import { readFileSync } from "node:fs";

import { normalizeText, regionalPolicies, resolveRegionalPolicyIn } from "../src/data.js";
import type { RegionalPolicyData, RegionMatchLevel } from "../src/data.js";

/**
 * Phase 5 R7. 지표는 not_found 비율이 아니라 **지역 해상도 분포**다.
 *
 * 자치구 확정 / 광역시도 폴백 / 전국 폴백 / 오매칭으로 나눠 세고, 오매칭 0이
 * R2의 통과 조건이다. before는 Phase 5 직전(PR #9) 상태를 그대로 재현한다 —
 * 시·도 이름은 확정하지 않고 full 티어 5개 지역만 있던 때다. 그 시점에 이미
 * 오매칭은 0이었으므로, Phase 5가 옮긴 것은 오매칭이 아니라 **전국 폴백으로
 * 흘러가던 질의**다. 오매칭 0은 지키는 조건이지 개선 지표가 아니다.
 *
 * after는 `src/data.ts`의 리졸버를 그대로 불러 쓴다. 예전에는 여기에 사본을
 * 뒀는데, 그러면 런타임 매칭을 고쳐도 측정값은 옛 규칙으로 계속 나온다.
 */
/** `expectRefusal`은 착지하지 않는 것이 정답인 질의다 — 전국 동명 이름이 여기 해당한다. */
type MeasurementQuery = { query: string; expectedRegionId?: string; expectRefusal?: boolean };

const queries = readFileSync(new URL("../logs/region-expansion-queries.example.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as MeasurementQuery);

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
 *
 * 이건 지금 코드의 사본이 아니라 **폐기된 옛 규칙의 재현**이라 여기 남는다.
 * before 열이 없으면 after 숫자만으로는 무엇이 나아졌는지 말할 수 없다.
 */
function resolveLegacy(policies: RegionalPolicyData[], region: string): RegionalPolicyData | undefined {
  const normalizedRegion = normalizeText(region);
  if (!normalizedRegion) return undefined;

  const broaderHits: RegionalPolicyData[] = [];
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

type Bucket = "district" | "metro_fallback" | "national_fallback" | "ambiguous" | "mismatch";
type Row = MeasurementQuery & { resolved?: string; bucket: Bucket };

function classify(resolvedId: string | undefined, resolvedLevel: RegionMatchLevel | undefined, testCase: MeasurementQuery): Bucket {
  // 확정 거부가 정답인 질의는 반대로 읽는다. `강서구`처럼 전국 동명인 이름은 착지하지
  // 않는 것이 성공이고, 누군가 별칭을 달아 확정되게 만들면 그건 회귀다. 이 분기가 없으면
  // `classify`가 미확정에서 먼저 빠져나가 오매칭으로 잡히지 않는다.
  if (testCase.expectRefusal) return resolvedId ? "mismatch" : "national_fallback";
  if (!resolvedId) return "national_fallback";
  if (resolvedId !== testCase.expectedRegionId) return "mismatch";
  return resolvedLevel === "metro" ? "metro_fallback" : "district";
}

function tally(rows: Row[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { district: 0, metro_fallback: 0, national_fallback: 0, ambiguous: 0, mismatch: 0 };
  for (const row of rows) counts[row.bucket] += 1;
  return counts;
}

const legacyPolicies = regionalPolicies.filter((policy) => policy.coverageTier === "full");

const before: Row[] = queries.map((testCase) => {
  const matched = resolveLegacy(legacyPolicies, testCase.query);
  return { ...testCase, resolved: matched?.id, bucket: classify(matched?.id, "district", testCase) };
});

const after: Row[] = queries.map((testCase) => {
  const resolution = resolveRegionalPolicyIn(regionalPolicies, testCase.query);
  if (resolution.status === "ambiguous") return { ...testCase, resolved: "(ambiguous)", bucket: "ambiguous" };
  const matched = resolution.status === "match" ? resolution.match : undefined;
  return {
    ...testCase,
    resolved: matched?.region.id,
    bucket: classify(matched?.region.id, matched?.level, testCase),
  };
});

function report(label: string, rows: Row[]): Record<Bucket, number> {
  const counts = tally(rows);
  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log(`\n${label} (n=${rows.length})`);
  console.log(`- 자치구 확정: ${counts.district} (${pct(counts.district)})`);
  console.log(`- 광역시도 폴백: ${counts.metro_fallback} (${pct(counts.metro_fallback)})`);
  console.log(`- 전국 폴백: ${counts.national_fallback} (${pct(counts.national_fallback)})`);
  console.log(`- 되묻기: ${counts.ambiguous} (${pct(counts.ambiguous)})`);
  console.log(`- 오매칭: ${counts.mismatch} (${pct(counts.mismatch)})`);

  const mismatches = rows.filter((row) => row.bucket === "mismatch");
  if (mismatches.length > 0) {
    console.log("  오매칭 상세:");
    for (const row of mismatches) console.log(`  - "${row.query}" -> ${row.resolved} (기대: ${row.expectRefusal ? "확정 거부" : row.expectedRegionId})`);
  }
  return counts;
}

report("before (Phase 5 직전 = PR #9 기준: 시·도 미확정 + full 티어 5개 지역)", before);
const afterCounts = report("after (Phase 5: 단계형 매칭 + 35개 지역)", after);

if (afterCounts.mismatch > 0) {
  console.error(`\nR2 통과 조건 위반: 오매칭 ${afterCounts.mismatch}건`);
  process.exit(1);
}
