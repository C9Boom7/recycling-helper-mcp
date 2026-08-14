import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Confidence = "high" | "medium" | "low";
export type SourceType = "official_guidance" | "local_guidance" | "law" | "safety_guidance" | "manual_review";
export type ReviewStatus = "draft" | "needs_source" | "verified" | "region_review_needed" | "standard_import";

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

/**
 * `full`은 배출 요일까지 확인한 기존 5개 지역, `standard`는 대형폐기물 신청
 * 경로와 수거함 안내만 담은 얕은 티어, `metro`는 자치구가 등록되지 않았을 때
 * 착지시키는 광역시도 레이어다. 대형폐기물 접수는 기초자치단체 소관이라
 * `metro`에는 `bulkyWaste`를 두지 않는다(validate가 강제).
 */
export type RegionCoverageTier = "full" | "standard" | "metro";

export type RegionBulkyWaste = {
  definition?: string;
  place?: string[];
  collection?: string[];
  phone?: string;
  applicationUrl?: string;
  feeUrl?: string;
  /** URL과 번호는 확인 시점이 달라서 지역 `checkedAt`과 따로 기록한다. */
  contactCheckedAt?: string;
};

export type RegionalPolicyData = {
  id: string;
  name: string;
  aliases: string[];
  coverageTier: RegionCoverageTier;
  /** 자치구·시가 속한 광역시도의 region id. `metro` 항목에는 없다. */
  metroId?: string;
  checkedAt: string;
  summary: string;
  generalWaste?: {
    time: string;
    place: string;
    method: string;
    notes: string[];
  };
  recycling?: {
    appliesTo: string;
    time: string;
    place: string;
    vinylAndPetDay: string;
    otherDays: string;
    method: string[];
    notes: string[];
  };
  foodWaste?: {
    method: string[];
    generalWasteExceptions: string[];
    exceptionMethod: string;
  };
  specialCollections?: {
    batteryAndFluorescentLamp?: { method: string[] };
    medicine?: { method: string[] };
    usedCookingOil?: { method: string[] };
    clothing?: { method: string[] };
  };
  bulkyWaste?: RegionBulkyWaste;
  smallElectronics?: {
    method: string[];
    examples: string[];
  };
  itemGuides?: RegionItemGuide[];
  sources: RegionCollectionSource[];
};

/** 자치구·시 레벨과 광역시도 레벨. 매칭은 작은 단위부터 확정한다. */
export type RegionMatchLevel = "district" | "metro";

export type MatchedRegionPolicy = {
  region: RegionalPolicyData;
  matchedBy: string;
  level: RegionMatchLevel;
};

export type RegionResolution =
  | { status: "match"; match: MatchedRegionPolicy }
  | { status: "ambiguous"; candidates: MatchedRegionPolicy[] }
  | { status: "not_found" };

export type WasteMatch = {
  item: WasteItem;
  score: number;
  matchedBy: string;
  matchKind: MatchKind;
};

export type MaterialGuideline = {
  id: string;
  label: string;
  quickRule: string;
  steps: string[];
  cautions: string[];
  whenGeneral: string;
  source: { title: string; url?: string };
};

const dataPath = fileURLToPath(new URL("./data/waste-items.json", import.meta.url));
const regionPolicyPath = fileURLToPath(new URL("./data/region-policies.json", import.meta.url));
const bulkyWasteFeePath = fileURLToPath(new URL("./data/bulky-waste-fees.json", import.meta.url));
const materialGuidelinePath = fileURLToPath(new URL("./data/material-guidelines.json", import.meta.url));
const disposalGroupPath = fileURLToPath(new URL("./data/disposal-groups.json", import.meta.url));

export const wasteItems = JSON.parse(readFileSync(dataPath, "utf8")) as WasteItem[];
export const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8")) as RegionalPolicyData[];
export const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeePath, "utf8")) as BulkyWasteFeeSchedule[];
export const materialGuidelines = JSON.parse(readFileSync(materialGuidelinePath, "utf8")) as MaterialGuideline[];
// disposalType은 자유 문자열이라 라벨을 부분 문자열로 추론하면 새 값이 조용히
// 폴백으로 떨어진다("small_electronics_collection"이 어느 분기에도 안 걸리는 식).
// 매핑을 데이터로 두고 validate-data.mjs가 전수 대응을 강제한다.
export const disposalGroups = JSON.parse(readFileSync(disposalGroupPath, "utf8")) as Record<string, string>;

