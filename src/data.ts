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

function scoreItem(query: string, item: WasteItem): WasteMatch {
  const normalizedQuery = normalizeText(query);
  const names = [item.name, ...item.aliases];
  let bestScore = 0;
  let matchedBy = item.name;

  for (const name of names) {
    const normalizedName = normalizeText(name);
    let score = 0;

    if (normalizedQuery === normalizedName) {
      score = 100;
    } else if (normalizedQuery.includes(normalizedName)) {
      score = 88;
    } else if (normalizedName.includes(normalizedQuery)) {
      score = 82;
    } else {
      const queryChars = Array.from(new Set(normalizedQuery.split("")));
      const nameChars = new Set(normalizedName.split(""));
      const overlap = queryChars.filter((char) => nameChars.has(char)).length;
      score = Math.round((overlap / Math.max(queryChars.length, 1)) * 60);
    }

    if (score > bestScore) {
      bestScore = score;
      matchedBy = name;
    }
  }

  return { item, score: bestScore, matchedBy };
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
  contaminated: "오염 여부 확인",
  damaged: "파손됨",
  electronics: "전자제품",
  empty_required: "내용물 비움 필요",
  food_contaminated: "음식물 오염",
  hazardous: "유해/위험 품목",
  hygiene: "위생용품",
  liquid: "액체",
  mixed_material: "복합재질",
  oily: "기름 오염",
  pressurized: "압축/가스 용기",
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

export function itemSourceRefs(item: WasteItem): string[] {
  if (item.sources?.length > 0) {
    return item.sources.map((source) => source.title);
  }

  return item.sourceRefs;
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
  const lines = [
    `## ${item.name}`,
    "",
    `- 분류: ${item.category}`,
    `- 배출 판단: ${item.disposalType}`,
    `- 결론: ${item.summary}`,
    `- 확신도: ${confidenceLabel(item.confidence)}`,
    item.conditions.length > 0 ? `- 판단 조건: ${item.conditions.map(conditionLabel).join(", ")}` : undefined,
    "",
    "### 배출 방법",
    ...item.steps.map((step, index) => `${index + 1}. ${step}`),
  ].filter((line): line is string => line !== undefined);

  if (item.cautions.length > 0) {
    lines.push("", "### 주의", ...item.cautions.map((caution) => `- ${caution}`));
  }

  if (itemNeedsRegionCheck(item)) {
    lines.push(
      "",
      "### 지역 확인",
      regionMatch
        ? `- ${regionMatch.region.name} 기준으로 확인된 지역 안내를 함께 반영합니다.`
        : region
        ? `- ${region} 기준 상세 배출 요일, 수거함 위치, 신고 수수료는 지자체 안내와 생활폐기물 분리배출 누리집에서 추가 확인이 필요합니다.`
        : "- 이 품목은 지역별 기준 차이가 있을 수 있습니다. 지역명을 함께 알려주면 확인해야 할 항목을 안내할 수 있습니다.",
    );

    const regionGuideLines = formatRegionItemGuide(item, regionMatch);
    if (regionGuideLines.length > 0) {
      lines.push(...regionGuideLines);
    }

    if (item.regionPolicy?.checkItems?.length) {
      lines.push(...item.regionPolicy.checkItems.map((checkItem) => `- 확인 항목: ${checkItem}`));
    }
  }

  lines.push("", "### 근거", ...formatSourceList(item));

  if (regionMatch && itemNeedsRegionCheck(item)) {
    lines.push("", `### ${regionMatch.region.name} 공식 출처`, ...formatRegionSourceList(regionMatch.region));
  }

  return lines.join("\n");
}

export function disposalGroupLabel(disposalType: string): string {
  if (disposalType.includes("bulky")) return "대형폐기물";
  if (disposalType.includes("special") || disposalType.includes("hazardous")) return "특수/유해폐기물";
  if (disposalType.includes("general")) return "일반쓰레기";
  if (disposalType.includes("recycle")) return "재활용";
  if (disposalType.includes("region")) return "지역 확인 필요";
  return "확인 필요";
}
