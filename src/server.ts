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
import type { MatchedRegionPolicy, MaterialGuideline, WasteItem, WasteMatch } from "./data.js";
import {
  confidenceLabel,
  disposalGroupLabel,
  findBulkyWasteFees,
  findMaterialGuideline,
  findRegionalPolicy,
  findRegionItemGuide,
  findWasteItems,
  formatItemGuide,
  formatRegionItemGuide,
  formatRegionSourceList,
  inferMaterialCategories,
  itemNeedsCriticalRegionCheck,
  itemNeedsRegionCheck,
  itemRegionCheckLabel,
  itemRegionGuidance,
  publicReviewMetadata,
  resolveWasteItem,
  wasteItems,
} from "./data.js";

const SERVICE_NAME = "RecyclingHelper(재활용척척)";
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
  score?: number;
  status?: string;
  matched?: number;
  total?: number;
};

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
      "Quickly classifies a Korean household waste item with RecyclingHelper(재활용척척): returns the disposal category (재활용/일반쓰레기/음식물쓰레기/소형가전/불연성 폐기물/대형폐기물/특수·유해폐기물 — 재질이나 크기로 갈리는 품목은 '일반쓰레기/대형폐기물'처럼 주 배출로를 앞에 둔 복합 라벨), confidence, and whether local municipality rules matter. Use for quick yes/no judgment questions like '피자박스 재활용 돼?', '이거 분리수거 되나?', '스티로폼은 어디에 버려?'. For full step-by-step disposal instructions, prefer get_disposal_steps.",
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
    description:
      "Returns step-by-step disposal instructions for a Korean household waste item from RecyclingHelper(재활용척척): preparation steps, cautions, official sources, and region-specific notes when a region is given. This is the primary tool whenever a user asks how to throw away, discard, or recycle something — e.g. '기름 묻은 피자박스 어떻게 버려?', '깨진 유리컵 버리는 법', '폐건전지 어디다 버려?'. Accepts vague or partial item names; if ambiguous, the result lists candidates so you can ask the user which one they mean.",
    inputShape: {
      itemName: itemNameParam,
      region: optionalRegionParam,
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
      "Explains commonly confused Korean waste-sorting cases with RecyclingHelper(재활용척척), comparing up to 3 similar items and their exceptions. Use when the user is unsure between categories or asks why — e.g. '영수증은 종이인데 왜 재활용 안 돼?', '컵라면 용기는 종이야 플라스틱이야?', '이것도 재활용 되는 거 맞아?'.",
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
      "Returns municipality-specific waste disposal information for a Korean region from RecyclingHelper(재활용척척): collection days, bulky-waste application links and fees, and official local sources. Use when the user names where they live or asks region-specific questions — e.g. '강남구 재활용 무슨 요일에 버려?', '성남시 대형폐기물 신고 어떻게 해?', '우리 동네 폐건전지 어디 버려?'. Optional itemName narrows the checklist to that item.",
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
function buildRegionNotes(item: WasteItem, regionMatch?: MatchedRegionPolicy): string[] | undefined {
  if (!regionMatch || !itemNeedsRegionCheck(item)) return undefined;

  const hasSpecificGuide = Boolean(findRegionItemGuide(regionMatch.region, item));
  if (!hasSpecificGuide && !itemNeedsCriticalRegionCheck(item)) return undefined;

  const lines = formatRegionItemGuide(item, regionMatch);
  return lines.length > 0 ? lines : undefined;
}

function textResult(text: string, structuredContent?: ToolResult, log?: ToolLogMeta): LoggedToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(log ? { _log: log } : {}),
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
function unknownItemResult(itemName: string): CallToolResult {
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

  return textResult(lines.join("\n"), {
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
  });
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
  return [
    `일반쓰레기: ${region.region.generalWaste.time}, ${region.region.generalWaste.place}`,
    `재활용품: ${region.region.recycling.time}, ${region.region.recycling.place}`,
    region.region.recycling.vinylAndPetDay,
    region.region.recycling.otherDays,
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
  const checks = [
    ...(item.regionPolicy?.checkItems ?? []),
    ...(guide ? guide.steps : []),
    ...findBulkyWasteFees(region.region, item).map((fee) => `${fee.itemName} ${fee.spec} 수수료 ${fee.feeKrw.toLocaleString("ko-KR")}원`),
  ].filter(Boolean);

  if (checks.length > 0) return Array.from(new Set(checks));
  if (!itemNeedsRegionCheck(item)) return ["거주지 종량제봉투 또는 재활용품 배출 요일과 장소"];
  if (itemNeedsCriticalRegionCheck(item)) return ["전용 수거함, 지정 수거처, 신고 또는 수수료 기준"];
  return ["실제 배출 요일·장소나 수거함·회수 가능 여부"];
}

async function handleClassifyWasteItem({ itemName, region }: { itemName: string; region?: string }): Promise<LoggedToolResult> {
  const resolved = resolveWasteItem(itemName);
  if (resolved.status === "not_found") return unknownItemResult(itemName);
  if (resolved.status === "ambiguous") return ambiguousItemResult(itemName, resolved.candidates);

  const { match } = resolved;
  const { item } = match;
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
    { matchedId: item.id, score: match.score },
  );
}

async function handleGetDisposalSteps({ itemName, region }: { itemName: string; region?: string }): Promise<LoggedToolResult> {
  const resolved = resolveWasteItem(itemName);
  if (resolved.status === "not_found") return unknownItemResult(itemName);
  if (resolved.status === "ambiguous") return ambiguousItemResult(itemName, resolved.candidates);

  const { match } = resolved;
  const { item } = match;
  const regionMatch = itemNeedsRegionCheck(item) ? findRegionalPolicy(region) : undefined;
  const regionNotes = buildRegionNotes(item, regionMatch);
  const text = formatItemGuide(item, region);
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
    { matchedId: item.id, score: match.score, matchedRegion: regionMatch?.region.name },
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
      return {
        input: rawName,
        found: false as const,
        group: "확인 필요",
        summary: "초기 데이터에서 확실히 찾지 못했습니다.",
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

async function handleGetRegionDisposalInfo({ region, itemName }: { region: string; itemName?: string }): Promise<LoggedToolResult> {
  const resolved = itemName ? resolveWasteItem(itemName) : undefined;
  const match = resolved?.status === "match" ? resolved.match : undefined;
  const ambiguousCandidates =
    resolved?.status === "ambiguous" ? resolved.candidates.map(ambiguousCandidateLabel) : undefined;
  const regionMatch = findRegionalPolicy(region);
  const checkList = itemRegionCheckList(regionMatch, match?.item);

  const itemLine = match
    ? `품목: ${match.item.name}`
    : ambiguousCandidates
    ? `품목: "${itemName}" — ${ambiguousCandidateSummary(ambiguousCandidates)}`
    : itemName
    ? `입력한 품목 "${itemName}"을(를) 초기 데이터에서 확실히 찾지 못했습니다.`
    : "품목을 함께 입력하면 확인해야 할 항목을 더 좁혀드릴 수 있습니다.";

  const lines = [
    `${regionMatch?.region.name ?? region} 지역 확인 안내`,
    "",
    itemLine,
    match ? `기본 판단: ${match.item.summary}` : undefined,
    match ? `판단 범위: ${itemRegionGuidance(match.item)}` : undefined,
    regionMatch ? `지역 요약: ${regionMatch.region.summary}` : undefined,
    "",
    regionMatch ? `${regionMatch.region.name} 기본 배출 기준` : undefined,
    regionMatch ? `- 일반쓰레기: ${regionMatch.region.generalWaste.time}, ${regionMatch.region.generalWaste.place}` : undefined,
    regionMatch ? `- 재활용품: ${regionMatch.region.recycling.time}, ${regionMatch.region.recycling.place}` : undefined,
    regionMatch ? `- ${regionMatch.region.recycling.vinylAndPetDay}` : undefined,
    regionMatch ? `- ${regionMatch.region.recycling.otherDays}` : undefined,
    match && regionMatch ? "" : undefined,
    match && regionMatch ? `품목별 ${regionMatch.region.name} 안내` : undefined,
    match && regionMatch ? formatRegionItemGuide(match.item, regionMatch).join("\n") : undefined,
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
      : [
          "- 생활폐기물 분리배출 누리집: https://www.분리배출.kr/front/region/region.do",
          "- 거주 지자체 청소/자원순환/환경 부서 안내 페이지",
          "- 대형폐기물은 지자체 대형폐기물 신고 페이지",
        ]),
  ].filter(Boolean);

  return textResult(
    lines.join("\n"),
    {
      region,
      matchedRegion: regionMatch?.region.name,
      item: match?.item.name,
      ambiguousCandidates,
      defaultSummary: match?.item.summary,
      checkList,
      officialSources: regionMatch
        ? regionMatch.region.sources.slice(0, 3).map((source) => ({ title: source.title, url: source.url }))
        : [
            { title: "생활폐기물 분리배출 누리집", url: "https://www.분리배출.kr/front/region/region.do" },
            { title: "거주 지자체 청소/자원순환/환경 부서 안내 페이지" },
          ],
    },
    {
      matchedId: match?.item.id,
      score: match?.score,
      matchedRegion: regionMatch?.region.name,
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
 * Emits one JSON line per tool call to stdout (collected as container logs).
 * Inputs here are only item/region names, never free-form user prompts, so
 * there is no personal data concern — do not log anything beyond these fields.
 * Log identifiers come from the handler's `_log` metadata (stripped here so it
 * never reaches a client), not from client-facing structuredContent fields.
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
          input,
          status: _log?.status ?? callStatus(result),
          matchedId: _log?.matchedId,
          matchedRegion: _log?.matchedRegion,
          score: _log?.score,
          matched: _log?.matched,
          total: _log?.total,
          ms: Date.now() - startedAt,
        }),
      );
      return result;
    } catch (error) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          tool,
          input,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
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
    console.error("Error handling MCP request:", error);
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
