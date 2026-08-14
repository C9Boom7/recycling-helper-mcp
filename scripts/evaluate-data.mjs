import { readFileSync } from "node:fs";

const itemsPath = new URL("../src/data/waste-items.json", import.meta.url);
const casesPath = new URL("../src/data/evaluation-cases.json", import.meta.url);
const wasteItems = JSON.parse(readFileSync(itemsPath, "utf8"));
const evaluationCases = JSON.parse(readFileSync(casesPath, "utf8"));

function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function scoreItem(query, item) {
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

function findBestWasteItem(query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return undefined;

  return wasteItems
    .map((item) => scoreItem(query, item))
    .filter((match) => match.score >= 35)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ko"))[0];
}

const failures = [];
const itemIds = new Set(wasteItems.map((item) => item.id));
const caseCountsByItemId = new Map();

for (const testCase of evaluationCases) {
  caseCountsByItemId.set(testCase.expectedItemId, (caseCountsByItemId.get(testCase.expectedItemId) ?? 0) + 1);
}

for (const item of wasteItems) {
  const count = caseCountsByItemId.get(item.id) ?? 0;
  if (count === 0) {
    failures.push(`item ${item.id} (${item.name}) has no evaluation case`);
  } else if (count > 1) {
    failures.push(`item ${item.id} (${item.name}) has ${count} evaluation cases; expected exactly 1`);
  }
}

for (const expectedItemId of caseCountsByItemId.keys()) {
  if (!itemIds.has(expectedItemId)) {
    failures.push(`evaluation case references unknown item id ${expectedItemId}`);
  }
}

for (const testCase of evaluationCases) {
  const match = findBestWasteItem(testCase.query);

  if (!match) {
    failures.push(`"${testCase.query}" did not match any item; expected ${testCase.expectedItemId}`);
    continue;
  }

  if (match.item.id !== testCase.expectedItemId) {
    failures.push(
      `"${testCase.query}" matched ${match.item.id} by "${match.matchedBy}" (${match.score}); expected ${testCase.expectedItemId}`,
    );
  }

  if (match.item.disposalType !== testCase.expectedDisposalType) {
    failures.push(
      `"${testCase.query}" matched ${match.item.id} with disposalType ${match.item.disposalType}; expected ${testCase.expectedDisposalType}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Data evaluation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

// 지역 케이스는 `test-region-matching.ts`로 옮겼다 — 거기서는 리졸버를 복제하지 않고
// `src/data.ts`에서 그대로 불러 쓴다.
console.log(`Data evaluation passed: ${evaluationCases.length} item cases`);
