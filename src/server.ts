import express from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// The SDK uses this same helper (with these defaults) when serializing
// registered tools, so the JSON-only list cannot drift from the SSE list
// even across zod major versions.
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MatchedRegionPolicy, MaterialGuideline, RegionalPolicyData, WasteItem, WasteMatch } from "./data.js";
import {
  collectionDayCheckLine,
  confidenceLabel,
  disposalGroupLabel,
  findBulkyWasteFeeRowTotal,
  hasFeeSpec,
  isCheckItemAnsweredByRegionGuide,
  findBulkyWasteFeeSchedule,
  findBulkyWasteFees,
  findMaterialGuideline,
  findNamedSubRegionForMatch,
  findRegionalPolicy,
  findRegionCollectionDaySource,
  findRegionItemGuide,
  findRegisteredDistricts,
  findWasteItems,
  formatItemGuide,
  formatRegionBulkyContactLines,
  formatRegionItemGuide,
  formatRegionSourceList,
  formatRegionSourceLines,
  regionCollectionSources,
  regionSourcesForItem,
  formatUnregisteredDistrictScope,
  inferMaterialCategories,
  isBulkySecondaryRoute,
  itemHasBulkyRoute,
  itemNeedsCriticalRegionCheck,
  itemNeedsRegionCheck,
  itemRegionCheckLabel,
  itemRegionGuidance,
  needsCollectionDaySource,
  publicReviewMetadata,
  regionalPolicies,
  resolveRegionalPolicy,
  resolveWasteItem,
  wasteItems,
  withCollectionDaySource,
  withCollectionDaySourceLine,
  REGION_SELECT_GUIDE_LINK,
} from "./data.js";
import type { DisposalWidgetPayload } from "./widgets.js";
import { buildDisposalWidget } from "./widgets.js";
import type { SpotCategory, SpotRow } from "./moe-spot-client.js";
import {
  categorizeSpotName,
  findSpotsByDong,
  hasSpotServiceKey,
  spotCategories,
  spotCategoryForItemId,
} from "./moe-spot-client.js";

const SERVICE_NAME = "RecyclingHelper(재활용척척)";
// PRD phase-3 R1. Exactly "false" turns widgets off; anything else (including an
// unset value) leaves them on, so QA can disable a misrendering card by
// redeploying with one env var instead of shipping a code change.
const WIDGET_ENABLED = process.env.WIDGET_ENABLED !== "false";
// Tool arguments and thrown messages can contain arbitrary user text. Keep
// production container logs aggregate-safe; local QA can opt into detail.
const CALL_LOG_DETAILS_ENABLED = process.env.CALL_LOG_DETAILS === "true";
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
// Suffix wildcards (leading "*.") cover whatever hostname PlayMCP in KC assigns
// to a newly created server, so a redeploy never needs a code change.
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]", "*.playmcp-endpoint.kakaocloud.io"];
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(","))
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://playmcp.kakaocloud.io",
  "https://playmcp.kakao.com",
  "https://preview-chatgpt.kakao.com",
  "https://tools.kakao.com",
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const DEFAULT_CORS_ALLOWED_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
].join(", ");
const SERVER_INFO = {
  name: "recycling-helper",
  version: "0.1.0",
};
const SERVER_INSTRUCTIONS =
  "Use RecyclingHelper(재활용척척) tools to answer Korean household waste disposal questions. " +
  "Prefer get_disposal_steps whenever the user asks how to throw away, discard, or recycle an item. " +
  "If a result is ambiguous, show the candidates and ask the user about material or usage instead of guessing. " +
  "If the user mentions where they live, pass it as the region argument. " +
  // 되묻기 금지. 요일은 동·주택 유형별로 갈려 우리가 값으로 주지 않는데, 모델이 그
  // 빈자리를 "사는 동이 어디세요"로 메우면 사용자가 답해도 줄 게 없다. 그 뒤 후속
  // 턴이 통째로 웹 검색으로 새는 걸 2026-08-19 Preview 측정에서 확인했다.
  "Collection days and times are deliberately not returned as values — get_region_disposal_info names the official page to check instead. " +
  "When the user asks which day to put waste out, call get_region_disposal_info and answer with that link; do NOT ask for their 동/neighborhood or apartment complex. " +
  "Keep answers concise and cite the provided sources; if local rules may differ, say that regional verification is needed.";

type JsonRpcId = string | number | null;
type JsonRpcBody = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = Record<string, unknown>;

const itemNameParam = z
  .string()
  .min(1)
  .max(80)
  .describe("Household waste item name or short description in Korean.");
const optionalRegionParam = z.string().max(80).optional().describe("Optional Korean city, district, or neighborhood.");
/**
 * 이름이 어디서 왔는지 알려주는 신호. 서버로 오는 건 어느 쪽이든 그냥 문자열이라,
 * 호스트가 얹어주지 않으면 사람이 직접 친 이름과 사진에서 알아본 이름을 구분할 수
 * 없다. 사진 쪽은 틀릴 확률이 눈에 띄게 높아서 확정 매칭에 확인 문구를 붙인다.
 *
 * 값은 "photo" 하나로 둔다. 늘리면 호스트가 매번 골라야 할 게 늘고 description 예산도
 * 같이 먹는데, 지금 필요한 판단은 "사진에서 왔나"뿐이다.
 *
 * 대신 `.catch(undefined)`로 느슨하게 받는다. 엄격한 enum이면 호스트가 "image"나 true
 * 같은 값을 얹었을 때 인자 검증에서 -32602로 떨어져 배출 안내를 통째로 잃는다. 이 값은
 * 로그 필드 하나일 뿐이라 답을 못 주는 대가를 치를 이유가 없다. 정확히 "photo"일 때만
 * 확인 문구와 로그가 붙고, 나머지는 이 파라미터가 없던 때처럼 조용히 무시된다.
 */
const inputSourceParam = z
  .enum(["photo"])
  .optional()
  .catch(undefined)
  .describe('Set to "photo" when itemName came from an image the user sent rather than text they typed.');

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

/**
 * Per-call log metadata. Handlers attach this as `_log` on their result;
 * withCallLog strips it before the result reaches any client. `matchedId` is
 * always a stable waste-item id (never a display name) so QA-window log
 * analysis can group across tools; matched regions go in `matchedRegion`.
 */
type ToolLogMeta = {
  matchedId?: string;
  matchedRegion?: string;
  /**
   * 지역 해상도 — R7 측정이 자치구 확정/광역 폴백/전국 폴백을 이 필드로 센다.
   * `district` | `metro` | `unregistered_district` | `ambiguous` | `unknown`.
   * `unregistered_district`는 사용자가 시·군·구를 댔는데 그 상세 데이터가 없어
   * 광역으로 착지한 경우다. 다음에 어느 지역을 채울지가 이 칸에서 보인다.
   */
  regionStatus?: string;
  score?: number;
  status?: string;
  matched?: number;
  total?: number;
  /**
   * not_found가 어느 폴백으로 착지했는지. 재질을 추정했으면 그 재질 id, 아무 단서도
   * 없어 메뉴만 펼쳤으면 `menu`다. 로그에서 품목명이 빠진 뒤 not_found 줄에 남는
   * 유일한 신호이고, 값은 재질 카탈로그에서 오므로 호출자 문자열이 섞이지 않는다.
   */
  fallbackTier?: string;
  /**
   * 품목명이 사진에서 왔는지. 사진 경로가 실제로 얼마나 들어오는지 세는 유일한 근거다.
   * `fallbackTier`와 같은 이유로 운영 로그에 그대로 남겨도 된다 — 값이 `"photo"`
   * 하나뿐이라 호출자 문자열이 섞일 자리가 없다.
   */
  inputSource?: InputSource;
  /**
   * 외부 조회가 어떻게 끝났는지 — `ok` | `timeout` | `http` | `empty` | `truncated`
   * (PRD phase-12 R6). `find_disposal_spots`에만 실린다. 사용자에게 나가는 응답은
   * 실패 종류를 감추고 폴백 하나로 접으므로, 이 칸이 **실패를 세는 유일한 자리**다.
   * 값은 클라이언트 모듈이 정하는 낱말이라 호출자 문자열도 키도 섞일 수 없다.
   */
  upstream?: string;
  /** 그 외부 조회에 걸린 시간. 툴 전체 `ms`와 갈라 봐야 느린 쪽이 우리인지 그쪽인지 안다. */
  upstreamMs?: number;
};

type InputSource = "photo";

/**
 * 사진에서 왔다는 표시는 매칭 결과와 상관없이 남긴다. 사진에서 알아본 이름일수록
 * 카탈로그에 없는 말로 나올 확률이 높은데, 확정된 호출만 세면 정작 궁금한 쪽(사진을
 * 보냈지만 답을 못 준 경우)이 통째로 빠진다.
 */
function withInputSourceLog(result: CallToolResult, inputSource?: InputSource): LoggedToolResult {
  if (!inputSource) return result;
  const { _log } = result as LoggedToolResult;
  return { ...result, _log: { ..._log, inputSource } };
}

type LoggedToolResult = CallToolResult & { _log?: ToolLogMeta };

type ToolDef<Shape extends ZodRawShape = ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  annotations: Record<string, unknown> & { title: string };
  handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<LoggedToolResult>;
};

// Erases the per-tool shape generic so defs can live in one array while each
// handler still type-checks against its own inputShape at the definition site.
function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * Single source of truth for tool metadata and handlers. The McpServer
 * registration (SSE path), the JSON-only discovery response, and JSON-only
 * tools/call dispatch are all generated from this list, so they can never
 * drift apart.
 */