const materialGuidelineById = new Map(materialGuidelines.map((guideline) => [guideline.id, guideline]));

export function findMaterialGuideline(id: string): MaterialGuideline | undefined {
  return materialGuidelineById.get(id);
}

// Material inference for the not_found fallback. The ids are the material axis
// of material-guidelines.json — a deliberately separate system from the
// item-classification `category` field on waste items, even where strings
// overlap. Concrete material words come before disposal-channel words so a
// query like "약과 포장지 폐의약품 수거함?" leads with the packaging material.
//
// Keywords are matched as bare substrings, so a word that also appears inside
// unrelated compounds stays out of the table: "글라스" would infer glass-bottle
// recycling for 선글라스, and "껍질" would infer food waste for 조개껍질. Both are
// general trash, and a wrong material principle reads more authoritative than
// the generic material menu the fallback shows instead.
const MATERIAL_QUERY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "styrofoam", pattern: /스티로폼|스치로폼|아이스박스|완충재/u },
  { category: "vinyl_film", pattern: /비닐|봉지|봉투|필름|포장지|포장재|파우치|에어캡|뽁뽁이/u },
  { category: "paper_cardboard", pattern: /종이|박스|상자|골판지|신문|서류|공책/u },
  { category: "can_metal", pattern: /캔|깡통|고철|금속|알루미늄|스텐|스테인리스|양은/u },
  { category: "glass_bottle", pattern: /유리/u },
  { category: "plastic_container", pattern: /플라스틱|페트|트레이|아크릴/u },
  { category: "textile", pattern: /옷|의류|섬유|이불|담요|커튼|수건|헝겊/u },
  { category: "electronics_battery", pattern: /배터리|건전지|전지|충전|전동|전자|전기|가전|노트북|랩탑|케이블|충전기/u },
  { category: "hazardous_pressurized", pattern: /의약품|알약|물약|연고|시럽|형광등|가스|스프레이|부탄|에어로졸|살충|농약|페인트|소화기/u },
  { category: "food_waste", pattern: /음식물|먹다\s*남|과일|채소/u },
  { category: "bulky", pattern: /대형|가구|침대|소파|장롱|매트리스/u },
  { category: "general_trash", pattern: /실리콘|고무|라텍스|가죽|멜라민|스펀지|스폰지|복합\s*재질/u },
];

export function inferMaterialCategories(query: string, limit = 2): string[] {
  const lowered = query.toLowerCase();
  const categories: string[] = [];
  for (const { category, pattern } of MATERIAL_QUERY_PATTERNS) {
    if (categories.length >= limit) break;
    if (pattern.test(lowered) && !categories.includes(category)) {
      categories.push(category);
    }
  }

  return categories;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * Bare disposal-category words are not items. They used to match whichever item
 * happened to carry a sentence-style alias containing the category — "대형폐기물"
 * hit `"인덕션 유리 상판 깨진 건 대형폐기물이야"` and returned a broken-cooktop card,
 * "음식물" hit `"곰팡이 핀 빵은 음식물쓰레기야"`. A confident card about an item the
 * user never named is worse than the not_found fallback, which asks what the item is.
 *
 * The 19 sentence aliases stay — they legitimately match full utterances by their
 * item-name part. Only the query side is gated, and only when the whole query is
 * the category term (so "대형폐기물 신고" or "음식물 쓰레기통" still search normally).
 *
 * The gate lives in findWasteItems rather than in resolveWasteItem alone, because
 * check_confusing_item searches directly and would otherwise still list "재활용"
 * as 배달 플라스틱 용기 — the same wrong-item card by another route.
 */
const DISPOSAL_CATEGORY_QUERIES = new Set(
  [
    "대형폐기물",
    "생활폐기물",
    "음식물",
    "음식물쓰레기",
    "일반쓰레기",
    "종량제",
    "종량제봉투",
    "재활용",
    "재활용품",
    "분리수거",
    "분리배출",
    "불연성",
    "불연성폐기물",
    "특수폐기물",
    "유해폐기물",
    "폐기물",
    "쓰레기",
  ].map(normalizeText),
);

function isDisposalCategoryQuery(query: string): boolean {
  return DISPOSAL_CATEGORY_QUERIES.has(normalizeText(query));
}

const SHORT_ALIAS_MAX_LENGTH = 2;
const HIGH_CONFIDENCE_SCORE = 88;
const MIN_MATCH_SCORE = 35;
const MAX_AMBIGUOUS_CANDIDATES = 7;
// fuzzy_jamo must stay below generic_fragment (82): it is a typo guess, never
// stronger evidence than an actual substring hit.
const FUZZY_JAMO_STRONG_SCORE = 70;
const FUZZY_JAMO_WEAK_MIN_SCORE = 40;
const FUZZY_JAMO_WEAK_MAX_SCORE = 55;
const FUZZY_JAMO_STRONG_SIMILARITY = 0.85;
const FUZZY_JAMO_MIN_SIMILARITY = 0.7;
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

const HANGUL_CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const HANGUL_JUNGSEONG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const HANGUL_JONGSEONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

// Compound jongseong stays a single compatibility jamo character so syllable
// counts stay predictable (e.g. "패트병"/"페트병" are both 7 jamo — the 0.857
// boundary case pinned in the Phase 1 PRD).
function decomposeHangulJamo(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      result += HANGUL_CHOSEONG[Math.floor(offset / 588)];
      result += HANGUL_JUNGSEONG[Math.floor((offset % 588) / 28)];
      result += HANGUL_JONGSEONG[offset % 28];
    } else {
      result += char;
    }
  }

  return result;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

