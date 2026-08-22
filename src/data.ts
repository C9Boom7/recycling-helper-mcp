import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokenizeQuery } from "./korean/query-tokenizer.js";

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
  /**
   * 임포터가 품목당 표시 상한을 걸기 전 행 수. 상한에 걸린 품목만 담는다 —
   * 안 걸린 품목까지 넣으면 `fees`를 세면 나오는 값이 그대로 중복된다.
   * 손으로 넣은 행은 임포터를 거치지 않으므로 `validate-data.mjs`가 실제 행 수와
   * 대조한다.
   */
  preCapFeeRowCountByItemId?: Record<string, number>;
};

/**
 * `full`은 품목별 지역 안내와 신청 기한까지 확인한 초기 5개 지역, `standard`는
 * 대형폐기물 신청 경로와 수거함 안내만 담은 얕은 티어, `metro`는 자치구가 등록되지 않았을 때
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
  /**
   * 배출 전에 폐기물에 붙이는 것. **확인한 지역만 채운다.**
   *
   * 이 필드가 없으면 지금까지 쓰던 "접수증 또는 접수번호를 부착해" 문장이
   * 그대로 나간다 — 서울 자치구 대부분이 실제로 그렇고, 32곳을 한꺼번에
   * 조사하지 않아도 되도록 기본값을 바꾸지 않았다.
   *
   * `none`은 "확인해 보니 붙일 게 없다"는 뜻이지 "아직 안 봤다"가 아니다.
   * 부산 해운대구·부산진구가 그렇다 — 신청하면 대행업체가 현장에 나와 품목을
   * 확인하고 그 자리에서 수수료를 받으므로, 배출 전에 발급되는 접수증이
   * 아예 없다. 그런데도 고정 문장이 붙어 "없는 접수번호를 붙이라"는 안내가
   * 나가고 있었다.
   */
  prePosting?: "receipt" | "sticker" | "none";
};

