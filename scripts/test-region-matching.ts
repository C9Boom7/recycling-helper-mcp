import { readFileSync } from "node:fs";

import {
  findBestWasteItem,
  findBulkyWasteFees,
  findNamedSubRegion,
  findRegionItemGuide,
  formatRegionItemGuide,
  regionalPolicies,
  resolveRegionalPolicy,
  resolveRegionalPolicyIn,
} from "../src/data.js";
import type { RegionalPolicyData } from "../src/data.js";

type RegionEvaluationCase = {
  region: string;
  expectedStatus?: "ambiguous";
  expectedCandidateIds?: string[];
  expectedRegionId?: string;
  expectedLevel?: "district" | "metro";
  expectedBulkyApplication?: boolean;
  query?: string;
  expectedItemId?: string;
  expectedGuideContains?: string;
  expectedFeeKrw?: number;
  /**
   * 광역으로 착지했을 때 응답이 불러야 할 시·군·구 이름. 지목하지 않은 질의는
   * `null`로 적어 "되묻는 게 맞는 쪽"을 함께 고정한다. 필드를 뺀 케이스는 이
   * 갈래를 보지 않는다.
   */
  expectedNamedSubRegion?: string | null;
};

const regionEvaluationCases = JSON.parse(
  readFileSync(new URL("../src/data/region-evaluation-cases.json", import.meta.url), "utf8"),
) as RegionEvaluationCase[];

/**
 * 동명 자치구 되묻기 회귀. 서울 중구는 실데이터에 들어왔지만 부산·대구·인천 등의
 * 중구가 아직 없어서, 바로 그 이유로 서울 중구에는 맨 앞 별칭 "중구"를 달지 않았다
 * (달면 "중구"가 서울 중구로 단독 확정돼 다른 지역 주민에게 틀린 안내가 나간다).
 * 그래서 되묻기 자체는 여전히 픽스처로 고정한다. 실데이터 기반 케이스는 같은 이름의
 * 구가 둘 이상 들어오는 배치에서 함께 넣는다.
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

// 픽스처만으로는 실데이터의 별칭 충돌을 못 잡는다. 아래 두 검사는 실제
// region-policies.json을 같은 리졸버에 통과시킨다. 예전 `evaluate-data.mjs`는
// .mjs라 `src/data.ts`를 못 불러와 리졸버를 복제해 뒀는데, 사본이 어긋나면 평가가
// 런타임과 다른 답을 통과시킨다(실제로 되묻기 후보 개수 제한이 한쪽에만 있었다).
// 지역 검사가 먼저 이리로 옮겨 왔고, 품목 검사도 Phase 7에서 `evaluate-data.ts`로
// 옮겨 가 이제 양쪽 모두 `src/data.ts`를 그대로 쓴다.

// R2의 회귀 방어선. 지역의 이름·별칭을 그대로 입력했을 때 그 지역으로
// 확정되거나 최소한 되묻기 후보에는 들어가야 한다. 어느 쪽도 아니면 그 별칭은
// 다른 지역에 뺏긴 것이고, 사용자에게는 조용히 틀린 지역 안내가 나간다.
for (const region of regionalPolicies) {
  for (const alias of [region.name, ...region.aliases, ...(region.districtAliases ?? [])]) {
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

// 위 루프의 반대 방향. 별칭을 "그 지역으로 가는지"만 보면, 전국에 여럿인 이름을
// 한 지역이 독차지하는 사고는 통과한다 — 실제로 서울 중구를 넣으면서 `중구`와
// `jung-gu`가 서울 중구로 단독 확정돼, 부산 중구 주민이 서울 중구의 전화번호와
// 조례 수수료표를 받게 돼 있었다. 같은 이름의 자치구가 여럿인 이름은 광역 접두어
// 없이 자치구로 확정되면 안 된다. 확정을 안 하는 한 되묻기든 폴백이든 상관없다.
// 목록을 늘릴 때는 "서울에 있는 이름"이 아니라 **전국에 둘 이상 있는 이름**을 기준으로
// 본다. 강서구가 그래서 빠져 있었다 — 서울에만 있는 줄 알기 쉽지만 부산에도 있다.
const nationallyAmbiguousDistrictQueries = [
  "중구",
  "jung-gu",
  "동구",
  "dong-gu",
  "서구",
  "seo-gu",
  "남구",
  "nam-gu",
  "북구",
  "buk-gu",
  "강서구",
  "gangseo-gu",
];

for (const query of nationallyAmbiguousDistrictQueries) {
  const resolution = resolveRegionalPolicy(query);
  // level을 district로 좁혀 보면 안 된다. 광역 별칭에 `서구`를 달면 metro 강도로
  // 확정되는데, 그때도 다른 광역 주민이 남의 안내를 받는 것은 똑같다. 확정 자체를 막는다.
  if (resolution.status === "match") {
    failures.push(
      `"${query}" confidently resolved to ${resolution.match.region.id} (level: ${resolution.match.level}); ` +
        "이 이름은 여러 광역시에 있어 광역 접두어 없이 확정하면 안 된다 — 자치구든 광역 별칭이든 마찬가지다",
    );
  }
}

/**
 * 광역 별칭 쪽의 같은 함정. 미등록 시·군 이름을 광역 별칭으로 달아 폴백을 열어줄 때,
 * **광역이 유일하게 정해지는 이름만** 달 수 있다. 아래 이름들은 그 조건을 못 채운다 —
 * 고성군은 강원과 경남에 하나씩 있고, 광주시는 경기도의 시이면서 광주광역시와 같은 표기다.
 * 어느 한쪽에 달면 다른 쪽 주민이 남의 광역 안내를 조용히 받는다. 확정만 안 하면
 * 되묻기든 전국 폴백이든 상관없다.
 */