const TOOL_DEFS: ToolDef[] = [
  defineTool({
    name: "classify_waste_item",
    title: "Classify Waste Item",
    description:
      "Quickly classifies a Korean household waste item with RecyclingHelper(재활용척척): answers which bucket the item goes in (재활용/일반쓰레기/음식물쓰레기/소형가전/불연성 폐기물/대형폐기물/특수·유해폐기물 — 재질이나 크기로 갈리는 품목은 '일반쓰레기/대형폐기물'처럼 주 배출로를 앞에 둔 복합 라벨) and what the verdict rests on. Use when the question is which bucket ONE item belongs in and a yes/no or a category name answers it — e.g. '피자박스 재활용 돼?', '종이컵은 일반쓰레기야?', '아이스팩 재활용 되는 품목이야?'. If the user asks how to throw it away, prefer get_disposal_steps; if they are weighing two items against each other, prefer check_confusing_item.",
    inputShape: {
      itemName: itemNameParam,
      region: optionalRegionParam,
    },
    annotations: {
      title: "Classify Waste Item",
      ...READ_ONLY_ANNOTATIONS,
    },
    handler: handleClassifyWasteItem,
  }),
  defineTool({
    name: "get_disposal_steps",
    title: "Get Disposal Steps",
    // 다섯 툴 중 가장 긴 description이라 1,024자 한도(docs/prd/phase-0-compliance.md R3,
    // docs/prd/README.md 본선 규격 요약)에 제일 먼저 닿는다. 발화 예시 네 개는 호스트
    // 라우팅의 근거라 그대로 두고 설명 문장을 눌러 담았다. 길이는 스모크가 지킨다.
    description:
      "Returns step-by-step disposal instructions for a Korean household waste item from RecyclingHelper(재활용척척): preparation steps, cautions, official sources, and region-specific notes when a region is given. The primary tool when a user asks how to throw away, discard, or recycle ONE thing — e.g. '기름 묻은 피자박스 어떻게 버려?', '깨진 유리컵 버리는 법', '폐건전지 어디다 버려?'. Use it even when they mention where they live — pass that as region for local rules and the bulky-waste fee — e.g. '강남구 사는데 침대 어떻게 버려?'. Accepts vague or partial names; if ambiguous, the result lists candidates to ask about. " +
      "When the user sends a photo instead of a name, pass only the object being discarded — not the room, background, or people — as itemName in everyday Korean (foam tray → 스티로폼 용기, snack bag → 과자봉지), adding the material when the object type alone is ambiguous, and set inputSource to \"photo\". For two or more items in one message — typed or in a photo — call make_cleanup_plan once instead.",
    inputShape: {
      itemName: itemNameParam,
      region: optionalRegionParam,
      inputSource: inputSourceParam,
    },
    annotations: {
      title: "Get Disposal Steps",
      ...READ_ONLY_ANNOTATIONS,
    },
    handler: handleGetDisposalSteps,
  }),
  defineTool({
    name: "check_confusing_item",
    title: "Check Confusing Item",
    description:
      "Explains commonly confused Korean waste-sorting cases with RecyclingHelper(재활용척척), comparing up to 3 similar items and their exceptions. Use when the question sets two things against each other or asks why a rule goes the way it does — e.g. '영수증은 종이인데 왜 재활용 안 돼?', '컵라면 용기는 종이야 플라스틱이야?', '종이컵이랑 종이팩이랑 같이 버려도 돼?'. For a single item with no comparison in the question, prefer classify_waste_item or get_disposal_steps.",
    inputShape: {
      itemName: z.string().min(1).max(80).describe("Confusing household waste item name or situation in Korean."),
    },
    annotations: {
      title: "Check Confusing Item",
      ...READ_ONLY_ANNOTATIONS,
    },
    handler: handleCheckConfusingItem,
  }),
  defineTool({
    name: "make_cleanup_plan",
    title: "Make Cleanup Plan",
    // 이 툴이 지금껏 안 뽑힌 자리를 그대로 메운 문구다. 예전 설명은 "품목을 배출 그룹으로
    // 묶어준다"가 골자여서, 모델이 이미 할 수 있다고 느끼면 그냥 자기 지식으로 답하고
    // 넘어갔다(Preview 측정, 2026-08-18: '강남구에서 이사가면서 침대랑 화분' 미호출).
    // 그래서 모델이 못 가진 값 — 지자체 고시 수수료 — 을 첫 문장에 세우고, 여러 품목일 때
    // get_disposal_steps를 반복 호출하지 말라는 경계를 명시한다.
    description:
      "Plans disposal for several Korean household waste items at once with RecyclingHelper(재활용척척): each item's bucket (재활용/일반쓰레기/대형폐기물/특수폐기물) plus that municipality's own bulky-waste fee figures with the date they were verified, when a region is given. The fees come from each 시·군·구 ordinance and are not general knowledge. Call this ONCE with every item in the list — do not call get_disposal_steps repeatedly for each one. Use whenever the user names two or more things to throw away, or mentions moving out, decluttering, or a big cleanup — e.g. '이사 가는데 침대, 옷, 화분 버려야 해', '강남구에서 이사가면서 침대랑 화분 버리려는데 어떻게 버려?', '대청소했더니 버릴 게 한가득이야'. Pass the region whenever the user names where they live.",
    inputShape: {
      items: z
        .array(z.string().min(1).max(80))
        .min(1)
        .max(30)
        .describe("List of household waste item names in Korean."),
      region: optionalRegionParam,
    },
    annotations: {
      title: "Make Cleanup Plan",
      ...READ_ONLY_ANNOTATIONS,
    },
    handler: handleMakeCleanupPlan,
  }),
  defineTool({
    name: "get_region_disposal_info",
    title: "Get Region Disposal Info",
    description:
      "Returns municipality-specific waste disposal information for a Korean region from RecyclingHelper(재활용척척): bulky-waste application links and fees, special collection points (batteries, medicine, clothing), what to verify locally, and official local sources. It does not return collection days as fixed values — those vary by 동 and building type, so the checklist names the official page to check and links it. Answer day questions with that link instead of asking which 동 or apartment complex the user lives in. Use when the region itself is the question — e.g. '성남시 대형폐기물 신고 어떻게 해?', '우리 동네 분리수거 어떻게 해?', '강남구 폐건전지 어디에 버려?'. If the user asks how to dispose of a specific item and only mentions their area in passing ('강남구 사는데 침대 어떻게 버려?'), use get_disposal_steps with the region parameter instead — except day or time questions, which belong here even when an item is named ('강남구 비닐 목요일 배출 맞아?'); get_disposal_steps covers days for only some items. Optional itemName narrows the checklist to that item.",
    inputShape: {
      region: z.string().min(1).max(80).describe("Korean city, district, or neighborhood."),
      itemName: z.string().max(80).optional().describe("Optional household waste item name in Korean."),
    },
    annotations: {
      title: "Get Region Disposal Info",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
    handler: handleGetRegionDisposalInfo,
  }),
  /**
   * PRD phase-12 D3. **키가 없으면 이 툴은 목록에 아예 나오지 않는다.** 등록해 놓고 매번
   * 폴백으로 내려앉는 것보다 호스트가 처음부터 다른 툴을 고르는 쪽이 낫고, 키 env를 비우고
   * 재배포하는 것이 그대로 되돌리기 스위치가 된다 — 별도 플래그는 두지 않는다.
   *
   * **거르는 자리는 여기 하나여야 한다.** 등록(SSE)·JSON-only 목록·JSON-only 디스패치가
   * 전부 `TOOL_DEFS`에서 파생되므로, 갈래 하나만 걸러내면 "두 목록은 바이트 동일" 불변식이
   * 조용히 깨진다.
   */
  ...(hasSpotServiceKey()
    ? [
        defineTool({
          name: "find_disposal_spots",
          title: "Find Disposal Spots",
          description:
            "Finds real collection-point addresses in a Korean neighborhood with RecyclingHelper(재활용척척): medicine, battery·fluorescent-lamp, clothing, small-electronics, PET-bottle and food-waste drop-off points, each with its place name and street address. Use when the question is WHERE to drop something off — e.g. '상계동 폐의약품 수거함 어디야', '역삼동에서 헌옷수거함 어디 있어', '폐건전지 버리는 곳 알려줘'. Needs a 법정동 name such as 상계동 or 역삼동; forms like 상계1동 are normalized, but a 구·시 name alone (강남구, 서울) finds nothing — ask the user which 동 they live in. Pass region when they name their city or district ('서울 노원구') so same-named 동 in other cities are filtered out, and itemName to narrow the answer to one kind of collection point. If they ask HOW to throw something away rather than where, use get_disposal_steps instead.",
          inputShape: {
            // `.trim()`이 스키마 단계에서 공백을 걷는다 — " "가 통과하면 정규화 뒤 빈 addr로
            // 업스트림 한도를 쓰고 "## 서울 노원구  근처"처럼 빈 이름이 찍힌다.
            dong: z
              .string()
              .trim()
              .min(1, "법정동 이름이 필요합니다 — 예: 상계동.")
              .max(40)
              .describe("Korean legal-status neighborhood name (법정동), e.g. 상계동."),
            region: optionalRegionParam,
            itemName: z.string().max(80).optional().describe("Optional household waste item name in Korean."),
          },
          annotations: {
            title: "Find Disposal Spots",
            readOnlyHint: true,
            destructiveHint: false,
            // 유일하게 외부 서비스를 부르는 툴이다. 답이 우리 데이터만으로 정해지지 않는다.
            openWorldHint: true,
            idempotentHint: true,
          },
          handler: handleFindDisposalSpots,
        }),
      ]
    : []),
];

const COMPAT_TOOLS = TOOL_DEFS.map((def) => ({
  name: def.name,
  title: def.title,
  description: def.description,
  inputSchema: toJsonSchemaCompat(z.object(def.inputShape)),
  annotations: def.annotations,
  // The SDK defaults registered tools to taskSupport "forbidden"; mirror it so
  // the JSON-only list stays byte-identical to the SSE list.
  execution: { taskSupport: "forbidden" },
}));

function itemTopSources(item: WasteItem, limit = 2): Array<{ title: string; url?: string }> {
  if (item.sources?.length > 0) {
    return item.sources.slice(0, limit).map((source) => ({ title: source.title, url: source.url }));
  }

  return item.sourceRefs.slice(0, limit).map((title) => ({ title }));
}

/**
 * Region-specific guidance lines for structuredContent, gated the same way the
 * text path (formatItemGuide) gates them: only when the item has a
 * region-specific guide or the region check is critical. Advisory-only items
 * get no region lines, keeping "no region noise" responses noise-free.
 *
 * 예외는 요일 불변식 하나다. 위젯 응답의 content는 카드 JSON이라 완성된 답변에
 * 문장을 이어 붙일 자리가 없어서, 요일을 닫는 줄도 여기서 실어야 한다 — 안 그러면
 * 카드에도 구조화 출력에도 확인처가 없다. 참고 등급인 `빈 약통`이 그랬다.
 */
function buildRegionNotes(item: WasteItem, regionMatch: MatchedRegionPolicy | undefined, region?: string): string[] | undefined {
  if (!itemNeedsRegionCheck(item)) return undefined;

  const hasSpecificGuide = Boolean(regionMatch && findRegionItemGuide(regionMatch.region, item));
  // 지역 툴과 같은 갈래. 시·군·구를 이미 댄 사람에게 되묻는 대신 그 이름을 부른다.
  // 줄 수는 그대로다 — 되묻기 한 줄이 이름 부르기 한 줄로 바뀔 뿐이라 카드의
  // 지역 줄 두 개 예산을 밀지 않는다.
  const lines =
    regionMatch && (hasSpecificGuide || itemNeedsCriticalRegionCheck(item))
      ? formatRegionItemGuide(item, regionMatch, { namedSubRegion: findNamedSubRegionForMatch(regionMatch, region) })
      : [];

  // 판정 범위는 카드가 실제로 싣는 것 — 품목 단계·주의와 위 지역 줄들이다. 참고 등급
  // 품목은 지역 줄이 아예 없어 `steps`의 "플라스틱류 배출 요일과 장소는 지역 기준을
  // 확인합니다" 한 줄만 나가고 있었다. 닫는 줄은 맨 앞에 둔다. 카드는 지역 줄을 두 개까지
  // 자르는데, 뒤에 붙이면 지역 안내가 긴 품목에서 확인처부터 잘려 나간다.
  const body = [...item.steps, ...item.cautions, ...lines].join("\n");
  const notes = needsCollectionDaySource(body, regionMatch) ? [`- ${collectionDayCheckLine(regionMatch)}`, ...lines] : lines;

  return notes.length > 0 ? notes : undefined;
}

/**
 * PRD phase-3 R2-1. The card can only carry two region lines, and
 * formatRegionItemGuide orders its output boilerplate-first, fee-table-last — so
 * the fee, which is the whole reason someone names their 구, was always the part
 * that got cut. Condensed to one line here (the builder must not recompute) and
 * rendered outside the card's two-line region budget.
 */
function buildRegionFeeLine(item: WasteItem, regionMatch?: MatchedRegionPolicy): string | undefined {
  if (!regionMatch) return undefined;

  const fees = findBulkyWasteFees(regionMatch.region, item);
  if (fees.length === 0) return undefined;

  const krw = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const amounts = fees.map((fee) => fee.feeKrw);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);

  // 수수료는 품목이 아니라 지역 고시에서 오고, 확인일도 거기 따로 붙어 있다(2025-11-03 ~
  // 2026-08-16으로 흩어져 있다). 카드 맨 아래 근거 줄은 sources[0]의 날짜라, 이 줄에 날짜가
  // 없으면 바로 위에 놓인 수수료가 품목 출처를 확인한 날에 확인된 값으로 읽힌다.
  // 스케줄이 없으면 날짜 없이 둔다 — 추측한 확인일은 없는 것보다 나쁘다.
  const checkedAt = findBulkyWasteFeeSchedule(regionMatch.region)?.checkedAt;
  const paren = (detail: string) => (checkedAt ? `(${detail}, ${checkedAt} 확인)` : `(${detail})`);

  // A single tier can name itself; several tiers become a range, because listing
  // four specs would blow the card and picking one for the user would be a guess.
  //
  // 규격 칸이 빈 행(`-`)은 이름을 댈 게 없다. 그 값을 그대로 끼우면 카드와
  // `make_cleanup_plan`이 `수수료 1,000원 (-, 2026-08-22 확인)`으로 나간다 —
  // 마포 `빨래건조대`·`욕조` 등 10쌍이 그랬다(PRD phase-11 R3). 그때는 날짜만 남긴다.
  if (fees.length === 1) {
    if (!hasFeeSpec(fees[0])) return checkedAt ? `수수료 ${krw(min)} (${checkedAt} 확인)` : `수수료 ${krw(min)}`;
    return `수수료 ${krw(min)} ${paren(fees[0].spec)}`;
  }

  // 상한에 걸린 품목은 `fees.length`가 우리가 들고 있는 행 수지 규격 수가 아니다.
  // 그냥 "규격 12종"이라고 쓰면 텍스트 답변은 "대표 12행만"이라고 밝히는데 카드만
  // 12종이 전부인 척한다. 최저~최고 범위는 그대로 참이다 — 임포터가 잘라낼 때
  // 양 끝 행을 남긴다. 잘린 쪽은 행으로 말한다 — 잘리기 전 숫자는 (고시명, 규격,
  // 금액)으로 중복을 지운 행 수지 규격 종류 수가 아니라서다(노원 매트리스 21행은
  // 고시명 3종 × 규격 ~7종).
  const rowTotal = findBulkyWasteFeeRowTotal(regionMatch.region, item);
  // 여러 행인데 규격 칸이 전부 빈 경우도 있다 — 마포구 `피아노`는 `피아노`와 `전자피아노(오르간)`
  // 두 고시명이 규격 없이 금액만 다르다. 그걸 `규격 2종`이라고 쓰면 고시에 없는 구분을 지어내는
  // 셈이라, 그때는 행으로 말한다(PR #74 리뷰 1라운드).
  const specDetail = rowTotal
    ? `수수료표 ${rowTotal}행 중 대표 ${fees.length}행`
    : // 한 행이라도 규격 칸이 비어 있으면 "규격 N종"이 아니다. 마포구 `운동기구`는 세 행 중
      // 둘만 규격을 대고(`러닝머신`은 `-`) 있어 `규격 3종`은 없는 구분을 하나 지어낸다.
      // 섞인 조합이 마포 둘뿐이라 눈에 안 띄었다(PR #74 리뷰 3라운드).
      fees.every(hasFeeSpec)
      ? `규격 ${fees.length}종`
      : `수수료표 ${fees.length}행`;
  return `수수료 ${krw(min)}~${krw(max)} ${paren(specDetail)}`;
}

function textResult(text: string, structuredContent?: ToolResult, log?: ToolLogMeta): LoggedToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(log ? { _log: log } : {}),
  };
}

/**
 * 위젯 응답에도 텍스트 경로와 같은 structuredContent를 싣는다(phase-3 R4 결정 변경,
 * 2026-08-18). 카드는 렌더링용이고 모델이 추론·인용할 데이터는 structuredContent 쪽이다 —
 * 카드만 보내면 호스트 모델이 UI 마크업을 읽고 답을 재구성해야 하고, 확신도처럼 카드가
 * 줄 수 예산 때문에 접어둔 신호는 그 턴에서 복구할 길이 없었다.
 *
 * `_log`의 status는 그대로 명시한다. callStatus()가 structuredContent에서 추론할 수
 * 있게 됐지만, 이 값이 응답 모양에 딸려가면 응답을 고치다 본선 집계가 조용히 어긋난다.
 */
function widgetResult(
  payload: DisposalWidgetPayload,
  structuredContent: ToolResult,
  log: ToolLogMeta,
): LoggedToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent,
    _log: { ...log, status: "match" },
  };
}

function briefSourceLabel(item: WasteItem): string {
  const source = item.sources[0];
  if (source) {
    const basis = source.basis ? ` - ${source.basis}` : "";
    const url = source.url ? ` (${source.url})` : "";
    return `${source.title}${basis}${url}`;
  }

  return item.sourceRefs[0] ?? "재활용척척 보수 안내 정책";
}

// Title-only variant for list-shaped outputs (cleanup plan) where the full
// basis + URL label would balloon the text for every item.
function briefSourceTitle(item: WasteItem): string {
  return item.sources[0]?.title ?? item.sourceRefs[0] ?? "재활용척척 보수 안내 정책";
}

// Reads the same sources[0] briefSourceTitle does, so a card can never date a
// different source than the one it names. The sourceRefs fallback is a bare
// title with no date attached, hence undefined rather than a guess.
function briefSourceCheckedAt(item: WasteItem): string | undefined {
  return item.sources[0]?.checkedAt;
}

const FALLBACK_ASK_FOR = ["재질", "오염 여부", "크기", "지역"];
// Material menu shown when the query gives no material hint. Kept to 5 one-line
// rules to respect the Phase 0 response-size budget.
const FALLBACK_MENU_MATERIAL_IDS = ["plastic_container", "vinyl_film", "paper_cardboard", "can_metal", "general_trash"];
const FALLBACK_STEP_LIMIT = 2;

function isMaterialGuideline(guideline: MaterialGuideline | undefined): guideline is MaterialGuideline {
  return guideline !== undefined;
}

// not_found means findWasteItems already came back empty for this query, so the
// answer is the material fallback: inferred principles when the query names a
// material, otherwise the one-line menu.
/**
 * 못 찾았을 때 한 줄이라도 쥐여 보내는 재질 원칙. `get_disposal_steps`의 not_found는
 * 전용 폴백(`unknownItemResult`)이 재질 메뉴까지 펼치지만, `make_cleanup_plan`과
 * `get_region_disposal_info`는 한 줄짜리 요약 자리뿐이라 이쪽을 쓴다.
 * 추정되는 재질이 없으면 빈 문자열이라 문구가 늘어지지 않는다.
 */
function materialPrincipleSuffix(itemName: string): string {
  const principle = inferMaterialCategories(itemName, 1).map(findMaterialGuideline).filter(isMaterialGuideline)[0];
  return principle ? ` 재질로 보면 ${principle.label}: ${principle.quickRule}` : "";
}

