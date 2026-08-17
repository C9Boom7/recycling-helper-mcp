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
  confidenceLabel,
  disposalGroupLabel,
  findBulkyWasteFeeRowTotal,
  findBulkyWasteFeeSchedule,
  findBulkyWasteFees,
  findMaterialGuideline,
  findNamedSubRegionForMatch,
  findRegionalPolicy,
  findRegionItemGuide,
  findRegisteredDistricts,
  findWasteItems,
  formatItemGuide,
  formatRegionBulkyContactLines,
  formatRegionItemGuide,
  formatRegionSourceList,
  formatUnregisteredDistrictScope,
  inferMaterialCategories,
  itemNeedsCriticalRegionCheck,
  itemNeedsRegionCheck,
  itemRegionCheckLabel,
  itemRegionGuidance,
  publicReviewMetadata,
  resolveRegionalPolicy,
  resolveWasteItem,
  wasteItems,
} from "./data.js";
import type { DisposalWidgetPayload } from "./widgets.js";
import { buildDisposalWidget } from "./widgets.js";

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
      "Returns step-by-step disposal instructions for a Korean household waste item from RecyclingHelper(재활용척척): preparation steps, cautions, official sources, and region-specific notes when a region is given. The primary tool whenever a user asks how to throw away, discard, or recycle something — e.g. '기름 묻은 피자박스 어떻게 버려?', '깨진 유리컵 버리는 법', '폐건전지 어디다 버려?'. Use it even when they mention where they live — pass that as region for local rules and the bulky-waste fee — e.g. '강남구 사는데 침대 어떻게 버려?'. Accepts vague or partial names; if ambiguous, the result lists candidates to ask about. " +
      "When the user sends a photo instead of a name, pass only the object being discarded — not the room, background, or people — as itemName in everyday Korean (foam tray → 스티로폼 용기, snack bag → 과자봉지), adding the material when the object type alone is ambiguous, and set inputSource to \"photo\". For several items in one photo, call make_cleanup_plan with one name each.",
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
    description:
      "Groups multiple Korean household waste items into disposal buckets (재활용/일반쓰레기/대형폐기물/특수폐기물) with RecyclingHelper(재활용척척) and returns an organized disposal plan. Use when the user lists two or more items to throw away, or mentions moving out, decluttering, or a big cleanup — e.g. '이사 가는데 침대, 옷, 화분 버려야 해', '대청소했더니 버릴 게 한가득이야'.",
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
      "Returns municipality-specific waste disposal information for a Korean region from RecyclingHelper(재활용척척): collection days, bulky-waste application links and fees, and official local sources. Use when the region itself is the question — e.g. '강남구 재활용 무슨 요일에 버려?', '성남시 대형폐기물 신고 어떻게 해?', '우리 동네 분리수거 어떻게 해?'. If the user asks how to dispose of a specific item and only mentions their area in passing ('강남구 사는데 침대 어떻게 버려?'), use get_disposal_steps with the region parameter instead. Optional itemName narrows the checklist to that item.",
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
 */
