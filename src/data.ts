import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Confidence = "high" | "medium" | "low";
export type SourceType = "official_guidance" | "local_guidance" | "law" | "safety_guidance" | "manual_review";
export type ReviewStatus = "draft" | "needs_source" | "verified" | "region_review_needed";

export type WasteSource = {
  title: string;
  url?: string;
  sourceType: SourceType;
  checkedAt: string;
  basis?: string;
  note?: string;
};

export type RegionPolicy = {
  scope: "national_default" | "region_specific" | "local_collection_point" | "bulky_waste";
  needsRegionCheck: boolean;
  regionCheckLevel?: "required" | "advisory";
  reason?: string;
  checkItems?: string[];
};

export type ReviewMetadata = {
  status: ReviewStatus;
  reviewer?: string;
  lastReviewedAt?: string;
  notes?: string[];
};

export type WasteItem = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  disposalType: string;
  conditions: string[];
  summary: string;
  steps: string[];
  cautions: string[];
  confidence: Confidence;
  needsRegionCheck: boolean;
  regionPolicy: RegionPolicy;
  sources: WasteSource[];
  review: ReviewMetadata;
  sourceRefs: string[];
};

export type RegionCollectionSource = WasteSource;

export type RegionItemGuide = {
  itemIds: string[];
  summary: string;
  steps: string[];
};

export type BulkyWasteFee = {
  itemId: string;
  category: string;
  itemName: string;
  spec: string;
  feeKrw: number;
};

export type BulkyWasteFeeSchedule = {
  regionId: string;
  regionName: string;
  checkedAt: string;
  applicationUrl: string;
  feeUrl: string;
  phone: string;
  source: WasteSource;
  fees: BulkyWasteFee[];
};

export type RegionalPolicyData = {
  id: string;
  name: string;
  aliases: string[];
  checkedAt: string;
  summary: string;
  generalWaste: {
    time: string;
    place: string;
    method: string;
    notes: string[];
  };
  recycling: {
    appliesTo: string;
    time: string;
    place: string;
    vinylAndPetDay: string;
    otherDays: string;
    method: string[];
    notes: string[];
  };
  foodWaste: {
    method: string[];
    generalWasteExceptions: string[];
    exceptionMethod: string;
  };
  specialCollections: {
    batteryAndFluorescentLamp: { method: string[] };
    medicine: { method: string[] };
    usedCookingOil: { method: string[] };
    clothing: { method: string[] };
  };
  bulkyWaste: {
    definition: string;
    place: string[];
    collection: string[];
    phone: string;
  };
  smallElectronics: {
    method: string[];
    examples: string[];
  };
  itemGuides: RegionItemGuide[];
  sources: RegionCollectionSource[];
};

export type MatchedRegionPolicy = {
  region: RegionalPolicyData;
  matchedBy: string;
};

export type WasteMatch = {
  item: WasteItem;
  score: number;
  matchedBy: string;
  matchKind: MatchKind;
};

const dataPath = fileURLToPath(new URL("./data/waste-items.json", import.meta.url));
const regionPolicyPath = fileURLToPath(new URL("./data/region-policies.json", import.meta.url));
const bulkyWasteFeePath = fileURLToPath(new URL("./data/bulky-waste-fees.json", import.meta.url));