function unknownItemResult(itemName: string): LoggedToolResult {
  const inferred = inferMaterialCategories(itemName).map(findMaterialGuideline).filter(isMaterialGuideline);
  const isInferred = inferred.length > 0;
  const guidelines = isInferred
    ? inferred
    : FALLBACK_MENU_MATERIAL_IDS.map(findMaterialGuideline).filter(isMaterialGuideline);

  const lines = [
    `입력한 품목 "${itemName}"을(를) 초기 데이터에서 확실히 찾지 못했습니다.`,
    `품목의 ${FALLBACK_ASK_FOR.join(", ")} 정보를 함께 알려주면 더 정확히 판단할 수 있습니다.`,
    "",
    isInferred ? "재질로 추정한 일반 원칙:" : "주요 재질별 한 줄 원칙:",
  ];

  for (const guideline of guidelines) {
    lines.push(`- ${guideline.label}: ${guideline.quickRule}`);
    if (!isInferred) continue;
    for (const step of guideline.steps.slice(0, FALLBACK_STEP_LIMIT)) {
      lines.push(`  - ${step}`);
    }
    lines.push(`  - 재활용이 어려운 경우: ${guideline.whenGeneral}`);
  }

  return textResult(
    lines.join("\n"),
    {
      found: false,
      itemName,
      fallback: {
        inferred: isInferred,
        materials: guidelines.map((guideline) => ({
          id: guideline.id,
          label: guideline.label,
          quickRule: guideline.quickRule,
          ...(isInferred
            ? {
                steps: guideline.steps.slice(0, FALLBACK_STEP_LIMIT),
                whenGeneral: guideline.whenGeneral,
                source: guideline.source,
              }
            : {}),
        })),
        askFor: FALLBACK_ASK_FOR,
      },
    },
    // 품목명이 로그에서 빠진 뒤로 not_found 줄에는 status와 ms만 남는다. 어느 재질로
    // 착지했는지, 단서가 없어 메뉴만 폈는지라도 남겨야 폴백 품질을 집계로 본다.
    // 추정이 없을 때의 guidelines는 고정 메뉴라 그 첫 항목을 쓰면 추정한 재질처럼 읽힌다.
    { status: "not_found", fallbackTier: isInferred ? (inferred[0]?.id ?? "menu") : "menu" },
  );
}

function ambiguousCandidateLabel(match: WasteMatch): string {
  if (match.matchedBy === match.item.name) {
    return match.item.name;
  }

  return `${match.matchedBy} (${match.item.name})`;
}

function ambiguousCandidateDetails(match: WasteMatch): ToolResult {
  return {
    itemId: match.item.id,
    itemName: match.item.name,
    matchedBy: match.matchedBy,
  };
}

// A one-candidate resolution is a typo guess, not a list of matches — Phase 1
// typo matching made that the common shape, so every site that renders
// candidates has to ask instead of claiming several items matched.
function didYouMeanQuestion(candidateLabel: string): string {
  return `혹시 "${candidateLabel}"을(를) 찾으시나요?`;
}

function ambiguousCandidateSummary(candidateLabels: string[]): string {
  return candidateLabels.length === 1
    ? `${didYouMeanQuestion(candidateLabels[0])} 맞다면 그 품목명으로 다시 물어봐 주세요.`
    : `여러 품목에 해당할 수 있어 하나로 확정하지 못했습니다. (후보: ${candidateLabels.join(", ")})`;
}

function ambiguousItemResult(itemName: string, candidates: WasteMatch[]): CallToolResult {
  const candidateLabels = candidates.map(ambiguousCandidateLabel);
  const text =
    candidateLabels.length === 1
      ? [
          `입력한 품목 "${itemName}"을(를) 정확히 찾지 못했습니다. ${didYouMeanQuestion(candidateLabels[0])}`,
          "맞다면 그 품목명으로 다시 물어봐 주세요. 아니라면 재질, 용도, 크기를 알려주시면 다시 판단하겠습니다.",
        ].join("\n")
      : [
          `입력한 품목 "${itemName}"은(는) 여러 품목에 해당할 수 있어 하나로 확정하지 못했습니다.`,
          `후보: ${candidateLabels.join(", ")}`,
          "재질, 용도, 크기를 조금 더 구체적으로 알려주시면 정확히 판단할 수 있습니다.",
        ].join("\n");

  return textResult(text, {
    found: false,
    ambiguous: true,
    itemName,
    candidates: candidateLabels,
    candidateDetails: candidates.map(ambiguousCandidateDetails),
  });
}

/**
 * 불변식: **응답이 요일을 언급하면 그 응답 어딘가에 요일 확인처가 있어야 한다.**
 * 문장과 판정은 `data.ts`가 한 벌만 들고 있다(`collectionDayCheckLine`,
 * `needsCollectionDaySource`) — 호출부마다 다시 쓰면 어긋나는 순간 조용히 샌다.
 *
 * 체크 항목만 보고 붙이던 게 화근이었다. 지역 요약은 자치구 48곳 모두 "배출 요일과
 * 시간은 동·주택 유형별로 갈려 이 데이터에는 넣지 않았습니다"로 끝나는데, 품목이 붙어
 * 체크리스트가 그 품목으로 좁혀지면(침대처럼 요일과 무관한 대형폐기물이 그렇다) 요일
 * 줄이 통째로 빠진다. 그러면 응답은 **요일을 못 준다고 말해놓고 어디서 확인하는지는
 * 안 말하는** 모양이 된다 — 되묻기를 부른 게 바로 그 모양이라, 지역만 물었을 때보다
 * 오히려 나쁘다.
 *
 * 그래서 좁힌 목록에 요일 줄이 있으면 거기에 확인처를 잇고(`withCollectionDaySource`),
 * 없으면 여기서 요일 확인 항목을 한 줄 더해 닫는다. 일반 체크리스트를 통째로 되살리지는
 * 않는다 — 좁히기는 의도한 동작이고, 침대를 물은 사람에게 폐형광등 수거함까지 돌려줄
 * 이유는 없다. 요일을 아무 데서도 말하지 않는 응답에는 아무것도 더하지 않는다.
 *
 * **판정에는 응답 본문(`answerText`)도 함께 넣는다.** 예전에는 체크 항목만 보고 "아직
 * 안 닫혔다"고 판단했는데, 그 사이 `formatRegionItemGuide`가 지역 요약 줄에서 직접
 * 닫게 되면서 이미 확인처가 실린 응답에 체크리스트 줄이 하나 더 붙었다 — 같은 주소가
 * 한 응답에 두 번 나갔다(강남구 + 뚝배기). 닫혔는지는 응답 전체를 보고 정해야 한다.
 */
function closeCollectionDayMention(checks: string[], answerText: string, region?: MatchedRegionPolicy): string[] {
  if (!needsCollectionDaySource([...checks, answerText].join("\n"), region)) return checks;
  return [...checks, collectionDayCheckLine(region)];
}

function generalRegionCheckList(region: MatchedRegionPolicy): string[] {
  return [
    collectionDayCheckLine(region),
    "불연성 폐기물 봉투, 특수마대, PP봉투 등 지역 지정 봉투 기준",
    "음식물류폐기물 전용봉투, RFID, 제외 품목",
    "대형생활폐기물 사전 신청과 수수료",
    "폐건전지, 폐형광등, 폐의약품, 폐식용유, 의류수거함 위치",
  ];
}

function unknownRegionCheckList(item?: WasteItem): string[] {
  if (!item) {
    return [
      // 지역을 못 찾은 자리다. `백현동`처럼 동 이름만 온 경우가 여기로 떨어지는데,
      // 하필 모델이 되물어서 받아낸 답이 이쪽으로 오기 쉽다. 지자체를 모르니 전국
      // 지역별 안내로 닫는다.
      collectionDayCheckLine(),
      "품목별 전용 수거함 위치",
      "대형폐기물 신고 페이지와 수수료",
      "폐건전지, 폐형광등, 폐의약품 등 생활계 유해폐기물 수거 장소",
      "아파트, 단독주택, 상가 등 주택 유형별 배출 방식",
    ];
  }

  if (!itemNeedsRegionCheck(item)) {
    return withCollectionDaySource(["거주지 종량제봉투 또는 재활용품 배출 요일과 장소"]);
  }

  // 지역을 못 찾았어도 요일 줄은 링크로 닫는다. 지자체를 모르니 전국 지역별 안내가 붙는다.
  return withCollectionDaySource(
    itemNeedsCriticalRegionCheck(item)
      ? item.regionPolicy?.checkItems ?? ["전용 수거함, 지정 수거처, 신고 또는 수수료 기준"]
      : item.regionPolicy?.checkItems ?? ["실제 배출 요일·장소나 수거함·회수 가능 여부"],
  );
}

/**
 * `확인할 정보`는 이름 그대로 **사용자가 아직 직접 확인해야 할 것**의 목록이다. 그런데 같은
 * 응답 위쪽에서 이미 답한 것을 다시 싣고 있었다 — 수수료 행 12줄이 바로 위 `수수료 후보`
 * 블록과 같은 값이었고(노원구 `매트리스`에서 1,035B), 품목별 지역 안내의 steps와 지역 안내가
 * 답한 `checkItems`도 마찬가지였다(PRD phase-11 R2).
 *
 * 판정은 **그 응답에 실제로 찍힌 줄**로 한다. 어느 갈래가 답했는지를 플래그로 세면 문장이
 * 자유로운 갈래(`itemGuides`)에서 어긋난다 — Phase 10 R2-b가 같은 이유로 같은 방식을 택했다.
 * 넘기는 줄은 대형폐기물 연락처 블록과 품목별 안내 블록이다. **지역 요약은 넘기지 않는다** —
 * 지역 전체를 훑는 문장이라 낱말만 스쳐도 답한 것으로 잡힌다(Phase 10 3라운드에서 같은 이유로 뺐다).
 */
type RegionCheckListOptions = {
  /** 이 응답 위쪽에 이미 찍힌 지역 안내 줄들. 비면 아무것도 거르지 않는다. */
  answeredLines?: readonly string[];
};

function itemRegionCheckList(
  region: MatchedRegionPolicy | undefined,
  item?: WasteItem,
  { answeredLines = [] }: RegionCheckListOptions = {},
): string[] {
  if (!region) return unknownRegionCheckList(item);
  if (!item) return generalRegionCheckList(region);

  const guide = findRegionItemGuide(region.region, item);
  const feeRows = findBulkyWasteFees(region.region, item);
  // 이 체크리스트도 수수료 행을 전부 펼친다. 상한에 걸린 품목이면 여기서도 잘리므로
  // 잘렸다는 사실을 같이 내보낸다. 출처 URL은 바로 위 `formatRegionBulkyContactLines`가
  // "수수료 조회"로 이미 찍는다 — 체크 항목은 한 줄짜리라 주소까지 넣지 않는다.
  // 수수료는 행을 하나씩 옮기지 않고 범위 한 줄로 접는다. 행을 펼치면 바로 위 `수수료 후보`
  // 블록과 같은 값이 12줄까지 되풀이된다 — 노원구 `매트리스`에서 1,035B였다.
  //
  // **한 줄은 남겨야 한다.** 이 툴의 structuredContent에서 금액이 실리는 자리는 `checkList`뿐이라
  // (`regionFeeLine` 같은 필드가 없다), 통째로 지우면 구조화 출력만 읽는 모델이 수수료를 잃는다.
  // 문구는 카드가 쓰는 `buildRegionFeeLine`을 그대로 쓴다.
  //
  // 처음에는 "위에 블록이 찍혔을 때만" 접고 아니면 행을 펼치게 두었는데, 그 갈래는 도달하지
  // 않는다 — 수수료가 붙는 품목은 배출 그룹 라벨에 대형폐기물이 들어가야 하고, 그런 키는
  // 전부 `bulky`를 담고 있어 `formatRegionItemGuide`가 늘 블록을 낸다. 닿지 않는 갈래를 남기면
  // 회귀가 그 위를 헛돈다(PR #74 리뷰 3라운드).
  //
  // 보조 배출로인 품목에는 카드·플랜과 같은 단서를 여기서도 단다. 안 그러면 `다리미판`처럼
  // 종량제봉투가 기본인 품목의 체크리스트만 금액을 조건 없이 말해, 같은 품목·지역에서
  // 툴마다 다른 말을 한다(PR #74 리뷰 2라운드).
  const feeSummary = feeRows.length > 0 ? buildRegionFeeLine(item, region) : undefined;
  const feeChecks = feeSummary
    ? [isBulkySecondaryRoute(item) ? `대형폐기물에 해당할 때만 ${feeSummary}` : `품목별 ${feeSummary}`]
    : [];

  // 걸러 낸 결과가 비면 거르기 전 목록을 그대로 쓴다. 빈 목록은 아래 폴백으로 떨어지는데,
  // 그 폴백은 품목을 모를 때 쓰는 일반 문장이라 **품목별 항목보다 나쁘다** — `변기커버`처럼
  // 확인 항목이 하나뿐이고 그게 위에서 답해진 품목이 "전용 수거함, 지정 수거처, …"로
  // 되돌아가, 대형폐기물 품목에 수거함을 묻고 수수료를 다시 묻는다(PR #74 리뷰 2라운드).
  const declaredChecks = item.regionPolicy?.checkItems ?? [];
  const keptChecks = declaredChecks.filter(
    (checkItem) => !isCheckItemAnsweredByRegionGuide(checkItem, answeredLines, item, region),
  );

  // 품목별 안내의 steps는 위 블록과 겹치지만 **그대로 둔다.** 이 툴의 structuredContent에서
  // 지역별 품목 안내가 실리는 자리가 `checkList`뿐이라(위 수수료 한 줄을 남기는 이유와 같다),
  // 여기서 빼면 구조화 출력만 읽는 호스트가 마포구 `의자`의 지역 안내를 통째로 잃는다.
  // 텍스트에 두 번 나가는 값은 그 대가로 치른다 — 정보를 지우는 것보다 낫다(PR #74 리뷰 1라운드).
  const otherChecks = [...(guide ? guide.steps : []), ...feeChecks];

  // 되살리는 건 **목록 전체가 빌 때만**이다. 수수료 줄이나 안내 steps가 남아 있으면 목록은
  // 이미 서 있으므로, 답해진 항목까지 되살리면 품목 툴이 지운 것을 이 툴만 다시 묻는다 —
  // 노원구 `욕실 발매트`가 그 자리였다(PR #74 리뷰 3라운드).
  //
  // 그래도 남는 비대칭이 있다. 확인 항목이 하나뿐이고 그게 답해졌으며 수수료도 안내도 없는
  // 품목(`변기커버`·`고양이 스크래처` 등 20조합)은 품목 툴이 `확인 항목:`을 아예 안 내는데
  // 이 툴은 되살려 한 줄을 낸다. 두 툴이 **다르게 답하는** 게 아니라 이 툴이 한 줄 더 내는
  // 쪽이라 그대로 둔다 — 이 툴의 `확인할 정보`는 제목이 늘 서는 뼈대라, 비우면 답이 끊긴
  // 것처럼 보이고 일반 폴백으로 떨어지면 대형폐기물 품목에 수거함을 묻게 된다.
  const checks = [
    ...(keptChecks.length > 0 || otherChecks.length > 0 ? keptChecks : declaredChecks),
    ...otherChecks,
  ].filter(Boolean);

  if (checks.length > 0) return withCollectionDaySource(Array.from(new Set(checks)), region);
  if (!itemNeedsRegionCheck(item)) return withCollectionDaySource(["거주지 종량제봉투 또는 재활용품 배출 요일과 장소"], region);
  if (itemNeedsCriticalRegionCheck(item)) return withCollectionDaySource(["전용 수거함, 지정 수거처, 신고 또는 수수료 기준"], region);
  return withCollectionDaySource(["실제 배출 요일·장소나 수거함·회수 가능 여부"], region);
}

/**
 * 지역 해상도 한 낱말, 품목 툴 쪽. 세 툴이 같은 어휘로 남겨야 집계가 한 축으로 서는데
 * 지역 툴만 값을 남기고 있었다 — 사용자가 자기 구를 말하는 건 오히려 품목 질문 쪽이 더
 * 흔하다("청주시 사는데 소파 어떻게 버려?").
 *
 * `unknown`은 "찾아봤는데 없더라"만 뜻한다. 찾아본 적 없는 호출까지 거기 뭉치면 이 필드가
 * 재려는 미등록 지역 수요가 통째로 부풀려진다.
 */
