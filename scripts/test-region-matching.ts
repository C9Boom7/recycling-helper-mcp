import { resolveRegionalPolicyIn } from "../src/data.js";
import type { RegionalPolicyData } from "../src/data.js";

/**
 * 동명 자치구 되묻기 회귀. 실데이터에는 아직 같은 이름의 구가 둘 이상 없어서
 * (서울 중구·부산 중구 모두 완결 조건을 못 채워 백로그에 있다) 픽스처로 고정한다.
 * 실데이터 기반 케이스는 그 지역들이 들어오는 배치에서 함께 넣는다.
 */
function metro(id: string, name: string, aliases: string[]): RegionalPolicyData {
  return {
    id,
    name,
    aliases,
    coverageTier: "metro",
    checkedAt: "2026-08-14",
    summary: `${name} 광역 안내`,
    sources: [{ title: `${name} 출처`, url: "https://example.go.kr", sourceType: "local_guidance", checkedAt: "2026-08-14" }],
  };
}

function district(id: string, name: string, aliases: string[], metroId: string): RegionalPolicyData {
  return {
    id,
    name,
    aliases,
    coverageTier: "standard",
    metroId,
    checkedAt: "2026-08-14",
    summary: `${name} 안내`,
    sources: [{ title: `${name} 출처`, url: "https://example.go.kr", sourceType: "local_guidance", checkedAt: "2026-08-14" }],
  };
}

const fixture: RegionalPolicyData[] = [
  metro("seoul", "서울특별시", ["서울", "서울시", "서울특별시"]),
  metro("busan", "부산광역시", ["부산", "부산시", "부산광역시"]),
  district("seoul_jung_gu", "서울 중구", ["중구", "서울 중구", "서울시 중구"], "seoul"),
  district("busan_jung_gu", "부산 중구", ["중구", "부산 중구", "부산시 중구"], "busan"),
  district("busan_haeundae_gu", "부산 해운대구", ["해운대구", "부산 해운대구"], "busan"),
  district("seoul_gangnam_gu", "서울 강남구", ["강남구", "서울 강남구"], "seoul"),
];

type Expectation =
  | { query: string; expect: "match"; regionId: string; level: "district" | "metro" }
  | { query: string; expect: "ambiguous"; candidateIds: string[] }
  | { query: string; expect: "not_found" };

const expectations: Expectation[] = [
  // 어느 레벨에서도 유일하지 않다 — 확정하지 말고 되물어야 한다.
  { query: "중구", expect: "ambiguous", candidateIds: ["busan_jung_gu", "seoul_jung_gu"] },
  // 광역 접두어가 붙으면 자치구가 확정된다.
  { query: "부산 중구", expect: "match", regionId: "busan_jung_gu", level: "district" },
  { query: "서울 중구", expect: "match", regionId: "seoul_jung_gu", level: "district" },
  // 자치구 후보가 여럿이어도 광역 완전 일치가 더 앞 단계라 되묻지 않고 착지한다.
  { query: "부산", expect: "match", regionId: "busan", level: "metro" },
  { query: "서울", expect: "match", regionId: "seoul", level: "metro" },
  // 미등록 자치구는 광역으로 내려간다.
  { query: "부산 사하구", expect: "match", regionId: "busan", level: "metro" },
  // 접두 조각은 확정 근거가 되지만, 중간 조각은 아니다. "남구"가 "강남구"에
  // 걸려 조용히 강남구로 확정되던 것이 이 규칙이 막는 실패다.
  { query: "해운대", expect: "match", regionId: "busan_haeundae_gu", level: "district" },
  { query: "강남", expect: "match", regionId: "seoul_gangnam_gu", level: "district" },
  { query: "남구", expect: "not_found" },
];

const failures: string[] = [];

for (const expectation of expectations) {
  const resolution = resolveRegionalPolicyIn(fixture, expectation.query);

  if (expectation.expect === "not_found") {
    if (resolution.status !== "not_found") {
      failures.push(`"${expectation.query}" resolved as ${resolution.status}; expected not_found`);
    }
    continue;
  }

  if (expectation.expect === "ambiguous") {
    if (resolution.status !== "ambiguous") {
      failures.push(`"${expectation.query}" resolved as ${resolution.status}; expected an ambiguous re-ask`);
      continue;
    }
    const actual = resolution.candidates.map((candidate) => candidate.region.id).sort();
    const expected = [...expectation.candidateIds].sort();
    if (actual.join(",") !== expected.join(",")) {
      failures.push(`"${expectation.query}" candidates were ${actual.join(", ")}; expected ${expected.join(", ")}`);
    }
    continue;
  }

  if (resolution.status !== "match") {
    failures.push(`"${expectation.query}" resolved as ${resolution.status}; expected ${expectation.regionId}`);
    continue;
  }
  if (resolution.match.region.id !== expectation.regionId) {
    failures.push(`"${expectation.query}" matched ${resolution.match.region.id}; expected ${expectation.regionId}`);
  }
  if (resolution.match.level !== expectation.level) {
    failures.push(`"${expectation.query}" matched at the ${resolution.match.level} level; expected ${expectation.level}`);
  }
}

if (failures.length > 0) {
  console.error(`Region matching test failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Region matching test passed: ${expectations.length} cases`);
