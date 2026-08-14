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

// src/data.ts의 resolveRegionalPolicy와 같은 규칙을 쓴다 — 명확하게 확정되는
// 가장 작은 단위가 이긴다. 한쪽만 고치면 평가가 런타임과 다른 답을 통과시킨다.
const REGION_MIN_FRAGMENT_QUERY_LENGTH = 2;

function regionMatchLevel(region) {
  return region.coverageTier === "metro" ? "metro" : "district";
}

function regionMatchStrength(normalizedQuery, normalizedName) {
  if (!normalizedName) return 0;
  if (normalizedQuery === normalizedName) return 3;
  if (normalizedQuery.startsWith(normalizedName)) return 2;
  if (normalizedName.startsWith(normalizedQuery) && normalizedQuery.length >= REGION_MIN_FRAGMENT_QUERY_LENGTH) return 1;
  return 0;
}

function regionCandidatesAt(normalizedQuery, level, strength) {
  const byRegionId = new Map();

  for (const policy of regionalPolicies) {
    if (regionMatchLevel(policy) !== level || byRegionId.has(policy.id)) continue;
    for (const name of [policy.name, ...policy.aliases]) {
      if (regionMatchStrength(normalizedQuery, normalizeText(name)) !== strength) continue;
      byRegionId.set(policy.id, { region: policy, matchedBy: name, level });
      break;
    }
  }

  return Array.from(byRegionId.values()).sort((a, b) => a.region.name.localeCompare(b.region.name, "ko"));
}

const REGION_RESOLUTION_ORDER = [
  ["district", 3],
  ["metro", 3],
  ["district", 2],
  ["district", 1],
  ["metro", 2],
  ["metro", 1],
];

function resolveRegionalPolicy(region) {
  const normalizedQuery = normalizeText(region ?? "");
  if (!normalizedQuery) return { status: "not_found" };

  let ambiguous;
  for (const [level, strength] of REGION_RESOLUTION_ORDER) {
    const candidates = regionCandidatesAt(normalizedQuery, level, strength);
    if (candidates.length === 1) return { status: "match", match: candidates[0] };
    if (candidates.length > 1 && !ambiguous) ambiguous = candidates;
  }

  return ambiguous ? { status: "ambiguous", candidates: ambiguous } : { status: "not_found" };
}

function findRegionalPolicy(region) {
  const resolved = resolveRegionalPolicy(region);
  return resolved.status === "match" ? resolved.match : undefined;
}

function findRegionItemGuide(region, item) {
  return region.itemGuides?.find((guide) => guide.itemIds.includes(item.id));
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

// R2의 회귀 방어선. 지역의 이름·별칭을 그대로 입력했을 때 그 지역으로
// 확정되거나 최소한 되묻기 후보에는 들어가야 한다. 어느 쪽도 아니면 그 별칭은
// 다른 지역에 뺏긴 것이고, 사용자에게는 조용히 틀린 지역 안내가 나간다.
for (const region of regionalPolicies) {
  for (const alias of [region.name, ...region.aliases]) {
    const resolution = resolveRegionalPolicy(alias);
    if (resolution.status === "match" && resolution.match.region.id === region.id) continue;
    if (resolution.status === "ambiguous" && resolution.candidates.some((candidate) => candidate.region.id === region.id)) continue;

    const actual =
      resolution.status === "match"
        ? `${resolution.match.region.id}`
        : resolution.status === "ambiguous"
        ? `ambiguous(${resolution.candidates.map((candidate) => candidate.region.id).join(", ")})`
        : "not_found";
    failures.push(`region ${region.id} alias "${alias}" resolves to ${actual}`);
  }
}

for (const testCase of regionEvaluationCases) {
  const resolution = resolveRegionalPolicy(testCase.region);

  // 동명 자치구는 확정하지 않고 되묻는 게 정답이다. 이 케이스는 "어떤 지역으로
  // 매칭됐는가"가 아니라 "확정을 거부했는가"를 본다.
  if (testCase.expectedStatus === "ambiguous") {
    if (resolution.status !== "ambiguous") {
      failures.push(`region "${testCase.region}" resolved as ${resolution.status}; expected an ambiguous re-ask`);
      continue;
    }

    const candidateIds = resolution.candidates.map((candidate) => candidate.region.id);
    for (const expectedId of testCase.expectedCandidateIds ?? []) {
      if (!candidateIds.includes(expectedId)) {
        failures.push(`region "${testCase.region}" ambiguity candidates ${candidateIds.join(", ")} did not include ${expectedId}`);
      }
    }
    continue;
  }

  if (resolution.status !== "match") {
    failures.push(`region "${testCase.region}" did not match any policy; expected ${testCase.expectedRegionId}`);
    continue;
  }

  const regionMatch = resolution.match;
  if (regionMatch.region.id !== testCase.expectedRegionId) {
    failures.push(`region "${testCase.region}" matched ${regionMatch.region.id}; expected ${testCase.expectedRegionId}`);
  }

  if (testCase.expectedLevel !== undefined && regionMatch.level !== testCase.expectedLevel) {
    failures.push(`region "${testCase.region}" resolved at the ${regionMatch.level} level; expected ${testCase.expectedLevel}`);
  }

  // 표준 티어는 필드가 얕아 케이스도 얕게 간다 — 신청 경로가 실제로 노출되는지만 본다.
  if (testCase.expectedBulkyApplication && !regionMatch.region.bulkyWaste?.applicationUrl) {
    failures.push(`region "${testCase.region}" (${regionMatch.region.id}) has no bulkyWaste.applicationUrl to surface`);
  }

  if (testCase.query === undefined) continue;

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