const metroAmbiguousNames = ["고성군", "고성"];

// `광주시`는 위 목록에 넣어봐야 검사가 되지 않는다 — 광주광역시가 원래 이 이름을
// 별칭으로 갖고 있어 항상 확정되고, 예외 처리를 달면 어떤 경우에도 실패하지 않는
// 빈 검사가 된다. 대신 **경기도가 이 이름을 가져가지 않았는지**만 직접 본다.
{
  const resolution = resolveRegionalPolicy("광주시");
  const owner = resolution.status === "match" ? resolution.match.region.id : `(${resolution.status})`;
  if (owner !== "gwangju") {
    failures.push(
      `"광주시"가 ${owner}로 갔다. 이 이름은 광주광역시가 원래 갖고 있고 경기도 광주시와 표기가 같다 — ` +
        "경기도 별칭에 더하면 두 광역이 같은 이름을 물어 되묻기로 빠진다",
    );
  }
}

for (const query of metroAmbiguousNames) {
  const resolution = resolveRegionalPolicy(query);
  if (resolution.status !== "match") continue;
  failures.push(
    `"${query}" confidently resolved to ${resolution.match.region.id}; ` +
      "이 이름은 광역이 유일하게 정해지지 않아 광역 별칭으로 달면 안 된다",
  );
}

/**
 * 광역으로 착지한 뒤 **어느 시·군·구를 지목했는지**를 실데이터로 전수 확인한다.
 * 지목에 실패하면 응답은 방금 들은 이름을 다시 묻고, 잘못 지목하면 사용자가 대지도
 * 않은 지역의 상세 데이터가 없다고 답한다. 둘 다 조용히 지나가는 실패라 케이스를
 * 손으로 적는 대신 데이터를 그대로 돈다.
 */
const namingSweep = { standalone: 0, prefixed: 0 };

function checkNaming(query: string, expectedMetroId: string, expectedName: string): void {
  const resolution = resolveRegionalPolicy(query);
  if (resolution.status !== "match" || resolution.match.region.id !== expectedMetroId || resolution.match.level !== "metro") {
    const actual =
      resolution.status === "match" ? `${resolution.match.region.id}/${resolution.match.level}` : resolution.status;
    failures.push(`"${query}" resolved to ${actual}; expected ${expectedMetroId} at the metro level`);
    return;
  }

  const named = findNamedSubRegion(resolution.match.region, query);
  if (named !== expectedName) {
    failures.push(`"${query}" named ${named ?? "(none)"}; expected ${expectedName}`);
  }
}