export const wasteItems = JSON.parse(readFileSync(dataPath, "utf8")) as WasteItem[];
export const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8")) as RegionalPolicyData[];
export const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeePath, "utf8")) as BulkyWasteFeeSchedule[];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const SHORT_ALIAS_MAX_LENGTH = 2;
const HIGH_CONFIDENCE_SCORE = 88;
const MAX_AMBIGUOUS_CANDIDATES = 7;
const SHORT_ALIAS_PARTICLE_SUFFIXES = ["으로", "은", "는", "이", "가", "을", "를", "에", "도", "만", "야", "요", "죠", "지", "로"];

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function stripShortAliasParticle(token: string): string {
  for (const suffix of SHORT_ALIAS_PARTICLE_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

function hasStandaloneShortAliasMatch(queryTokens: string[], normalizedName: string): boolean {
  return queryTokens.some((token) => token === normalizedName || stripShortAliasParticle(token) === normalizedName);
}

function isLikelyDisposalTargetMention(query: string, normalizedQuery: string, normalizedName: string): boolean {
  if (normalizedQuery.startsWith(normalizedName)) {
    return false;
  }

  const index = normalizedQuery.indexOf(normalizedName);
  if (index <= 0) {
    return false;
  }

  const before = normalizedQuery.slice(0, index);
  const after = normalizedQuery.slice(index + normalizedName.length);
  const hasTopicBefore = /[은는이가]$/u.test(before);
  const looksLikeTarget = after.startsWith("수거함") || after.startsWith("수거처") || after.startsWith("류") || after.startsWith("로") || after.startsWith("으로");

  return hasTopicBefore && looksLikeTarget && query.includes("?");
}

const CONDITION_QUERY_SIGNALS: Array<{ condition: string; patterns: RegExp[]; score: number }> = [
  { condition: "contaminated", patterns: [/오염/u, /묻/u, /이물질/u, /찌꺼기/u, /더러/u, /국물/u, /양념/u, /소스/u, /크림/u, /성에/u, /핏물/u], score: 5 },
  { condition: "food_contaminated", patterns: [/음식물/u, /국물/u, /양념/u, /소스/u, /크림/u, /성에/u, /핏물/u, /고기/u], score: 6 },
  { condition: "oily", patterns: [/기름/u, /오일/u, /유분/u], score: 5 },
  { condition: "damaged", patterns: [/깨진/u, /깨졌/u, /부서/u, /금간/u, /금 간/u, /파손/u, /찌그러/u, /부푼/u, /부풀/u, /터진/u], score: 5 },
  { condition: "remaining_content", patterns: [/남았/u, /남은/u, /잔여/u, /내용물/u, /가스/u], score: 5 },
  { condition: "pressurized", patterns: [/가스/u, /스프레이/u, /부탄/u, /압축/u, /에어로졸/u], score: 5 },
  { condition: "electronics", patterns: [/배터리/u, /전지/u, /충전/u, /전자/u, /전동/u], score: 4 },
  { condition: "safe_wrap_required", patterns: [/깨진/u, /파손/u, /날카/u, /신문지/u, /테이프/u, /싸서/u], score: 4 },
  { condition: "separate_parts", patterns: [/분리/u, /뚜껑/u, /라벨/u, /스티커/u, /테이프/u, /송장/u], score: 4 },
  { condition: "mixed_material", patterns: [/복합/u, /재질/u, /플라스틱/u, /고철/u, /금속/u, /유리/u, /종이/u, /비닐/u], score: 4 },
];

function hasQuerySignal(query: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(query));
}

function scoreQuerySemanticSignals(query: string, item: WasteItem): number {
  const loweredQuery = query.toLowerCase();
  let bonus = 0;

  for (const signal of CONDITION_QUERY_SIGNALS) {
    if (item.conditions.includes(signal.condition) && hasQuerySignal(loweredQuery, signal.patterns)) {
      bonus += signal.score;
    }
  }

  if (item.category.includes("vinyl") && /비닐|봉지|파우치|필름|포장/u.test(loweredQuery)) {
    bonus += 6;
  }

  if ((item.category.includes("paper") || item.category.includes("cardboard")) && /종이|상자|박스/u.test(loweredQuery)) {
    bonus += 5;
  }

  if ((item.category.includes("can") || item.category.includes("metal")) && /캔|금속|고철/u.test(loweredQuery)) {
    bonus += 5;
  }

  return Math.min(bonus, 18);
}

/**
 * "generic_fragment" marks the one branch below (query is a short substring of
 * the candidate name/alias, e.g. "컵" inside "깨진 유리컵") that scores purely on
 * containment with no standalone-word check. Every other branch already requires
 * an exact, prefix, or standalone-token match, so only this one needs a tie check
 * in resolveWasteItem before it's safe to answer with confidence.
 */
type MatchKind = "none" | "exact" | "query_contains_name" | "short_alias_standalone" | "generic_fragment" | "fuzzy_overlap" | "target_mention";

function scoreItem(query: string, item: WasteItem): WasteMatch {
  const normalizedQuery = normalizeText(query);
  const queryTokens = normalizedTokens(query);
  const names = [item.name, ...item.aliases];
  const semanticBonus = scoreQuerySemanticSignals(query, item);
  let bestScore = 0;
  let matchedBy = item.name;
  let matchKind: MatchKind = "none";

  for (const name of names) {
    const normalizedName = normalizeText(name);
    const isShortAlias = normalizedName.length <= SHORT_ALIAS_MAX_LENGTH;
    let score = 0;
    let kind: MatchKind = "none";

    if (normalizedQuery === normalizedName) {
      score = 100;
      kind = "exact";
    } else if (normalizedQuery.includes(normalizedName)) {
      if (isLikelyDisposalTargetMention(query, normalizedQuery, normalizedName)) {
        score = 20;
        kind = "target_mention";
      } else if (isShortAlias) {
        score = hasStandaloneShortAliasMatch(queryTokens, normalizedName) ? 78 : 0;
        kind = "short_alias_standalone";
      } else {
        const startsWithName = normalizedQuery.startsWith(normalizedName);
        const lengthBonus = Math.min(normalizedName.length, 5);
        score = Math.min(99, 88 + lengthBonus + (startsWithName ? 5 : 0));
        kind = "query_contains_name";
      }
    } else if (normalizedName.includes(normalizedQuery)) {
      score = 82;
      kind = "generic_fragment";
    } else {
      if (!isShortAlias) {
        const queryChars = Array.from(new Set(normalizedQuery.split("")));
        const nameChars = new Set(normalizedName.split(""));
        const overlap = queryChars.filter((char) => nameChars.has(char)).length;
        score = Math.round((overlap / Math.max(queryChars.length, 1)) * 30);
        kind = "fuzzy_overlap";
      }
    }

    if (score > bestScore) {
      bestScore = score;
      matchedBy = name;
      matchKind = kind;
    }
  }

  const adjustedScore = bestScore > 0 && bestScore < HIGH_CONFIDENCE_SCORE ? Math.min(99, bestScore + semanticBonus) : bestScore;
  return { item, score: adjustedScore, matchedBy, matchKind };
}

export function findWasteItems(query: string, limit = 5): WasteMatch[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  return wasteItems
    .map((item) => scoreItem(query, item))
    .filter((match) => match.score >= 35)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ko"))
    .slice(0, limit);
}

export function findBestWasteItem(query: string): WasteMatch | undefined {
  return findWasteItems(query, 1)[0];
}

function hasReadableGenericFragmentLabel(query: string, match: WasteMatch): boolean {
  const normalizedQuery = normalizeText(query);
  const normalizedItemName = normalizeText(match.item.name);
  if (!normalizedQuery) return false;

  if (normalizedItemName.includes(normalizedQuery)) {
    return true;
  }

  const matchedTokens = normalizedTokens(match.matchedBy);
  const isCompactAlias = matchedTokens.length <= 3 && match.matchedBy.length <= 18;
  if (!isCompactAlias) {
    return false;
  }

  return matchedTokens.some((token) => {
    const stripped = stripShortAliasParticle(token);
    return token === normalizedQuery || stripped === normalizedQuery || token.endsWith(normalizedQuery);
  });
}

function genericFragmentCandidateRank(query: string, match: WasteMatch): number {
  const normalizedQuery = normalizeText(query);
  const normalizedItemName = normalizeText(match.item.name);
  const matchedTokens = normalizedTokens(match.matchedBy);
  let rank = 0;

  if (normalizedItemName.includes(normalizedQuery)) rank += 40;
  if (match.matchedBy === match.item.name) rank += 10;
  if (
    matchedTokens.some((token) => {
      const stripped = stripShortAliasParticle(token);
      return token === normalizedQuery || stripped === normalizedQuery;
    })
  ) {
    rank += 30;
  } else if (matchedTokens.some((token) => token.endsWith(normalizedQuery))) {
    rank += 20;
  }

  return rank;
}

export type WasteQueryResolution =
  | { status: "match"; match: WasteMatch }
  | { status: "ambiguous"; candidates: WasteMatch[] }
  | { status: "not_found" };

/**
 * Only the "generic_fragment" match kind is a bare containment check (e.g. "컵"
 * inside "깨진 유리컵", "종이컵", "컵라면 용기") with no standalone-word guard, so a
 * tie there is a real coin flip. Other kinds (short alias, exact, prefix) already
 * require a standalone-token or full match, so ties among those are resolved as
 * before (e.g. "약" and "약병" can both legitimately hit in the same sentence).
 */
export function resolveWasteItem(query: string): WasteQueryResolution {
  const matches = findWasteItems(query, wasteItems.length);
  if (matches.length === 0) {
    return { status: "not_found" };
  }

  const [best, ...rest] = matches;
  if (best.matchKind === "generic_fragment" && best.score < HIGH_CONFIDENCE_SCORE) {
    const tied = [best, ...rest].filter((match) => match.score === best.score && match.matchKind === "generic_fragment");
    const readableCandidates = tied
      .filter((match) => hasReadableGenericFragmentLabel(query, match))
      .sort(
        (a, b) =>
          genericFragmentCandidateRank(query, b) - genericFragmentCandidateRank(query, a) ||
          a.matchedBy.localeCompare(b.matchedBy, "ko") ||
          a.item.name.localeCompare(b.item.name, "ko"),
      );

    const candidates = (readableCandidates.length > 1 ? readableCandidates : tied).slice(0, MAX_AMBIGUOUS_CANDIDATES);
    if (candidates.length > 1) {
      return { status: "ambiguous", candidates };
    }
  }

  return { status: "match", match: best };
}

export function findRegionalPolicy(region?: string): MatchedRegionPolicy | undefined {
  if (!region) return undefined;

  const normalizedRegion = normalizeText(region);
  if (!normalizedRegion) return undefined;

  for (const policy of regionalPolicies) {
    const names = [policy.name, ...policy.aliases];
    for (const name of names) {
      const normalizedName = normalizeText(name);
      if (normalizedRegion === normalizedName || normalizedRegion.includes(normalizedName) || normalizedName.includes(normalizedRegion)) {
        return { region: policy, matchedBy: name };
      }
    }
  }

  return undefined;
}

export function confidenceLabel(confidence: Confidence): string {
  switch (confidence) {
    case "high":
      return "높음";
    case "medium":
      return "보통";
    case "low":
      return "낮음";
  }
}

const conditionLabels: Record<string, string> = {
  bulky: "크기/부피 확인",
  clean: "깨끗한 상태",
  coated: "코팅 여부",
  contaminated: "오염 여부 확인",
  damaged: "파손됨",
  electronics: "전자제품",
  empty_required: "내용물 비움 필요",
  food_contaminated: "음식물 오염",
  hazardous: "유해/위험 품목",
  hygiene: "위생용품",
  liquid: "액체",
  mixed_material: "복합재질",
  manufacturer_takeback: "제조사 회수 확인",
  nonburnable: "불연성 폐기물",
  oily: "기름 오염",
  pressurized: "압축/가스 용기",
  remaining_content: "내용물 남음",
  reusable: "재사용 가능 여부",
  safe_wrap_required: "안전 포장 필요",
  separate_parts: "분리 필요",
  sharp: "날카로움",
  small_item: "소형 품목",
  textile: "섬유류",
};

export function conditionLabel(condition: string): string {
  return conditionLabels[condition] ?? condition.replaceAll("_", " ");
}

export function itemNeedsRegionCheck(item: WasteItem): boolean {
  return item.regionPolicy?.needsRegionCheck ?? item.needsRegionCheck;
}

export function itemNeedsCriticalRegionCheck(item: WasteItem): boolean {
  if (!itemNeedsRegionCheck(item)) return false;
  if (item.regionPolicy?.regionCheckLevel === "required") return true;
  if (item.regionPolicy?.regionCheckLevel === "advisory") return false;

  const policyText = [
    item.disposalType,
    ...(item.conditions ?? []),
    ...item.steps,
    ...item.cautions,
    item.regionPolicy?.reason,
    ...(item.regionPolicy?.checkItems ?? []),
  ].join(" ");

  return (
    item.regionPolicy?.scope === "local_collection_point" ||
    item.regionPolicy?.scope === "bulky_waste" ||
    /불연성|특수규격|특수마대|PP봉투|생활계 유해폐기물|폐의약품|위험|누출|가스|폭발|구멍|통풍|신고|수수료/.test(policyText)
  );
}

export function itemRegionCheckLabel(item: WasteItem): string {
  if (!itemNeedsRegionCheck(item)) return "낮음";
  if (itemNeedsCriticalRegionCheck(item)) return "필수";
  return "참고";
}

export function itemRegionGuidance(item: WasteItem): string {
  if (!itemNeedsRegionCheck(item)) return "전국 공통 기준으로 바로 안내 가능합니다.";
  if (itemNeedsCriticalRegionCheck(item)) {
    return "지역 기준이 실제 배출 방법을 바꿀 수 있습니다. 전용 수거함, 신고 방식, 수수료 같은 공식 기준 확인이 필요합니다.";
  }

  return "기본 분리배출 판단은 전국 기준으로 안내 가능하며, 지역 정보는 배출 요일·장소 확인용입니다.";
}

export function itemSourceRefs(item: WasteItem): string[] {
  if (item.sources?.length > 0) {
    return item.sources.map((source) => source.title);
  }

  return item.sourceRefs;
}

/**
 * Drops internal editorial fields (reviewer, notes) before an item's review
 * metadata reaches tool responses. Those are for the data-maintenance workflow,
 * not for MCP callers or end users.
 */
export function publicReviewMetadata(item: WasteItem): Pick<ReviewMetadata, "status"> {
  return { status: item.review.status };
}

export function formatSourceList(item: WasteItem): string[] {
  if (item.sources?.length > 0) {
    return item.sources.map((source) => {
      const url = source.url ? ` (${source.url})` : "";
      const checkedAt = source.checkedAt ? `, 확인일: ${source.checkedAt}` : "";
      const basis = source.basis ? ` - ${source.basis}` : "";
      return `- ${source.title}${url}${checkedAt}${basis}`;
    });
  }

  return item.sourceRefs.map((source) => `- ${source}`);
}

export function formatRegionSourceList(region: RegionalPolicyData): string[] {
  return region.sources.map((source) => {
    const url = source.url ? ` (${source.url})` : "";
    const checkedAt = source.checkedAt ? `, 확인일: ${source.checkedAt}` : "";
    const basis = source.basis ? ` - ${source.basis}` : "";
    return `- ${source.title}${url}${checkedAt}${basis}`;
  });
}

export function findRegionItemGuide(region: RegionalPolicyData, item: WasteItem): RegionItemGuide | undefined {
  return region.itemGuides.find((guide) => guide.itemIds.includes(item.id));
}

export function findBulkyWasteFeeSchedule(region: RegionalPolicyData): BulkyWasteFeeSchedule | undefined {
  return bulkyWasteFeeSchedules.find((schedule) => schedule.regionId === region.id);
}

export function findBulkyWasteFees(region: RegionalPolicyData, item: WasteItem): BulkyWasteFee[] {
  return findBulkyWasteFeeSchedule(region)?.fees.filter((fee) => fee.itemId === item.id) ?? [];
}

function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatBulkyWasteFeeLines(item: WasteItem, region: RegionalPolicyData): string[] {
  const schedule = findBulkyWasteFeeSchedule(region);
  if (!schedule) return [];

  const fees = schedule.fees.filter((fee) => fee.itemId === item.id);
  if (fees.length === 0) return [];

  return [
    `- ${region.name} 대형생활폐기물 수수료 후보:`,
    ...fees.map((fee) => `  - ${fee.itemName} ${fee.spec}: ${formatKrw(fee.feeKrw)}`),
    `- 신청 URL: ${schedule.applicationUrl}`,
    `- 수수료 출처: ${schedule.feeUrl}`,
  ];
}

export function formatRegionItemGuide(item: WasteItem, regionMatch?: MatchedRegionPolicy): string[] {
  if (!regionMatch) return [];

  const { region } = regionMatch;
  const guide = findRegionItemGuide(region, item);
  const bulkyWasteFeeLines = formatBulkyWasteFeeLines(item, region);
  if (guide) {
    return [`- ${guide.summary}`, ...guide.steps.map((step) => `- ${region.name} 기준: ${step}`), ...bulkyWasteFeeLines];
  }

  if (item.disposalType.includes("bulky")) {
    return [
      `- ${region.name} 대형생활폐기물은 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다.`,
      `- 문의/신청 안내 전화: ${region.bulkyWaste.phone}`,
      ...bulkyWasteFeeLines,
    ];
  }

  if (item.disposalType.includes("special_collection")) {
    return [
      `- ${region.name}에서는 전용 수거함이나 지정 수거처 위치를 확인한 뒤 배출합니다.`,
      "- 폐형광등·폐건전지는 일반주택의 경우 주민센터 및 주택가 수거함, 아파트는 단지 내 수거함을 확인합니다.",
    ];
  }

  return [`- ${region.summary}`];
}

export function formatItemGuide(item: WasteItem, region?: string): string {
  const regionMatch = findRegionalPolicy(region);
  const hasSpecificRegionGuide = Boolean(regionMatch && findRegionItemGuide(regionMatch.region, item));
  const needsCriticalRegionCheck = itemNeedsCriticalRegionCheck(item);
  const needsAdvisoryRegionCheck = itemNeedsRegionCheck(item) && !needsCriticalRegionCheck;
  const regionGuideLines =
    itemNeedsRegionCheck(item) && (hasSpecificRegionGuide || needsCriticalRegionCheck)
      ? formatRegionItemGuide(item, regionMatch)
      : [];
  const hasRegionGuide = regionGuideLines.length > 0;
  const lines = [
    `## ${item.name}`,
    "",
    `- 분류: ${item.category}`,
    `- 배출 판단: ${item.disposalType}`,
    `- 결론: ${item.summary}`,
    `- 확신도: ${confidenceLabel(item.confidence)}`,
    `- 판단 범위: ${itemRegionGuidance(item)}`,
    item.conditions.length > 0 ? `- 판단 조건: ${item.conditions.map(conditionLabel).join(", ")}` : undefined,
    "",
    "### 배출 방법",
    ...item.steps.map((step, index) => `${index + 1}. ${step}`),
  ].filter((line): line is string => line !== undefined);

  if (item.cautions.length > 0) {
    lines.push("", "### 주의", ...item.cautions.map((caution) => `- ${caution}`));
  }

  if (needsCriticalRegionCheck) {
    lines.push("", "### 지역 확인 필요");

    if (regionMatch) {
      lines.push(`- ${regionMatch.region.name} 기준으로 확인된 지역 안내를 함께 반영합니다.`);
    } else if (region) {
      lines.push(`- ${region} 기준 수거함 위치, 신고 방식, 배출일 또는 수수료는 지자체 공식 안내 확인이 필요합니다.`);
    } else {
      lines.push("- 이 품목은 전용 수거함, 지정 수거처, 대형폐기물 신고 또는 수수료처럼 지역별 기준이 실제 배출 방법을 바꿀 수 있습니다.");
    }

    if (hasRegionGuide) lines.push(...regionGuideLines);
    if (item.regionPolicy?.checkItems?.length) lines.push(...item.regionPolicy.checkItems.map((checkItem) => `- 확인 항목: ${checkItem}`));
  } else if (needsAdvisoryRegionCheck && regionMatch) {
    lines.push("", "### 지역 참고");
    lines.push(
      hasRegionGuide
        ? `- ${regionMatch.region.name} 기준으로 확인된 지역 안내를 함께 반영합니다.`
        : `- 기본 배출 판단은 위와 같고, ${regionMatch.region.name} 기준 배출 요일·장소나 수거함·회수 가능 여부만 맞춰 확인하면 됩니다.`,
    );
    if (hasRegionGuide) lines.push(...regionGuideLines);
  }

  lines.push("", "### 근거", ...formatSourceList(item));

  if (regionMatch && needsCriticalRegionCheck) {
    lines.push("", `### ${regionMatch.region.name} 공식 출처`, ...formatRegionSourceList(regionMatch.region));
  }

  return lines.join("\n");
}

export function disposalGroupLabel(disposalType: string): string {
  if (disposalType.includes("bulky")) return "대형폐기물";
  if (disposalType.includes("special") || disposalType.includes("hazardous")) return "특수/유해폐기물";
  if (disposalType.includes("general") && disposalType.includes("recycle")) return "재활용/일반쓰레기";
  if (disposalType.includes("general")) return "일반쓰레기";
  if (disposalType.includes("recycle")) return "재활용";
  if (disposalType.includes("region")) return "지역 확인 필요";
  return "확인 필요";
}
