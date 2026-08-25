/**
 * 품목 평가 케이스 검증.
 *
 * 리졸버를 복제하지 않고 `src/data.ts`의 `resolveWasteItem`을 그대로 불러 쓴다.
 * 이전 `evaluate-data.mjs`는 4분기짜리 자체 구현을 갖고 있었는데, Phase 1의
 * 자모 매칭·짧은 별칭 독립 토큰 검사와 Phase 7의 수식어 배제가 들어오면서
 * 실제 서버와 판정이 갈렸다 — "컴퓨터 어떻게 버리나요"를 서버는 컴퓨터로
 * 확정하는데 평가는 이불("요" 별칭)로 판정하는 식이었다. 평가가 실동작을
 * 검증하지 못하면 개선이 실패로 보이고 실제 오답이 통과한다.
 *
 * 지역 케이스가 `test-region-matching.ts`에서 같은 이유로 먼저 옮겨졌고,
 * 이 스크립트는 품목 쪽을 같은 기준에 맞춘 것이다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inferMaterialCategories, isReservedQuery, resolveWasteItem, wasteItems } from "../src/data.js";

type EvaluationCase = {
  query: string;
  expectedItemId: string;
  expectedDisposalType: string;
  notes?: string;
};

const casesPath = fileURLToPath(new URL("../src/data/evaluation-cases.json", import.meta.url));
const evaluationCases = JSON.parse(readFileSync(casesPath, "utf8")) as EvaluationCase[];

const failures: string[] = [];
const itemIds = new Set(wasteItems.map((item) => item.id));
const caseCountsByItemId = new Map<string, number>();

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
  const resolved = resolveWasteItem(testCase.query);

  if (resolved.status === "not_found") {
    failures.push(`"${testCase.query}" did not match any item; expected ${testCase.expectedItemId}`);
    continue;
  }

  // 평가 케이스는 확정 매칭을 기대한다. 되묻기가 정답인 포괄어 질의는 애초에
  // 여기 두지 않고 mcp-answer-cases의 ambiguous 케이스로 고정한다.
  if (resolved.status === "ambiguous") {
    const candidates = resolved.candidates.map((candidate) => candidate.item.id).join(", ");
    failures.push(`"${testCase.query}" was ambiguous (${candidates}); expected ${testCase.expectedItemId}`);
    continue;
  }

  const { item, matchedBy, matchKind, score } = resolved.match;

  if (item.id !== testCase.expectedItemId) {
    failures.push(
      `"${testCase.query}" matched ${item.id} by "${matchedBy}" (${matchKind}, ${score}); expected ${testCase.expectedItemId}`,
    );
  }

  if (item.disposalType !== testCase.expectedDisposalType) {
    failures.push(
      `"${testCase.query}" matched ${item.id} with disposalType ${item.disposalType}; expected ${testCase.expectedDisposalType}`,
    );
  }
}

// 예약어(카테고리어·재질 이름·가스레인지 비매칭 복합어)는 매칭 맨 앞에서 질의를 끊는다.
// 품목명이나 별칭이 예약어에 걸리면 그 품목은 exact 매칭에 닿기도 전에 잘려 **확정될 수
// 없다**(카테고리어는 아예 검색에서 사라진다). 데이터만 봐서는 드러나지 않는 결합이라
// 여기서 막는다. 가스레인지 후드·받침장을 나중에 별도 품목으로 세우면 여기서 걸린다.
for (const item of wasteItems) {
  for (const label of [item.name, ...(item.aliases ?? [])]) {
    if (isReservedQuery(label)) {
      failures.push(
        `${item.id}의 "${label}"이(가) 예약어 게이트에 걸립니다 — 이 품목은 검색에서 확정될 수 없습니다. 별칭을 바꾸거나 게이트에서 빼세요.`,
      );
    }
  }
}

// not_found 폴백의 재질 추정. 매칭 게이트가 막은 질의("소파 커버"는 소파가 아니다)를
// 부분 문자열 스캔이 되살리지 않아야 하고, 그 차단이 진짜 재질 단서까지 죽여서도 안 된다.
// e2e 케이스(mcp-answer-cases의 part_compound_*)는 응답 문구만 보므로, 추정 갈래
// 자체는 여기서 표로 고정한다.
const materialInferenceExpectations: Array<{ query: string; expected: string[] }> = [
  { query: "소파 커버", expected: [] },
  { query: "소파 커버 버리는 법", expected: [] }, // 꼬리 어절이 부품어가 아니어도 게이트 판정을 따라 막힌다
  { query: "가스레인지 후드", expected: [] }, // 부품어가 아니라 전용 게이트 경유
  { query: "알약 포장재 커버", expected: [] }, // 삼킴 구간(isSwallowedByGatedSpan) 경유
  { query: "모니터 받침대", expected: [] },
  { query: "원목 받침대", expected: [] }, // 게이트와 별개로 "받침대"의 침대 오인은 lookbehind가 막는다
  { query: "노트북 커버", expected: [] }, // 되살아나는 갈래가 bulky·hazardous만이 아니라는 증거
  { query: "2층 침대", expected: ["bulky"] }, // lookbehind가 진짜 침대를 죽이지 않는다
  { query: "이불 커버", expected: [] }, // 전면 차단의 대가 — 우연히 맞던 소프트 추정도 메뉴로 내린다
];

for (const { query, expected } of materialInferenceExpectations) {
  const actual = inferMaterialCategories(query);
  if (actual.length !== expected.length || actual.some((category, index) => category !== expected[index])) {
    failures.push(
      `inferMaterialCategories("${query}") = [${actual.join(", ")}]; expected [${expected.join(", ")}]`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Data evaluation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Data evaluation passed: ${evaluationCases.length} item cases, ${materialInferenceExpectations.length} fallback inference cases (resolver: src/data.ts)`,
);
