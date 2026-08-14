import { readFileSync } from "node:fs";

/**
 * Phase 5 R7. 지표는 not_found 비율이 아니라 **지역 해상도 분포**다.
 *
 * 자치구 확정 / 광역시도 폴백 / 전국 폴백 / 오매칭으로 나눠 세고, 오매칭 0이
 * R2의 통과 조건이다. before는 Phase 5 직전(PR #9) 상태를 그대로 재현한다 —
 * 시·도 이름은 확정하지 않고 full 티어 5개 지역만 있던 때다. 그 시점에 이미
 * 오매칭은 0이었으므로, Phase 5가 옮긴 것은 오매칭이 아니라 **전국 폴백으로
 * 흘러가던 질의**다. 오매칭 0은 지키는 조건이지 개선 지표가 아니다.
 */
const queries = readFileSync(new URL("../logs/region-expansion-queries.example.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const regionalPolicies = JSON.parse(readFileSync(new URL("../src/data/region-policies.json", import.meta.url), "utf8"));

function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** 시·도 이름은 확정하지 않는다 — Phase 5 직전(PR #9) 상태를 그대로 재현한 목록. */
const LEGACY_PROVINCE_QUERIES = new Set(
  [
    "서울", "서울시", "서울특별시",
    "부산", "부산시", "부산광역시",
    "대구", "대구시", "대구광역시",
    "인천", "인천시", "인천광역시",
    "광주", "광주시", "광주광역시",
    "대전", "대전시", "대전광역시",
    "울산", "울산시", "울산광역시",
    "세종", "세종시", "세종특별자치시",
    "경기", "경기도",
    "강원", "강원도", "강원특별자치도",
    "충북", "충청북도", "충남", "충청남도",
    "전북", "전라북도", "전북특별자치도", "전남", "전라남도",
    "경북", "경상북도", "경남", "경상남도",
    "제주", "제주도", "제주특별자치도",
  ].map(normalizeText),
);

/**
 * Phase 5 직전 매칭(PR #9 기준): 질의가 정책명을 포함하면 즉시 확정하고, 더 넓은
 * 질의는 후보가 정확히 하나일 때만 확정하되 시·도 이름은 아예 확정하지 않는다.
 */
function resolveLegacy(policies, region) {
  const normalizedRegion = normalizeText(region);
  if (!normalizedRegion) return undefined;

  const broaderHits = [];
  for (const policy of policies) {
    for (const name of [policy.name, ...policy.aliases]) {
      const normalizedName = normalizeText(name);
      if (normalizedRegion === normalizedName || normalizedRegion.includes(normalizedName)) return policy;
      if (normalizedName.includes(normalizedRegion)) broaderHits.push(policy);
    }
  }

  if (LEGACY_PROVINCE_QUERIES.has(normalizedRegion)) return undefined;

  const distinct = new Set(broaderHits.map((hit) => hit.name));
  return distinct.size === 1 ? broaderHits[0] : undefined;
}

const REGION_MIN_FRAGMENT_QUERY_LENGTH = 2;

function matchStrength(normalizedQuery, normalizedName) {
  if (!normalizedName) return 0;
  if (normalizedQuery === normalizedName) return 3;
  if (normalizedQuery.startsWith(normalizedName)) return 2;
  if (normalizedName.startsWith(normalizedQuery) && normalizedQuery.length >= REGION_MIN_FRAGMENT_QUERY_LENGTH) return 1;
  return 0;
}

function candidatesAt(policies, normalizedQuery, level, strength) {
  const byRegionId = new Map();
  for (const policy of policies) {
    const policyLevel = policy.coverageTier === "metro" ? "metro" : "district";
    if (policyLevel !== level || byRegionId.has(policy.id)) continue;
    for (const name of [policy.name, ...policy.aliases]) {
      if (matchStrength(normalizedQuery, normalizeText(name)) !== strength) continue;
      byRegionId.set(policy.id, { region: policy, level });
      break;
    }
  }
  return Array.from(byRegionId.values());
}

const REGION_RESOLUTION_ORDER = [
  ["district", 3],
  ["metro", 3],
  ["district", 2],
  ["district", 1],
  ["metro", 2],
  ["metro", 1],
];

function resolveCurrent(policies, region) {
  const normalizedQuery = normalizeText(region);
  if (!normalizedQuery) return { status: "not_found" };

  let ambiguous;
  for (const [level, strength] of REGION_RESOLUTION_ORDER) {
    const candidates = candidatesAt(policies, normalizedQuery, level, strength);
    if (candidates.length === 1) return { status: "match", match: candidates[0] };
    if (candidates.length > 1 && !ambiguous) ambiguous = candidates;
  }
  return ambiguous ? { status: "ambiguous", candidates: ambiguous } : { status: "not_found" };
}

function classify(resolvedId, resolvedLevel, testCase) {
  if (!resolvedId) return "national_fallback";
  if (resolvedId !== testCase.expectedRegionId) return "mismatch";
  return resolvedLevel === "metro" ? "metro_fallback" : "district";
}

function tally(rows) {
  const counts = { district: 0, metro_fallback: 0, national_fallback: 0, ambiguous: 0, mismatch: 0 };
  for (const row of rows) counts[row.bucket] += 1;
  return counts;
}

const legacyPolicies = regionalPolicies.filter((policy) => policy.coverageTier === "full");

const before = queries.map((testCase) => {
  const matched = resolveLegacy(legacyPolicies, testCase.query);
  return { ...testCase, resolved: matched?.id, bucket: classify(matched?.id, "district", testCase) };
});

const after = queries.map((testCase) => {
  const resolution = resolveCurrent(regionalPolicies, testCase.query);
  if (resolution.status === "ambiguous") return { ...testCase, resolved: "(ambiguous)", bucket: "ambiguous" };
  const matched = resolution.status === "match" ? resolution.match : undefined;
  return {
    ...testCase,
    resolved: matched?.region.id,
    bucket: classify(matched?.region.id, matched?.level, testCase),
  };
});

function report(label, rows) {
  const counts = tally(rows);
  const pct = (n) => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log(`\n${label} (n=${rows.length})`);
  console.log(`- 자치구 확정: ${counts.district} (${pct(counts.district)})`);
  console.log(`- 광역시도 폴백: ${counts.metro_fallback} (${pct(counts.metro_fallback)})`);
  console.log(`- 전국 폴백: ${counts.national_fallback} (${pct(counts.national_fallback)})`);
  console.log(`- 되묻기: ${counts.ambiguous} (${pct(counts.ambiguous)})`);
  console.log(`- 오매칭: ${counts.mismatch} (${pct(counts.mismatch)})`);

  const mismatches = rows.filter((row) => row.bucket === "mismatch");
  if (mismatches.length > 0) {
    console.log("  오매칭 상세:");
    for (const row of mismatches) console.log(`  - "${row.query}" -> ${row.resolved} (기대: ${row.expectedRegionId})`);
  }
  return counts;
}

report("before (Phase 5 직전 = PR #9 기준: 시·도 미확정 + full 티어 5개 지역)", before);
const afterCounts = report("after (Phase 5: 단계형 매칭 + 35개 지역)", after);

if (afterCounts.mismatch > 0) {
  console.error(`\nR2 통과 조건 위반: 오매칭 ${afterCounts.mismatch}건`);
  process.exit(1);
}