function buildRegionNotes(item: WasteItem, regionMatch: MatchedRegionPolicy | undefined, region?: string): string[] | undefined {
  if (!regionMatch || !itemNeedsRegionCheck(item)) return undefined;

  const hasSpecificGuide = Boolean(findRegionItemGuide(regionMatch.region, item));
  if (!hasSpecificGuide && !itemNeedsCriticalRegionCheck(item)) return undefined;

  // 지역 툴과 같은 갈래. 시·군·구를 이미 댄 사람에게 되묻는 대신 그 이름을 부른다.
  // 줄 수는 그대로다 — 되묻기 한 줄이 이름 부르기 한 줄로 바뀔 뿐이라 카드의
  // 지역 줄 두 개 예산을 밀지 않는다.
  const lines = formatRegionItemGuide(item, regionMatch, {
    namedSubRegion: findNamedSubRegionForMatch(regionMatch, region),
  });
  return lines.length > 0 ? lines : undefined;
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
  if (fees.length === 1) return `수수료 ${krw(min)} ${paren(fees[0].spec)}`;

  // 상한에 걸린 품목은 `fees.length`가 우리가 들고 있는 행 수지 규격 수가 아니다.
  // 그냥 "규격 12종"이라고 쓰면 텍스트 답변은 "대표 12개만"이라고 밝히는데 카드만
  // 12종이 전부인 척한다. 최저~최고 범위는 그대로 참이다 — 임포터가 잘라낼 때
  // 양 끝 행을 남긴다.
  const rowTotal = findBulkyWasteFeeRowTotal(regionMatch.region, item);
  const specDetail = rowTotal ? `규격 ${rowTotal}종 중 대표 ${fees.length}종` : `규격 ${fees.length}종`;
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
 * PRD phase-3 R4. The widget is the whole answer, so no structuredContent rides
 * along. `status` in `_log` is mandatory here: callStatus() infers the status
 * from structuredContent, which a widget response does not have, and without it
 * every confirmed match would be logged as a plain "ok".
 */
function widgetResult(payload: DisposalWidgetPayload, log: ToolLogMeta): LoggedToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
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

function generalRegionCheckList(region: MatchedRegionPolicy): string[] {
  const { generalWaste, recycling } = region.region;

  // 배출 요일·시간은 full 티어에만 있다. 얕은 티어에서 이 자리를 비우면 확인할
  // 항목이 통째로 사라지므로, 확정된 값 대신 "직접 확인할 항목"으로 돌려준다.
  const scheduleChecks = [
    generalWaste ? `일반쓰레기: ${generalWaste.time}, ${generalWaste.place}` : undefined,
    recycling ? `재활용품: ${recycling.time}, ${recycling.place}` : undefined,
    recycling?.vinylAndPetDay,
    recycling?.otherDays,
  ].filter((check): check is string => Boolean(check));

  return [
    ...(scheduleChecks.length > 0 ? scheduleChecks : ["일반쓰레기·재활용품 배출 요일과 시간 (같은 지역 안에서도 동·주택 유형별로 다를 수 있음)"]),
    "불연성 폐기물 봉투, 특수마대, PP봉투 등 지역 지정 봉투 기준",
    "음식물류폐기물 전용봉투, RFID, 제외 품목",
    "대형생활폐기물 사전 신청과 수수료",
    "폐건전지, 폐형광등, 폐의약품, 폐식용유, 의류수거함 위치",
  ];
}

function unknownRegionCheckList(item?: WasteItem): string[] {
  if (!item) {
    return [
      "재활용품 배출 요일과 시간",
      "품목별 전용 수거함 위치",
      "대형폐기물 신고 페이지와 수수료",
      "폐건전지, 폐형광등, 폐의약품 등 생활계 유해폐기물 수거 장소",
      "아파트, 단독주택, 상가 등 주택 유형별 배출 방식",
    ];
  }

  if (!itemNeedsRegionCheck(item)) {
    return ["거주지 종량제봉투 또는 재활용품 배출 요일과 장소"];
  }

  return itemNeedsCriticalRegionCheck(item)
    ? item.regionPolicy?.checkItems ?? ["전용 수거함, 지정 수거처, 신고 또는 수수료 기준"]
    : item.regionPolicy?.checkItems ?? ["실제 배출 요일·장소나 수거함·회수 가능 여부"];
}

function itemRegionCheckList(region: MatchedRegionPolicy | undefined, item?: WasteItem): string[] {
  if (!region) return unknownRegionCheckList(item);
  if (!item) return generalRegionCheckList(region);

  const guide = findRegionItemGuide(region.region, item);
  const feeRows = findBulkyWasteFees(region.region, item);
  // 이 체크리스트도 수수료 행을 전부 펼친다. 상한에 걸린 품목이면 여기서도 잘리므로
  // 잘렸다는 사실을 같이 내보낸다. 출처 URL은 바로 위 `formatRegionBulkyContactLines`가
  // "수수료 조회"로 이미 찍는다 — 체크 항목은 한 줄짜리라 주소까지 넣지 않는다.
  const feeRowTotal = findBulkyWasteFeeRowTotal(region.region, item);
  const checks = [
    ...(item.regionPolicy?.checkItems ?? []),
    ...(guide ? guide.steps : []),
    ...feeRows.map((fee) => `${fee.itemName} ${fee.spec} 수수료 ${fee.feeKrw.toLocaleString("ko-KR")}원`),
    ...(feeRowTotal ? [`확인된 ${feeRowTotal}개 규격 중 대표 ${feeRows.length}개만 옮겼습니다 — 나머지 규격은 수수료 조회 페이지에서 확인`] : []),
  ].filter(Boolean);

  if (checks.length > 0) return Array.from(new Set(checks));
  if (!itemNeedsRegionCheck(item)) return ["거주지 종량제봉투 또는 재활용품 배출 요일과 장소"];
  if (itemNeedsCriticalRegionCheck(item)) return ["전용 수거함, 지정 수거처, 신고 또는 수수료 기준"];
  return ["실제 배출 요일·장소나 수거함·회수 가능 여부"];
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
  if (resolved.status === "not_found") return unknownItemResult(itemName);
  if (resolved.status === "ambiguous") return ambiguousItemResult(itemName, resolved.candidates);

  const { match } = resolved;
  const { item } = match;

  // Resolved on both sides of the switch on purpose. WIDGET_ENABLED is a
  // rendering rollback (qa-runbook 4절); if the region were only matched in the
  // widget branch, flipping it off would also drop `matchedRegion` from the
  // logs, and the finals-window 지역 해상도 numbers are read off those.
  const regionMatch = itemNeedsRegionCheck(item) ? findRegionalPolicy(region) : undefined;
  const log = { matchedId: item.id, score: match.score, matchedRegion: regionMatch?.region.name };

  // PRD phase-3 R1 keeps ambiguous·not_found on text — those two need a
  // follow-up turn and a card closes the conversation. A confirmed match does
  // not, so it takes the same card get_disposal_steps serves.
  if (WIDGET_ENABLED) {
    return widgetResult(matchedItemWidget(item, regionMatch, { region }), log);
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
      ? "- 기본 판단은 가능하며, 실제 배출 요일·장소나 수거함·회수 가능 여부만 거주지 기준에 맞추면 됩니다."
      : undefined,
    region && itemNeedsRegionCheck(item) ? `- 입력 지역: ${region}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return textResult(
    text,
    {
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
    },
    log,
  );
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
  if (resolved.status === "not_found") return withInputSourceLog(unknownItemResult(itemName), inputSource);
  if (resolved.status === "ambiguous") {
    return withInputSourceLog(ambiguousItemResult(itemName, resolved.candidates), inputSource);
  }

  const { match } = resolved;
  const { item } = match;
  const regionMatch = itemNeedsRegionCheck(item) ? findRegionalPolicy(region) : undefined;
  const photoNote = inputSource === "photo" ? photoConfirmLine(item) : undefined;
  const log = { matchedId: item.id, score: match.score, matchedRegion: regionMatch?.region.name, inputSource };

  if (WIDGET_ENABLED) {
    return widgetResult(matchedItemWidget(item, regionMatch, { photoNote, region }), log);
  }

  // Below the widget branch on purpose: the card builds its own region lines
  // (matchedItemWidget), so this is the text path's alone.
  const regionNotes = buildRegionNotes(item, regionMatch, region);
  // 확인 문구는 안내 위에 둔다. 잘못 알아본 이름이면 아래 내용을 읽을 이유가 없다.
  const text = photoNote ? `${photoNote}\n\n${formatItemGuide(item, region)}` : formatItemGuide(item, region);
  return textResult(
    text,
    {
      found: true,
      id: item.id,
      itemName: item.name,
      matchedBy: match.matchedBy,
      disposalGroup: disposalGroupLabel(item.disposalType),
      summary: item.summary,
      steps: item.steps,
      cautions: item.cautions,
      review: publicReviewMetadata(item),
      region,
      regionCheckLevel: itemRegionCheckLabel(item),
      ...(regionNotes ? { regionNotes } : {}),
      sources: itemTopSources(item),
    },
    log,
  );
}

async function handleCheckConfusingItem({ itemName }: { itemName: string }): Promise<LoggedToolResult> {
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
    return {
      input: rawName,
      found: true as const,
      itemName: match.item.name,
      matchedBy: match.matchedBy,
      group: disposalGroupLabel(match.item.disposalType),
      summary: match.item.summary,
      regionCheckLevel: itemRegionCheckLabel(match.item),
      sourceRef: briefSourceTitle(match.item),
    };
  });

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
          entry.found ? `  - 대표 근거: ${entry.sourceRef}` : undefined,
        ].filter((line): line is string => line !== undefined);
      }),
      "",
    ]),
    planned.some((entry) => entry.found && entry.regionCheckLevel === "필수")
      ? "전용 수거함, 지정 수거처, 대형폐기물 신고·수수료 품목은 지역 공식 안내 확인이 필요합니다."
      : undefined,
    planned.some((entry) => entry.found && entry.regionCheckLevel === "참고")
      ? "일부 품목은 기본 판단은 위와 같고, 실제 배출 요일·장소나 수거함·회수 가능 여부만 거주지 기준에 맞추면 됩니다."
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
  {
    title: "생활폐기물 분리배출 누리집 지역별 안내",
    url: "https://www.분리배출.kr/front/region/region.do",
    basis: "거주 지역을 선택하면 그 지자체의 분리배출 기준을 볼 수 있습니다.",
  },
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
  if (regionMatch.region.coverageTier === "standard") {
    return `${regionMatch.region.name} 기준으로 대형폐기물 신청 경로와 수거함 안내까지 확인했습니다. 배출 요일과 시간은 같은 지역 안에서도 동·주택 유형별로 갈려 확정 안내에 넣지 않았습니다.`;
  }
  return undefined;
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
  const checkList = itemRegionCheckList(regionMatch, match?.item);

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
  const hasSchedule = Boolean(regionMatch?.region.generalWaste && regionMatch.region.recycling);

  const lines = [
    `${regionMatch?.region.name ?? region} 지역 확인 안내`,
    "",
    itemLine,
    match ? `기본 판단: ${match.item.summary}` : undefined,
    match ? `판단 범위: ${itemRegionGuidance(match.item)}` : undefined,
    regionLine,
    regionMatch ? regionCoverageNote(regionMatch, namedSubRegion) : undefined,
    hasSchedule ? "" : undefined,
    hasSchedule ? `${regionMatch?.region.name} 기본 배출 기준` : undefined,
    hasSchedule ? `- 일반쓰레기: ${regionMatch?.region.generalWaste?.time}, ${regionMatch?.region.generalWaste?.place}` : undefined,
    hasSchedule ? `- 재활용품: ${regionMatch?.region.recycling?.time}, ${regionMatch?.region.recycling?.place}` : undefined,
    hasSchedule ? `- ${regionMatch?.region.recycling?.vinylAndPetDay}` : undefined,
    hasSchedule ? `- ${regionMatch?.region.recycling?.otherDays}` : undefined,
    bulkyLines.length > 0 ? "" : undefined,
    bulkyLines.length > 0 ? `${regionMatch?.region.name} 대형폐기물` : undefined,
    ...bulkyLines,
    specialLines.length > 0 ? "" : undefined,
    specialLines.length > 0 ? `${regionMatch?.region.name} 수거함 안내` : undefined,
    ...specialLines,
    match && regionMatch ? "" : undefined,
    match && regionMatch ? `품목별 ${regionMatch.region.name} 안내` : undefined,
    match && regionMatch
      ? formatRegionItemGuide(match.item, regionMatch, { namedSubRegion, subRegionScopeAlreadyShown: true }).join("\n")
      : undefined,
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
              ...regionMatch.region.sources.slice(0, room).map((source) => ({ title: source.title, url: source.url })),
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
 * Emits one JSON line per tool call to stdout (collected as container logs).
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
          score: _log?.score,
          matched: _log?.matched,
          total: _log?.total,
          fallbackTier: _log?.fallbackTier,
          inputSource: _log?.inputSource,
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
    res.json(jsonRpcError(body.id, -32602, `Invalid arguments for ${toolName}: ${parsed.error.message}`));
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