export type RegionalPolicyData = {
  id: string;
  name: string;
  aliases: string[];
  /**
   * 상세 데이터가 아직 없어 이 광역으로 받아 넘기는 시·군·구 이름들. `metro`
   * 항목에만 둔다.
   *
   * 매칭에서는 `aliases`와 똑같이 쓰이지만 **뜻이 다르다** — `aliases`는 광역
   * 자신을 부르는 여러 표기이고, 이쪽은 사용자가 실제로 지목한 기초자치단체다.
   * 한 배열에 섞어 두면 "청주시"로 착지한 응답이 "거주 중인 시·군·구를
   * 알려주세요"라고 되물어, 방금 들은 것을 다시 묻는 꼴이 된다. 갈라 두면
   * 응답이 그 이름을 그대로 부를 수 있다.
   */
  districtAliases?: string[];
  /**
   * 같은 자리의 시·군·구지만 **이름만으로는 광역이 안 정해지는** 것들. 중구·동구·
   * 서구·남구·북구·강서구는 광역시 여섯 곳에 흩어져 있고, 고성군은 강원과 경남에
   * 하나씩, 광주시는 광주광역시와 표기가 겹친다.
   *
   * 그래서 `districtAliases`와 달리 **매칭에는 절대 쓰지 않는다**(`regionMatchNames`
   * 참조). 맨 "중구"는 지금처럼 되물어야 한다 — 어느 광역인지 모르는 채로 상세
   * 데이터가 없다고 답하면 없는 확신을 파는 것이다.
   *
   * 쓰이는 데는 한 곳뿐이다. 질의 앞에 이 광역의 표기가 실제로 붙어 있어서 광역이
   * 이미 확정된 경우(`부산 중구`), 남은 조각을 지목한 이름으로 부를 수 있게 한다.
   * `metro` 항목에만 둔다.
   */
  prefixOnlyDistrictAliases?: string[];
  coverageTier: RegionCoverageTier;
  /** 자치구·시가 속한 광역시도의 region id. `metro` 항목에는 없다. */
  metroId?: string;
  checkedAt: string;
  summary: string;
  // 배출 요일·시간·장소를 담던 `generalWaste`·`recycling`은 2026-08-19에 걷어냈다.
  // 구 대표값 하나로는 동과 주택 유형에 따라 갈리는 실제 배출 기준을 맞출 수 없어,
  // 확정 안내 대신 "직접 확인할 항목"과 공식 출처로만 잇는다.
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
  // 재질 이름 하나만 들어온 경우는 부분 문자열 표를 훑지 않고 바로 갈래를 준다.
  // 그 표는 `철` 같은 한 글자를 담을 수 없기 때문이다(MATERIAL_ONLY_QUERIES 주석 참고).
  const materialOnly = MATERIAL_ONLY_QUERIES.get(normalizeText(query));
  if (materialOnly) {
    return [materialOnly];
  }

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

/**
 * 재질만 가리키는 낱말도 품목이 아니다. 카테고리어와 같은 이유로 막지만 근거는 조금 다르다 —
 * 카테고리어는 문장형 별칭에 얹혀 걸렸고, 이쪽은 **별칭 안에 재질 이름이 들어 있다는 이유로**
 * 엉뚱한 품목이 확정된다.
 *
 * `종이`가 `코팅지`(별칭 "코팅 종이", generic_fragment 91점)로 확정되던 것이 그 예다.
 * 종이를 물은 사람에게 "코팅지는 재활용이 안 됩니다" 카드가 나갔다. 차점이 `종이호일`(87점,
 * "기름종이")이라 둘 중 어느 쪽이 이겨도 오답이다. `비닐`은 `비닐류 포장재`와 `뽁뽁이`가
 * 88점 동점이라 사실상 동전던지기였다.
 *
 * 확정하지 않고 not_found로 보내면 Phase 1의 재질 폴백이 `material-guidelines.json`의
 * 원칙으로 답한다. 실제로 "종이 어떻게 버려?"라는 **문장**은 이미 그 경로로 제대로 답하고
 * 있었다 — 답을 갖고 있으면서 명사 하나만 넘어올 때 엉뚱한 카드가 그걸 가로채고 있던 셈이다.
 * 호스트 LLM은 보통 명사만 뽑아 넘기므로 실사용 경로는 그쪽이다.
 *
 * **`플라스틱`·`유리`·`나무`·`천`은 일부러 넣지 않았다.** 이들은 지금 되묻기로 착지하는데,
 * 되묻기가 더 나은 답이다 — 같은 유리라도 유리병은 재활용, 깨진 유리는 신문지에 싸서
 * 종량제·불연성이라 배출법이 갈린다. 재질 원칙 하나로 답하면 둘 중 하나는 틀린다.
 * 여기 넣는 기준은 "재질어인가"가 아니라 **"재질 안내가 지금 답보다 나은가"**다.
 *
 * 낱말과 붙는 재질 갈래를 값으로 함께 둔다. `철`·`쇠`는 `MATERIAL_QUERY_PATTERNS`에 넣을 수 없다 —
 * 그 표는 부분 문자열로 훑으므로 `지하철`·`철거`·`철학책`·`쇠고기`까지 캔·고철류로 끌고 간다
 * (표 위 주석이 `글라스`·`껍질`을 뺀 것과 같은 이유다). **질의 전체가 그 낱말일 때만** 갈래를
 * 지정하면 그 위험 없이 안내를 붙일 수 있다.
 *
 * 값이 `undefined`면 확정만 막고 갈래는 폴백의 기본 메뉴에 맡긴다. `목재`처럼 대응하는
 * 재질 가이드가 없는 낱말은 아예 넣지 않는다 — 막아도 나아지는 게 없다.
 *
 * 품목명·별칭과 정확히 일치하는 낱말(`스티로폼`, `캔`)은 여기 없어야 한다. 게이트가
 * `resolveWasteItem` 맨 앞에서 끊으므로 exact 매칭보다 먼저 걸려 **그 품목을 확정할 수
 * 없게 된다.** `scripts/evaluate-data.ts`가 품목명·별칭과 예약어의 충돌을 검사한다
 * (`validate-data.mjs`는 TS를 읽지 못해 목록을 복제해야 하므로 그쪽에 두지 않았다).
 */
const MATERIAL_ONLY_QUERIES = new Map<string, string | undefined>(
  (
    [
      ["종이", "paper_cardboard"],
      ["비닐", "vinyl_film"],
      ["고무", "general_trash"],
      ["가죽", "general_trash"],
      ["금속", "can_metal"],
      ["철", "can_metal"],
      ["쇠", "can_metal"],
      ["알루미늄", "can_metal"],
      ["스텐", "can_metal"],
      ["스테인리스", "can_metal"],
      ["섬유", "textile"],
      ["헝겊", "textile"],
    ] as Array<[string, string | undefined]>
  ).map(([word, category]) => [normalizeText(word), category]),
);

function isMaterialOnlyQuery(query: string): boolean {
  return MATERIAL_ONLY_QUERIES.has(normalizeText(query));
}

/**
 * 이름이 "가스레인지"로 시작할 뿐 실제로는 다른 물건인 붙박이 살림들. 후드와 받침장이
 * 각자 공식 근거를 갖춘 품목으로 서기 전까지는, **이름이 접두어로 겹친다는 이유만으로**
 * `gas_range`가 이기게 두지 않는다. 받침장을 물은 사람에게 "가스 밸브를 잠그고 연결
 * 호스를 분리" 절차와 가스레인지 수수료가 나가느니 not_found로 되묻는 편이 안전하다.
 *
 * 정확히 일치하는 낱말 몇 개만 막으면 거의 다 새어 나간다 — `가스렌지 후드`(`가스렌지`는
 * `gas_range`의 실제 별칭이고 구어에서 더 흔하다), `가스레인지 받침`, `가스레인지 후드
 * 필터`, `빌트인 가스레인지 후드`가 전부 98점 단독 확정으로 돌아왔다. 그래서 표기를
 * `렌지`→`레인지`로 모은 뒤 **포함 여부**로 본다.
 *
 * `상판`은 일부러 뺐다. 가스레인지 상판은 가스레인지의 일부라 같은 안내가 크게 어긋나지
 * 않는다. 여기 넣는 기준은 "이름이 겹치는가"가 아니라 **"다른 물건인가"**다.
 */
const GAS_RANGE_NONMATCH_PARTS = ["후드", "받침"];

/** `가스렌지`·`렌지후드` 표기를 하나로 모은다. 이 게이트 안에서만 쓰는 정규화다. */
function normalizeRangeSpelling(query: string): string {
  return normalizeText(query).replace(/렌지/g, "레인지");
}

function isGasRangeNonmatchCompound(query: string): boolean {
  const normalized = normalizeRangeSpelling(query);
  // 전자레인지 계열까지 끌고 가지 않게 가스레인지에만 건다. 다만 `레인지후드`는 앞에
  // "가스"가 없어도 후드 하나를 가리키는 낱말이라 함께 받는다.
  const isGasRangeCompound = normalized.includes("가스레인지");
  const isBareRangeHood = normalized.includes("레인지후드") && !normalized.includes("전자레인지");
  if (!isGasRangeCompound && !isBareRangeHood) {
    return false;
  }

  if (GAS_RANGE_NONMATCH_PARTS.some((part) => normalized.includes(part))) {
    return true;
  }

  // 받침장은 `가스레인지대`로도 부른다. `대`는 포함 검사에 쓰기엔 너무 짧아
  // (`가스레인지 2대`) 끝자리로만 본다.
  return normalized.endsWith("레인지대");
}

/**
 * 확정 게이트에 걸리는 질의인지. validate가 품목명·별칭과의 충돌을 막는 데 쓴다.
 *
 * 낱말 목록이 아니라 함수인 이유가 있다 — 게이트 셋 중 하나는 정확 일치가 아니라 포함
 * 규칙이라 목록으로 펼칠 수가 없다. 목록을 따로 두면 규칙이 늘 때마다 검사가 조용히
 * 뒤처지는데, 그 어긋남이 정확히 이 검사가 막으려는 사고다.
 */
export function isReservedQuery(query: string): boolean {
  return isDisposalCategoryQuery(query) || isMaterialOnlyQuery(query) || isGasRangeNonmatchCompound(query);
}

const SHORT_ALIAS_MAX_LENGTH = 2;
// 짧은 별칭이 독립 낱말로 걸렸을 때의 점수 = 이 값 + 별칭 길이. 길이를 더하는 건
// 질의 토큰에 조사를 지나쳐 깎은 형태가 섞여 들어오기 때문이다 — `요지는요?`는
// `요지`(이쑤시개)와 `요`(이불)를 동시에 물고, 둘이 동점이면 `rankMatches`의 가나다
// 순서가 이불을 뽑는다. 긴 별칭이 더 많은 글자를 설명하므로 그쪽을 믿는다.
const SHORT_ALIAS_STANDALONE_BASE_SCORE = 77;
const HIGH_CONFIDENCE_SCORE = 88;
const MIN_MATCH_SCORE = 35;
const MAX_AMBIGUOUS_CANDIDATES = 7;
// A query that only hits the modifier half of a compound name is not evidence
// of identity (see scoreItemNames), so it can never confirm an answer on its
// own — resolveWasteItem drops it before picking a match.
//
// It still has to survive ranking, though. Deleting these hits outright let the
// single surviving head hit confirm alone, turning a query that used to ask
// back into a confident wrong answer: "컴퓨터" answered 노트북 once 컴퓨터
// 모니터/책상/의자 were gone, "유리" answered 깨진 보온병 once 35 of its 37
// candidates were. The hit is weak evidence of identity but good evidence that
// the query is under-specified, which is exactly what the ask-back needs.
// Ranked just above MIN_MATCH_SCORE so it always sorts last.
const MODIFIER_FRAGMENT_SCORE = 36;
// fuzzy_jamo must stay below generic_fragment (82): it is a typo guess, never
// stronger evidence than an actual substring hit.
const FUZZY_JAMO_STRONG_SCORE = 70;
const FUZZY_JAMO_WEAK_MIN_SCORE = 40;
const FUZZY_JAMO_WEAK_MAX_SCORE = 55;
const FUZZY_JAMO_STRONG_SIMILARITY = 0.85;
const FUZZY_JAMO_MIN_SIMILARITY = 0.7;
const SHORT_ALIAS_PARTICLE_SUFFIXES = ["으로", "은", "는", "이", "가", "을", "를", "에", "도", "만", "야", "요", "죠", "지", "로"];

/** 품목명·별칭 쪽. 이건 우리가 쓴 데이터라 낱말 경계가 이미 띄어쓰기로 드러나 있다. */
function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

/**
 * 질의 쪽. 사용자가 쓴 문장이라 조사가 낱말에 붙어 들어오므로 낱말 경계 판단을
 * `query-tokenizer`에 맡긴다 — 형태소 분석기를 끼울 수 있는 지점이다.
 */
function queryTokens(query: string): string[] {
  return tokenizeQuery(query)
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

// 질의 토큰에는 조사를 떼어 가며 나온 중간 형태가 이미 다 들어 있다(`queryTokens`).
function hasStandaloneShortAliasMatch(queryTokens: string[], normalizedName: string): boolean {
  return queryTokens.includes(normalizedName);
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
  /** 조사를 떼어 가며 나온 중간 형태까지 다 들어 있다 — 낱말 수를 세는 용도가 아니다. */
  tokens: string[];
  /** 띄어쓰기·문장부호로만 자른 낱말 수. 질의가 한 낱말짜리인지 판단할 때 쓴다. */
  wordCount: number;
};

type FuzzyQuery = {
  normalized: string;
  jamoVariants: string[];
  isBareItemName: boolean;
};

function buildFuzzyQuery({ normalized, tokens, wordCount }: ScoredQuery): FuzzyQuery {
  const variants = new Set<string>([normalized]);
  for (const token of tokens) {
    if (token.length <= 1) continue;
    variants.add(token);
  }

  return {
    normalized,
    jamoVariants: Array.from(variants, (variant) => decomposeHangulJamo(variant)).filter(Boolean),
    // The weak band only fires on a bare item name. In a longer query a generic
    // compound token sits ~0.7 from unrelated items ("약과 포장지"↔"약 포장재"), and
    // the not_found material fallback answers those better than a coin-flip
    // suggestion would. `tokens`가 아니라 `wordCount`로 센다 — `tokens`에는 조사를
    // 뗀 중간 형태가 섞여 있어서 "카메래는" 한 낱말도 2개로 잡힌다.
    isBareItemName: wordCount <= 1,
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
type MatchKind = "none" | "exact" | "query_contains_name" | "short_alias_standalone" | "generic_fragment" | "modifier_fragment" | "fuzzy_jamo" | "target_mention";

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
        score = hasStandaloneShortAliasMatch(queryTokens, normalizedName) ? SHORT_ALIAS_STANDALONE_BASE_SCORE + normalizedName.length : 0;
        kind = "short_alias_standalone";
      } else {
        const startsWithName = normalizedQuery.startsWith(normalizedName);
        const lengthBonus = Math.min(normalizedName.length, 5);
        score = Math.min(99, 88 + lengthBonus + (startsWithName ? 5 : 0));
        kind = "query_contains_name";
      }
    } else if (normalizedName.includes(normalizedQuery)) {
      // Korean is head-final: the trailing morpheme of a compound noun carries
      // the identity. "의자" inside "낡은 의자" is the head, so they are the same
      // object. "에어컨" inside "에어컨 리모컨" is a modifier — a different object
      // that merely names the query in passing, and answering with it is worse
      // than not answering. Only a head-position hit counts as identity.
      if (normalizedName.endsWith(normalizedQuery)) {
        score = 82;
        kind = "generic_fragment";
      } else {
        score = MODIFIER_FRAGMENT_SCORE;
        kind = "modifier_fragment";
      }
    }

    if (score > bestScore) {
      bestScore = score;
      matchedBy = name;
      matchKind = kind;
    }
  }

  // The semantic bonus must not lift a modifier hit back over MIN_MATCH_SCORE —
  // material keywords in the query say nothing about which half of a compound
  // name was hit.
  const adjustedScore =
    matchKind !== "modifier_fragment" && bestScore > 0 && bestScore < HIGH_CONFIDENCE_SCORE
      ? Math.min(99, bestScore + semanticBonus)
      : bestScore;
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

  const scoredQuery: ScoredQuery = {
    raw: query,
    normalized: normalizedQuery,
    tokens: queryTokens(query),
    wordCount: normalizedTokens(query).length,
  };
  const named = rankMatches(indexedItems.map((indexed) => scoreItemNames(scoredQuery, indexed)));
  // Modifier hits alone do not count as a name hit: "에어컨" reaching only
  // "에어컨 리모컨" has still failed to name anything, so the typo tier below
  // must run exactly as it did before those hits were kept.
  if (named.some((match) => match.matchKind !== "modifier_fragment")) {
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
  // 재질 이름 하나짜리 질의는 **확정만** 막는다. 카테고리어와 달리 게이트가
  // `findWasteItems`가 아니라 여기 있는 이유가 있다 — `check_confusing_item`은
  // `findWasteItems`를 직접 부르는데, "종이"에 코팅지·종이호일을 늘어놓는 것은
  // 그 툴에서는 **정확히 원하는 동작**이다. 헷갈리는 품목을 보여 달라는 툴이니까.
  // 잘못된 건 그 목록의 첫 줄을 답으로 확정하는 것이지 목록 자체가 아니다.
  if (isMaterialOnlyQuery(query)) {
    return { status: "not_found" };
  }

  if (isGasRangeNonmatchCompound(query)) {
    return { status: "not_found" };
  }

  // A bare category term comes back empty from findWasteItems, which lands on
  // the not_found fallback below.
  const matches = findWasteItems(query, wasteItems.length);
  if (matches.length === 0) {
    return { status: "not_found" };
  }

  // Modifier hits ride along as an under-specification signal only (see
  // MODIFIER_FRAGMENT_SCORE). They never become the answer.
  const modifierHits = matches.filter((match) => match.matchKind === "modifier_fragment");
  const named = matches.filter((match) => match.matchKind !== "modifier_fragment");
  if (named.length === 0) {
    return { status: "not_found" };
  }

  const [best, ...rest] = named;

  // Typo guesses confirm only when exactly one candidate clears the strong
  // similarity bar; anything weaker is surfaced as an "is this what you
  // meant?" candidate list, even when there is just one candidate. The typo
  // tier never mixes with name matches, so every match here is a guess.
  if (best.matchKind === "fuzzy_jamo") {
    const strongMatches = named.filter((match) => match.score >= FUZZY_JAMO_STRONG_SCORE);
    if (strongMatches.length === 1) {
      return { status: "match", match: strongMatches[0] };
    }

    return { status: "ambiguous", candidates: named.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
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

    // One head hit left, but other items carry the query as a modifier: the
    // query named a whole category and this item is one member of it. "컴퓨터"
    // reaches 노트북 컴퓨터 alone once 컴퓨터 모니터/책상/의자 are set aside, and
    // answering with 노트북 is the same confident-wrong-answer this tier exists
    // to avoid. Ask instead.
    if (modifierHits.length > 0) {
      return { status: "ambiguous", candidates: [best, ...modifierHits].slice(0, MAX_AMBIGUOUS_CANDIDATES) };
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

/**
 * 이 지역으로 착지시킬 수 있는 모든 표기. 광역 자신의 이름과, 상세 데이터가
 * 없어 이 광역이 대신 받는 시·군·구 이름을 함께 본다 — 둘을 갈라 저장할 뿐
 * 여기서는 빠지지 않는다.
 *
 * `prefixOnlyDistrictAliases`는 뺀다. 그쪽은 이름만으로 광역이 안 정해지는
 * 것들이라 매칭에 넣으면 맨 "중구"가 광역 하나로 확정된다.
 */
function regionMatchNames(policy: RegionalPolicyData): string[] {
  return [policy.name, ...policy.aliases, ...(policy.districtAliases ?? [])];
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

    for (const name of regionMatchNames(policy)) {
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
const REGION_DISTRICT_ORDER: ReadonlyArray<readonly [RegionMatchLevel, RegionMatchStrength]> = [
  ["district", 3],
  ["metro", 3],
  ["district", 2],
  ["district", 1],
];

const REGION_METRO_FALLBACK_ORDER: ReadonlyArray<readonly [RegionMatchLevel, RegionMatchStrength]> = [
  ["metro", 2],
  ["metro", 1],
];

/**
 * 질의 앞에 붙은 광역명과 그것을 뗀 나머지. 가장 긴 광역 표기를 떼야
 * "경기도 분당구"에서 `경기`가 아니라 `경기도`가 떨어진다.
 *
 * 질의가 통째로 광역명이면 떼지 않는다 — 그건 광역 참조다.
 *
 * 여기서는 `districtAliases`를 보지 않는다. 떼려는 건 광역 표기이지 그 밑의
 * 시·군·구 이름이 아니다.
 *
 * 이 한 줄이 이 함수의 유일한 동작 변화다. 예전에는 시·군·구 이름도 `aliases`에
 * 섞여 있어 접두어로 떨어졌고, 그래서 "안산시 성남시" 꼴이면 앞의 안산시를 떼고
 * 뒤의 성남시로 착지했다. 이제는 경기도로 착지한다. 실사용 질의로는 나올 일이
 * 없다 — 한국어 주소는 큰 단위부터 적으니 미등록 시·군 이름이 등록된 시 앞에
 * 오지 않는다. 게다가 이 경로는 광역 안에 등록된 하위 지역을 찾는 것이라,
 * 서울 밖에서 그런 하위 지역을 가진 광역은 경기도뿐이다.
 *
 * 뒤쪽 논거는 지금 데이터에서만 참이다. 두 번째 도에 상세 데이터를 가진 시·군·구가
 * 등록되는 순간 "닿을 일이 없다"가 깨지므로, 그때는 이 동작을 다시 봐야 한다.
 */
function splitLeadingMetro(
  policies: RegionalPolicyData[],
  normalizedQuery: string,
): { metro: RegionalPolicyData; rest: string } | undefined {
  let best: { metro: RegionalPolicyData; rest: string } | undefined;

  for (const policy of policies) {
    if (regionMatchLevel(policy) !== "metro") continue;

    for (const name of [policy.name, ...policy.aliases]) {
      const normalizedName = normalizeText(name);
      if (!normalizedName || normalizedQuery === normalizedName) continue;
      if (!normalizedQuery.startsWith(normalizedName)) continue;

      const rest = normalizedQuery.slice(normalizedName.length);
      if (!rest) continue;
      if (!best || rest.length < best.rest.length) best = { metro: policy, rest };
    }
  }

  return best;
}

export function resolveRegionalPolicyIn(policies: RegionalPolicyData[], region?: string): RegionResolution {
  if (!region) return { status: "not_found" };

  const normalizedQuery = normalizeText(region);
  if (!normalizedQuery) return { status: "not_found" };

  let ambiguous: MatchedRegionPolicy[] | undefined;

  const consider = (candidates: MatchedRegionPolicy[]): MatchedRegionPolicy | undefined => {
    if (candidates.length === 1) return candidates[0];
    // 되묻기는 더 앞선 단계가 전부 비었을 때만 쓴다. 약한 단계에서 후보가
    // 여럿이어도, 아직 안 본 단계에서 유일 확정이 나오면 그쪽이 이긴다.
    if (candidates.length > 1 && !ambiguous) ambiguous = candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES);
    return undefined;
  };

  for (const [level, strength] of REGION_DISTRICT_ORDER) {
    const match = consider(regionCandidatesAt(policies, normalizedQuery, level, strength));
    if (match) return { status: "match", match };
  }

  // 광역으로 내려앉기 전에, 앞의 광역명을 떼고 그 광역 소속 자치구만 다시 본다.
  // 광역 표기가 별칭과 다른 형태로 붙으면("경기 성남시" vs 별칭 "경기도 성남시")
  // 양방향 접두 어느 쪽도 맞지 않아 자치구를 통째로 놓치고, 배출 요일까지 있는
  // full 티어 데이터가 광역 안내로 덮인다. 서울은 자치구마다 "서울 X구"·"서울시 X구"
  // 별칭을 전부 달아둬서 가려져 있을 뿐이라, 지역이 늘 때마다 같은 구멍이 난다.
  const split = splitLeadingMetro(policies, normalizedQuery);
  if (split) {
    const withinMetro = policies.filter((policy) => policy.metroId === split.metro.id);
    for (const [level, strength] of REGION_DISTRICT_ORDER) {
      if (level !== "district") continue;
      const match = consider(regionCandidatesAt(withinMetro, split.rest, level, strength));
      if (match) return { status: "match", match };
    }
  }

  for (const [level, strength] of REGION_METRO_FALLBACK_ORDER) {
    const match = consider(regionCandidatesAt(policies, normalizedQuery, level, strength));
    if (match) return { status: "match", match };
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

/**
 * 광역으로 착지했지만 질의가 특정 시·군·구를 지목했다면 그 이름.
 *
 * 전국 기초자치단체는 226곳인데 상세 데이터는 32곳뿐이라 대부분은 광역으로
 * 내려앉는다. 착지 자체는 의도한 설계지만, `matchedBy`만 봐서는 "청주시"라고
 * 말한 사람과 "충북"이라고 말한 사람을 가르지 못한다. 앞사람에게까지 "거주
 * 중인 시·군·구를 알려주세요"라고 되물으면 방금 들은 것을 다시 묻는 셈이다.
 *
 * `matchedBy`를 그대로 쓰지 않는 이유는 "부산 해운대구"다 — 이건 광역 접두
 * 강도로 걸려 `matchedBy`가 "부산"이 된다. 그래서 질의에서 광역 표기를 뗀
 * 나머지도 함께 본다.
 *
 * 뗀 나머지에서만 `prefixOnlyDistrictAliases`까지 본다. "부산 중구"는 앞의
 * "부산"이 이미 광역을 확정했으므로 남은 "중구"를 지목하는 데 위험이 없지만,
 * 맨 "중구"는 어느 광역인지 모른 채 답하는 것이라 되물어야 한다.
 */
export function findNamedSubRegion(metro: RegionalPolicyData, region?: string): string | undefined {
  const districtAliases = metro.districtAliases ?? [];
  const prefixOnlyAliases = metro.prefixOnlyDistrictAliases ?? [];
  if ((districtAliases.length === 0 && prefixOnlyAliases.length === 0) || !region) return undefined;

  const normalizedQuery = normalizeText(region);
  if (!normalizedQuery) return undefined;

  const ownNames = new Set([metro.name, ...metro.aliases].map((name) => normalizeText(name)).filter(Boolean));

  // 이 광역의 표기를 실제로 떼어낸 조각들. "떼어낸 게 있다" 자체가 뒤에서 근거로
  // 쓰이므로 질의 전체와 갈라 둔다.
  const strippedTargets: string[] = [];
  for (const name of ownNames) {
    if (normalizedQuery === name || !normalizedQuery.startsWith(name)) continue;
    const rest = normalizedQuery.slice(name.length);
    if (rest) strippedTargets.push(rest);
  }

  // 강도 기준은 지역 매칭과 같다. 앞부분으로만 겹치게 두어야 "부산 사상구"의
  // 뒷조각이 엉뚱한 이름에 걸리지 않는다. 목록에 있는 이름에만 걸리므로
  // "부산 어쩌구"의 "어쩌구"는 아무것도 지목하지 못한다.
  //
  // 광역 자신을 부르는 표기는 아예 후보에서 뺀다. 안 그러면 "제주"가 접두
  // 조각으로 "제주시"에 걸려, 도 전체를 물은 사람에게 시 하나를 지목했다고
  // 답한다. 광역명으로 말한 사람에게는 되묻는 쪽이 맞다.
  let best: { alias: string; strength: RegionMatchStrength } | undefined;
  const consider = (target: string, aliases: string[]): void => {
    if (ownNames.has(target)) return;
    for (const alias of aliases) {
      const strength = regionMatchStrength(target, normalizeText(alias));
      if (!strength) continue;
      if (!best || strength > best.strength) best = { alias, strength };
    }
  };

  for (const target of [normalizedQuery, ...strippedTargets]) consider(target, districtAliases);

  // 이름만으로 광역이 안 정해지는 쪽은 **떼어낸 조각에만** 건다. 광역 표기가
  // 앞에 붙어 있었다는 게 곧 광역이 확정됐다는 뜻이라, 남은 "중구"를 지목하는 데
  // 위험이 없다. 맨 "중구"는 여기 닿지 않아 예전처럼 되묻는다.
  for (const target of strippedTargets) consider(target, prefixOnlyAliases);

  return best?.alias;
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

  return "기본 분리배출 판단은 전국 기준으로 안내 가능하며, 거주지 배출 기준만 따로 확인하면 됩니다.";
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
 * 배출 요일을 실제로 안내하는 지자체 페이지. 요일 자체는 값으로 싣지 않지만,
 * "확인할 정보"에서 사용자에게 사는 동을 되묻는 대신 이 링크로 안내를 닫으려면
 * 어느 페이지가 요일을 다루는지는 알아야 한다.
 *
 * 1차 판정은 `basis`로 한다. 출처 설명은 그 페이지에 무엇이 있는지 적는 자리라
 * 요일을 다루는 페이지가 대체로 이 어휘를 갖는다. 다만 어휘만으로는 대형폐기물
 * 신청 페이지가 걸린다 — 용인시는 이 정규식에 걸리는 출처가 `대형폐기물 배출신청안내`
 * 하나뿐이라, 요일 질문에 신청 페이지를 확인처로 주고 있었다. 강남구는 두 번째
 * 매칭이 대형폐기물 포털이라 배열 순서가 바뀌면 확인처가 조용히 그리로 옮겨간다.
 * 그래서 그 지역의 `bulkyWaste` 신청·수수료 URL과 같은 주소는 후보에서 뺀다.
 *
 * 2026-08-19 기준 49곳 중 7곳(강남·서초·송파·마포·성남·부산·제주)만 잡히고,
 * 나머지는 undefined가 나와 호출부가 전국 지역별 안내로 닫는다. 용인은 요일을
 * 다루는 페이지가 실제로 없어서 그 폴백이 맞는 답이다.
 *
 * 대형폐기물 배제의 한계는 알고 넘어간다. 거르는 건 그 지역의
 * `bulkyWaste.applicationUrl`·`feeUrl`과 **주소가 정확히 같은** 출처뿐이라,
 * (1) 그 둘 밖의 대형폐기물 페이지(별도 안내문, 같은 포털의 다른 경로, 쿼리스트링만
 * 다른 주소)는 그대로 통과하고, (2) `bulkyWaste`가 없는 광역(부산·제주·경기도 등)에는
 * 아무 효과가 없다. 지금 데이터로는 새는 곳이 없어서 URL 비교 이상으로 복잡하게 만들지
 * 않았다 — 지역이 늘어 다시 신청 페이지가 확인처로 잡히면 그때 판정 기준을 손본다.
 * 회귀는 `scripts/smoke-mcp.mjs`가 49곳 전부에 대해 잡는다.
 */
const COLLECTION_DAY_BASIS = /요일|수거일|배출시간|수거시간/;

export function findRegionCollectionDaySource(region: RegionalPolicyData): RegionCollectionSource | undefined {
  const bulkyUrls = new Set(
    [region.bulkyWaste?.applicationUrl, region.bulkyWaste?.feeUrl].filter((url): url is string => !!url),
  );

  return region.sources.find(
    (source) =>
      source.sourceType === "local_guidance" &&
      !!source.url &&
      !bulkyUrls.has(source.url) &&
      COLLECTION_DAY_BASIS.test(source.basis ?? ""),
  );
}

/**
 * 지역을 골라 들어가는 전국 안내. 미등록 지역 폴백이면서, 지자체 요일 페이지가 없는
 * 곳에서 요일 질문을 닫는 링크이기도 하다. 두 자리가 같은 주소를 각자 적고 있으면
 * 한쪽만 고쳐지므로 상수 하나로 묶는다.
 */
export const REGION_SELECT_GUIDE_LINK = {
  title: "생활폐기물 분리배출 누리집 지역별 안내",
  url: "https://www.분리배출.kr/front/region/region.do",
  basis: "거주 지역을 선택하면 그 지자체의 분리배출 기준을 볼 수 있습니다.",
};

/** 요일을 말하는 줄인지. */
export function mentionsCollectionDay(text: string): boolean {
  return text.includes("요일");
}

/**
 * 요일을 못 준다고 말하는 자리에 이어 붙일 확인처 한 조각. 지자체 요일 페이지가 있으면
 * 그걸, 없으면 전국 지역별 안내를 준다 — 어느 쪽이든 URL이 하나는 들어간다.
 */
export function collectionDaySourceHint(regionMatch?: MatchedRegionPolicy): string {
  const daySource = regionMatch ? findRegionCollectionDaySource(regionMatch.region) : undefined;

  if (daySource?.url) {
    const checkedAt = daySource.checkedAt ? `, 확인일 ${daySource.checkedAt}` : "";
    return `${daySource.title}에서 확인하세요 (${daySource.url}${checkedAt})`;
  }

  return `${REGION_SELECT_GUIDE_LINK.title}에서 거주 지역을 선택해 확인하세요 (${REGION_SELECT_GUIDE_LINK.url})`;
}

/**
 * 이 줄이 **우리가 붙인** 확인처를 이미 갖고 있는지.
 *
 * 예전에는 `text.includes("http")`로 봤다. 그러면 요일을 말하면서 요일과 무관한 주소를
 * 달고 있는 체크 항목 하나로 판정이 뒤집힌다 — 확인처를 잇지도, 닫는 줄을 더하지도 않고
 * 조용히 통과한다. 지금 데이터에는 그런 항목이 없지만 근거가 틀린 판정이라, 붙일 문구와
 * 같은지로 본다. 문구는 `collectionDaySourceHint`가 지역별로 한 번만 만드니 비교가 샐 일이 없다.
 */
export function hasCollectionDaySource(text: string, regionMatch?: MatchedRegionPolicy): boolean {
  return text.includes(collectionDaySourceHint(regionMatch));
}

/**
 * 요일을 말하는 첫 줄에 확인처를 이어 붙인다.
 *
 * 요일 줄이 없으면 아무것도 더하지 않는다. 폐형광등 수거함처럼 요일과 무관한 품목까지
 * 링크를 달면 안내가 길어지기만 한다. 붙이는 자리는 첫 줄 하나뿐이다 — 같은 주소를
 * 여러 줄에 반복해 봐야 읽는 쪽이 고를 게 늘지 않는다.
 */
export function withCollectionDaySource(checks: string[], regionMatch?: MatchedRegionPolicy): string[] {
  const dayIndex = checks.findIndex((check) => mentionsCollectionDay(check) && !hasCollectionDaySource(check, regionMatch));
  if (dayIndex < 0) return checks;

  const withSource = [...checks];
  withSource[dayIndex] = `${withSource[dayIndex]} — ${collectionDaySourceHint(regionMatch)}`;
  return withSource;
}

/**
 * 목록이 아니라 문장 하나를 닫는 자리. 안내문 중간에 박혀 있는 요일 한 줄이 여기 온다.
 *
 * 같은 불변식이 네 툴에 흩어져 있어서, 판정과 문구는 위 `withCollectionDaySource` 하나만
 * 쓴다. 호출부마다 "요일을 말하는지" 조건을 따로 쓰면 그게 어긋나는 순간 다시 새는데,
 * `get_region_disposal_info`만 닫혀 있고 나머지 셋이 새고 있던 게 정확히 그 모양이었다.
 */
export function withCollectionDaySourceLine(line: string, regionMatch?: MatchedRegionPolicy): string {
  return withCollectionDaySource([line], regionMatch)[0];
}

/**
 * 배출 요일·시간은 확정 값으로 싣지 않는다. 같은 구 안에서도 동과 주택 유형에 따라
 * 갈리는데 우리가 그 단위까지 확인할 수 없어서다. 문제는 그 다음이었다 — "직접 확인할
 * 항목"으로만 남기고 **어디서** 확인하는지를 안 적었더니, 호스트 모델이 그 빈자리를
 * 사용자에게 되묻는 걸로 메웠다("사는 동 이름을 알려주세요"). 그런데 동 이름을 받아도
 * 우리가 줄 게 없다. 2026-08-19 Preview 측정에서 그 되묻기 뒤 후속 턴이 통째로 웹
 * 검색으로 샜고, 세 번째 턴은 부동산 커뮤니티 입주민 후기로 답이 나갔다.
 *
 * 그래서 못 준다고 말하는 그 자리에서 링크로 닫는다. 이을 줄이 이미 있으면
 * `withCollectionDaySource`가 거기 잇고, 이을 줄 자체가 없으면 이 문장을 새로 세운다.
 * 어느 쪽이든 URL이 하나 들어가고, 그건 `scripts/smoke-mcp.mjs`가 지킨다 —
 * 타입 검사만으로는 안 잡히니 `pnpm check`가 아니라 `pnpm local:test`로 돌려야 한다.
 *
 * 문장을 여기 두는 건 지역 툴의 체크리스트와 품목 툴의 지역 블록이 같은 말을 하기
 * 때문이다. 두 곳이 따로 쓰면 한쪽만 고쳐진다.
 */
export function collectionDayCheckLine(regionMatch?: MatchedRegionPolicy): string {
  return `일반쓰레기·재활용품 배출 요일과 시간 — 동·주택 유형별로 갈려 이 안내에는 싣지 않습니다. ${collectionDaySourceHint(regionMatch)}`;
}

/**
 * 이 본문이 요일을 말해놓고 확인처는 안 주는지. 닫는 줄을 더할지 가르는 판정이다.
 *
 * **판정 범위는 호출부가 정한다.** 응답 전체를 넘기면 과녁을 넘는다 — 출처 basis와
 * 품목 주의사항에 "배출 요일과 장소는 지역별로 확인합니다" 같은 문장이 여럿이라,
 * 지역을 묻지도 않은 응답마다 링크가 한 줄씩 따라붙는다. 그래서 호출부는 사용자가
 * 실제로 읽는 본문(품목 단계·주의·지역 안내)까지만 넘긴다.
 */
export function needsCollectionDaySource(bodyText: string, regionMatch?: MatchedRegionPolicy): boolean {
  return mentionsCollectionDay(bodyText) && !hasCollectionDaySource(bodyText, regionMatch);
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

  // 구청에 자체 신청 화면이 없어 안내 페이지 한 곳이 신청 경로와 품목별
  // 수수료표를 함께 싣는 지역이 있다(부산 부산진구). 두 값을 그대로 찍으면
  // 똑같은 주소가 두 줄로 나가 사용자에게는 링크가 잘못 붙은 것처럼 보인다.
  // 값이 같을 때만 한 줄로 합친다 — 주소가 다른 지역은 지금처럼 갈라 둔다.
  const sharedContactUrl =
    bulkyWaste.applicationUrl && bulkyWaste.applicationUrl === bulkyWaste.feeUrl
      ? bulkyWaste.applicationUrl
      : undefined;

  return [
    bulkyWaste.phone ? `- 문의/신청 안내 전화: ${bulkyWaste.phone}` : undefined,
    sharedContactUrl ? `- 인터넷 신청·수수료 조회: ${sharedContactUrl}` : undefined,
    !sharedContactUrl && bulkyWaste.applicationUrl ? `- 인터넷 신청: ${bulkyWaste.applicationUrl}` : undefined,
    !sharedContactUrl && bulkyWaste.feeUrl ? `- 수수료 조회: ${bulkyWaste.feeUrl}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

export function findBulkyWasteFeeSchedule(region: RegionalPolicyData): BulkyWasteFeeSchedule | undefined {
  return bulkyWasteFeeSchedules.find((schedule) => schedule.regionId === region.id);
}

/**
 * 수수료를 보여도 되는 품목인지. 지자체 고시에는 대형폐기물 요금이 실려 있어도,
 * 우리 안내가 "무료로 재활용/전용수거함/종량제봉투"인 품목이면 그 금액은 답이 아니다.
 *
 * 고시명 매칭은 넓게 걸리므로(`상자`→택배상자, `신발`→신발) 이 판단을 데이터 쪽에만
 * 맡기면 "깨끗한 상태로 스티로폼류에 배출합니다" 바로 아래에 "수수료 1,000원"이 붙는다.
 * 배출 그룹 라벨에 대형폐기물이 들어가는지로 거른다 — disposalType 문자열을 부분
 * 일치로 보면 새 값이 조용히 새므로 `disposal-groups.json`의 명시 매핑을 그대로 쓴다.
 */
export function itemHasBulkyRoute(item: WasteItem): boolean {
  return disposalGroupLabel(item.disposalType).includes("대형폐기물");
}

export function findBulkyWasteFees(region: RegionalPolicyData, item: WasteItem): BulkyWasteFee[] {
  if (!itemHasBulkyRoute(item)) return [];
  return findBulkyWasteFeeSchedule(region)?.fees.filter((fee) => fee.itemId === item.id) ?? [];
}

/**
 * 상한에 걸려 잘린 품목이면 잘리기 전 행 수를 준다. 수수료가 나가는 자리가 셋이고
 * (수수료 줄 목록·카드 한 줄·지역 체크리스트) 셋이 같은 숫자를 말해야 해서 여기 모은다.
 *
 * 메타데이터가 없으면 `undefined`다. 행 수가 상한과 같다는 것만으로 잘렸다고 보면
 * 마침 규격이 12종인 품목까지 "더 있다"고 말하게 된다 — 임포터가 남긴 값만 믿는다.
 */
export function findBulkyWasteFeeRowTotal(region: RegionalPolicyData, item: WasteItem): number | undefined {
  const total = findBulkyWasteFeeSchedule(region)?.preCapFeeRowCountByItemId?.[item.id];
  if (total === undefined) return undefined;
  return total > findBulkyWasteFees(region, item).length ? total : undefined;
}

function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatBulkyWasteFeeLines(item: WasteItem, region: RegionalPolicyData): string[] {
  const schedule = findBulkyWasteFeeSchedule(region);
  if (!schedule) return [];

  const fees = findBulkyWasteFees(region, item);
  if (fees.length === 0) return [];

  // "전체 N개"라고 쓰면 안 된다. N은 임포터가 품목 확정·중복 제거·충돌 제거를 마치고
  // 남긴 행 수지 고시에 실린 규격 수가 아니다(제외 기준은 source.note에 적혀 있다).
  const rowTotal = findBulkyWasteFeeRowTotal(region, item);

  return [
    `- ${region.name} 대형생활폐기물 수수료 후보:`,
    ...(rowTotal
      ? [`  - 확인된 ${rowTotal}개 규격 중 대표 ${fees.length}개만 추렸습니다. 전체 표는 수수료 출처에서 확인하세요.`]
      : []),
    ...fees.map((fee) => `  - ${fee.itemName} ${fee.spec}: ${formatKrw(fee.feeKrw)}`),
    `- 신청 URL: ${schedule.applicationUrl}`,
    `- 수수료 출처: ${schedule.feeUrl}`,
  ];
}

/**
 * 광역으로 착지했을 때만 질의가 지목한 시·군·구를 되짚는다.
 *
 * 세 툴이 저마다 이 갈래를 적으면 한 곳만 빠뜨려도 같은 질의에 다른 답이 나간다.
 * 실제로 그런 적이 있어서(지역 툴만 고치고 품목 툴은 되묻던 시기) 한곳에 둔다.
 */
export function findNamedSubRegionForMatch(
  regionMatch: MatchedRegionPolicy | undefined,
  region?: string,
): string | undefined {
  return regionMatch?.level === "metro" ? findNamedSubRegion(regionMatch.region, region) : undefined;
}

/**
 * "청주시 상세 데이터는 아직 없어 충청북도 광역 기준으로 안내합니다."
 *
 * 시·군·구를 이미 댔는데 광역으로 착지한 응답은 어느 툴이 답하든 이 문장으로 연다.
 * 뒤에 무엇을 잇는지는 툴마다 다르다 — 지역 툴은 응답 아래 "공식 확인처"로 넘기고,
 * 품목 툴에는 그 목록이 없어 시·군·구 공식 안내로 넘긴다. 여는 문장까지 갈리면
 * 호스트가 어느 툴을 고르느냐에 따라 같은 질문에 다른 답이 나간다.
 */
export function formatUnregisteredDistrictScope(metroName: string, namedSubRegion: string): string {
  return `${namedSubRegion} 상세 데이터는 아직 없어 ${metroName} 광역 기준으로 안내합니다.`;
}

export type RegionItemGuideOptions = {
  /**
   * 질의가 지목한 시·군·구 이름. `findNamedSubRegionForMatch`가 돌려준 값을 그대로 넘긴다.
   * 넘어오면 "거주 중인 시·군·구를 확인해야" 되묻기를 그 이름을 부르는 줄로 갈아끼운다 —
   * 방금 들은 것을 다시 묻지 않으면서, 광역 기준으로 답한다는 사실은 그대로 밝힌다.
   */
  namedSubRegion?: string;
  /**
   * 호출부가 응답 위쪽에서 이미 그 이름을 부르고 범위를 밝혔으면 `true`.
   * `get_region_disposal_info`가 그렇다 — 한 응답에 같은 말을 두 번 쓰지 않으려고
   * 그때는 갈아끼우는 대신 지운다. 이건 문장 중복을 피하는 선택일 뿐이라,
   * 켜고 끄는 것으로 연락처가 사라지는 일은 아래에서 막는다.
   */
  subRegionScopeAlreadyShown?: boolean;
};

export function formatRegionItemGuide(
  item: WasteItem,
  regionMatch?: MatchedRegionPolicy,
  { namedSubRegion, subRegionScopeAlreadyShown }: RegionItemGuideOptions = {},
): string[] {
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
    //
    // "배출 3일 전"은 **`full` 티어 지자체에서 직접 확인한 기한**이다. 확인한 곳
    // 밖으로 이 숫자를 옮기면 안 된다.
    // - 광역: 지역명만 갈아끼우면 확인한 적 없는 기한을 광역 전체 기준으로 단정하게
    //   되고, 바로 아래 "접수는 시·군·구 소관" 안내와 한 블록 안에서 어긋난다.
    // - `standard` 티어: 이 티어는 신청 경로와 연락처까지만 확인하고 기한은 확인하지
    //   않는다. 실제로 지자체마다 다르다 — 서대문은 "배출 지정일로부터 5일 이내
    //   수거", 성동은 배출일을 신청자가 고르고, 중구는 접수를 상용 앱이 받아 3일
    //   규칙 자체가 없다. 서울 자치구가 21곳으로 늘면서 틀린 기한이 나가는 범위도
    //   같이 늘어, 기한을 빼고 신청 URL이 정확한 기한으로 가는 경로를 맡긴다.
    const hasConfirmedDeadline = region.coverageTier === "full";
    const isMetro = region.coverageTier === "metro";

    // 배출 전 부착물을 확인한 지역은 그 사실대로 쓴다. 확인 안 한 지역(값 없음)은
    // 아래 기존 문장을 그대로 쓴다 — 기본값을 바꾸면 조사하지 않은 30곳까지
    // 한꺼번에 다른 안내를 받게 된다.
    const prePosting = region.bulkyWaste?.prePosting;
    const noPrePosting = prePosting === "none";
    const bulkyLine = noPrePosting && !isMetro
      ? isBulkySecondaryRoute(item)
        ? `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 전에 미리 신청합니다. 접수증이나 접수번호를 붙이지 않고 수거업체가 현장에서 품목을 확인합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : `- ${region.name} 대형생활폐기물은 배출 전에 미리 신청합니다. 접수증이나 접수번호를 붙이지 않고 수거업체가 현장에서 품목을 확인합니다.`
      : hasConfirmedDeadline
      ? isBulkySecondaryRoute(item)
        ? `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : `- ${region.name} 대형생활폐기물은 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다.`
      : isBulkySecondaryRoute(item)
        ? `- 대형폐기물에 해당할 때만 배출 전에 사전 신청하고 접수증 또는 접수번호를 부착합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : isMetro
          ? "- 대형생활폐기물은 배출 전에 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다. 신청 기한은 시·군·구마다 다릅니다."
          : `- ${region.name} 대형생활폐기물은 배출 전에 미리 신청하고 접수증 또는 접수번호를 부착해 배출합니다. 신청 기한은 아래 신청 경로에서 확인하세요.`;

    // 되묻기를 걷어내는 건 **metro 티어에서만**이다. 그 티어의 연락처 블록은
    // "거주 중인 시·군·구를 확인해야" 한 줄이 전부라 갈아끼워도 잃는 URL이 없지만,
    // district 티어에는 문의 전화·인터넷 신청·수수료 조회가 들어 있다.
    // `namedSubRegion`이 넘어오는 건 광역 착지 때뿐이라는 호출부 약속에 기대면,
    // 나중에 다른 툴로 넓히는 순간 그 셋이 소리 없이 사라진다 — 여기서 막는다.
    const contactLines =
      namedSubRegion && isMetro
        ? subRegionScopeAlreadyShown
          ? []
          : [
              `- ${formatUnregisteredDistrictScope(region.name, namedSubRegion)} 대형폐기물 신청 경로와 수수료는 ${namedSubRegion} 공식 안내에서 확인하세요.`,
            ]
        : formatRegionBulkyContactLines(region);
    return [bulkyLine, ...contactLines, ...bulkyWasteFeeLines];
  }

  if (item.disposalType.includes("special_collection")) {
    return [
      `- ${region.name}에서는 전용 수거함이나 지정 수거처 위치를 확인한 뒤 배출합니다.`,
      "- 폐형광등·폐건전지는 일반주택의 경우 주민센터 및 주택가 수거함, 아파트는 단지 내 수거함을 확인합니다.",
    ];
  }

  // 여기가 요일 불변식이 새던 마지막 구멍이다. 지역 요약은 자치구 32곳 모두 "배출
  // 요일과 시간은 동·주택 유형별로 갈려 이 데이터에는 넣지 않았습니다"로 끝나는데,
  // 대형폐기물도 수거함도 아닌 품목(뚝배기·와인잔·즉석밥 용기 등)은 이 갈래로 떨어져
  // 그 문장만 받고 끝났다 — 못 준다고 말해놓고 어디서 확인하는지는 안 적는, 되묻기를
  // 부른 그 모양이다. `formatItemGuide`의 checkItems 쪽만 닫아 둬서 못 잡았다.
  //
  // 닫는 자리를 응답 조립부가 아니라 문장을 만드는 여기로 잡은 건 이 줄이 세 경로로
  // 나가서다 — get_disposal_steps 텍스트, structuredContent의 regionNotes, 그리고
  // 위젯 카드. 응답을 후처리하면 카드의 JSON까지 건드려야 하는데, 여기서 닫으면 셋이
  // 한 번에 닫힌다.
  return [withCollectionDaySourceLine(`- ${region.summary}`, regionMatch)];
}

export function formatItemGuide(item: WasteItem, region?: string): string {
  const regionMatch = findRegionalPolicy(region);
  const hasSpecificRegionGuide = Boolean(regionMatch && findRegionItemGuide(regionMatch.region, item));
  const needsCriticalRegionCheck = itemNeedsCriticalRegionCheck(item);
  const needsAdvisoryRegionCheck = itemNeedsRegionCheck(item) && !needsCriticalRegionCheck;
  // "청주시 사는데 소파 어떻게 버려?"는 지역 툴보다 여기로 더 자주 온다. 지역 툴과
  // 같은 갈래를 타지 않으면 같은 입력이 호스트의 툴 선택에 따라 다르게 답한다.
  const namedSubRegion = findNamedSubRegionForMatch(regionMatch, region);
  const regionGuideLines =
    itemNeedsRegionCheck(item) && (hasSpecificRegionGuide || needsCriticalRegionCheck)
      ? formatRegionItemGuide(item, regionMatch, { namedSubRegion })
      : [];
  const hasRegionGuide = regionGuideLines.length > 0;
  // 아래 두 갈래 중 하나라도 열리면 지역 블록의 제목이 이미 찍힌다. 요일을 닫는 줄이
  // 그 블록에 얹힐지, 제목부터 세워야 할지를 여기서 한 번만 판단한다.
  const opensRegionSection = needsCriticalRegionCheck || (needsAdvisoryRegionCheck && Boolean(regionMatch));
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
    // 요일 확인 항목은 여기서도 확인처로 닫는다. `빗자루`·`다리미판`처럼 checkItems에
    // 요일이 든 품목이 이 갈래로 떨어지는데, 지역 툴과 달리 "확인 항목: 배출 장소·요일"
    // 한 줄로 끝나 **어디서** 확인하는지가 빠져 있었다. 못 준다고 말해놓고 확인처를 안
    // 적는 그 모양이 호스트 모델의 되묻기를 부른 원인이라, 두 툴이 같게 닫아야 한다.
    if (item.regionPolicy?.checkItems?.length)
      lines.push(...withCollectionDaySource(item.regionPolicy.checkItems, regionMatch).map((checkItem) => `- 확인 항목: ${checkItem}`));
  } else if (needsAdvisoryRegionCheck && regionMatch) {
    lines.push("", "### 지역 참고");
    lines.push(
      hasRegionGuide
        ? `- ${regionMatch.region.name} 기준으로 확인된 지역 안내를 함께 반영합니다.`
        : `- 기본 배출 판단은 위와 같고, ${regionMatch.region.name} 거주지 배출 기준이나 수거함·회수 가능 여부만 맞춰 확인하면 됩니다.`,
    );
    if (hasRegionGuide) lines.push(...regionGuideLines);
  }

  // 불변식의 마지막 구멍. 참고 등급 품목은 `checkItems`를 렌더하지도
  // `formatRegionItemGuide`를 타지도 않는데, 품목 단계에는 "플라스틱류 배출 요일과
  // 장소는 지역 기준을 확인합니다"가 그대로 나간다(빈 약통). 위 두 갈래는 자기가 만든
  // 문장만 닫아서 이걸 못 잡았다 — 못 준다고 말해놓고 어디서 확인하는지는 안 적는,
  // 되묻기를 부른 바로 그 모양이다.
  //
  // 판정은 여기까지 쌓인 본문으로만 한다. 아래 `근거`까지 넣으면 출처 basis의 요일에
  // 걸려 지역을 묻지도 않은 응답마다 링크가 따라붙는다.
  if (needsCollectionDaySource(lines.join("\n"), regionMatch)) {
    if (!opensRegionSection) lines.push("", "### 지역 참고");
    lines.push(`- ${collectionDayCheckLine(regionMatch)}`);
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

/**
 * 대형폐기물이 보조 배출로일 뿐인지 — 주 배출로는 종량제봉투·소형가전 수거함 등.
 *
 * 카드와 플랜이 함께 쓴다. 같은 판단을 서버에서 다시 짜면 한쪽만 조건을 붙이게 되고,
 * 실제로 그렇게 어긋난 적이 있다 — 카드는 "대형폐기물에 해당할 때만"을 달았는데 플랜은
 * 작은 플라스틱 화분에도 수수료를 조건 없이 찍었다.
 */
export function isBulkySecondaryRoute(item: WasteItem): boolean {
  const label = disposalGroupLabel(item.disposalType);
  return label.includes("대형폐기물") && !label.startsWith("대형폐기물");
}