function regionStatusFor(region: string | undefined): string | undefined {
  // 안 물었으면 이 축에 셀 것이 없다. 공백만 넣은 것도 안 물은 것으로 본다 —
  // `optionalRegionParam`에 `.min(1)`도 trim도 없어서 `" "`가 그대로 들어오고,
  // 그대로 조회하면 `unknown`이 되어 "찾아봤는데 없더라" 칸을 오염시킨다.
  if (!region?.trim()) return undefined;
  const resolved = resolveRegionalPolicy(region);
  if (resolved.status === "match") {
    return findNamedSubRegionForMatch(resolved.match, region) ? "unregistered_district" : resolved.match.level;
  }
  // 되묻기 갈래를 살려둔다. `findRegionalPolicy`는 그 상태를 버리고 undefined만
  // 돌려주므로, 그것만 보면 같은 질의가 지역 툴에서는 `ambiguous`, 품목 툴에서는
  // `unknown`으로 갈려 세 툴을 한 축으로 못 센다.
  return resolved.status === "ambiguous" ? "ambiguous" : "unknown";
}

/**
 * 품목이 확정됐을 때의 지역 해상도. 지역을 물었어도 그 품목은 지역이 답을 바꾸지 않아
 * 조회 자체를 안 한 경우가 있다 — 두 핸들러가 `itemNeedsRegionCheck`로 막고, 324개 중
 * 224개가 여기 해당한다. 그 호출까지 `unknown`으로 세면 미등록 지역 수요가 부풀려진다.
 *
 * 값은 `regionStatusFor`가 다시 계산한다. `regionMatch`를 넘겨받아 아끼는 대신 한 곳에서만
 * 정의되게 뒀다 — 어휘가 갈리면 집계가 조용히 어긋나는 쪽이 더 비싸다.
 */
function itemRegionStatus(region: string | undefined, item: WasteItem): string | undefined {
  return itemNeedsRegionCheck(item) ? regionStatusFor(region) : undefined;
}

/**
 * 품목을 못 찾았거나 되물어야 하는 갈래에도 지역 해상도를 남긴다. 두 핸들러가 그 갈래에서
 * 먼저 return하는 바람에, 지역을 댔는데도 로그에는 안 물은 것처럼 남았다.
 * **하필 이쪽이 이 필드가 재려는 수요 그 자체다** — 미등록 지역 사람이 카탈로그에 없는
 * 품목을 묻는 경우라, 빠지면 "그 지역을 채워야 한다"는 신호가 가장 센 표본을 놓친다.
 */
function withRegionStatusLog(result: LoggedToolResult, region: string | undefined): LoggedToolResult {
  const regionStatus = regionStatusFor(region);
  return regionStatus ? { ...result, _log: { ...result._log, regionStatus } } : result;
}

/**
 * The card for a confirmed match, shared by the two tools that resolve a single
 * item. Kakao renders a widget as-is while a text answer is the host's to
 * rewrite (Kakao Tools 개발 가이드 §3), and the `Kakao Tools · 재활용척척` label
 * only rides along on widget responses — so which of the two tools the host
 * happened to pick should not decide whether the user gets a card.
 */
function matchedItemWidget(
  item: WasteItem,
  regionMatch: MatchedRegionPolicy | undefined,
  // 이름으로 받는다. 둘 다 optional string이라 자리로 넘기면 서로 바꿔 넣어도 타입이
  // 잡아주지 않는다 — 실제로 사진 경로와 지역 되부르기를 합치다 region이 photoNote
  // 자리로 들어가 카드에 지역 문자열이 캡션으로 뜰 뻔했다.
  extras: {
    /** 사진에서 알아본 이름을 되비추는 확인 문구. 사진으로 들어온 호출에만 있다. */
    photoNote?: string;
    /** 사용자가 댄 원본 지역 문자열. 광역으로 착지했을 때 그 사람이 말한 시·군·구를 되부르는 데 쓴다. */
    region?: string;
  } = {},
): DisposalWidgetPayload {
  return buildDisposalWidget({
    item,
    sourceTitle: briefSourceTitle(item),
    sourceCheckedAt: briefSourceCheckedAt(item),
    regionName: regionMatch?.region.name,
    regionNotes: buildRegionNotes(item, regionMatch, extras.region),
    regionFeeLine: buildRegionFeeLine(item, regionMatch),
    photoNote: extras.photoNote,
  });
}

/**
 * 사진으로 들어온 요청에 붙는 확인 한 줄. 잘못 알아본 이름도 확정 매칭으로 착지하면
 * 그대로 확정된 답이 되므로, 어느 품목으로 안내하는지 밝히고 고칠 길을 열어둔다.
 *
 * 되비추는 값은 호스트가 넘긴 문자열이 아니라 서버가 고른 품목명(item.name)이다.
 * 사용자가 바로잡아야 할 대상이 그쪽이라서다 — "스티로폼 용기"를 넘겨도 안내는
 * "스티로폼" 기준으로 나간다. 그래서 문장도 두 단계를 갈라 쓴다. 사진을 읽은 건
 * 호스트고 품목으로 좁힌 건 서버인데, "사진을 ○○로 봤다"고 하면 서버의 매칭 결과가
 * 사진 판독인 것처럼 읽혀 엉뚱한 곳을 의심하게 된다.
 */
function photoConfirmLine(item: WasteItem): string {
  return `사진 속 물건은 "${item.name}" 품목 기준으로 안내합니다. 다르면 품목명을 알려주세요.`;
}