type IndexedName = {
  name: string;
  normalized: string;
  jamo: string;
  isShortAlias: boolean;
};

type IndexedItem = {
  item: WasteItem;
  names: IndexedName[];
};

// Names and aliases are static data, so their normalization and jamo
// decomposition happen once here rather than once per name per query.
const indexedItems: IndexedItem[] = wasteItems.map((item) => ({
  item,
  names: [item.name, ...item.aliases].map((name) => {
    const normalized = normalizeText(name);
    return {
      name,
      normalized,
      jamo: decomposeHangulJamo(normalized),
      isShortAlias: normalized.length <= SHORT_ALIAS_MAX_LENGTH,
    };
  }),
}));

type ScoredQuery = {
  raw: string;
  normalized: string;
  tokens: string[];
};

type FuzzyQuery = {
  normalized: string;
  jamoVariants: string[];
  isBareItemName: boolean;
};

function buildFuzzyQuery({ normalized, tokens }: ScoredQuery): FuzzyQuery {
  const variants = new Set<string>([normalized]);
  for (const token of tokens) {
    if (token.length <= 1) continue;
    variants.add(token);
    variants.add(stripShortAliasParticle(token));
  }

  return {
    normalized,
    jamoVariants: Array.from(variants, (variant) => decomposeHangulJamo(variant)).filter(Boolean),
    // The weak band only fires on a bare item name. In a longer query a generic
    // compound token sits ~0.7 from unrelated items ("약과 포장지"↔"약 포장재"), and
    // the not_found material fallback answers those better than a coin-flip
    // suggestion would.
    isBareItemName: tokens.length <= 1,
  };
}

// A typo guess must agree with the candidate on the word's first jamo, the same
// prefix constraint fuzzy search engines use. Similarity alone lets phonetic
// neighbours collide across unrelated words ("테이프"↔"베이프", "포장지"↔"화장지",
// "조개껍질"↔"호두껍질"); the recall lost on first-consonant typos is answered by
// the not_found material fallback, while a wrong suggestion is not.
function jamoTypoSimilarity(queryJamo: string, nameJamo: string): number {
  if (!queryJamo || !nameJamo) return 0;
  if (queryJamo[0] !== nameJamo[0]) return 0;

  const maxLength = Math.max(queryJamo.length, nameJamo.length);
  const minLength = Math.min(queryJamo.length, nameJamo.length);
  // The edit distance is at least the length gap, so this ratio caps the
  // reachable similarity — a cheap way to skip the Levenshtein matrix for the
  // sentence-vs-short-name pairs that make up most of the scan.
  if (minLength / maxLength < FUZZY_JAMO_MIN_SIMILARITY) return 0;

  return 1 - levenshteinDistance(queryJamo, nameJamo) / maxLength;
}

