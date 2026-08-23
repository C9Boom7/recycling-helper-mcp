import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { particleStrippedForms, tokenizeQuery } from "./korean/query-tokenizer.js";

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
const partNounPath = fileURLToPath(new URL("./data/compound-part-nouns.json", import.meta.url));

export const wasteItems = JSON.parse(readFileSync(dataPath, "utf8")) as WasteItem[];
export const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8")) as RegionalPolicyData[];
export const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeePath, "utf8")) as BulkyWasteFeeSchedule[];
export const materialGuidelines = JSON.parse(readFileSync(materialGuidelinePath, "utf8")) as MaterialGuideline[];
// disposalType은 자유 문자열이라 라벨을 부분 문자열로 추론하면 새 값이 조용히
// 폴백으로 떨어진다("small_electronics_collection"이 어느 분기에도 안 걸리는 식).
// 매핑을 데이터로 두고 validate-data.mjs가 전수 대응을 강제한다.
export const disposalGroups = JSON.parse(readFileSync(disposalGroupPath, "utf8")) as Record<string, string>;

/**
 * 품목명 뒤에 붙으면 **다른 물건**이 되는 부품·부속 낱말. 값은 왜 다른 물건인지의 근거다.
 *
 * 목록을 데이터로 두는 이유는 예외가 느는 방향 때문이다. `가스레인지 후드`·`화장대 거울`·
 * `복사기 토너 카트리지`처럼 지금까지는 (품목 × 부품) 조합을 하나씩 손으로 막아 왔는데,
 * 부품어 한 줄은 품목 수와 무관하게 한 번만 늘어난다 — `커버` 하나가 소파·이불·베개·
 * 변기·옷걸이를 한꺼번에 덮는다.
 *
 * 1글자 부품어(`살`·`심`·`줄`·`선`·`캡`)는 일부러 없다. 용언 활용형과 겹쳐서 `소파 살
 * 거예요`·`이불 줄 거예요` 같은 멀쩡한 발화를 깨뜨린다. `우산살`처럼 붙여 쓰는 것들은
 * 이미 별칭으로 등록돼 있어 이 목록이 없어도 답이 나온다. `실외기`도 없다 — 에어컨
 * 실외기는 에어컨과 같이 대형폐기물로 나가는 게 맞아 air_conditioner 별칭으로 뒀다.
 *
 * **넣고 빼는 기준은 "본체 카드가 그 부품의 배출 경로를 이미 짚는가"다.** 짚고 있으면
 * 게이트는 이득 없이 맞던 답만 지운다. `뚜껑`이 그래서 빠졌다 — 전수로 보니 본체 카드
 * 본문(요약·절차·주의)이 뚜껑을 언급하는 34개 품목이 전부 "뚜껑을 닫아 배출", "뚜껑은
 * 분리해 플라스틱 수거함"처럼 처리까지 적고 있었고, `페트병 뚜껑`·`우유팩 뚜껑`·`볼펜
 * 뚜껑`이 맞던 답을 잃었다. `냄비 유리뚜껑`·`변기커버`처럼 진짜로 다른 물건인 것들은
 * 이미 별칭이라 빼도 답이 남는다.
 *
 * 남은 30개도 같은 방식으로 훑었다. 본문에 부품어가 나오는 조합은 대부분 "손잡이가
 * 플라스틱이어도 본체는 고철"처럼 **본체의 복합재질을 설명하는 문장**이지 부품을 어디로
 * 보내라는 안내가 아니라서 게이트가 그대로 맞다. 애매한 여섯 개(`커버`·`필터`·`케이스`·
 * `패킹`·`스프링`·`트레이`)는 남긴 근거를 각 값에 적어 뒀다.
 */
export const compoundPartNouns = JSON.parse(readFileSync(partNounPath, "utf8")) as Record<string, string>;
const partNounList = Object.keys(compoundPartNouns).map((word) => normalizeText(word));

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

/**
 * 어절 경계와 정규화 문자열 위치를 함께 들고 있는다.
 *
 * 부품어 판정은 정규화 문자열만으로는 못 한다. `normalizeText`가 공백을 지워서
 * `소파 살까요`가 `소파살까요`가 되는데, 여기서 소파 뒤 꼬리를 문자열로 떼면 `살까요`가
 * 나오고 `살`에 걸린다. 어절이 어디서 끊겼는지를 알아야 `살까요`를 한 덩어리로 볼 수 있다.
 */
type QueryWordIndex = { words: string[]; offsets: number[] };

function buildQueryWordIndex(query: string): QueryWordIndex {
  const words = query
    .split(/[^\p{L}\p{N}]+/gu)
    .map((word) => normalizeText(word))
    .filter(Boolean);
  const offsets: number[] = [];
  let running = 0;
  for (const word of words) {
    offsets.push(running);
    running += word.length;
  }

  return { words, offsets };
}

/**
 * 어절이 부품어로 끝나면 그 부품어를 돌려준다. 조사가 붙어 있을 수 있으니 떼어 가며 본다.
 *
 * 시작이 아니라 **끝**을 보는 게 중요하다. `냄비 유리뚜껑`의 `유리뚜껑`을 `뚜껑`으로
 * 잡으려면 끝을 봐야 하고, 용언은 어미가 뒤에 붙으니 끝을 보는 쪽이 오히려 안전하다 —
 * `살까요`는 `살`로 시작하지만 `살`로 끝나지는 않는다.
 *
 * 참/거짓이 아니라 낱말을 돌려주는 이유는 오타 티어 때문이다. 거기서는 "부품어가 있다"로
 * 끝나지 않고 **어느** 부품어인지를 알아야 오타 히트가 그걸 설명하는지 볼 수 있다.
 */
function partNounTail(word: string): string | undefined {
  if (!word) return undefined;
  for (const form of particleStrippedForms(word)) {
    for (const part of partNounList) {
      if (form.length >= part.length && form.endsWith(part)) return part;
    }
  }

  return undefined;
}

function endsWithPartNoun(word: string): boolean {
  return partNounTail(word) !== undefined;
}

