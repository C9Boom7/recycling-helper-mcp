import { readFileSync } from "node:fs";

const itemsPath = new URL("../src/data/waste-items.json", import.meta.url);
const casesPath = new URL("../src/data/evaluation-cases.json", import.meta.url);
const regionPoliciesPath = new URL("../src/data/region-policies.json", import.meta.url);
const regionCasesPath = new URL("../src/data/region-evaluation-cases.json", import.meta.url);
const bulkyWasteFeesPath = new URL("../src/data/bulky-waste-fees.json", import.meta.url);
const wasteItems = JSON.parse(readFileSync(itemsPath, "utf8"));
const evaluationCases = JSON.parse(readFileSync(casesPath, "utf8"));
const regionalPolicies = JSON.parse(readFileSync(regionPoliciesPath, "utf8"));
const regionEvaluationCases = JSON.parse(readFileSync(regionCasesPath, "utf8"));
const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeesPath, "utf8"));

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

function findRegionalPolicy(region) {
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

function findRegionItemGuide(region, item) {
  return region.itemGuides.find((guide) => guide.itemIds.includes(item.id));
}

function findBulkyWasteFees(region, item) {
  return bulkyWasteFeeSchedules.find((schedule) => schedule.regionId === region.id)?.fees.filter((fee) => fee.itemId === item.id) ?? [];
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

for (const testCase of regionEvaluationCases) {
  const regionMatch = findRegionalPolicy(testCase.region);
  if (!regionMatch) {
    failures.push(`region "${testCase.region}" did not match any policy; expected ${testCase.expectedRegionId}`);
    continue;
  }

  if (regionMatch.region.id !== testCase.expectedRegionId) {
    failures.push(`region "${testCase.region}" matched ${regionMatch.region.id}; expected ${testCase.expectedRegionId}`);
  }

  const itemMatch = findBestWasteItem(testCase.query);
  if (!itemMatch) {
    failures.push(`"${testCase.query}" did not match any item for region case; expected ${testCase.expectedItemId}`);
    continue;
  }

  if (itemMatch.item.id !== testCase.expectedItemId) {
    failures.push(`"${testCase.query}" matched ${itemMatch.item.id} for region case; expected ${testCase.expectedItemId}`);
  }

  const guide = findRegionItemGuide(regionMatch.region, itemMatch.item);
  const guideText = guide ? [guide.summary, ...guide.steps].join(" ") : "";
  if (!guideText.includes(testCase.expectedGuideContains)) {
    failures.push(
      `"${testCase.region}" + "${testCase.query}" regional guide did not include "${testCase.expectedGuideContains}"`,
    );
  }

  if (testCase.expectedFeeKrw !== undefined) {
    const fees = findBulkyWasteFees(regionMatch.region, itemMatch.item);
    if (!fees.some((fee) => fee.feeKrw === testCase.expectedFeeKrw)) {
      failures.push(
        `"${testCase.region}" + "${testCase.query}" bulky waste fees did not include ${testCase.expectedFeeKrw}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Data evaluation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Data evaluation passed: ${evaluationCases.length} item cases, ${regionEvaluationCases.length} region cases`);