function fuzzyJamoScore(query: FuzzyQuery, name: IndexedName): number {
  let bestSimilarity = 0;
  for (const queryJamo of query.jamoVariants) {
    bestSimilarity = Math.max(bestSimilarity, jamoTypoSimilarity(queryJamo, name.jamo));
  }

  if (bestSimilarity >= FUZZY_JAMO_STRONG_SIMILARITY) return FUZZY_JAMO_STRONG_SCORE;
  if (!query.isBareItemName || bestSimilarity < FUZZY_JAMO_MIN_SIMILARITY) return 0;

  const similaritySpan = FUZZY_JAMO_STRONG_SIMILARITY - FUZZY_JAMO_MIN_SIMILARITY;
  const scoreSpan = FUZZY_JAMO_WEAK_MAX_SCORE - FUZZY_JAMO_WEAK_MIN_SCORE;
  return FUZZY_JAMO_WEAK_MIN_SCORE + Math.round(((bestSimilarity - FUZZY_JAMO_MIN_SIMILARITY) / similaritySpan) * scoreSpan);
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
type MatchKind = "none" | "exact" | "query_contains_name" | "short_alias_standalone" | "generic_fragment" | "fuzzy_jamo" | "target_mention";

function scoreItemNames(query: ScoredQuery, indexed: IndexedItem): WasteMatch {
  const { raw, normalized: normalizedQuery, tokens: queryTokens } = query;
  const semanticBonus = scoreQuerySemanticSignals(raw, indexed.item);
  let bestScore = 0;
  let matchedBy = indexed.item.name;
  let matchKind: MatchKind = "none";

  for (const { name, normalized: normalizedName, isShortAlias } of indexed.names) {
    let score = 0;
    let kind: MatchKind = "none";

    if (normalizedQuery === normalizedName) {
      score = 100;
      kind = "exact";
    } else if (normalizedQuery.includes(normalizedName)) {
      if (isLikelyDisposalTargetMention(raw, normalizedQuery, normalizedName)) {
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
    }

    if (score > bestScore) {
      bestScore = score;
      matchedBy = name;
      matchKind = kind;
    }
  }

  const adjustedScore =
    bestScore > 0 && bestScore < HIGH_CONFIDENCE_SCORE ? Math.min(99, bestScore + semanticBonus) : bestScore;
  return { item: indexed.item, score: adjustedScore, matchedBy, matchKind };
}

// Typo guesses never take the semantic bonus: 70 + 18 would overtake
// generic_fragment (82) and break the typo-stays-weakest invariant.
function scoreItemTypos(query: FuzzyQuery, indexed: IndexedItem): WasteMatch {
  let bestScore = 0;
  let matchedBy = indexed.item.name;

  for (const name of indexed.names) {
    // A name that shares a substring with the query is not a typo of it: that
    // containment is scored by scoreItemNames, including the cases it
    // deliberately holds down (a "폐의약품 수거함" mention is not a query about
    // 폐의약품), and a typo guess must not route around those guards.
    if (name.isShortAlias || query.normalized.includes(name.normalized) || name.normalized.includes(query.normalized)) {
      continue;
    }

    const score = fuzzyJamoScore(query, name);
    if (score > bestScore) {
      bestScore = score;
      matchedBy = name.name;
    }
  }

  return { item: indexed.item, score: bestScore, matchedBy, matchKind: bestScore > 0 ? "fuzzy_jamo" : "none" };
}

function rankMatches(matches: WasteMatch[]): WasteMatch[] {
  return matches
    .filter((match) => match.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ko"));
}

export function findWasteItems(query: string, limit = 5): WasteMatch[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || isDisposalCategoryQuery(query)) {
    return [];
  }

  const scoredQuery: ScoredQuery = { raw: query, normalized: normalizedQuery, tokens: normalizedTokens(query) };
  const named = rankMatches(indexedItems.map((indexed) => scoreItemNames(scoredQuery, indexed)));
  if (named.length > 0) {
    return named.slice(0, limit);
  }

  // Typo matching is a fallback tier, not a competing signal. Running it only
  // when no name or alias hit exists keeps near-miss guesses out of every
  // list-shaped output (e.g. check_confusing_item's top 3) at any score band,
  // and a well-spelled query never pays for the jamo Levenshtein scan.
  const fuzzyQuery = buildFuzzyQuery(scoredQuery);
  const typos = rankMatches(indexedItems.map((indexed) => scoreItemTypos(fuzzyQuery, indexed)));
  return typos.slice(0, limit);
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
  // A bare category term comes back empty from findWasteItems, which lands on
  // the not_found fallback below.
  const matches = findWasteItems(query, wasteItems.length);
  if (matches.length === 0) {
    return { status: "not_found" };
  }

  const [best, ...rest] = matches;

  // Typo guesses confirm only when exactly one candidate clears the strong
  // similarity bar; anything weaker is surfaced as an "is this what you
  // meant?" candidate list, even when there is just one candidate. The typo
  // tier never mixes with name matches, so every match here is a guess.
  if (best.matchKind === "fuzzy_jamo") {
    const strongMatches = matches.filter((match) => match.score >= FUZZY_JAMO_STRONG_SCORE);
    if (strongMatches.length === 1) {
      return { status: "match", match: strongMatches[0] };
    }

    return { status: "ambiguous", candidates: matches.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
  }

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

export function regionMatchLevel(region: RegionalPolicyData): RegionMatchLevel {
  return region.coverageTier === "metro" ? "metro" : "district";
}

/**
 * 3(완전 일치) > 2(질의가 지역명으로 시작) > 1(지역명이 질의로 시작).
 *
 * 양쪽 모두 **앞부분 기준**인 게 핵심이다. 한국어 주소는 큰 단위부터 적으므로
 * 실제 지역 참조는 항상 어느 한쪽의 앞에서 겹친다. 아무 위치나 허용하면 형태소
 * 경계를 넘어 걸린다 — "남구"가 "서울강남구"에 걸려 조용히 강남구로 확정되고,
 * "부산 해운대구"는 "해운대구" 속의 "대구" 때문에 대구광역시까지 후보로 끌어온다.
 * 앞부분으로 고정하면 "강남"은 "강남구"를, "부산 해운대구"는 부산만 찾고,
 * "남구"는 아무것도 못 찾아 전국 폴백으로 내려간다. 틀린 답보다 모르는 답이 낫다.
 */
const REGION_MIN_FRAGMENT_QUERY_LENGTH = 2;

type RegionMatchStrength = 3 | 2 | 1;

function regionMatchStrength(normalizedQuery: string, normalizedName: string): RegionMatchStrength | 0 {
  if (!normalizedName) return 0;
  if (normalizedQuery === normalizedName) return 3;
  if (normalizedQuery.startsWith(normalizedName)) return 2;
  if (normalizedName.startsWith(normalizedQuery) && normalizedQuery.length >= REGION_MIN_FRAGMENT_QUERY_LENGTH) return 1;
  return 0;
}

/** 한 레벨에서 주어진 강도로 매칭되는 지역들. 같은 지역이 여러 별칭으로 걸리면 하나로 접는다. */
function regionCandidatesAt(
  policies: RegionalPolicyData[],
  normalizedQuery: string,
  level: RegionMatchLevel,
  strength: RegionMatchStrength,
): MatchedRegionPolicy[] {
  const byRegionId = new Map<string, MatchedRegionPolicy>();

  for (const policy of policies) {
    if (regionMatchLevel(policy) !== level) continue;
    if (byRegionId.has(policy.id)) continue;

    for (const name of [policy.name, ...policy.aliases]) {
      if (regionMatchStrength(normalizedQuery, normalizeText(name)) !== strength) continue;
      byRegionId.set(policy.id, { region: policy, matchedBy: name, level });
      break;
    }
  }

  return Array.from(byRegionId.values()).sort((a, b) => a.region.name.localeCompare(b.region.name, "ko"));
}

/**
 * 명확하게 확정되는 가장 작은 단위가 이긴다. 강도가 높은 단계부터 내려가되
 * 같은 강도 안에서는 자치구를 광역시도보다 먼저 본다. 이 순서가 핵심 케이스를
 * 가른다 — "부산 중구"는 자치구 완전 일치로 확정, "부산"은 자치구가 여럿이라
 * 미확정이지만 광역 완전 일치가 더 앞 단계라 되묻지 않고 광역으로 착지,
 * "중구"는 어느 단계에서도 유일하지 않아 되묻는다.
 */
/**
 * 완전 일치는 레벨을 가리지 않고 먼저 본다 — 질의가 통째로 광역명이면("경기")
 * 그건 광역 참조지 자치구 이름의 조각이 아니다. 그 다음은 자치구의 약한 단계까지
 * 모두 본 뒤에야 광역으로 내려간다. 이래야 "서울 강남"이 광역 서울이 아니라
 * 강남구로 착지한다 — 명확하게 확정되는 가장 작은 단위가 이긴다.
 */
const REGION_RESOLUTION_ORDER: ReadonlyArray<readonly [RegionMatchLevel, RegionMatchStrength]> = [
  ["district", 3],
  ["metro", 3],
  ["district", 2],
  ["district", 1],
  ["metro", 2],
  ["metro", 1],
];

export function resolveRegionalPolicyIn(policies: RegionalPolicyData[], region?: string): RegionResolution {
  if (!region) return { status: "not_found" };

  const normalizedQuery = normalizeText(region);
  if (!normalizedQuery) return { status: "not_found" };

  let ambiguous: MatchedRegionPolicy[] | undefined;

  for (const [level, strength] of REGION_RESOLUTION_ORDER) {
    const candidates = regionCandidatesAt(policies, normalizedQuery, level, strength);
    if (candidates.length === 1) return { status: "match", match: candidates[0] };
    // 되묻기는 더 앞선 단계가 전부 비었을 때만 쓴다. 약한 단계에서 후보가
    // 여럿이어도, 아직 안 본 단계에서 유일 확정이 나오면 그쪽이 이긴다.
    if (candidates.length > 1 && !ambiguous) ambiguous = candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES);
  }

  return ambiguous ? { status: "ambiguous", candidates: ambiguous } : { status: "not_found" };
}

export function resolveRegionalPolicy(region?: string): RegionResolution {
  return resolveRegionalPolicyIn(regionalPolicies, region);
}

/**
 * 확정된 지역만 돌려준다. 되묻어야 하는 입력은 지역 없음으로 취급해, 호출부가
 * 조용히 틀린 지역 기준을 답변에 싣지 않게 한다. 되묻는 응답이 필요한 곳은
 * `resolveRegionalPolicy`를 직접 쓴다.
 */
export function findRegionalPolicy(region?: string): MatchedRegionPolicy | undefined {
  const resolved = resolveRegionalPolicy(region);
  return resolved.status === "match" ? resolved.match : undefined;
}

/** 광역 안내로 착지했을 때 "어느 구인지" 좁히도록 되짚어줄 등록된 자치구들. */
export function findRegisteredDistricts(metro: RegionalPolicyData): RegionalPolicyData[] {
  return regionalPolicies
    .filter((policy) => policy.metroId === metro.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
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
  return region.itemGuides?.find((guide) => guide.itemIds.includes(item.id));
}

/**
 * 대형폐기물 신청 경로. `standard`는 신청·수수료 URL과 직통번호가 전부 채워져
 * 있다는 게 데이터 추가 조건이고, `metro`는 접수 자체가 자치구 소관이라
 * 번호 대신 자치구 확인이 필요하다는 사실을 밝힌다.
 */
export function formatRegionBulkyContactLines(region: RegionalPolicyData): string[] {
  if (region.coverageTier === "metro") {
    return [`- ${region.name} 대형폐기물 접수는 시·군·구 소관이라, 거주 중인 시·군·구를 확인해야 신청 경로와 수수료가 정해집니다.`];
  }

  const { bulkyWaste } = region;
  if (!bulkyWaste) return [];

  return [
    bulkyWaste.phone ? `- 문의/신청 안내 전화: ${bulkyWaste.phone}` : undefined,
    bulkyWaste.applicationUrl ? `- 인터넷 신청: ${bulkyWaste.applicationUrl}` : undefined,
    bulkyWaste.feeUrl ? `- 수수료 조회: ${bulkyWaste.feeUrl}` : undefined,
  ].filter((line): line is string => line !== undefined);
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
    // 대형폐기물이 보조 배출로면 사전 신청은 그 갈래에서만 필요하다. 무조건
    // 신청 절차만 안내하면 종량제봉투가 기본인 품목(빗자루·돗자리 등)에
    // 틀린 절차를 지시하게 된다.
    return [
      isBulkySecondaryRoute(item)
        ? `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : `- ${region.name} 대형생활폐기물은 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다.`,
      ...formatRegionBulkyContactLines(region),
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

/**
 * 배출 그룹은 `disposal-groups.json`의 명시 매핑으로만 정한다. 복합 배출로는
 * "주 배출로/보조 배출로" 순서로 적어, 종량제봉투가 기본인 품목이 통째로
 * "대형폐기물"로 보이지 않게 한다. "확인 필요"는 make_cleanup_plan에서
 * not_found·모호 항목의 그룹이기도 해서, 매칭된 품목에는 절대 쓰지 않는다 —
 * validate가 disposalType 전수 대응을 강제하므로 폴백은 도달 불가다.
 */
export function disposalGroupLabel(disposalType: string): string {
  return disposalGroups[disposalType] ?? "확인 필요";
}

/** 대형폐기물이 보조 배출로일 뿐인지 — 주 배출로는 종량제봉투·소형가전 수거함 등. */
function isBulkySecondaryRoute(item: WasteItem): boolean {
  const label = disposalGroupLabel(item.disposalType);
  return label.includes("대형폐기물") && !label.startsWith("대형폐기물");
}