async function handleClassifyWasteItem({ itemName, region }: { itemName: string; region?: string }): Promise<LoggedToolResult> {
  const resolved = resolveWasteItem(itemName);
  if (resolved.status === "not_found") return withRegionStatusLog(unknownItemResult(itemName), region);
  if (resolved.status === "ambiguous") {
    return withRegionStatusLog(ambiguousItemResult(itemName, resolved.candidates), region);
  }

  const { match } = resolved;
  const { item } = match;

  // Resolved on both sides of the switch on purpose. WIDGET_ENABLED is a
  // rendering rollback (qa-runbook 4절); if the region were only matched in the
  // widget branch, flipping it off would also drop `matchedRegion` from the
  // logs, and the finals-window 지역 해상도 numbers are read off those.
  const regionMatch = itemNeedsRegionCheck(item) ? findRegionalPolicy(region) : undefined;
  const log = { matchedId: item.id, score: match.score, matchedRegion: regionMatch?.region.name, regionStatus: itemRegionStatus(region, item) };

  // 두 렌더링 모드가 같은 데이터를 실어야 한다. 분기 안에서 따로 만들면 필드를
  // 고칠 때 한쪽만 고쳐져 위젯을 껐다 켤 때 모델이 받는 데이터가 달라진다.
  const structured = {
    found: true,
    matchedItem: item.name,
    matchedBy: match.matchedBy,
    disposalGroup: disposalGroupLabel(item.disposalType),
    disposalType: item.disposalType,
    summary: item.summary,
    confidence: item.confidence,
    regionCheckLevel: itemRegionCheckLabel(item),
    regionGuidance: itemRegionGuidance(item),
    primarySource: itemTopSources(item, 1)[0] ?? { title: "재활용척척 보수 안내 정책" },
  };

  // PRD phase-3 R1 keeps ambiguous·not_found on text — those two need a
  // follow-up turn and a card closes the conversation. A confirmed match does
  // not, so it takes the same card get_disposal_steps serves.
  if (WIDGET_ENABLED) {
    return widgetResult(matchedItemWidget(item, regionMatch, { region }), structured, log);
  }

  const text = [
    `분류 결과: ${item.name}`,
    `- 배출 그룹: ${disposalGroupLabel(item.disposalType)}`,
    `- 세부 판단: ${item.disposalType}`,
    `- 결론: ${item.summary}`,
    `- 확신도: ${confidenceLabel(item.confidence)}`,
    `- 지역 영향: ${itemRegionCheckLabel(item)}`,
    `- 판단 범위: ${itemRegionGuidance(item)}`,
    `- 대표 근거: ${briefSourceLabel(item)}`,
    itemNeedsCriticalRegionCheck(item)
      ? "- 전용 수거함, 지정 수거처, 대형폐기물 신고 또는 수수료처럼 지역 기준이 실제 배출 방법을 바꿀 수 있습니다."
      : itemNeedsRegionCheck(item)
      ? // 이 줄도 요일을 말하므로 확인처까지 함께 낸다. 지역 툴만 닫혀 있어서, 같은
        // 사람이 툴만 갈아타면 되묻기가 그대로 살아났다.
        withCollectionDaySourceLine(
          "- 기본 판단은 가능하며, 실제 배출 요일·장소나 수거함·회수 가능 여부만 거주지 기준에 맞추면 됩니다.",
          regionMatch,
        )
      : undefined,
    region && itemNeedsRegionCheck(item) ? `- 입력 지역: ${region}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return textResult(text, structured, log);
}

async function handleGetDisposalSteps({
  itemName,
  region,
  inputSource,
}: {
  itemName: string;
  region?: string;
  inputSource?: InputSource;
}): Promise<LoggedToolResult> {
  const resolved = resolveWasteItem(itemName);
  // 되묻는 두 갈래는 이미 "이게 맞냐"고 묻고 있어서 확인 문구를 겹쳐 붙일 자리가 없다.
  // 사진에서 왔다는 표시만 로그에 남긴다.
  if (resolved.status === "not_found") {
    return withRegionStatusLog(withInputSourceLog(unknownItemResult(itemName), inputSource), region);
  }
  if (resolved.status === "ambiguous") {
    return withRegionStatusLog(withInputSourceLog(ambiguousItemResult(itemName, resolved.candidates), inputSource), region);
  }

  const { match } = resolved;
  const { item } = match;
  const regionMatch = itemNeedsRegionCheck(item) ? findRegionalPolicy(region) : undefined;
  const photoNote = inputSource === "photo" ? photoConfirmLine(item) : undefined;
  const log = { matchedId: item.id, score: match.score, matchedRegion: regionMatch?.region.name, regionStatus: itemRegionStatus(region, item), inputSource };

  // 카드는 지역 줄을 스스로 만들지만(matchedItemWidget), structuredContent는 두
  // 렌더링 모드가 같은 것을 실어야 하므로 분기 밖에서 한 번 만든다.
  const regionNotes = buildRegionNotes(item, regionMatch, region);
  const structured = {
    found: true,
    id: item.id,
    itemName: item.name,
    matchedBy: match.matchedBy,
    disposalGroup: disposalGroupLabel(item.disposalType),
    summary: item.summary,
    steps: item.steps,
    cautions: item.cautions,
    // 카드는 medium일 때 "근거를 함께 보라"는 한 줄로 접어 싣고 등급 이름은 버린다.
    // 등급 원문이 모델에 닿는 경로는 여기뿐이다 — `review`는 검수 status만 담는다.
    confidence: item.confidence,
    review: publicReviewMetadata(item),
    region,
    regionCheckLevel: itemRegionCheckLabel(item),
    ...(regionNotes ? { regionNotes } : {}),
    sources: itemTopSources(item),
  };

  if (WIDGET_ENABLED) {
    return widgetResult(matchedItemWidget(item, regionMatch, { photoNote, region }), structured, log);
  }

  // 확인 문구는 안내 위에 둔다. 잘못 알아본 이름이면 아래 내용을 읽을 이유가 없다.
  const text = photoNote ? `${photoNote}\n\n${formatItemGuide(item, region)}` : formatItemGuide(item, region);
  return textResult(text, structured, log);
}

async function handleCheckConfusingItem({ itemName }: { itemName: string }): Promise<LoggedToolResult> {
  // 이 툴은 `resolveWasteItem`을 안 거치고 `findWasteItems`를 바로 부른다. 부품어에 걸린
  // 히트가 그 사이로 `소파 커버` -> "1. 소파 / 결론: 대형폐기물로 신고한 뒤 배출합니다"처럼
  // 번호 붙은 확정으로 새어 나갔는데, 지금은 `findWasteItems`가 내보내기 전에 걷어낸다.
  //
  // `modifier_fragment`는 거기서도 일부러 남는다. 그쪽은 "질의가 덜 특정됐다"는 신호라
  // 헷갈림 후보로 보여 주는 게 맞다(src/data.ts의 MODIFIER_FRAGMENT_SCORE 주석).
  let matches = findWasteItems(itemName, 3);
  if (matches.length === 0) return unknownItemResult(itemName);

  // Typo guesses have to clear the same confirmation gate as the other tools.
  // Listed as "헷갈림 체크" entries they would read as conclusions about items the
  // user never named, so an unconfirmed guess asks back instead.
  if (matches[0].matchKind === "fuzzy_jamo") {
    const resolved = resolveWasteItem(itemName);
    if (resolved.status === "not_found") return unknownItemResult(itemName);
    if (resolved.status === "ambiguous") return ambiguousItemResult(itemName, resolved.candidates);
    matches = [resolved.match];
  }

  const lines = [
    `헷갈림 체크: "${itemName}"`,
    "",
    ...matches.flatMap((match, index) => [
      `${index + 1}. ${match.item.name}`,
      `   - 결론: ${match.item.summary}`,
      `   - 주의: ${match.item.cautions[0] ?? "지역별 기준을 확인하세요."}`,
      `   - 지역 영향: ${itemRegionCheckLabel(match.item)}`,
      `   - 판단 범위: ${itemRegionGuidance(match.item)}`,
      `   - 대표 근거: ${briefSourceLabel(match.item)}`,
      `   - 확신도: ${confidenceLabel(match.item.confidence)}`,
    ]),
  ];

  return textResult(
    lines.join("\n"),
    {
      found: true,
      matches: matches.map((match) => ({
        itemName: match.item.name,
        summary: match.item.summary,
        caution: match.item.cautions[0],
        confidence: match.item.confidence,
        regionCheckLevel: itemRegionCheckLabel(match.item),
      })),
    },
    { matchedId: matches[0].item.id, score: matches[0].score },
  );
}

async function handleMakeCleanupPlan({ items, region }: { items: string[]; region?: string }): Promise<LoggedToolResult> {
  // 공백만 온 지역은 안 온 것으로 본다. regionStatusFor와 같은 이유다. 남는 값도 다듬은
  // 쪽으로 쓴다 — 앞뒤 공백이 붙은 채로 문장에 박히거나 후속 호출 인자로 넘어간다.
  const hintRegion = region?.trim() || undefined;
  /**
   * 지역을 여기서 한 번 확정해 품목별 수수료까지 플랜에 싣는다. 예전에는 이 자리에서
   * status만 보고 매칭 결과를 버렸고, 그래서 "강남구에서 이사가면서 침대랑 화분 버리는데"
   * 처럼 수수료가 질문의 핵심인 발화에도 금액이 한 줄도 안 나갔다 — 지역 툴을 한 번 더
   * 부르라고 미루는 사이 호스트는 그냥 자기 지식으로 답해버린다. 데이터(bulky-waste-fees)는
   * 이미 있었고 없던 건 배선뿐이다.
   */
  const regionMatch = findRegionalPolicy(hintRegion);
  const planned = items.map((rawName) => {
    const resolved = resolveWasteItem(rawName);
    if (resolved.status === "not_found") {
      // 못 찾았다고 빈손으로 돌려보내지 않는다. `get_disposal_steps`의 not_found는 이미
      // 재질 원칙으로 착지하는데(Phase 1), 여기만 "확실히 찾지 못했습니다"로 끝나 있었다.
      // 계획에 열 개를 넣으면 못 찾은 항목만 아무 안내 없이 남는다.
      return {
        input: rawName,
        found: false as const,
        group: "확인 필요",
        summary: `초기 데이터에서 확실히 찾지 못했습니다.${materialPrincipleSuffix(rawName)}`,
      };
    }

    if (resolved.status === "ambiguous") {
      const candidateLabels = resolved.candidates.map(ambiguousCandidateLabel);
      return {
        input: rawName,
        found: false as const,
        group: "확인 필요",
        summary: ambiguousCandidateSummary(candidateLabels),
        candidates: candidateLabels,
      };
    }

    const { match } = resolved;
    // 카드와 같은 빌더를 쓴다. 플랜만 따로 포맷을 만들면 같은 품목·같은 지역인데
    // 카드와 플랜이 다른 금액 문장을 내놓는 순간 어느 쪽이 맞는지 알 수 없게 된다.
    const feeLine = buildRegionFeeLine(match.item, regionMatch);
    return {
      input: rawName,
      found: true as const,
      itemName: match.item.name,
      matchedBy: match.matchedBy,
      group: disposalGroupLabel(match.item.disposalType),
      summary: match.item.summary,
      regionCheckLevel: itemRegionCheckLabel(match.item),
      sourceRef: briefSourceTitle(match.item),
      // 대형폐기물이 보조 배출로인 품목에는 카드가 다는 단서를 여기서도 단다. 이게
      // 없으면 작은 플라스틱 화분에도 "수수료 1,000원~2,000원"이 조건 없이 찍혀,
      // 같은 품목·같은 지역인데 `get_disposal_steps`와 플랜이 서로 다른 말을 한다.
      feeLine:
        feeLine && isBulkySecondaryRoute(match.item)
          ? `대형폐기물에 해당할 때만 ${feeLine}. 그 외에는 위 배출 방법을 따릅니다.`
          : feeLine,
      // 대형폐기물 경로를 타는 품목인지. 금액이 붙었는지와는 다른 축이고, 마무리
      // 문장이 그 둘을 갈라 봐야 한다(바로 아래 hasFeeUnknownBulky).
      //
      // 보조 배출로는 여기서 뺀다. 인형처럼 "일반쓰레기/대형폐기물"인 품목은 바로 위에서
      // "대형폐기물에 해당할 때만"이라는 단서를 달아 놓고선, 마무리 줄에서 "금액을 적지
      // 못한 대형폐기물 품목의 수수료를 확인하라"고 부르면 같은 함수가 한 화면에서 서로
      // 반대로 말한다. 조건부인 품목은 조건부라고만 말하고 끝낸다.
      bulkyRoute: itemHasBulkyRoute(match.item) && !isBulkySecondaryRoute(match.item),
    };
  });

  /**
   * 지역이 답을 바꾸는 품목이 있을 때만 다음 걸음을 놓는다. 문장에는 툴 이름을
   * 쓰지 않는다 — 텍스트는 호스트가 사용자에게 그대로 인용할 수 있어서, 호출에
   * 필요한 정확한 이름과 인자는 structuredContent의 nextTool로만 내려보낸다.
   * 지역을 안 댔으면 nextTool도 없다 — 물어볼 지역이 정해져야 인자가 완성된다.
   */
  const hasCriticalItem = planned.some((entry) => entry.found && entry.regionCheckLevel === "필수");
  // 한 품목이라도 금액이 나갔는지. 마무리 문장이 "수수료는 확인이 필요하다"고 말할지
  // 말지가 여기서 갈린다 — 방금 금액을 적어 놓고 같은 화면에서 없다고 하면 안 된다.
  const hasFeeLine = planned.some((entry) => entry.found && entry.feeLine);
  /**
   * 대형폐기물로 나가는데 그 지역 고시에서 행을 못 찾은 품목이 섞여 있는지. 한 품목의
   * 금액이 플랜 전체를 덮으면 안 된다 — 강남구에 "책상의자, 옷장"을 넣으면 의자 금액만
   * 찍히고 고시에 행이 없는 옷장은 수수료를 확인하라는 말조차 사라졌다.
   *
   * 가르는 축은 "금액이 있나"가 아니라 "대형폐기물 경로인데 우리가 그 지역 행을 못
   * 가졌나"다. 금액 없음만 보면 건전지에서 틀린다 — 답이 전용 수거함이라 수수료라는 게
   * 애초에 없는 품목에 "수수료를 확인하세요"를 붙이면 없는 요금을 예고하는 셈이다.
   */
  const hasFeeUnknownBulky = planned.some((entry) => entry.found && entry.bulkyRoute && !entry.feeLine);
  /**
   * 그 지역 데이터를 가진 경우에만 신고 방법·수수료·수거함 위치까지 약속한다. 미등록이거나
   * 되물어야 하는 지역에 같은 문장을 붙이면 없는 안내를 있다고 말하는 셈이다.
   *
   * 그래도 nextTool은 두 갈래 모두 내려보낸다. 미등록 지역이면 지역 툴이 공식 확인 경로를,
   * 모호한 지역이면 후보를 주므로 후속 호출 자체는 유효하다 — 과했던 건 호출이 아니라 문장의
   * 약속이었다. 여기서 지역을 다시 묻고 멈추면, 방금 자기 지역을 댄 사람에게 못 들은 척하는
   * 답이 된다.
   */
  const hintRegionKnown = regionMatch !== undefined;

  const groups = new Map<string, typeof planned>();
  for (const entry of planned) {
    const existing = groups.get(entry.group) ?? [];
    existing.push(entry);
    groups.set(entry.group, existing);
  }

  const lines = [
    "대청소 배출 계획",
    region ? `지역: ${region}` : undefined,
    "",
    ...Array.from(groups.entries()).flatMap(([group, entries]) => [
      `## ${group}`,
      ...entries.flatMap((entry) => {
        const label = entry.found ? `${entry.input} -> ${entry.itemName}` : entry.input;
        const regionImpact = entry.found ? ` (지역 영향: ${entry.regionCheckLevel})` : "";
        return [
          `- ${label}: ${entry.summary}${regionImpact}`,
          entry.found && entry.feeLine ? `  - ${entry.feeLine}` : undefined,
          entry.found ? `  - 대표 근거: ${entry.sourceRef}` : undefined,
        ].filter((line): line is string => line !== undefined);
      }),
      "",
    ]),
    // 금액을 적어 보냈으면 "수수료도 확인이 필요하다"는 말을 뺀다. 남는 건 신고 절차와
    // 수거처인데, 그건 우리가 대신 해줄 수 없는 게 맞다. 다만 금액을 못 채운 대형폐기물이
    // 함께 있으면 그 품목 몫의 수수료 확인은 도로 살린다. 금액이 한 줄도 안 나간
    // 호출에서는 예전 문장 그대로다 — 수수료 표를 못 가진 지역이 아직 많다.
    hasCriticalItem
      ? hasFeeLine
        ? hasFeeUnknownBulky
          ? "위 수수료는 규격별 후보이고, 실제 금액은 신고할 때 고르는 규격에서 정해집니다. 금액을 적지 못한 대형폐기물 품목의 수수료와 전용 수거함·지정 수거처, 신고 절차는 지역 공식 안내를 확인하세요."
          : "위 수수료는 규격별 후보이고, 실제 금액은 신고할 때 고르는 규격에서 정해집니다. 전용 수거함과 지정 수거처, 신고 절차는 지역 공식 안내를 확인하세요."
        : "전용 수거함, 지정 수거처, 대형폐기물 신고·수수료 품목은 지역 공식 안내 확인이 필요합니다."
      : undefined,
    planned.some((entry) => entry.found && entry.regionCheckLevel === "참고")
      ? // 플랜도 마찬가지다. 대청소는 지역을 함께 주는 호출이 많아 오히려 여기서 되묻기가
        // 나오면 손해가 크다 — 품목이 여러 개라 되물은 뒤 다시 세우는 값이 그만큼 많다.
        withCollectionDaySourceLine(
          "일부 품목은 기본 판단은 위와 같고, 실제 배출 요일·장소나 수거함·회수 가능 여부만 거주지 기준에 맞추면 됩니다.",
          regionMatch,
        )
      : undefined,
    // 다음 걸음 안내. 예고는 그 후속 호출이 **어느 지역에서나** 내놓는 것에만 건다.
    // 여기서 두 번 미끄러졌다 — 처음엔 "규격별 수수료 전체 표"를 걸었는데 품목을 넘겨도
    // 대표 N종에서 끊기고, 다음엔 "신청 주소와 수수료 조회처"로 낮췄는데 그것도 못 준다.
    // 신청·수수료 URL은 bulky-waste-fees.json에 있고 지역 개요 경로는 그 파일을 안 읽는다.
    // 강남구가 통과한 건 마침 지역 출처 목록에 clean.gangnam.go.kr가 들어 있어서지 경로가
    // 있어서가 아니다 — 서초구는 같은 문장에서 줄 게 하나도 없다. 그래서 지역 데이터만으로
    // 늘 나가는 것(신고 절차 체크 항목, 수거함 안내, 공식 확인처)까지만 예고한다.
    //
    // 필수 품목에는 수수료를 내는 대형폐기물만 있는 게 아니라 건전지·폐의약품처럼 전용
    // 수거함이 답인 것도 있어서, 바로 위 마무리 줄처럼 두 갈래를 함께 부른다.
    hasCriticalItem
      ? hintRegion
        ? hintRegionKnown
          ? hasFeeLine
            ? `${hintRegion}의 대형폐기물 신고 절차와 전용 수거함 위치, 공식 확인처도 이어서 안내할 수 있습니다.`
            : `${hintRegion}의 대형폐기물 신고 방법·수수료나 전용 수거함 위치도 이어서 안내할 수 있습니다.`
          : `${hintRegion} 기준 배출 확인이 필요하면 지역 안내도 이어서 도와드릴 수 있습니다.`
        : "거주 지역을 알려주시면 대형폐기물 신고 방법·수수료나 전용 수거함 위치까지 확인해 드릴 수 있습니다."
      : undefined,
  ].filter(Boolean);

  const structuredItems = planned.map((entry) =>
    entry.found
      ? {
          input: entry.input,
          found: true,
          group: entry.group,
          itemName: entry.itemName,
          summary: entry.summary,
          regionCheckLevel: entry.regionCheckLevel,
          // text에만 있고 structuredContent에 없으면, 구조화 응답만 읽는 호스트에서
          // 금액이 통째로 사라진다. 배선을 넣은 이유가 그 경로라 둘 다 실어야 한다.
          ...(entry.feeLine ? { fee: entry.feeLine } : {}),
        }
      : {
          input: entry.input,
          found: false,
          group: entry.group,
          summary: entry.summary,
          ...("candidates" in entry && entry.candidates ? { candidates: entry.candidates } : {}),
        },
  );

  const matched = planned.filter((entry) => entry.found).length;
  return textResult(
    lines.join("\n"),
    {
      region,
      items: structuredItems,
      ...(hasCriticalItem && hintRegion
        ? {
            nextTool: {
              name: "get_region_disposal_info",
              arguments: { region: hintRegion },
              when: "사용자가 신고 방법, 수수료, 전용 수거함 위치를 물으면",
            },
          }
        : {}),
    },
    {
      status: matched === planned.length ? "match" : matched === 0 ? "not_found" : "partial",
      matched,
      total: planned.length,
    },
  );
}

/**
 * 미등록 지역에서도 다음 행동이 남아야 한다. "지역번호+120" 대표 민원번호는
 * 연결해도 담당 부서까지 한참 돌아가 안내로서 값이 없으므로 넣지 않는다 —
 * 번호를 준다면 지역 데이터에서 확인한 직통번호여야 하고, 없으면 빼는 쪽이 낫다.
 */
const NATIONAL_FALLBACK_LINKS = [
  REGION_SELECT_GUIDE_LINK,
  {
    title: "정부24 민원 신청",
    url: "https://plus.gov.kr/minwon/",
    basis: "'대형폐기물'로 검색하면 거주 지자체의 대형폐기물 배출 신청 민원으로 연결됩니다.",
  },
];

/** 광역 안내로 착지했을 때 좁혀줄 자치구는 몇 곳만 보인다 — 응답 줄 수 예산을 지킨다. */
const MAX_LISTED_DISTRICTS = 6;

/** `get_region_disposal_info`의 structuredContent 상한. Phase 0 R5가 정한 값이다. */
const MAX_OFFICIAL_SOURCES = 3;

/**
 * 상한에 걸려 자를 때 **요일 확인처는 남긴다.**
 *
 * 요일 출처는 지역 데이터에 나중에 붙은 게 많아 `sources` 뒤쪽에 몰려 있는데, 앞에서
 * 세 개를 세면 그게 그대로 잘린다. 하필 이 링크는 본문 "확인할 정보"가 **직접 가리키는
 * 주소**라, 구조화 응답만 읽는 호스트에서는 본문이 "여기서 확인하세요"라고 말한 그
 * 페이지가 목록에 없다. 세종시와 고양시가 그랬다.
 *
 * 상한을 올리는 대신 고르는 순서를 바꾼다 — 상한은 응답 크기 예산이라 손댈 값이 아니고,
 * 자리를 하나 내주는 쪽이 잃는 게 적다. 원래 배열 순서는 그대로 지켜, 요일 출처가 앞에
 * 있으면 아무것도 달라지지 않는다.
 */
function pickRegionOfficialSources(region: RegionalPolicyData, room: number): RegionalPolicyData["sources"] {
  if (room <= 0) return [];

  const head = region.sources.slice(0, room);
  const daySource = findRegionCollectionDaySource(region);
  if (!daySource || head.includes(daySource)) return head;

  const kept = new Set([...head.slice(0, room - 1), daySource]);
  return region.sources.filter((source) => kept.has(source));
}

function metroNarrowingLine(metro: MatchedRegionPolicy): string {
  const districts = findRegisteredDistricts(metro.region);
  if (districts.length === 0) {
    return `${metro.region.name} 광역 기준 안내입니다. 대형폐기물 신청 경로와 수수료는 시·군·구 소관이라, 거주 중인 시·군·구를 알려주시면 더 정확히 안내할 수 있습니다.`;
  }

  const listed = districts.slice(0, MAX_LISTED_DISTRICTS).map((district) => district.name);
  const rest = districts.length - listed.length;
  return `${metro.region.name} 광역 기준 안내입니다. 시·군·구를 알려주시면 그 기준으로 좁혀드립니다. (상세 안내 보유: ${listed.join(", ")}${rest > 0 ? ` 외 ${rest}곳` : ""})`;
}

/**
 * 사용자가 이미 시·군·구를 댔는데 상세 데이터가 없어 광역으로 착지한 경우.
 *
 * 여기서 되묻기 문구를 그대로 쓰면 방금 들은 것을 다시 묻는 셈이라, 자기 말이
 * 무시된 것으로 읽힌다. 그렇다고 없는 데이터를 있는 척할 수는 없으므로 순서를
 * 셋으로 고정한다 — 그 이름을 부르고, 상세 데이터가 없다고 밝히고, 그래서
 * 광역 기준으로 간다고 잇는다. 마지막 안내는 아래 "공식 확인처"로 넘긴다.
 * 광역 착지에는 분리배출.kr 지역별 안내와 정부24가 항상 함께 붙어서, 사용자가
 * 자기 시·군·구 기준을 실제로 찾아갈 경로는 거기 있다.
 *
 * 여는 문장은 품목 툴과 공유한다(`formatUnregisteredDistrictScope`). 뒤에 붙는
 * 안내만 이 툴의 "공식 확인처" 목록을 가리킨다 — 품목 툴에는 그 목록이 없다.
 */