/**
 * 이름 뒤에 이것만 남았으면 어절이 끝난 것으로 치고 **다음 어절까지** 부품어를 찾는다.
 *
 * 남은 꼬리가 있다고 무조건 다음 어절을 넘겨다보면 안 된다. `이불이랑 커버 같이 버려도
 * 되나요?`의 `이랑`은 접속조사라 "이불과 커버"이고, 이불도 물어본 물건이라 답으로 남아야
 * 한다. 반대로 `모니터용 받침대`는 "모니터를 위한 받침대"라 물어본 물건은 받침대 하나다.
 * 가르는 지점은 뒤에 오는 말이 앞말을 **수식**하느냐 앞말과 **나열**되느냐다.
 *
 * 그래서 뒷말이 머리임을 못 박는 두 낱말만 넣는다. `용`은 용도를 나타내는 접미사
 * (`모니터용`), `의`는 관형격 조사(`믹서기의`)로 둘 다 앞말을 뒷말의 수식어로 내린다.
 * 조사·어미는 여기 있으면 안 된다 — `이랑`·`은`·`는`은 앞말을 주제나 나열 대상으로
 * 세우므로 앞말이 여전히 물어본 물건이다.
 *
 * 한 글자 차이로 게이트가 통째로 풀리던 자리다. `모니터용 받침대`·`냉장고용 커버`·
 * `믹서기의 칼날`이 전부 앞 품목 96점 확정으로 새고 있었다.
 */
const MODIFIER_TAIL_SUFFIXES = new Set(["용", "의"]);

/**
 * `end` 자리 **바로 뒤**가 부품어인가. 어절 안이면 남은 꼬리를, 어절 끝이면 다음 어절을 본다.
 *
 * 한국어는 뒷말이 물건의 정체를 쥔다. `모니터 받침대`의 머리는 받침대지 모니터가 아니라서,
 * 모니터로 답하면 대형가전 무상방문수거를 안내하게 된다 — 실제로는 나무·플라스틱이다.
 * 이름이 질의를 품는 방향은 이미 `scoreItemNames`가 머리 자리를 보고 가르는데
 * (`generic_fragment` / `modifier_fragment`), 질의가 이름을 품는 방향에는 그 판정이
 * 없었다. `가스레인지 후드`·`화장대 거울`·`복사기 토너 카트리지`를 하나씩 손으로 막아 온
 * 게 전부 여기서 빠진 절반이다.
 *
 * 자리 하나만 보는 함수다. 자리를 어떻게 고르고 몇 자리를 봐야 하는지는
 * `partCompoundGateOf`가 정한다.
 */
function isFollowedByPartNoun(index: QueryWordIndex, end: number): boolean {
  const wordIndex = index.offsets.findIndex((offset, i) => end > offset && end <= offset + index.words[i].length);
  if (wordIndex === -1) return false;

  const rest = index.words[wordIndex].slice(end - index.offsets[wordIndex]);
  if (rest && !MODIFIER_TAIL_SUFFIXES.has(rest)) {
    return endsWithPartNoun(rest);
  }

  return endsWithPartNoun(index.words[wordIndex + 1] ?? "");
}

/**
 * 이름이 `at`에서 시작할 때, **같은 품목의 이름으로 계속 설명되는 데까지** 끝을 늘린다.
 *
 * 두 가지를 이어 붙인다.
 *  - 같은 자리에서 시작하는 더 긴 이름: `치약 튜브 커버`의 `치약`@0은 별칭 `치약 튜브`가
 *    같은 자리를 더 길게 덮으므로 끝이 4로 간다.
 *  - 바로 다음 어절이 같은 품목의 또 다른 이름으로 시작하는 경우: `에어컨 실외기 커버`의
 *    `에어컨`@0은 다음 어절 `실외기`가 같은 품목의 별칭이라 끝이 6까지 간다.
 *
 * 두 번째가 없으면 짧은 별칭이 게이트를 그냥 빠져나간다. `에어컨`은 뒤가 `실외기`라
 * 부품어를 안 물고, 그 자리를 깨끗하다고 보면 `에어컨 실외기 커버`가 96점 확정으로 나간다.
 *
 * 어절 경계는 따지지 않는다. 이어 붙이는 조건이 "같은 품목의 다른 이름이 그 자리에서
 * **정확히** 시작한다"라 조사나 어미로 볼 수 없는 강한 신호라서다. 한때 어절 첫머리에서만
 * 잇도록 막아 뒀는데, 그러면 붙여 쓴 복합어가 자기 머리 낱말에 걸린다 — `전선케이블`은
 * `전선`에서 멈춰 뒤의 `케이블`을 남의 부품으로 읽고, 같은 품목의 이름인데도 not_found로
 * 떨어졌다. `마우스충전기`·`소쿠리채반`도 같은 자리였다. 띄어쓰기로 답이 갈리면 안 된다.
 */
function extendNameOccurrence(normalizedQuery: string, names: IndexedName[], at: number): number {
  let end = at;
  for (;;) {
    let longest = 0;
    for (const { normalized } of names) {
      if (normalized.length > longest && normalizedQuery.startsWith(normalized, end)) {
        longest = normalized.length;
      }
    }
    if (longest === 0) return end;
    end += longest;
  }
}

/** 질의 정규화 문자열에서 한 품목의 이름이 덮은 구간. 끝은 열린 구간이다. */
type NameSpan = { start: number; end: number };

/** 한 품목이 덮은 자리 전부와, 그 자리가 모두 부품어를 물었는지. */
type PartCompoundGate = { gated: boolean; spans: NameSpan[] };

/**
 * 이 품목이 질의의 어디를 덮었고, 그 자리가 **전부** 부품어를 물고 있는가.
 *
 * 한 자리라도 깨끗하면(= 늘린 끝 뒤가 부품어가 아니면) 발동하지 않는다. `소파 커버 말고
 * 소파는 어떻게`처럼 멀쩡하게 이름을 부른 자리가 섞여 있으면 지금 답을 그대로 둔다는 뜻이다.
 *
 * 예전에는 `Math.max`로 오른쪽 끝 자리 하나만 봤다. 그건 `에어컨 실외기 커버`에서 짧은
 * 별칭이 새는 걸 막으려던 것인데, 애먼 발화까지 같이 지웠다 — `냉장고 버리는데 냉장고
 * 야채칸은 어떻게 하나요`는 앞의 `냉장고`가 깨끗한데도 뒤의 `냉장고 야채칸` 자리 때문에
 * not_found로 떨어졌다. 짧은 별칭 누수는 `extendNameOccurrence`가 자리를 늘려서 막고,
 * 깨끗한 자리 판정은 전(全)자리로 되돌린다.
 *
 * 등장 자리는 어절 첫머리로 제한한다. 그러지 않으면 부품어 **안에** 우연히 박힌 이름이
 * 깨끗한 자리로 잡힌다 — `침대 프레임 받침대`의 `받침대`에는 `침대`가 들어 있어서,
 * 그 자리를 인정하면 뒤에 아무것도 없다는 이유로 게이트가 풀렸다.
 *
 * 걸렸는지만이 아니라 구간까지 돌려주는 이유는 `findWasteItems`가 품목 사이를 봐야 해서다
 * (`isSwallowedByGatedSpan`).
 */