for (const metro of regionalPolicies) {
  const districtAliases = metro.districtAliases ?? [];
  const prefixOnlyAliases = metro.prefixOnlyDistrictAliases ?? [];

  // 이름만 대도 광역이 정해지는 쪽. 착지 지역과 부르는 이름이 모두 맞아야 한다.
  for (const alias of districtAliases) {
    namingSweep.standalone += 1;
    checkNaming(alias, metro.id, alias);
  }

  // 이름만으로는 광역이 안 정해지는 쪽. 이 광역으로 확정돼서도, 이 광역이 그 이름을
  // 지목해서도 안 된다 — 맨 "중구"에 대고 "부산 중구 상세 데이터가 없다"고 답하는 게
  // 바로 이 검사가 막는 실패다. (`광주시`처럼 다른 광역이 원래 갖고 있는 표기도 있어서
  // "아무 데로도 확정되면 안 된다"로는 못 적는다. 이 광역으로만 안 가면 된다.)
  for (const alias of prefixOnlyAliases) {
    const resolution = resolveRegionalPolicy(alias);
    if (resolution.status === "match" && resolution.match.region.id === metro.id) {
      failures.push(
        `"${alias}" confidently resolved to ${metro.id}; 이 이름은 광역 접두어 없이 이 광역으로 가면 안 된다`,
      );
    }
    const named = findNamedSubRegion(metro, alias);
    if (named !== undefined) {
      failures.push(`"${alias}" alone made ${metro.id} name ${named}; 광역 접두어가 없으면 지목하지 않아야 한다`);
    }
  }

  // 광역 표기가 앞에 붙은 조합. 여기서는 두 목록 모두 이름을 불러야 한다 —
  // 앞의 광역명이 이미 광역을 확정했으므로 남은 조각을 지목하는 데 위험이 없다.
  for (const alias of [...districtAliases, ...prefixOnlyAliases]) {
    for (const metroName of [metro.name, ...metro.aliases]) {
      namingSweep.prefixed += 1;
      checkNaming(`${metroName} ${alias}`, metro.id, alias);
    }
  }
}

// 위 스윕의 반대편. 광역 표기 뒤에 아무 말이나 붙었다고 지목하면, 있지도 않은 지역을
// 두고 "상세 데이터가 없다"고 답하게 된다 — 되묻는 지금보다 나쁘다. 목록에 있는
// 이름에만 걸려야 한다.
const nonDistrictRemainders: Array<{ query: string; metroId: string }> = [
  { query: "부산 어쩌구", metroId: "busan" },
  { query: "부산 그런구", metroId: "busan" },
  // 강남구는 서울에만 있다. 부산 질의에서 서울 자치구 이름을 지목하면 안 된다.
  { query: "부산 강남구", metroId: "busan" },
];