function unregisteredDistrictLine(metro: MatchedRegionPolicy, namedSubRegion: string): string {
  return (
    `${formatUnregisteredDistrictScope(metro.region.name, namedSubRegion)} ` +
    `대형폐기물 신청 경로와 수수료는 ${namedSubRegion} 소관이니 아래 공식 확인처에서 확인해 주세요.`
  );
}

/** 얕은 티어를 full 티어처럼 보이게 하지 않는다 — 확정되지 않은 범위를 밝힌다. */
function regionCoverageNote(regionMatch: MatchedRegionPolicy, namedSubRegion?: string): string | undefined {
  if (regionMatch.level === "metro") {
    return namedSubRegion ? unregisteredDistrictLine(regionMatch, namedSubRegion) : metroNarrowingLine(regionMatch);
  }
  // 티어를 가리지 않고 같은 문장을 쓴다. 예전에는 `full` 티어 다섯 곳이 배출 요일까지
  // 들고 있어서 이 안내가 `standard`에만 붙었는데, 그 값을 걷어낸 뒤로는 모든 자치구가
  // 같은 범위(신청 경로·수거함까지)라 문장이 갈릴 이유가 없다.
  //
  // 요일을 왜 안 싣는지는 여기서 말하지 않는다. 바로 위에 찍히는 `지역 요약`이 자치구
  // 32곳 모두 그 문장으로 끝나서(회귀는 test-region-matching이 잡는다), 여기에 또 쓰면
  // 한 응답에 같은 말이 두 번 나온다.
  //
  // 확인했다는 범위는 실제로 들고 있는 것에서 뽑는다. `standard` 티어는 둘 다 있어야
  // 추가되지만 validate가 `full`에는 같은 요구를 걸지 않아서, 문장을 고정해 두면 수거함
  // 데이터가 없는 지역이 아래에 없는 블록을 있다고 말하게 된다.
  const confirmed = [
    regionMatch.region.bulkyWaste ? "대형폐기물 신청 경로" : undefined,
    Object.values(regionMatch.region.specialCollections ?? {}).some((entry) => (entry?.method?.length ?? 0) > 0)
      ? "수거함 안내"
      : undefined,
  ].filter((part): part is string => part !== undefined);
  if (confirmed.length === 0) return undefined;

  return `${regionMatch.region.name} 기준으로 ${confirmed.join("와 ")}까지 확인했습니다.`;
}

const MEDICINE_ITEM_IDS = new Set(["medicine"]);
const BATTERY_LAMP_ITEM_IDS = new Set(["battery", "power_bank", "fluorescent_lamp", "led_lamp", "incandescent_bulb"]);

function collectionLines(label: string, method: string[] | undefined, expand: boolean): string[] {
  const filled = (method ?? []).filter((line) => typeof line === "string" && line.trim().length > 0);
  if (filled.length === 0) return [];
  const shown = expand ? filled : filled.slice(0, 1);
  return shown.map((line, index) => (index === 0 ? `- ${label}: ${line}` : `  - ${line}`));
}

/**
 * 물어본 품목이 걸린 수거함만 전부 펼친다.
 *
 * 예전에는 두 항목 모두 `method[0]`만 실었다. 그래서 지역 데이터에 적어둔
 * 둘째 줄부터가 어느 경로로도 사용자에게 못 갔다 — 성북 "평판형·십자형·원반형
 * LED는 특수규격봉투", 중랑 "백열전구·LED등은 특수마대", 양천 "깨진 형광등은
 * 불연성 마대", 중구 "리튬전지는 '비대상전지' 표기"가 전부 죽은 데이터였다.
 * 하필 이런 예외가 사용자가 실제로 틀리는 지점이다.
 *
 * 그렇다고 항상 전부 실으면 지역 한 곳이 최대 일곱 줄까지 늘어난다. 폐의약품을
 * 물었는데 형광등 예외까지 다 받을 이유는 없으므로, **물어본 품목이 속한 쪽만**
 * 펼치고 나머지는 첫 줄로 둔다. 품목을 안 물었으면 둘 다 첫 줄만 — 예전 동작과
 * 같아서 지역 개요 응답 크기는 그대로다.
 *
 * 주의: `method`의 모든 줄은 사용자에게 그대로 나간다. 예전에는 둘째 줄부터가
 * 죽어 있어서 작성 메모("보수적 안내를 유지합니다" 같은 우리 쪽 서술)를 적어둔
 * 지역이 있었는데, 이 함수가 열리면서 전부 사용자 문장이 됐다. 지역을 추가할
 * 때 `method`에 작업 메모를 남기지 않는다.
 */
function regionSpecialCollectionLines(region: RegionalPolicyData, item?: WasteItem): string[] {
  const { medicine, batteryAndFluorescentLamp } = region.specialCollections ?? {};
  return [
    ...collectionLines("폐의약품", medicine?.method, Boolean(item && MEDICINE_ITEM_IDS.has(item.id))),
    ...collectionLines(
      "폐건전지·폐형광등",
      batteryAndFluorescentLamp?.method,
      Boolean(item && BATTERY_LAMP_ITEM_IDS.has(item.id)),
    ),
  ];
}

async function handleGetRegionDisposalInfo({ region, itemName }: { region: string; itemName?: string }): Promise<LoggedToolResult> {
  const resolved = itemName ? resolveWasteItem(itemName) : undefined;
  const match = resolved?.status === "match" ? resolved.match : undefined;
  const ambiguousCandidates =
    resolved?.status === "ambiguous" ? resolved.candidates.map(ambiguousCandidateLabel) : undefined;

  const regionResolution = resolveRegionalPolicy(region);
  const regionMatch = regionResolution.status === "match" ? regionResolution.match : undefined;
  const regionCandidates = regionResolution.status === "ambiguous" ? regionResolution.candidates.map((candidate) => candidate.region.name) : undefined;

  // 광역으로 착지했더라도 질의가 시·군·구를 지목했는지는 갈라 본다. 응답 문구도
  // 로그 집계도 이 한 갈래에서 갈린다 — `metro`로 뭉뚱그리면 "충북"이라고 말한
  // 사람과 "청주시"라고 말한 사람이 한 칸에 섞여, 다음에 어느 지역 데이터를
  // 채워야 하는지가 집계에서 안 보인다. 값을 `metro`로 시작하지 않게 둔 건
  // 회귀 케이스가 부분 문자열로 대조하기 때문이다.
  const namedSubRegion = findNamedSubRegionForMatch(regionMatch, region);
  const regionStatus = regionMatch
    ? namedSubRegion
      ? "unregistered_district"
      : regionMatch.level
    : regionCandidates
      ? "ambiguous"
      : "unknown";

  const itemLine = match
    ? `품목: ${match.item.name}`
    : ambiguousCandidates
    ? `품목: "${itemName}" — ${ambiguousCandidateSummary(ambiguousCandidates)}`
    : itemName
    ? // 못 찾았어도 재질 원칙은 붙인다. 지역 체크리스트가 함께 나가므로 답이 비지는
      // 않지만, `make_cleanup_plan`과 같은 이유로 한 줄이라도 더 쥐여 보낸다.
      `입력한 품목 "${itemName}"을(를) 초기 데이터에서 확실히 찾지 못했습니다.${materialPrincipleSuffix(itemName)}`
    : "품목을 함께 입력하면 확인해야 할 항목을 더 좁혀드릴 수 있습니다.";

  // 지역을 확정하지 못해도 첫 줄에 입력한 지역명을 그대로 되비추고,
  // "확인하지 못했다"가 아니라 "이 경로로 확인하면 된다"로 끝낸다.
  const regionLine = regionCandidates
    ? `입력한 지역 "${region}"은(는) 여러 지역에 해당할 수 있어 하나로 확정하지 못했습니다. 후보: ${regionCandidates.join(", ")} — 어느 지역인지 알려주시면 그 기준으로 안내하겠습니다.`
    : regionMatch
    ? `지역 요약: ${regionMatch.region.summary}`
    : `"${region}"은(는) 아직 상세 지역 데이터가 없습니다. 아래 공식 경로에서 거주 지자체 기준을 바로 확인할 수 있습니다.`;

  // 광역의 대형폐기물 줄은 "거주 중인 시·군·구를 확인해야 한다"가 전부라,
  // 시·군·구를 이미 댄 사람에게는 바로 위 문구를 한 번 더 쓴 것에 지나지 않는다.
  // 그쪽 문구가 그 이름까지 부르니 여기서는 뺀다 — 줄 수도 두 줄 줄어든다.
  //
  // 광역일 때로 한정하는 이유는 formatRegionItemGuide가 같은 자리에서 막는 이유와 같다.
  // district 티어의 그 블록에는 문의 전화·인터넷 신청·수수료 조회 URL이 들어 있어서,
  // `namedSubRegion`이 광역 착지 때만 온다는 호출부 약속에 기대면 그 셋이 소리 없이 사라진다.
  const dropsOnlyTheReAsk = Boolean(namedSubRegion) && regionMatch?.level === "metro";
  const bulkyLines = regionMatch && !dropsOnlyTheReAsk ? formatRegionBulkyContactLines(regionMatch.region) : [];
  const specialLines = regionMatch ? regionSpecialCollectionLines(regionMatch.region, match?.item) : [];
  // 품목별 안내 블록. 아래 두 곳이 이 배열을 함께 쓴다 — 응답 본문과, 체크리스트가
  // "위에서 이미 답한 것"을 가려내는 근거다. 한 번만 만들어야 둘이 어긋나지 않는다.
  const itemGuideLines =
    match && regionMatch
      ? formatRegionItemGuide(match.item, regionMatch, {
          namedSubRegion,
          subRegionScopeAlreadyShown: true,
          // 바로 위 `{지역} 대형폐기물` 블록을 실제로 찍었을 때만 넘긴다. 광역 착지처럼
          // 그 블록이 비는 갈래에서 넘기면 이 응답에 연락처가 한 번도 안 나간다.
          contactLinesAlreadyShown: bulkyLines.length > 0,
        })
      : [];
  // "확인할 정보" 위쪽을 먼저 세운다. 요일 확인처를 붙일지가 **이 블록이 요일을
  // 말하는지**에 달려 있어서다 — 지역 요약이 그 자리다.
  const answerBodyLines = [
    `${regionMatch?.region.name ?? region} 지역 확인 안내`,
    "",
    itemLine,
    match ? `기본 판단: ${match.item.summary}` : undefined,
    match ? `판단 범위: ${itemRegionGuidance(match.item)}` : undefined,
    regionLine,
    regionMatch ? regionCoverageNote(regionMatch, namedSubRegion) : undefined,
    // "기본 배출 기준" 블록이 여기 있었다. 요일·시간을 구 대표값으로 실었는데,
    // 같은 구 안에서도 동과 주택 유형에 따라 갈리는 값이라 확정 안내로 내보내지
    // 않는다. 아래 "확인할 정보"가 그 자리를 대신한다.
    bulkyLines.length > 0 ? "" : undefined,
    bulkyLines.length > 0 ? `${regionMatch?.region.name} 대형폐기물` : undefined,
    ...bulkyLines,
    specialLines.length > 0 ? "" : undefined,
    specialLines.length > 0 ? `${regionMatch?.region.name} 수거함 안내` : undefined,
    ...specialLines,
    match && regionMatch ? "" : undefined,
    match && regionMatch ? `품목별 ${regionMatch.region.name} 안내` : undefined,
    itemGuideLines.length > 0 ? itemGuideLines.join("\n") : undefined,
  ].filter(Boolean);

  // 체크리스트가 "위에서 이미 답한 것"을 가려내는 근거.
  //
  // **렌더된 줄이 아니라 품목 툴이 쓰는 줄을 넘긴다.** 두 툴이 같은 품목·지역에서 같은 항목을
  // 내야 하는데, 이 툴이 실제로 찍는 것은 그것과 두 군데 다르다 — 지역 대형폐기물 연락처
  // 블록은 품목과 **무관하게** 늘 찍히고(`스탠드 조명`처럼 대형폐기물이 아닌 품목까지
  // "신청 URL이 있으니 답했다"로 걸린다), 반대로 품목별 안내의 연락처는 위에서 찍었다고
  // 여기서 빠져 있다. 둘 중 어느 쪽으로 기울어도 툴마다 답이 갈린다.
  //
  // 그래서 근거는 `formatItemGuide`가 쓰는 것과 같은 모양으로 한 번 더 만든다. 이 배열은
  // 응답에 찍히지 않고 판정에만 쓰인다 — 대신 두 툴의 필터가 정의상 같아진다(PR #74 리뷰 2라운드).
  const parityGuideLines =
    match && regionMatch ? formatRegionItemGuide(match.item, regionMatch, { namedSubRegion }) : [];
  const checkList = closeCollectionDayMention(
    itemRegionCheckList(regionMatch, match?.item, { answeredLines: parityGuideLines }),
    answerBodyLines.join("\n"),
    regionMatch,
  );

  const lines = [
    ...answerBodyLines,
    "",
    "확인할 정보",
    ...checkList.map((item, index) => `${index + 1}. ${item}`),
    match ? "" : undefined,
    match ? "품목 판단 근거" : undefined,
    match ? `- ${briefSourceLabel(match.item)}` : undefined,
    "",
    "공식 확인처",
    ...(regionMatch
      ? formatRegionSourceList(regionMatch.region)
      : NATIONAL_FALLBACK_LINKS.map((link) => `- ${link.title}: ${link.url} - ${link.basis}`)),
    // 광역까지만 좁혀졌으면 전국 안내 링크를 함께 남긴다. 시·군 이름을 광역 별칭으로
    // 흡수한 뒤 `안산시`는 미등록 폴백 대신 경기도로 착지하는데, 그 순간 분리배출.kr
    // 지역별 안내와 정부24 신청 민원이 함께 사라졌다. 광역 요약이 더 구체적이긴 해도
    // **사용자가 자기 시 기준을 실제로 찾아갈 수 있는 경로**는 그 둘뿐이라, 빠지면
    // 안내가 오히려 얕아진다. 광역 링크에 이어 붙여 잃는 것 없이 얻기만 하게 한다.
    ...(regionMatch?.level === "metro"
      ? NATIONAL_FALLBACK_LINKS.map((link) => `- ${link.title}: ${link.url} - ${link.basis}`)
      : []),
  ].filter(Boolean);

  return textResult(
    lines.join("\n"),
    {
      region,
      matchedRegion: regionMatch?.region.name,
      regionStatus,
      regionCandidates,
      coverageTier: regionMatch?.region.coverageTier,
      item: match?.item.name,
      ambiguousCandidates,
      defaultSummary: match?.item.summary,
      checkList,
      // Phase 0 R5 상한은 3개다. **자를 곳은 합친 뒤가 아니라 지역 출처 쪽이다.**
      // 합친 배열을 자르면 광역이 출처를 하나 더 갖는 순간 정부24가 조용히 밀려나고
      // text에는 그대로 찍혀 둘이 어긋난다. 둘 더 가지면 49e712e가 고친 링크 소실이
      // 그대로 되살아난다 — 데이터 추가만으로 회귀하는 셈이라 순서를 뒤집는다.
      officialSources: regionMatch
        ? (() => {
            const national =
              regionMatch.level === "metro"
                ? NATIONAL_FALLBACK_LINKS.map((link) => ({ title: link.title, url: link.url }))
                : [];
            const room = Math.max(0, MAX_OFFICIAL_SOURCES - national.length);
            return [
              ...pickRegionOfficialSources(regionMatch.region, room).map((source) => ({ title: source.title, url: source.url })),
              ...national,
            ];
          })()
        : NATIONAL_FALLBACK_LINKS.map((link) => ({ title: link.title, url: link.url })),
    },
    {
      matchedId: match?.item.id,
      score: match?.score,
      matchedRegion: regionMatch?.region.name,
      regionStatus,
    },
  );
}