function partCompoundGateOf(normalizedQuery: string, index: QueryWordIndex, names: IndexedName[]): PartCompoundGate {
  const wordStarts = new Set(index.offsets);
  const starts = new Set<number>();

  for (const { normalized } of names) {
    if (!normalized) continue;
    for (let at = normalizedQuery.indexOf(normalized); at !== -1; at = normalizedQuery.indexOf(normalized, at + 1)) {
      if (wordStarts.has(at)) starts.add(at);
    }
  }

  if (starts.size === 0) return { gated: false, spans: [] };

  const spans = [...starts].map((at) => ({ start: at, end: extendNameOccurrence(normalizedQuery, names, at) }));
  return { gated: spans.every((span) => isFollowedByPartNoun(index, span.end)), spans };
}

/**
 * 게이트에 걸린 다른 품목의 구간이 이 품목의 자리를 **통째로** 삼켰는가.
 *
 * 품목 하나만 보는 판정으로는 못 잡는 갈래가 있다. `알약 포장재 커버`는 알약 포장재가
 * 게이트에 걸리는데, 그 구간 안에 든 짧은 이름 `알약`이 폐의약품을 79점으로 확정해서
 * 결과가 not_found가 아니라 **틀린 카드**로 나갔다. `화분 흙 커버`가 화분을,
 * `기름 묻은 피자박스 커버`가 폐식용유를 내보내던 것도 같은 자리다.
 *
 * 삼켜졌다는 건 질의에서 그 이름을 부른 자리가 전부 더 긴 이름의 일부였다는 뜻이라,
 * 사용자가 그 물건을 부른 적이 없다. 반대로 구간 밖에 자리가 하나라도 있으면
 * (`믹서기 칼날`의 `칼날`, `노트북 충전기`의 `충전기`) 그건 따로 부른 것이라 그대로 둔다.
 *
 * 어절 첫머리 자리가 없는 품목은 판정을 건너뛴다. `아이스크림 통`의 `크림통`처럼 어절
 * 중간에 우연히 박힌 것은 구간으로 견줄 자리가 없어서, 여기서 다룰 문제가 아니다.
 */
