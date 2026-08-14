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
import { resolveWasteItem, wasteItems } from "../src/data.js";

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

if (failures.length > 0) {
  console.error(`Data evaluation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Data evaluation passed: ${evaluationCases.length} item cases (resolver: src/data.ts)`);