/* ─────────────────────────── find_disposal_spots (PRD phase-12) ─────────────────────────── */

const SPOT_SOURCE_LABEL = "기후에너지환경부 분리배출 정보조회 서비스";
/** 묶음당·전체 개수 상한(R5). 둘이 충돌하면 R3 표 순서가 이긴다 — 급한 묶음이 위에 있다. */
const SPOT_PER_CATEGORY_LIMIT = 3;
const SPOT_TOTAL_LIMIT = 12;
/** 폴백에 싣는 지역 공식 확인처 줄 수. 지역에 따라 출처가 여덟 줄까지 있어 상한이 필요하다. */
const SPOT_MAX_REGION_SOURCES = 2;
/** 되묻기에서 이름을 불러 주는 지역 수. 전국 동명이면 후보가 열 곳을 넘기도 한다. */
const SPOT_MAX_ASK_REGIONS = 4;

const regionPolicyById = new Map(regionalPolicies.map((policy) => [policy.id, policy]));

/**
 * 행정동 표기를 법정동으로 줄이는 규칙 하나(R2). `addr`은 법정동만 통해서
 * `상계1동`은 그대로 보내면 NODATA다. 그 밖의 변형(`종로1가` 등)은 손대지 않는다 —
 * 규칙을 늘릴수록 멀쩡한 이름을 망가뜨릴 자리가 늘고, 빗나가도 폴백이 받는다.
 */
function normalizeDongName(raw: string): string {
  return raw.trim().replace(/제?\s*\d+\s*동$/, "동");
}

/** 수거함을 실제로 찾는 데 필요한 층·건물 설명이 `addrDtl`에 있다. 공백 하나로 잇는다. */
function formatSpotAddress(row: SpotRow): string {
  return `${row.addrBase} ${row.addrDtl}`.replace(/\s+/g, " ").trim();
}

/**
 * 주소에서 시·군·구까지를 떼어 낸다(`서울특별시 노원구 상계로 …` → `서울특별시 노원구`).
 * 지역을 안 받았을 때 "이 응답이 한 지역으로 수렴하는가"를 세는 열쇠이자, 수렴했을 때
 * 응답 머리에 밝히는 이름이다. 세종처럼 시·군·구가 없는 주소는 광역 이름만 남는다.
 */
function addressRegionLabel(addrBase: string): string {
  const [metro, second] = addrBase.trim().split(/\s+/);
  if (!metro) return "";
  return second && /[시군구]$/.test(second) ? `${metro} ${second}` : metro;
}

/**
 * 착지 지역이 속한 광역의 표기들. 주소는 광역 이름으로 시작하므로 `startsWith`로 본다 —
 * 부분 문자열로 보면 `서울대공원`이 서울로 걸리는 식의 오검출이 생긴다.
 */
function metroPrefixNames(region: RegionalPolicyData): string[] {
  const metro = region.metroId ? regionPolicyById.get(region.metroId) : region;
  if (!metro) return [];
  return [metro.name, ...metro.aliases].filter((name) => /[가-힣]/.test(name));
}

/**
 * 착지 지역의 시·군·구 표기들. 광역까지만 좁혀졌으면 사용자가 지목한 시·군·구가 있을 때만
 * 값이 있다(`청주시`). 로마자와 광역 접두어가 붙은 표기는 뺀다 — 주소에는 안 나온다.
 */
function districtNames(match: MatchedRegionPolicy, namedSubRegion?: string): string[] {
  if (match.level === "metro") return namedSubRegion ? [namedSubRegion] : [];

  const lastToken = match.region.name.split(/\s+/).at(-1) ?? "";
  const candidates = [lastToken, ...match.region.aliases].filter(
    (name) => name.length > 0 && !/\s/.test(name) && /[시군구]$/.test(name) && /[가-힣]/.test(name),
  );
  return Array.from(new Set(candidates));
}

/**
 * 동음 오염 필터(R4). **광역과 시·군·구가 함께 맞아야 남긴다.**
 *
 * 구 이름 하나만 보면 안 된다 — `중구`·`북구`류는 광역시 여섯 곳에 흩어져 있어서, 부산 중구
 * 질의에 대구 중구 주소가 그대로 통과한다(`prefixOnlyDistrictAliases`가 있는 이유와 같다).
 * 반대로 광역까지만 좁혀진 질의에는 시·군·구 이름이 없으므로 광역만 본다 — 광역 이름은
 * 전국에서 유일하니 그것만으로도 오염이 섞이지 않는다.
 */
function addressInRegion(addrBase: string, metroNames: string[], districts: string[]): boolean {
  if (metroNames.length > 0 && !metroNames.some((name) => addrBase.startsWith(name))) return false;
  // 시·군·구는 어절 첫머리에서만 찾는다. 부분 문자열로 보면 이름을 품은 이웃 구가 통과한다 —
  // `부산 서구` 질의에 강서구 주소가, `인천 동구`에 남동구 주소가 남는 식이다.
  if (districts.length > 0 && !districts.some((name) => new RegExp(`(^|\\s)${escapeRegExp(name)}`).test(addrBase))) return false;
  return true;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 폴백(R5). **지역 객체에 기대지 않는다** — `region` 없이 `dong`만 온 기본 시나리오가
 * 이 툴의 다수라, 지역이 없으면 비는 폴백은 폴백이 아니다. 그래서 셋으로 짠다:
 * 전국 확인 경로 한 줄(늘 나간다), 지역이 있으면 그 지역의 공식 확인처, 품목이 확정됐으면
 * 그 묶음이 들고 있는 일반 안내 한 줄.
 *
 * **업스트림 오류 내용은 어디에도 싣지 않는다.** 사용자가 할 수 있는 일이 아니고, 키가
 * 섞여 나갈 수 있는 유일한 경로가 오류 문자열이다.
 */
function spotFallbackResult(params: {
  dong: string;
  reason: "upstream" | "empty";
  regionMatch?: MatchedRegionPolicy;
  category?: SpotCategory;
  /** 품목이 확정됐을 때 그 이름. 0건 문장이 무엇을 못 찾았는지 밝히는 데 쓴다. */
  itemLabel?: string;
  /** 품목이 확정됐을 때 그 품목. 지역 출처를 품목 주제로 고르는 데 쓴다. */
  item?: WasteItem;
  /** 행은 받았는데 전부 노출하지 않는 묶음(판매소·기타)이었던 경우. */
  hiddenOnly?: boolean;
  /** 행은 받았는데 지역 필터가 전부 거른 경우 — 동과 지역이 안 맞는 신호다. */
  regionFilteredAll?: boolean;
  log: ToolLogMeta;
}): LoggedToolResult {
  const { dong, reason, regionMatch, category, itemLabel, item, hiddenOnly, regionFilteredAll, log } = params;
  // 텍스트와 structuredContent가 **같은 출처를 같은 순서로** 실어야 한다 — 같은 배열에서 나온다.
  // `sources[0]`을 그냥 집으면 자치구 대부분에서 대형폐기물 신청 페이지가 잡힌다. 품목이
  // 있으면 그 품목의 주제로, 없으면 수거함·분리배출을 말하는 출처로 고른다.
  const regionSources = regionMatch
    ? (item ? regionSourcesForItem(regionMatch.region, item) : regionCollectionSources(regionMatch.region)).slice(
        0,
        SPOT_MAX_REGION_SOURCES,
      )
    : [];
  const regionSourceLines = formatRegionSourceLines(regionSources);

  // 두 갈래의 첫 문장을 가른다. 조회에 성공했는데 한 곳도 없었던 경우까지 "확인하지
  // 못했습니다"라고 하면, 우리가 실제로 확인한 사실을 안 한 것처럼 말하는 셈이다.
  // 품목을 물었으면 그 이름까지 밝힌다 — `소파`처럼 수거함이 답이 아닌 품목에서
  // "이 동에는 배출 장소가 없다"고 말하면 그건 틀린 문장이다.
  const opening =
    reason === "upstream"
      ? `${dong}의 배출 장소를 지금 조회하지 못했습니다. 대신 이렇게 확인할 수 있습니다.`
      : regionFilteredAll && regionMatch
        ? `${regionMatch.region.name}에서 "${dong}" 주소를 찾지 못했습니다. 다른 지역에 같은 이름의 동이 있을 수 있으니 동 이름과 지역이 맞는지 확인해 주세요.`
        : itemLabel
          ? `${dong}에서 ${itemLabel} 배출 장소를 찾지 못했습니다. 이렇게 확인해 보세요.`
          : hiddenOnly
            ? `${dong}에서 전용 수거함류 배출 장소는 찾지 못했습니다. 이렇게 확인해 보세요.`
            : `${dong}에 등록된 배출 장소를 찾지 못했습니다. 이렇게 확인해 보세요.`;

  const lines = [
    opening,
    `- ${REGION_SELECT_GUIDE_LINK.title}에서 지역을 골라 수거함 안내를 확인하세요: ${REGION_SELECT_GUIDE_LINK.url}`,
    ...regionSourceLines,
    category ? `- ${category.fallbackLine}` : undefined,
  ].filter((line) => line !== undefined);

  return textResult(
    lines.join("\n"),
    {
      found: false,
      dong,
      fallback: {
        mapUrl: REGION_SELECT_GUIDE_LINK.url,
        ...(regionSources.length > 0
          ? { regionSources: regionSources.map((source) => ({ title: source.title, url: source.url })) }
          : {}),
        ...(category ? { itemLine: category.fallbackLine } : {}),
      },
    },
    log,
  );
}

async function handleFindDisposalSpots({
  dong,
  region,
  itemName,
}: {
  dong: string;
  region?: string;
  itemName?: string;
}): Promise<LoggedToolResult> {
  const normalizedDong = normalizeDongName(dong);
  // 공백만 온 지역은 안 온 것으로 본다 — 다른 툴과 같은 규칙이다.
  const hintRegion = region?.trim() || undefined;
  const regionMatch = findRegionalPolicy(hintRegion);
  const namedSubRegion = findNamedSubRegionForMatch(regionMatch, hintRegion);

  /**
   * 품목명은 이 툴에서 **필터일 뿐**이라 되묻지 않는다(R2). `ambiguous`도 `not_found`도
   * 품목 필터 없이 전 묶음 요약으로 떨어진다 — 장소를 물은 사람에게 품목을 되물으면
   * 원래 질문이 사라진다.
   */
  const resolvedItem = itemName?.trim() ? resolveWasteItem(itemName) : undefined;
  const matchedItem = resolvedItem?.status === "match" ? resolvedItem.match.item : undefined;
  const itemCategory = matchedItem ? spotCategoryForItemId(matchedItem.id) : undefined;

  const lookup = await findSpotsByDong(normalizedDong);
  const baseLog: ToolLogMeta = {
    matchedId: matchedItem?.id,
    matchedRegion: regionMatch?.region.name,
    upstreamMs: lookup.ms,
  };

  if (!lookup.ok) {
    return spotFallbackResult({
      dong: normalizedDong,
      reason: "upstream",
      regionMatch,
      category: itemCategory,
      item: matchedItem,
      log: { ...baseLog, status: "spots_fallback", upstream: lookup.upstream },
    });
  }

  let rows: SpotRow[];
  let regionLabel: string | undefined;

  if (regionMatch) {
    const metroNames = metroPrefixNames(regionMatch.region);
    // 행마다 다시 계산하지 않는다 — 한 호출에 최대 1,000행을 거른다.
    const districts = districtNames(regionMatch, namedSubRegion);
    rows = lookup.rows.filter((row) => addressInRegion(row.addrBase, metroNames, districts));
    regionLabel = regionMatch.region.name;
  } else {
    // 역추적 색인 없이 수렴만 본다(R4). 등록 지역 40곳짜리 색인으로 "이 동은 유일하다"를
    // 판정하면 전국 동명에서 오염된 쪽을 정답으로 확정해 버린다 — 그건 필터가 아니다.
    const counts = new Map<string, number>();
    for (const row of lookup.rows) {
      const label = addressRegionLabel(row.addrBase);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    if (counts.size > 1) {
      const regions = Array.from(counts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, SPOT_MAX_ASK_REGIONS)
        .map(([label]) => label);
      // 오염된 주소를 자신 있게 내보내는 것보다 한 번 되묻는 쪽이 낫다.
      // 지역을 대긴 했는데 우리가 못 알아들은 경우(맨 `중구` 등)에는 그 사실부터 밝힌다 —
      // 방금 지역을 말한 사람에게 지역을 알려 달라고만 하면 안 들은 것처럼 읽힌다.
      const unresolvedRegionNote =
        hintRegion && !regionMatch ? `말씀하신 지역 "${hintRegion}"만으로는 어느 시·군·구인지 정하지 못했습니다. ` : "";
      return textResult(
        `${unresolvedRegionNote}여러 지역에 "${normalizedDong}"이라는 같은 이름의 동이 있습니다(${regions.join(", ")}). 시·군·구를 함께 알려주세요 — 예: "서울 노원구 상계동".`,
        { found: false, dong: normalizedDong, ambiguousDong: true, regions },
        { ...baseLog, status: "spots_ask", upstream: lookup.upstream },
      );
    }

    rows = lookup.rows;
    regionLabel = Array.from(counts.keys())[0];
  }

  const buckets = new Map<string, SpotRow[]>();
  for (const row of rows) {
    const category = categorizeSpotName(row.spotNm);
    const bucket = buckets.get(category.id) ?? [];
    bucket.push(row);
    buckets.set(category.id, bucket);
  }

  /**
   * 품목이 확정되면 그 묶음만, 아니면 기본 노출 묶음 전부를 표 순서대로 채운다.
   *
   * 확정됐는데 걸리는 묶음이 없는 품목(`소파`처럼 수거함이 답이 아닌 것들)은 **빈 목록**이다.
   * 여기서 필터를 슬쩍 풀면 소파를 물은 사람에게 폐의약품 수거함 주소를 내주게 된다 —
   * 못 찾았다고 말하고 폴백으로 내려앉는 쪽이 맞다.
   */
  const visible = matchedItem
    ? itemCategory
      ? [itemCategory]
      : []
    : spotCategories.filter((category) => category.defaultExposed);
  const shown: Array<{ category: SpotCategory; rows: SpotRow[]; found: number }> = [];
  // 전체 상한이 **통째로** 지운 묶음. 묶음당 상한은 "(N곳 중 M곳)"이 밝히지만, 묶음이
  // 아예 빠지면 그 종류가 이 동에 없는 것처럼 읽힌다 — 그게 상한 표기를 둔 이유였다.
  const omitted: Array<{ category: SpotCategory; found: number }> = [];
  let total = 0;
  for (const category of visible) {
    const bucket = buckets.get(category.id) ?? [];
    if (bucket.length === 0) continue;
    if (total >= SPOT_TOTAL_LIMIT) {
      omitted.push({ category, found: bucket.length });
      continue;
    }
    const room = Math.min(SPOT_PER_CATEGORY_LIMIT, SPOT_TOTAL_LIMIT - total);
    shown.push({ category, rows: bucket.slice(0, room), found: bucket.length });
    total += Math.min(room, bucket.length);
  }

  if (shown.length === 0) {
    return spotFallbackResult({
      dong: normalizedDong,
      reason: "empty",
      regionMatch,
      category: itemCategory,
      itemLabel: matchedItem?.name,
      item: matchedItem,
      // 필터를 통과한 행이 있는데 전부 숨긴 묶음(판매소·기타)이면 "없다"가 아니라
      // "전용 수거함은 못 찾았다"다 — 판매소가 응답의 절반을 차지하는 동이 실제로 있다.
      hiddenOnly: rows.length > 0,
      // 지역 필터가 행을 전부 걸렀으면 "이 동에는 없다"가 아니라 "이 지역에서는 못 찾았다"다 —
      // 서교동 107행이 노원구 필터에 전멸하는 조합이 실제로 있다.
      regionFilteredAll: rows.length === 0 && lookup.rows.length > 0 && Boolean(regionMatch),
      log: { ...baseLog, status: "spots_fallback", upstream: lookup.upstream },
    });
  }

  const heading = [regionLabel, normalizedDong].filter(Boolean).join(" ");
  const lines = [
    `## ${heading} 근처 배출 장소`,
    "",
    ...shown.flatMap(({ category, rows: spots, found }) => [
      // 몇 곳을 찾았고 몇 곳을 보여 주는지 가른다. 상한에 걸린 걸 감추면 "이 동에는
      // 세 곳뿐"으로 읽힌다.
      `### ${category.label} (${found > spots.length ? `${found}곳 중 ${spots.length}곳` : `${found}곳`})`,
      ...spots.map((spot) => `- ${spot.spotNm} | ${formatSpotAddress(spot)}`),
    ]),
    "",
    // 절단은 사용자가 눈치챌 수 없는 유일한 실패라 한 줄로 밝힌다(R1).
    lookup.truncated ? "- 자료가 많아 일부만 표시했습니다." : undefined,
    // 전체 상한이 지운 묶음도 같은 이유로 밝힌다 — 없는 게 아니라 못 실은 것이다.
    omitted.length > 0
      ? `- 자리가 모자라 ${omitted.map(({ category, found }) => `${category.label} ${found}곳`).join(" · ")}은 싣지 못했습니다. 품목을 정해 물으면 그 묶음을 바로 보여 드립니다.`
      : undefined,
    "- 수거함 위치는 바뀔 수 있습니다. 방문 전 지자체 안내를 확인하세요.",
    `- 출처: ${SPOT_SOURCE_LABEL}`,
    // 빈 줄을 살려야 마지막 수거함 줄과 맺음말이 붙어 읽히지 않는다. `filter(Boolean)`을
    // 쓰면 빈 문자열까지 지워져 블록이 통째로 붙는다.
  ].filter((line) => line !== undefined);

  return textResult(
    lines.join("\n"),
    {
      found: true,
      dong: normalizedDong,
      ...(regionLabel ? { region: regionLabel } : {}),
      categories: shown.map(({ category, rows: spots }) => ({
        id: category.id,
        label: category.label,
        spots: spots.map((spot) => ({ name: spot.spotNm, address: formatSpotAddress(spot) })),
      })),
      ...(lookup.truncated ? { truncated: true } : {}),
      ...(omitted.length > 0
        ? { omitted: omitted.map(({ category, found }) => ({ id: category.id, label: category.label, found })) }
        : {}),
      source: SPOT_SOURCE_LABEL,
    },
    { ...baseLog, status: "spots", upstream: lookup.upstream },
  );
}

function callStatus(result: CallToolResult): string {
  const structured = result.structuredContent as { found?: unknown; ambiguous?: unknown } | undefined;
  if (!structured) return "ok";
  if (structured.ambiguous === true) return "ambiguous";
  if (structured.found === false) return "not_found";
  if (structured.found === true) return "match";
  return "ok";
}

/**
 * Names the failure without quoting it. The class name and the top stack frame
 * are written in this repository, not by a caller, so they survive the privacy
 * cut that drops `message` — and without them a production `status: "error"`
 * line says only that something threw, which the runbook cannot act on.
 * A thrown non-Error is reported by type alone; its value could be caller text.
 */
function errorSignature(error: unknown): { errorName: string; errorAt?: string } {
  if (!(error instanceof Error)) return { errorName: `non-error:${typeof error}` };

  // stack[0] is "Name: message" — start at [1] so no message text rides along.
  const frame = error.stack?.split("\n")[1]?.trim();
  return { errorName: error.name, ...(frame ? { errorAt: frame } : {}) };
}

/**
 * Emits one JSON line per tool call to stdout — readable only when the server
 * runs locally, since the KC console exposes no container log view.
 * Log identifiers come from the handler's `_log` metadata (stripped here so it
 * never reaches a client), not from client-facing structuredContent fields.
 * Item names and exception messages are omitted by default because callers can
 * provide arbitrary strings; local QA may opt in with CALL_LOG_DETAILS=true.
 */
function withCallLog(
  tool: string,
  handler: (args: never) => Promise<LoggedToolResult>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args: Record<string, unknown>) => {
    const startedAt = Date.now();
    const input = {
      itemName: typeof args.itemName === "string" ? args.itemName : undefined,
      region: typeof args.region === "string" ? args.region : undefined,
      items: Array.isArray(args.items) ? args.items : undefined,
      // 동 이름도 사용자가 사는 곳이라 다른 인자와 같은 규칙을 따른다 — 기본 미기록,
      // 로컬 QA가 CALL_LOG_DETAILS로 켤 때만 남는다(PRD phase-12 R6).
      dong: typeof args.dong === "string" ? args.dong : undefined,
    };

    try {
      const { _log, ...result } = await handler(args as never);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          tool,
          ...(CALL_LOG_DETAILS_ENABLED ? { input } : {}),
          status: _log?.status ?? callStatus(result),
          matchedId: _log?.matchedId,
          matchedRegion: _log?.matchedRegion,
          regionStatus: _log?.regionStatus,
          score: _log?.score,
          matched: _log?.matched,
          total: _log?.total,
          fallbackTier: _log?.fallbackTier,
          inputSource: _log?.inputSource,
          upstream: _log?.upstream,
          upstreamMs: _log?.upstreamMs,
          ms: Date.now() - startedAt,
        }),
      );
      return result;
    } catch (error) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          tool,
          ...(CALL_LOG_DETAILS_ENABLED ? { input } : {}),
          status: "error",
          ...errorSignature(error),
          ...(CALL_LOG_DETAILS_ENABLED ? { message: error instanceof Error ? error.message : String(error) } : {}),
          ms: Date.now() - startedAt,
        }),
      );
      throw error;
    }
  };
}