function isSwallowedByGatedSpan(gate: PartCompoundGate, gatedSpans: NameSpan[]): boolean {
  if (gate.gated || gate.spans.length === 0) return false;

  return gate.spans.every((span) =>
    gatedSpans.some((gated) => gated.start <= span.start && span.end <= gated.end && gated.end - gated.start > span.end - span.start),
  );
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
  /** 어절 경계. 부품어 꼬리 판정이 쓴다. */
  wordIndex: QueryWordIndex;
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
type MatchKind =
  | "none"
  | "exact"
  | "query_contains_name"
  | "short_alias_standalone"
  | "generic_fragment"
  | "modifier_fragment"
  | "part_compound_fragment"
  | "fuzzy_jamo"
  | "target_mention";

/**
 * 답이 될 수 없는 두 갈래. 점수는 같지만 처리가 갈려서 종류를 나눠 둔다.
 *
 * `modifier_fragment`는 "질의가 덜 특정됐다"는 신호라 후보 목록에 남고, 이것만 걸렸을
 * 때는 이름을 못 찾은 것이므로 `findWasteItems`가 오타 폴백으로 내려간다.
 * `part_compound_fragment`는 반대로 이름을 찾았는데 그 물건이 아닌 것이라, 오타 폴백을
 * 막고 결과에서 통째로 걷어낸다.
 */
function isFragmentKind(kind: MatchKind): boolean {
  return kind === "modifier_fragment" || kind === "part_compound_fragment";
}

function scoreItemNames(query: ScoredQuery, indexed: IndexedItem, partCompoundGated: boolean): WasteMatch {
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
      } else if (partCompoundGated) {
        // 이름 뒤에 부품어가 붙었으면 물어본 물건은 이 품목이 아니다. 짧은 별칭 경로도
        // 같이 막아야 한다 — `소파 커버`가 79점(short_alias_standalone)으로 소파를
        // 확정하던 것이 이 갈래다.
        score = MODIFIER_FRAGMENT_SCORE;
        kind = "part_compound_fragment";
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
    !isFragmentKind(matchKind) && bestScore > 0 && bestScore < HIGH_CONFIDENCE_SCORE
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

/**
 * 오타 히트가 질의 안의 부품어를 설명하는가.
 *
 * 이름 게이트(`partCompoundGateOf`)는 이름이 질의에 **정확히** 들어 있을 때만
 * 걸린다. 오타 티어는 그 판정을 안 거치니까 머리 글자 하나만 틀리면 게이트가 통째로
 * 없어졌다 — `냉장고 야채칸`은 not_found인데 `냉장구 야채칸`은 냉장고 확정으로 나가서
 * 대형가전 무상방문수거 카드를 안내했다. 제대로 쓴 쪽이 더 안전한 답을 받는 건 뒤집힌 거다.
 *
 * 여기서는 이름이 없으니 자리를 못 짚는다. 대신 질의에 부품어로 끝나는 어절이 있는지 보고,
 * 있으면 오타로 짚은 이름이 그 부품어로 끝나야 통과시킨다. `정수기 필터`처럼 부품어가
 * 이름의 머리인 품목은 그대로 살고(`정수끼 필터` -> 정수기 필터), 부품을 설명하지 못하는
 * 본체 추측은 걸린다. 부품어 어절이 아예 없으면 판정할 게 없으므로 `형광능` -> 형광등
 * 같은 기존 오타 매칭은 손대지 않는다.
 */
function typoExplainsPartNouns(index: QueryWordIndex, match: WasteMatch): boolean {
  const parts = index.words.map((word) => partNounTail(word)).filter((part): part is string => part !== undefined);
  if (parts.length === 0) return true;

  const normalizedName = normalizeText(match.matchedBy);
  return parts.some((part) => normalizedName.endsWith(part));
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
    wordIndex: buildQueryWordIndex(query),
  };
  // 게이트 판정을 품목별 점수 매기기보다 먼저 돌린다. 걸린 품목의 구간을 다 모아야
  // 그 구간에 삼켜진 다른 품목을 가려낼 수 있는데(`isSwallowedByGatedSpan`), 그건
  // 품목 하나만 보는 `scoreItemNames` 안에서는 알 수 없는 정보다.
  const gates = indexedItems.map((indexed) => partCompoundGateOf(normalizedQuery, scoredQuery.wordIndex, indexed.names));
  const gatedSpans = gates.filter((gate) => gate.gated).flatMap((gate) => gate.spans);
  const named = rankMatches(
    indexedItems
      .map((indexed, at) => ({ match: scoreItemNames(scoredQuery, indexed, gates[at].gated), gate: gates[at] }))
      .filter(({ gate }) => !isSwallowedByGatedSpan(gate, gatedSpans))
      .map(({ match }) => match),
  );
  // Modifier hits alone do not count as a name hit: "에어컨" reaching only
  // "에어컨 리모컨" has still failed to name anything, so the typo tier below
  // must run exactly as it did before those hits were kept.
  //
  // 부품 복합어 히트는 반대다. `모니터 받침대`는 이름을 못 찾은 게 아니라 찾았는데 그
  // 물건이 아닌 것이라, 오타 티어로 내려보내면 자모가 비슷한 엉뚱한 품목을 짚는다.
  // 실제로 그렇게 샜다 — 게이트를 넣고 첫 측정에서 fuzzy_jamo 확정이 47건 나왔다.
  if (named.some((match) => match.matchKind !== "modifier_fragment")) {
    // 게이트에 걸린 히트를 걷어내는 자리는 여기 한 곳뿐이다. 부르는 쪽마다 거르게 뒀더니
    // 곧바로 빠뜨린 곳이 나왔다 — `소파 커버`에 `resolveWasteItem`은 not_found인데
    // `findBestWasteItem`은 소파(36점)를 내놨고, 그 위에서 지역 매칭 테스트가 돌고 있었다.
    //
    // 거르기는 오타 티어 판정 **뒤**에 한다. 위 주석대로 게이트에 걸린 히트는 이름을 못
    // 찾은 게 아니라 찾았는데 그 물건이 아닌 것이라, 오타 티어로 내려보내면 자모가 비슷한
    // 엉뚱한 품목을 짚는다. 판정에는 넣고 결과에서만 뺀다.
    return named.filter((match) => match.matchKind !== "part_compound_fragment").slice(0, limit);
  }

  // Typo matching is a fallback tier, not a competing signal. Running it only
  // when no name or alias hit exists keeps near-miss guesses out of every
  // list-shaped output (e.g. check_confusing_item's top 3) at any score band,
  // and a well-spelled query never pays for the jamo Levenshtein scan.
  const fuzzyQuery = buildFuzzyQuery(scoredQuery);
  const typos = rankMatches(indexedItems.map((indexed) => scoreItemTypos(fuzzyQuery, indexed)));
  // 이름 게이트와 같은 판정을 오타 히트에도 건다. 되묻기 후보로도 안 남기는 이유는
  // 이름 쪽과 결과를 맞추려는 것이다 — `냉장고 야채칸`이 not_found인데 `냉장구 야채칸`만
  // "혹시 냉장고 찾으시나요?"로 나가면 오타가 오히려 더 많은 걸 얻는다.
  return typos.filter((match) => typoExplainsPartNouns(scoredQuery.wordIndex, match)).slice(0, limit);
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
  const named = matches.filter((match) => !isFragmentKind(match.matchKind));
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

function formatRegionSourceLine(source: WasteSource): string {
  const url = source.url ? ` (${source.url})` : "";
  const checkedAt = source.checkedAt ? `, 확인일: ${source.checkedAt}` : "";
  const basis = source.basis ? ` - ${source.basis}` : "";
  return `- ${source.title}${url}${checkedAt}${basis}`;
}

export function formatRegionSourceList(region: RegionalPolicyData): string[] {
  return region.sources.map(formatRegionSourceLine);
}

/**
 * 배출 그룹 라벨에 든 갈래 이름 → 그 갈래를 다루는 지역 출처를 고르는 어휘. 제목과 basis에서
 * 찾는다. 라벨은 `disposal-groups.json`의 명시 매핑이고 "일반쓰레기/대형폐기물"처럼 `/`로
 * 잇는데, "특수/유해폐기물"은 이름 자체에 `/`가 있어 조각으로 가르지 않고 부분 문자열로 본다.
 * 여기 없는 라벨("지역 확인 필요")은 고를 어휘 자체가 없는 경우라 거르지 않고 지역 출처를
 * 전부 낸다 — 아래 `formatRegionSourceListForItem` 주석을 보라.
 */
const REGION_SOURCE_TOPIC_PATTERNS: Array<[labelPart: string, pattern: RegExp]> = [
  // "대형가전"(소형폐가전 무상수거 안내의 basis)에 걸리지 않게 폐기물까지 본다.
  ["대형폐기물", /대형(생활)?폐기물/],
  ["공사장폐기물", /공사장|건축/],
  ["소형가전", /소형가전|소형 가전|전기전자|폐가전|가전/],
  ["무상방문수거", /방문수거|폐가전|가전/],
  // "수거함"만 보면 의류수거함·재활용품 분리수거함까지 걸린다. 품목 종류 낱말로 잡는다.
  ["유해폐기물", /유해|형광등|건전지|전지|의약품|식용유|수은|체온계/],
  ["전용수거함", /유해|형광등|건전지|전지|의약품|식용유|수은|체온계/],
  ["재사용수거", /의류|헌옷|옷/],
  ["불연성", /불연성|마대|특수규격|PP|타지 않는/],
  ["음식물쓰레기", /음식물/],
  ["재활용", /재활용|분리배출|분리수거/],
  // "쓰레기 배출"만 보면 음식물쓰레기 배출요일 페이지까지 걸린다. 그렇다고 제목 모양만
  // 좁게 잡으면 같은 성격의 페이지를 절반쯤 놓친다 — `노원구 생활폐기물 배출안내`,
  // `구로구 쓰레기배출요령`, `성남시 … 생활 쓰레기 분리배출 안내`가 다 빠져 있었다.
  // 그래서 어휘는 넓히고 음식물·대형만 lookbehind로 뺀다.
  //
  // `(?<!대형 ?)`의 공백이 필요한 건 `중구 대형 생활폐기물 배출`처럼 띄어 쓴 제목 때문이다.
  // 공백을 안 넣으면 그 제목이 일반쓰레기 출처로 넘어온다.
  //
  // 남는 구멍 하나는 알고 넘어간다. `송파구청 음식물쓰레기 배출요령/수수료`의 basis에
  // "일반 생활쓰레기 대상 음식물 예외 품목"이 적혀 있어 제목이 아니라 basis로 걸린다.
  // 실제로 일반쓰레기 기준을 설명하는 문장이라 낱말만으로는 가릴 수 없다.
  ["일반쓰레기", /일반쓰레기|생활 ?쓰레기|(?<!대형 ?)생활폐기물 (분리)?(배출|수거)|(?<!음식물)쓰레기 ?(분리)?배출 ?(안내|요령)/],
];

/**
 * 품목에 맞는 지역 출처만 고른다 — `get_disposal_steps` 텍스트의 `### {지역} 공식 출처`용.
 *
 * 지역 출처 전부를 싣던 때는 노원구 매트리스에 폐의약품·폐건전지·재활용품 출처가 따라붙고
 * 마포구 의자에 의류수거함·무인회수기 출처까지 1.3KB가 붙었다(PRD phase-10 R2-a). 품목의
 * 배출 그룹 라벨로 거른다. 라벨 조각마다 위 어휘로 제목·basis를 보고, 대형폐기물 갈래는
 * 지역 연락처 주소와 같은 출처도 함께 잡는다. 수수료를 실제로 실은 품목이면 그 표의 출처
 * (수수료 고시)도 더한다 — 표가 어디서 왔는지는 표를 보여준 응답에만 필요하다.
 *
 * **거른 결과가 비면 지역 출처를 전부 낸다**(변경 전 동작). 비는 경위는 둘이지만 —
 * 고를 어휘가 아예 없거나(`LED등`의 `region_specific`은 라벨이 "지역 확인 필요"라 위
 * 표에 걸리는 패턴이 하나도 없다), 어휘는 있는데 그 지역이 그 갈래를 다루는 페이지를
 * 아직 안 실었거나 — 둘 다 "무엇을 골라야 할지 모른다"로 끝나서 답이 같다.
 *
 * 한때 뒤쪽만 대표 1개(`sources[0]`)로 닫았다가 되돌렸다(PR #70 리뷰 3라운드).
 * `sources[0]`이 그 지역의 대표 출처라는 전제였는데, 데이터를 보면 대부분 지역에서
 * 그 자리는 대형폐기물 신청 페이지다 — 수거함 품목에 엉뚱한 출처 하나만 남는다.
 * 앞쪽도 같은 이유로 전부를 낸다: `LED등` + `서울 도봉구`를 1개로 줄이면 스마트클린
 * 도봉만 남고 `도봉구 폐형광등·폐건전지 배출안내`를 잃는다.
 *
 * basis 문장은 출처마다 그대로 둔다 — 링크만 남기면 "왜 이 출처인가"가 사라져 되묻기를 부른다.
 */
export function formatRegionSourceListForItem(region: RegionalPolicyData, item: WasteItem): string[] {
  const label = disposalGroupLabel(item.disposalType);
  const patterns = REGION_SOURCE_TOPIC_PATTERNS.filter(([labelPart]) => label.includes(labelPart)).map(([, pattern]) => pattern);
  const bulkyUrls = new Set(itemHasBulkyRoute(item) ? regionBulkyContactUrls(region) : []);

  const matched = region.sources.filter((source) => {
    if (source.url && bulkyUrls.has(source.url)) return true;
    const haystack = `${source.title} ${source.basis ?? ""}`;
    return patterns.some((pattern) => pattern.test(haystack));
  });

  const feeSource = findBulkyWasteFees(region, item).length > 0 ? findBulkyWasteFeeSchedule(region)?.source : undefined;
  // 중복 판정은 주소가 있을 때만. 양쪽 `url`이 다 비면 `undefined === undefined`가 참이 되어
  // 주소 없는 수수료 고시가 아무 출처 하나와 같은 것으로 묶여 조용히 빠진다.
  const alreadyListed = Boolean(feeSource?.url) && matched.some((source) => source.url === feeSource?.url);
  const sources = feeSource && !alreadyListed ? [...matched, feeSource] : matched;

  return (sources.length > 0 ? sources : region.sources).map(formatRegionSourceLine);
}

/**
 * 지역 안내가 이미 답한 확인 항목인지 — `get_disposal_steps` 텍스트의 `- 확인 항목:` 줄을
 * 거르는 판정(PRD phase-10 R2-b).
 *
 * `checkItems`는 지역을 모를 때 사용자가 직접 확인할 것을 적은 목록이라, 바로 위에서
 * 지역 안내가 수수료표와 신청 경로를 냈는데도 "품목별 수수료"·"신고필증 부착 방식"을
 * 다시 묻고 있었다. 항목이 말하는 주제를 전부 지역 안내 줄에서 찾을 수 있을 때만 뺀다 —
 * "대형폐기물 신고 방법과 수수료"처럼 주제가 둘이면 둘 다 답해야 빠진다. 요일이 든
 * 항목은 건드리지 않는다. `withCollectionDaySource`가 거기에 확인처를 붙이는 자리다.
 *
 * **주제를 못 알아본 반쪽은 항목을 지킨다.** 어휘가 하나만 걸려도 항목을 통째로 지우면
 * 복합 항목의 모델링 안 된 절반이 조용히 사라진다 — `빨래건조대`의 "배출 장소와 접수번호
 * 부착 방식"이 부착 주제만 잡혀 빠지면서 "배출 장소"까지 잃었다(PR #70 리뷰 2라운드).
 * 그래서 항목을 접속 조각으로 나눠 **모든 조각이 어떤 주제에든 걸릴 때만** 생략 후보로
 * 본다. "대형폐기물 신고 URL과 수수료"처럼 한 조각이라도 주제 밖이면 항목을 남긴다 —
 * 주제 목록이 넓어지면 자연히 다시 생략 대상이 된다.
 *
 * 주제 판정은 지역 안내 줄의 어휘로 한다. 어떤 갈래가 답했는지를 데이터 플래그로 세면
 * 품목별 지역 안내(`itemGuides`)처럼 문장이 자유로운 갈래에서 어긋난다 — 실제로 적힌
 * 줄이 그 말을 하는지가 "답했다"의 뜻에 가장 가깝다.
 *
 * - 수수료: 수수료표가 나갔거나 수수료 조회 주소가 적혔을 때.
 * - 신고·신청 경로: 인터넷 신청 주소가 적혔거나, 홈페이지·주민센터 신고를 안내했을 때.
 *   광역 착지("신청 경로와 수수료는 ○○시 공식 안내에서")는 경로를 준 게 아니라 남는다.
 * - 부착: 접수증·접수번호·신고필증 부착 여부를 말했을 때(안 붙인다는 안내도 답이다).
 *
 * 어휘가 맞아도 답이 아닌 자리가 둘 있어 `onlyWhen`으로 막는다(PR #70 리뷰 1라운드).
 * 1. **"신고 대상 여부"는 "신고 방법"과 다른 질문이다.** 신청 주소를 줬다고 "이 품목이
 *    대형폐기물이냐"에 답한 게 아니다. 대형폐기물이 보조 배출로인 품목(`도자기 그릇`)에
 *    지역 안내가 하는 말은 "대형폐기물에 **해당할 때만** 신청한다"라, 해당 여부는 여전히
 *    사용자 몫이다. 그래서 이 주제는 대형폐기물이 주 배출로인 품목에서만 답한 것으로 친다.
 * 2. **부착 문구가 늘 확인된 사실은 아니다.** `formatRegionItemGuide`의 `bulkyLine`은
 *    `bulkyWaste.prePosting`이 빈 지역에서도 "접수증 또는 접수번호를 부착"이라고 말하는데,
 *    그건 조사한 값이 아니라 기본 문장이다(그쪽 주석 참조). 그러니 기준은 "`prePosting`이
 *    채워졌는지"가 아니라 **렌더된 문장이 확인한 값을 담고 있는지**다. `bulkyLine`이 문장을
 *    갈아끼우는 건 `prePosting`이 `"none"`일 때뿐이라, `"receipt"`·`"sticker"`는 값이
 *    있어도 나가는 문장이 기본 문장 그대로다. 부평구(`"sticker"`) `매트리스`가 그 자리였다 —
 *    스티커를 사서 붙인다는 확인된 방식은 한 번도 안 나가는데 "신고필증 부착 방식" 항목만
 *    사라졌다(PR #70 리뷰 2라운드). 그래서 `prePosting === "none"`이거나 품목별 지역 안내가
 *    부착 방식을 직접 적은 지역에서만 답한 것으로 친다. 노원구 `매트리스`는 둘 다 아니라
 *    "신고필증 부착 방식"이 남는다. (`"sticker"` 문장을 실제로 내보내는 일은 별건이다.)
 * 3. **지역 요약 줄은 근거가 아니다**(PR #70 리뷰 3라운드). `formatRegionItemGuide`의
 *    마지막 갈래 — 대형폐기물도 수거함도 아닌 품목 — 은 `- {지역 요약}` 한 줄만 낸다.
 *    그 요약은 그 지역 전체를 훑는 문장이라 이 품목과 상관없이 "수수료 조회"·"주민센터"
 *    같은 낱말을 품는다. `스탠드 조명`(소형가전 수거함) + `서울 노원구`가 그 자리였다 —
 *    연락처 블록도 수수료표도 안 나가는데 노원 요약의 "대형폐기물 신청과 수수료 조회를
 *    스마트클린 노원에서", "동주민센터"에 걸려 "대형폐기물 신고 방법과 수수료"가 빠졌다.
 *    그래서 판정 전에 요약으로 시작하는 줄을 뺀다(요일 확인처가 뒤에 붙으므로 startsWith).
 */
type CheckItemTopic = {
  topic: RegExp;
  answeredBy: RegExp;
  /** 어휘가 맞아도 이 조건이 거짓이면 답하지 않은 것으로 둔다. */
  onlyWhen?: (item: WasteItem, regionMatch?: MatchedRegionPolicy) => boolean;
};

const CHECK_ITEM_TOPICS: CheckItemTopic[] = [
  { topic: /수수료/, answeredBy: /수수료 후보:|수수료 조회/ },
  { topic: /신고 (방법|절차)/, answeredBy: /인터넷 신청|홈페이지|주민센터/ },
  {
    // "신고 여부"만 보면 품목 안쪽 범위를 묻는 항목까지 걸린다 — `화장대`의 "거울 별도
    // 신고 여부"는 거울을 따로 접수하느냐는 질문이라 신청 주소로는 답이 안 된다.
    // 데이터의 대형폐기물 해당 여부 항목은 전부 "대형(생활)폐기물 신고 …" 꼴이라
    // 앞말까지 묶어 잡는다(PR #70 리뷰 2라운드).
    topic: /대형(생활)?폐기물 신고 (대상|여부|기준)/,
    answeredBy: /인터넷 신청|홈페이지|주민센터/,
    onlyWhen: (item) => itemHasBulkyRoute(item) && !isBulkySecondaryRoute(item),
  },
  {
    topic: /신고필증|부착/,
    answeredBy: /부착|붙이지 않/,
    onlyWhen: (item, regionMatch) =>
      regionMatch?.region.bulkyWaste?.prePosting === "none" || Boolean(regionMatch && findRegionItemGuide(regionMatch.region, item)),
  },
];

/**
 * 괄호 안이 앞말을 풀어 쓴 게 아니라 **한정 질문**임을 알리는 어휘. 이런 항목은
 * 아예 생략 후보로 보지 않는다(PR #70 리뷰 3라운드).
 *
 * 괄호를 떼고 보면 `킥보드`의 "품목별 수수료(일반·전동 구분)"가 "품목별 수수료"로
 * 줄어 수수료표만 나갔다고 빠진다 — 그런데 이 항목이 정작 묻는 건 일반 킥보드와
 * 전동 킥보드를 갈라 매기느냐다. 표가 그 답을 하지 않으니 항목을 남겨야 한다.
 *
 * 2026-08-24 데이터에서 괄호가 든 확인 항목은 22개인데, 여기 걸리는 건 `킥보드`
 * 하나뿐이다. 나머지는 "대형폐기물 신고 방법(앱·주민센터)"·"불연성 전용
 * 마대(봉투) 사용 여부와 판매처"처럼 앞말을 풀어 쓴 자리라 지금처럼 뗀다.
 */
const QUALIFYING_PARENTHETICAL = /구분|여부|기준|별도|제외/;

function hasQualifyingParenthetical(checkItem: string): boolean {
  return (checkItem.match(/\(([^)]*)\)/g) ?? []).some((group) => QUALIFYING_PARENTHETICAL.test(group));
}

/**
 * 확인 항목을 접속 조각으로 나눈다. 괄호 안은 앞말을 풀어 쓴 자리라 떼고 본다 —
 * "대형폐기물 신고 방법(앱·주민센터)"의 `·`까지 세면 조각이 셋으로 늘어난다.
 */
function splitCheckItemParts(checkItem: string): string[] {
  return checkItem
    .replace(/\([^)]*\)/g, " ")
    .split(/와 |과 |, | 및 |·/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isCheckItemAnsweredByRegionGuide(
  checkItem: string,
  regionGuideLines: readonly string[],
  item: WasteItem,
  regionMatch?: MatchedRegionPolicy,
): boolean {
  if (mentionsCollectionDay(checkItem)) return false;
  if (hasQualifyingParenthetical(checkItem)) return false;
  const topics = CHECK_ITEM_TOPICS.filter(({ topic }) => topic.test(checkItem));
  if (topics.length === 0) return false;
  // 조각 하나라도 주제 밖이면 그 반쪽은 아직 답이 없다는 뜻이라 항목을 남긴다.
  const parts = splitCheckItemParts(checkItem);
  if (!parts.every((part) => CHECK_ITEM_TOPICS.some(({ topic }) => topic.test(part)))) return false;
  // 지역 요약 줄은 근거로 세지 않는다. 위 주석의 세 번째 이유를 보라.
  const answeringLines = regionMatch
    ? regionGuideLines.filter((line) => !line.startsWith(`- ${regionMatch.region.summary}`))
    : regionGuideLines;
  return topics.every(
    ({ answeredBy, onlyWhen }) =>
      (!onlyWhen || onlyWhen(item, regionMatch)) && answeringLines.some((line) => answeredBy.test(line)),
  );
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

  return [
    ...(bulkyWaste.phone ? [`- 문의/신청 안내 전화: ${bulkyWaste.phone}`] : []),
    ...formatBulkyUrlLines(bulkyWaste.applicationUrl, bulkyWaste.feeUrl),
  ];
}

/**
 * 대형폐기물 신청·수수료 주소 줄. 지역 연락처 블록과 수수료 블록이 같은 모양으로
 * 찍어야 한 응답 안에서 "같은 줄이 이미 나갔는지"를 문자열 비교로 판단할 수 있다.
 *
 * 구청에 자체 신청 화면이 없어 안내 페이지 한 곳이 신청 경로와 품목별
 * 수수료표를 함께 싣는 지역이 있다(부산 부산진구). 두 값을 그대로 찍으면
 * 똑같은 주소가 두 줄로 나가 사용자에게는 링크가 잘못 붙은 것처럼 보인다.
 * 값이 같을 때만 한 줄로 합친다 — 주소가 다른 지역은 지금처럼 갈라 둔다.
 *
 * `shownUrls`에 든 주소는 호출부가 같은 응답 안에서 이미 찍었다는 뜻이라 뺀다
 * (PRD phase-10 R1-a). 값이 같을 때만 빠지므로, 수수료 고시의 주소와 지역
 * 연락처의 주소가 다른 지역이 들어와도 링크가 사라지지 않는다.
 */
export function formatBulkyUrlLines(applicationUrl?: string, feeUrl?: string, shownUrls: readonly string[] = []): string[] {
  const application = applicationUrl && !shownUrls.includes(applicationUrl) ? applicationUrl : undefined;
  const fee = feeUrl && !shownUrls.includes(feeUrl) ? feeUrl : undefined;
  if (application && application === fee) return [`- 인터넷 신청·수수료 조회: ${application}`];
  return [
    ...(application ? [`- 인터넷 신청: ${application}`] : []),
    ...(fee ? [`- 수수료 조회: ${fee}`] : []),
  ];
}

/** 지역 연락처 블록(`formatRegionBulkyContactLines`)이 찍는 주소들. 수수료 블록의 중복 판단에 쓴다. */
export function regionBulkyContactUrls(region: RegionalPolicyData): string[] {
  if (region.coverageTier === "metro") return [];
  return [region.bulkyWaste?.applicationUrl, region.bulkyWaste?.feeUrl].filter((url): url is string => !!url);
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
  // 행이 하나도 안 나가는 품목에는 "대표 0개만"이라고 말할 자리가 없다. 품목의 대형폐기물
  // 갈래가 빠지면 `findBulkyWasteFees`는 비는데 메타데이터는 남아 있어, 지역 체크리스트가
  // "확인된 21개 규격 중 대표 0개만 옮겼습니다"를 찍게 된다.
  const loaded = findBulkyWasteFees(region, item).length;
  return loaded > 0 && total > loaded ? total : undefined;
}

function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export type BulkyWasteFeeLineOptions = {
  /**
   * 호출부가 같은 블록 앞쪽에서 이미 찍은 신청·수수료 주소. 여기 든 주소와 값이 같은
   * 줄은 뒤에 다시 적지 않는다 — 수수료 고시 26곳 전부 `region.bulkyWaste`와 주소가
   * 같아서(2026-08-23 확인) 안 거르면 모든 수수료 응답에 같은 주소 두 개가 두 번씩
   * 나갔다(PRD phase-10 R1-a). 호출부가 주소를 안 찍었으면(품목별 지역 안내가 있는
   * 지역) 비워 두고, 그때는 지금처럼 둘 다 적는다 — 이 블록이 유일한 링크 자리다.
   */
  shownUrls?: readonly string[];
};

export function formatBulkyWasteFeeLines(
  item: WasteItem,
  region: RegionalPolicyData,
  { shownUrls = [] }: BulkyWasteFeeLineOptions = {},
): string[] {
  const schedule = findBulkyWasteFeeSchedule(region);
  if (!schedule) return [];

  const fees = findBulkyWasteFees(region, item);
  if (fees.length === 0) return [];

  // "전체 N개"라고 쓰면 안 된다. N은 임포터가 품목 확정·중복 제거·충돌 제거를 마치고
  // 남긴 행 수지 고시에 실린 규격 수가 아니다(제외 기준은 source.note에 적혀 있다).
  // 그래서 "규격 N종"이 아니라 행으로 말한다 — 노원 매트리스 21행은 고시명 3종 ×
  // 규격 ~7종이라 규격 21종이 아니다.
  const rowTotal = findBulkyWasteFeeRowTotal(region, item);

  return [
    `- ${region.name} 대형생활폐기물 수수료 후보:`,
    ...(rowTotal
      ? [`  - 수수료표 ${rowTotal}행 중 대표 ${fees.length}행만 추렸습니다. 전체 표는 수수료 조회 링크에서 확인하세요.`]
      : []),
    ...formatBulkyWasteFeeRows(fees),
    ...formatBulkyUrlLines(schedule.applicationUrl, schedule.feeUrl, shownUrls),
  ];
}

/**
 * 수수료 행을 고시명 하나에 규격을 이어 붙여 적는다(PRD phase-10 R1-b).
 *
 * 한 줄에 한 행이던 때는 노원 매트리스 12행에서 `(침대)매트리스(라텍스/메모리폼)`이
 * 여덟 번 반복됐다 — 900B 가운데 절반이 같은 고시명이었다. 고시명 순서는 처음 나온
 * 차례(임포터가 금액순으로 남긴다), 규격은 그 안에서 원래 순서 그대로다. 규격이 비어
 * 있거나 `-`인 행(빨래건조대 -: 1,000원)은 금액만 적는다 — "빨래건조대: - 1,000원"은
 * 읽는 쪽에 틀린 표기로 보인다.
 *
 * 카드의 수수료 범위 줄(`buildRegionFeeLine`)은 `fees` 배열을 직접 읽으므로 이 모양과
 * 무관하다.
 */
export function formatBulkyWasteFeeRows(fees: readonly BulkyWasteFee[]): string[] {
  const groups = new Map<string, BulkyWasteFee[]>();
  for (const fee of fees) {
    const group = groups.get(fee.itemName);
    if (group) group.push(fee);
    else groups.set(fee.itemName, [fee]);
  }
  return Array.from(groups, ([itemName, rows]) => {
    const specs = rows.map((fee) => (fee.spec && fee.spec !== "-" ? `${fee.spec} ${formatKrw(fee.feeKrw)}` : formatKrw(fee.feeKrw)));
    return `  - ${itemName}: ${specs.join(" · ")}`;
  });
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
  /**
   * 호출부가 이 블록 **위에서 이미 찍은** 신청·수수료 주소. 수수료 블록이 그 주소를
   * 다시 적지 않게 그대로 넘긴다(PR #70 리뷰 3라운드).
   *
   * `get_region_disposal_info`가 이걸 넘긴다. 거기서는 호출부가 바로 위에서
   * `formatRegionBulkyContactLines`로 같은 주소를 찍는데, 품목별 지역 안내가 있는
   * 지역(강남·서초·송파·마포)은 아래 guide 갈래로 떨어져 수수료 블록이 그 주소를 다시
   * 냈다 — 이 PR이 두 자리의 라벨을 `- 인터넷 신청:`·`- 수수료 조회:`로 통일하면서
   * 글자까지 똑같은 줄이 두 번 나가게 됐다. `get_disposal_steps` 쪽 호출부는 넘기지
   * 않는다. 거기서는 이 블록이 유일한 링크 자리라, 넘기면 링크가 통째로 사라진다.
   */
  shownUrls?: readonly string[];
};

export function formatRegionItemGuide(
  item: WasteItem,
  regionMatch?: MatchedRegionPolicy,
  { namedSubRegion, subRegionScopeAlreadyShown, shownUrls = [] }: RegionItemGuideOptions = {},
): string[] {
  if (!regionMatch) return [];

  const { region } = regionMatch;
  const guide = findRegionItemGuide(region, item);
  if (guide) {
    // 품목별 지역 안내는 주소를 안 찍으므로(강남은 "자원순환 종합포털에서"로 끝난다)
    // 수수료 블록이 신청·수수료 링크를 낸다. 호출부가 응답 위쪽에서 같은 주소를 이미
    // 찍었을 때만 `shownUrls`가 차 있고, 안 넘어오면(품목 툴) 둘 다 그대로 나간다.
    return [
      `- ${guide.summary}`,
      ...guide.steps.map((step) => `- ${region.name} 기준: ${step}`),
      ...formatBulkyWasteFeeLines(item, region, { shownUrls }),
    ];
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

    // 배출 전 부착물을 "없다"고 확인한 지역만 부착 문구를 갈아끼운다. 값이 없으면
    // 지금까지 쓰던 문장 그대로다 — 기본값을 바꾸면 조사하지 않은 30곳까지 한꺼번에
    // 다른 안내를 받는다.
    //
    // **부착물 유무와 신청 기한은 다른 축이다.** 이 갈래를 기한 분기보다 앞에 두면
    // `full` 티어를 `none`으로 표시하는 순간 직접 확인한 "배출 3일 전까지"가 조용히
    // 사라진다. 그래서 기한 분기는 그대로 두고 부착 문구만 바꿔 끼운다.
    const noPrePosting = region.bulkyWaste?.prePosting === "none" && !isMetro;
    const postingClause = noPrePosting
      ? "접수증이나 접수번호를 붙이지 않고 수거업체가 현장에서 품목을 확인합니다."
      : undefined;
    const bulkyLine = hasConfirmedDeadline
      ? isBulkySecondaryRoute(item)
        ? postingClause
          ? `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 3일 전까지 사전 신청합니다. ${postingClause} 그 외에는 위 배출 방법을 따릅니다.`
          : `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : postingClause
          ? `- ${region.name} 대형생활폐기물은 배출 3일 전까지 사전 신청합니다. ${postingClause}`
          : `- ${region.name} 대형생활폐기물은 배출 3일 전까지 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다.`
      : isBulkySecondaryRoute(item)
        ? postingClause
          ? `- ${region.name} 기준으로 대형폐기물에 해당할 때만 배출 전에 사전 신청합니다. ${postingClause} 그 외에는 위 배출 방법을 따릅니다.`
          : `- 대형폐기물에 해당할 때만 배출 전에 사전 신청하고 접수증 또는 접수번호를 부착합니다. 그 외에는 위 배출 방법을 따릅니다.`
        : isMetro
          ? "- 대형생활폐기물은 배출 전에 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다. 신청 기한은 시·군·구마다 다릅니다."
          : postingClause
            ? `- ${region.name} 대형생활폐기물은 배출 전에 미리 신청합니다. ${postingClause} 신청 기한은 아래 신청 경로에서 확인하세요.`
            : `- ${region.name} 대형생활폐기물은 배출 전에 미리 신청하고 접수증 또는 접수번호를 부착해 배출합니다. 신청 기한은 아래 신청 경로에서 확인하세요.`;

    // 되묻기를 걷어내는 건 **metro 티어에서만**이다. 그 티어의 연락처 블록은
    // "거주 중인 시·군·구를 확인해야" 한 줄이 전부라 갈아끼워도 잃는 URL이 없지만,
    // district 티어에는 문의 전화·인터넷 신청·수수료 조회가 들어 있다.
    // `namedSubRegion`이 넘어오는 건 광역 착지 때뿐이라는 호출부 약속에 기대면,
    // 나중에 다른 툴로 넓히는 순간 그 셋이 소리 없이 사라진다 — 여기서 막는다.
    const usesRegionContactLines = !(namedSubRegion && isMetro);
    const contactLines = usesRegionContactLines
      ? formatRegionBulkyContactLines(region)
      : subRegionScopeAlreadyShown
        ? []
        : [
            `- ${formatUnregisteredDistrictScope(region.name, namedSubRegion)} 대형폐기물 신청 경로와 수수료는 ${namedSubRegion} 공식 안내에서 확인하세요.`,
          ];
    // 연락처 블록이 방금 찍은 주소는 수수료 블록 끝에서 다시 적지 않는다. 연락처
    // 블록을 안 거친 갈래(광역 착지)는 호출부가 넘긴 것만 남아, 아무도 안 찍었으면
    // 수수료 블록이 주소를 그대로 낸다.
    const feeShownUrls = usesRegionContactLines ? [...shownUrls, ...regionBulkyContactUrls(region)] : shownUrls;
    return [bulkyLine, ...contactLines, ...formatBulkyWasteFeeLines(item, region, { shownUrls: feeShownUrls })];
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
    //
    // 지역 안내가 바로 위에서 답한 항목은 다시 묻지 않는다(PRD phase-10 R2-b). 요일 항목은
    // `isCheckItemAnsweredByRegionGuide`가 손대지 않으므로 확인처가 붙는 자리는 그대로다.
    const checkItems = (item.regionPolicy?.checkItems ?? []).filter(
      (checkItem) => !hasRegionGuide || !isCheckItemAnsweredByRegionGuide(checkItem, regionGuideLines, item, regionMatch),
    );
    if (checkItems.length > 0)
      lines.push(...withCollectionDaySource(checkItems, regionMatch).map((checkItem) => `- 확인 항목: ${checkItem}`));
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
    lines.push("", `### ${regionMatch.region.name} 공식 출처`, ...formatRegionSourceListForItem(regionMatch.region, item));
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
