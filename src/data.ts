import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Confidence = "high" | "medium" | "low";

export type WasteItem = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  disposalType: string;
  summary: string;
  steps: string[];
  cautions: string[];
  confidence: Confidence;
  needsRegionCheck: boolean;
  sourceRefs: string[];
};

export type WasteMatch = {
  item: WasteItem;
  score: number;
  matchedBy: string;
};

const dataPath = fileURLToPath(new URL("./data/waste-items.json", import.meta.url));

export const wasteItems = JSON.parse(readFileSync(dataPath, "utf8")) as WasteItem[];

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

export function formatItemGuide(item: WasteItem, region?: string): string {
  const lines = [
    `## ${item.name}`,
    "",
    `- 분류: ${item.category}`,
    `- 배출 판단: ${item.disposalType}`,
    `- 결론: ${item.summary}`,
    `- 확신도: ${confidenceLabel(item.confidence)}`,
    "",
    "### 배출 방법",
    ...item.steps.map((step, index) => `${index + 1}. ${step}`),
  ];

  if (item.cautions.length > 0) {
    lines.push("", "### 주의", ...item.cautions.map((caution) => `- ${caution}`));
  }

  if (item.needsRegionCheck) {
    lines.push(
      "",
      "### 지역 확인",
      region
        ? `- ${region} 기준 상세 배출 요일, 수거함 위치, 신고 수수료는 지자체 안내와 생활폐기물 분리배출 누리집에서 추가 확인이 필요합니다.`
        : "- 이 품목은 지역별 기준 차이가 있을 수 있습니다. 지역명을 함께 알려주면 확인해야 할 항목을 안내할 수 있습니다.",
    );
  }

  lines.push("", "### 근거", ...item.sourceRefs.map((source) => `- ${source}`));

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