for (const { query, metroId } of nonDistrictRemainders) {
  const resolution = resolveRegionalPolicy(query);

  // 그 광역으로 풀리는 것이 이 케이스의 전제다. 전제가 깨지면 아래 단언은 볼 것이
  // 없어지는데, 건너뛰면 검사가 사라진 채로 스위트는 그대로 통과한다 — 없는
  // 검사보다 통과하는 척하는 검사가 나쁘다. 그래서 실패로 남긴다. 착지가
  // 달라졌다는 사실 자체가 손봐야 할 신호다.
  if (resolution.status !== "match" || resolution.match.region.id !== metroId) {
    const landed = resolution.status === "match" ? resolution.match.region.id : resolution.status;
    failures.push(
      `"${query}" resolved to ${landed}; expected ${metroId} — 이 케이스는 그 광역으로 풀린다는 전제 위에서만 지목 여부를 볼 수 있다`,
    );
    continue;
  }

  const named = findNamedSubRegion(resolution.match.region, query);
  if (named !== undefined) {
    failures.push(`"${query}" named ${named}; 기초자치단체 이름이 아닌 조각은 지목하면 안 된다`);
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

  if (testCase.expectedNamedSubRegion !== undefined) {
    const named = findNamedSubRegion(regionMatch.region, testCase.region) ?? null;
    if (named !== testCase.expectedNamedSubRegion) {
      failures.push(
        `region "${testCase.region}" named sub-region was ${named ?? "(none)"}; expected ${testCase.expectedNamedSubRegion ?? "(none)"}`,
      );
    }
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
  // `query`를 준 케이스는 지역 안내에서 무엇이 나와야 하는지도 함께 적어야 한다.
  if (testCase.expectedGuideContains === undefined) {
    failures.push(`region case "${testCase.region}" has a query but no expectedGuideContains`);
  } else if (!guideText.includes(testCase.expectedGuideContains)) {
    failures.push(`"${testCase.region}" + "${testCase.query}" regional guide did not include "${testCase.expectedGuideContains}"`);
  }

  if (testCase.expectedFeeKrw !== undefined) {
    const fees = findBulkyWasteFees(regionMatch.region, itemMatch.item);
    if (!fees.some((fee) => fee.feeKrw === testCase.expectedFeeKrw)) {
      failures.push(`"${testCase.region}" + "${testCase.query}" bulky waste fees did not include ${testCase.expectedFeeKrw}`);
    }
  }
}

// `namedSubRegion`을 받아도 연락처를 걷어내는 건 metro 티어에서만이라는 것.
//
// 지금은 어느 호출부도 district 티어에 이 값을 넘기지 않아 런타임 경로로는 닿지
// 않는다. 그래서 여기서 직접 부른다 — 이 갈래를 다른 툴로 넓히는 순간(PR 본문에
// 후속으로 적혀 있다) 문의 전화·인터넷 신청·수수료 조회 URL이 소리 없이 사라지는데,
// 호출부만 보고 있으면 그 사고를 막을 검사가 아무 데도 없다.
{
  const district = resolveRegionalPolicy("서울 종로구");
  const sofa = findBestWasteItem("소파");
  if (district.status !== "match" || district.match.region.coverageTier === "metro" || !sofa) {
    failures.push("district-tier contact guard lost its 종로구/소파 fixture");
  } else {
    const kept = formatRegionItemGuide(sofa.item, district.match, { namedSubRegion: "종로구" });
    for (const marker of ["문의/신청 안내 전화", "인터넷 신청", "수수료 조회"]) {
      if (!kept.some((line) => line.includes(marker))) {
        failures.push(`namedSubRegion이 district 티어에서 "${marker}" 줄을 지웠다; 이 갈래는 metro 티어에서만 걷어내야 한다`);
      }
    }
  }
}

/**
 * 배출 요일·시간이 지역 데이터로 다시 스며드는 걸 막는다. 구 대표값 하나로는
 * 동과 주택 유형에 따라 갈리는 실제 기준을 맞출 수 없어 2026-08-19에 전부
 * 걷어냈는데, 지역을 새로 추가하다 보면 출처 페이지의 요일표를 그대로 옮겨
 * 적기 쉽다. 사용자에게 나가는 필드만 본다 — 출처 설명(`sources`)은 "그 페이지에
 * 요일이 있다"는 안내라 오히려 남겨야 하므로 제외한다.
 */
const CONCRETE_SCHEDULE = /[월화수목금토일]요일|\d{1,2}:\d{2}/;
for (const region of regionalPolicies) {
  const userFacing = [
    region.summary,
    ...(region.itemGuides ?? []).flatMap((guide) => [guide.summary, ...(guide.steps ?? [])]),
  ].filter((line): line is string => typeof line === "string");

  for (const line of userFacing) {
    if (CONCRETE_SCHEDULE.test(line)) {
      failures.push(`${region.name}: 확정 배출 요일·시간이 다시 들어왔다 — "${line.slice(0, 60)}"`);
    }
  }

  // 요일을 왜 안 싣는지는 `지역 요약`(summary)만 말한다. regionCoverageNote가 같은
  // 말을 하지 않는 건 이 문장이 자치구 전부에 있다는 전제 위에 서 있으므로, 지역을
  // 새로 추가할 때 빠지면 그 지역만 이유 없이 요일이 사라진 답을 받게 된다.
  if (region.coverageTier !== "metro" && !region.summary.includes("동·주택 유형별로")) {
    failures.push(`${region.name}: summary에 배출 요일을 싣지 않는 이유가 빠졌다 (자치구·시는 모두 있어야 한다)`);
  }
}

if (failures.length > 0) {
  console.error(`Region matching test failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Region matching test passed: ${expectations.length} fixture cases, ${regionEvaluationCases.length} region cases, ` +
    `${regionalPolicies.length} policies' aliases, ` +
    `${namingSweep.standalone} sub-region names, ${namingSweep.prefixed} metro-prefixed combinations`,
);