// Built once at module load; shared by the SSE registration and the JSON-only
// tools/call dispatch so both paths run the identical logged handler.
const REGISTERED_TOOLS = TOOL_DEFS.map((def) => ({
  def,
  handler: withCallLog(def.name, def.handler),
}));

function registerTools(server: McpServer): void {
  for (const { def, handler } of REGISTERED_TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputShape,
        annotations: def.annotations,
      },
      handler,
    );
  }
}

function createServer(): McpServer {
  const server = new McpServer(
    SERVER_INFO,
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server);
  return server;
}

function hostnameAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((entry) =>
    entry.startsWith("*.") ? normalized.endsWith(entry.slice(1)) : normalized === entry,
  );
}

/**
 * Host header validation with suffix-wildcard support. The SDK's built-in
 * hostHeaderValidation only does exact matching, which would reject the
 * hostname PlayMCP in KC assigns to a newly created server.
 */
function hostValidation(req: Request, res: Response, next: NextFunction): void {
  const hostHeader = req.headers.host;
  if (!hostHeader) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Missing Host header" },
      id: null,
    });
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid Host header" },
      id: null,
    });
    return;
  }

  if (!hostnameAllowed(hostname)) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Invalid Host: ${hostname}` },
      id: null,
    });
    return;
  }

  next();
}

const app = express();
app.use(express.json());
// Host validation is DNS-rebinding protection for the MCP surface only.
// /health stays open: k8s-style probes send the pod IP as the Host header,
// which no allowlist entry can anticipate.
app.use("/mcp", hostValidation);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.get("origin");
  const corsAllowed = origin ? ALLOWED_ORIGINS.includes(origin) : false;

  if (corsAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", req.get("access-control-request-headers") ?? DEFAULT_CORS_ALLOWED_HEADERS);
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    res.vary("Origin");
  }

  if (req.method === "OPTIONS" && origin) {
    res.status(corsAllowed ? 204 : 403).end();
    return;
  }

  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: SERVICE_NAME,
    items: wasteItems.length,
  });
});

function jsonRpcResult(id: JsonRpcId | undefined, result: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

/**
 * -32602에 실을 필드별 복구 안내. 에러 메시지를 읽는 건 사용자가 아니라 호스트
 * 모델이라, 무엇이 틀렸는지에서 끝내지 않고 다음 호출을 어떻게 고치면 되는지까지
 * 잇는다. 여기 없는 필드는 이유 문장만 나간다. 키는 최상위 필드명이다 —
 * items.1처럼 원소를 가리키는 이슈도 고칠 곳은 결국 items라서 같은 안내를 쓴다.
 */
const ARGUMENT_RECOVERY_HINTS: Record<string, string> = {
  itemName: '버릴 품목명을 한국어로 전달하세요 (예: "기름 묻은 피자박스")',
  region: '한국 지역명을 전달하세요 (예: "서울 강남구")',
  items: '버릴 품목명 1~30개를 문자열 배열로 전달하세요 (예: ["침대", "화분"])',
  // 이 툴에서 MCP 오류로 끝나는 경우는 입력 검증 실패뿐이라(PRD phase-12 D2), 다음 호출을
  // 고칠 단서도 여기 한 줄이 전부다. 법정동이어야 한다는 것까지 적는다.
  dong: '법정동 이름을 전달하세요 (예: "상계동"). 구·시 이름만으로는 조회되지 않습니다',
};

function describeArgumentIssue(issue: z.ZodIssue): string {
  const field = issue.path.length > 0 ? issue.path.join(".") : "arguments";
  const hint = issue.path.length > 0 ? ARGUMENT_RECOVERY_HINTS[String(issue.path[0])] : undefined;
  const reason =
    issue.code === "invalid_type" && issue.received === "undefined"
      ? `${field}은(는) 필수 항목입니다`
      : issue.code === "too_small"
        ? `${field}이(가) 비어 있습니다`
        : issue.code === "too_big"
          ? `${field}이(가) 허용 크기(${issue.maximum}${issue.type === "array" ? "개" : "자"})를 넘습니다`
          : `${field} 값이 올바르지 않습니다 (${issue.message})`;
  return hint ? `${reason} — ${hint}.` : `${reason}.`;
}

/**
 * Runs a tools/call for clients that accept only application/json. The SDK
 * transport rejects POSTs whose Accept header lacks text/event-stream with a
 * 406, so without this path a JSON-only client could list tools but never
 * invoke one. Dispatches through the same logged handlers as the SSE path.
 */
async function handleJsonOnlyToolCall(body: JsonRpcBody, res: Response): Promise<void> {
  const params = body.params ?? {};
  const toolName = typeof params.name === "string" ? params.name : "";
  const registered = REGISTERED_TOOLS.find(({ def }) => def.name === toolName);
  if (!registered) {
    res.json(jsonRpcError(body.id, -32602, `Unknown tool: ${toolName}`));
    return;
  }

  const parsed = z.object(registered.def.inputShape).safeParse(params.arguments ?? {});
  if (!parsed.success) {
    // 자연어 안내가 앞, Zod 원문이 뒤. 모델은 첫 문장만으로 다음 호출을 고칠 수
    // 있고, 원문은 안내문이 뭉갠 세부(경로·코드)를 디버깅용으로 보존한다.
    const guidance = parsed.error.issues.map(describeArgumentIssue).join(" ");
    res.json(jsonRpcError(body.id, -32602, `Invalid arguments for ${toolName}: ${guidance}\n상세: ${parsed.error.message}`));
    return;
  }

  try {
    const result = await registered.handler(parsed.data);
    res.json(jsonRpcResult(body.id, result));
  } catch (error) {
    // Mirror the SDK: handler failures become an isError tool result, not a
    // protocol-level error.
    res.json(
      jsonRpcResult(body.id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      }),
    );
  }
}

async function handleJsonOnlyDiscovery(req: Request, res: Response): Promise<boolean> {
  const accept = req.get("accept") ?? "";
  if (accept.includes("text/event-stream")) return false;

  const body = req.body as JsonRpcBody | JsonRpcBody[];
  if (Array.isArray(body) || !body || typeof body !== "object") return false;

  switch (body.method) {
    case "initialize": {
      const protocolVersion =
        typeof body.params?.protocolVersion === "string" ? body.params.protocolVersion : "2025-03-26";
      res.json(
        jsonRpcResult(body.id, {
          protocolVersion,
          capabilities: {
            tools: {
              listChanged: true,
            },
          },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        }),
      );
      return true;
    }

    case "tools/list":
      res.json(jsonRpcResult(body.id, { tools: COMPAT_TOOLS }));
      return true;

    case "tools/call":
      await handleJsonOnlyToolCall(body, res);
      return true;

    case "ping":
      res.json(jsonRpcResult(body.id, {}));
      return true;

    case "notifications/initialized":
      res.status(202).end();
      return true;

    default:
      return false;
  }
}

app.post("/mcp", async (req: Request, res: Response) => {
  if (await handleJsonOnlyDiscovery(req, res)) return;

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    // Transport-level failures can carry request-derived text in `message`, and
    // "운영 로그에 예외 메시지를 남기지 않는다"(qa-runbook 2절) has to hold on this
    // path too, not just in withCallLog.
    console.error("Error handling MCP request:", CALL_LOG_DETAILS_ENABLED ? error : errorSignature(error));
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (req: Request, res: Response) => {
  const accept = req.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    res.json({
      jsonrpc: "2.0",
      id: null,
      result: {
        tools: COMPAT_TOOLS,
      },
      tools: COMPAT_TOOLS,
    });
    return;
  }

  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This stateless MCP server accepts POST requests at /mcp.",
    },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This MCP server is stateless.",
    },
    id: null,
  });
});

// Malformed JSON bodies throw before any route handler runs. Without this,
// Express falls back to its default HTML error page (stack trace included
// outside NODE_ENV=production), which is neither valid JSON-RPC nor safe to
// expose on a public, unauthenticated endpoint.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!(err instanceof SyntaxError) || !("status" in err) || (err as { status?: number }).status !== 400 || res.headersSent) {
    next(err);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: {
      code: -32700,
      message: "Parse error",
    },
    id: null,
  });
});

app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  console.log(`${SERVICE_NAME} MCP server listening at http://${HOST}:${PORT}`);
});
