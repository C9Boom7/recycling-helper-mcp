/**
 * 규칙 기반 토크나이저 vs Kiwi 형태소 분석기 비교 — 도입 검토용 스파이크.
 *
 * 실행:
 *   KIWI_SPIKE_DIR=/path/to/kiwi-spike pnpm tsx scripts/spike/measure-with-kiwi.ts
 *
 * 세 세트를 같은 리졸버로 돌려 세 구성을 비교한다.
 *   1. `evaluation-cases.json` 324건 — 회귀 방어선. 여기서 깨지면 도입 불가.
 *   2. 보류 발화 3,240건 — 조사·어미 내성. 규칙 기반이 지금 96.4%.
 *   3. 질문 백로그 + 발화 로그 161건 — 실제 질의 분포에서의 not_found.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveWasteItem, wasteItems } from "../../src/data.ts";
import { setQueryTokenizer, splitAndStripParticles, splitOnNonWordBoundary } from "../../src/korean/query-tokenizer.ts";
import { UTTERANCE_TEMPLATES } from "../utterance-templates.ts";
import { createKiwiTokenizer } from "./kiwi-tokenizer.ts";

type EvaluationCase = { query: string; expectedItemId: string };

const read = <T>(relative: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")) as T;

const evaluationCases = read<EvaluationCase[]>("../../src/data/evaluation-cases.json");
const backlog = read<Array<{ query: string }>>("../../src/data/question-backlog.json");
const utterances = readFileSync(fileURLToPath(new URL("../../logs/coverage-expansion-queries.example.jsonl", import.meta.url)), "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as { query: string });

/**
 * 정답 품목을 아는 질의만 점수로 센다. 백로그·로그 질의에는 정답 라벨이 없어서
 * "확정됐다"를 "맞혔다"로 치면 안 된다 — 실제로 이 스파이크에서 "약과 포장지는
 * 폐의약품 수거함에 넣어?"가 not_found에서 의약품 확정으로 바뀐 걸 개선으로
 * 셌는데, 약과는 과자라 그건 틀린 답이다. 라벨 없는 세트는 상태 분포만 찍고
 * 바뀐 질의를 사람이 보게 나열한다.
 */
type Probe = { query: string; expected?: string };

const SETS: Array<{ label: string; probes: Probe[] }> = [
  {
    label: "evaluation-cases",
    probes: evaluationCases.map((testCase) => ({ query: testCase.query, expected: testCase.expectedItemId })),
  },
  {
    label: "held-out-utterances",
    probes: wasteItems.flatMap((item) =>
      UTTERANCE_TEMPLATES.map((template) => ({ query: template.build(item.name), expected: item.id })),
    ),
  },
  {
    label: "backlog+logs",
    probes: [...backlog, ...utterances].map((entry) => ({ query: entry.query })),
  },
];

/** 정답 라벨이 있는 세트만 정확도로 읽는다. */
const LABELLED = new Set(["evaluation-cases", "held-out-utterances"]);

type Verdict = "ok" | "wrong" | "ambiguous" | "not_found";

function judge(probe: Probe): { verdict: Verdict; detail: string } {
  const resolved = resolveWasteItem(probe.query);
  if (resolved.status === "not_found") return { verdict: "not_found", detail: "-" };
  if (resolved.status === "ambiguous") {
    return { verdict: "ambiguous", detail: resolved.candidates.map((candidate) => candidate.item.id).join(",") };
  }

  const matchedId = resolved.match.item.id;
  if (probe.expected === undefined || matchedId === probe.expected) return { verdict: "ok", detail: matchedId };
  return { verdict: "wrong", detail: `${matchedId} (${resolved.match.matchKind}, ${resolved.match.score})` };
}

type Run = { label: string; results: Map<string, Map<string, { verdict: Verdict; detail: string }>>; elapsedMs: number };

function runAll(label: string): Run {
  const results = new Map<string, Map<string, { verdict: Verdict; detail: string }>>();
  const started = Date.now();
  for (const set of SETS) {
    const perQuery = new Map<string, { verdict: Verdict; detail: string }>();
    for (const probe of set.probes) perQuery.set(probe.query, judge(probe));
    results.set(set.label, perQuery);
  }

  return { label, results, elapsedMs: Date.now() - started };
}

function summarize(run: Run): void {
  console.log(`\n## ${run.label}  (전체 ${run.elapsedMs}ms)`);
  for (const set of SETS) {
    const perQuery = run.results.get(set.label)!;
    const counts: Record<Verdict, number> = { ok: 0, wrong: 0, ambiguous: 0, not_found: 0 };
    for (const result of perQuery.values()) counts[result.verdict] += 1;
    const total = perQuery.size;
    if (LABELLED.has(set.label)) {
      const rate = ((counts.ok / total) * 100).toFixed(1);
      console.log(
        `- ${set.label.padEnd(20)} ok ${String(counts.ok).padStart(4)}/${total} (${rate.padStart(5)}%)  wrong ${counts.wrong}  ambiguous ${counts.ambiguous}  not_found ${counts.not_found}`,
      );
    } else {
      console.log(
        `- ${set.label.padEnd(20)} 확정 ${String(counts.ok).padStart(4)}/${total} (정답 라벨 없음 — 아래 목록을 사람이 확인)  ambiguous ${counts.ambiguous}  not_found ${counts.not_found}`,
      );
    }
  }
}

function diff(before: Run, after: Run, limit = 25): void {
  console.log(`\n## 차이: ${before.label} -> ${after.label}`);
  for (const set of SETS) {
    const beforeResults = before.results.get(set.label)!;
    const afterResults = after.results.get(set.label)!;
    const fixed: string[] = [];
    const broken: string[] = [];

    for (const [query, beforeResult] of beforeResults) {
      const afterResult = afterResults.get(query)!;
      if (beforeResult.verdict === afterResult.verdict && beforeResult.detail === afterResult.detail) continue;
      const line = `"${query}": ${beforeResult.verdict}(${beforeResult.detail}) -> ${afterResult.verdict}(${afterResult.detail})`;

      if (!LABELLED.has(set.label)) {
        // 라벨이 없으니 개선/악화를 판정하지 않는다. 바뀐 것만 모아 사람에게 넘긴다.
        fixed.push(line);
        continue;
      }

      if (afterResult.verdict === "wrong") broken.push(line);
      else if (beforeResult.verdict === "ok" && afterResult.verdict !== "ok") broken.push(line);
      else if (afterResult.verdict === "ok" && beforeResult.verdict !== "ok") fixed.push(line);
    }

    const heading = LABELLED.has(set.label) ? `개선 ${fixed.length}, 악화 ${broken.length}` : `바뀐 질의 ${fixed.length}건 (판정 보류)`;
    console.log(`\n### ${set.label}: ${heading}`);
    for (const line of broken.slice(0, limit)) console.log(`  [악화] ${line}`);
    if (broken.length > limit) console.log(`  ... 외 ${broken.length - limit}건`);
    for (const line of fixed.slice(0, limit)) console.log(`  [개선] ${line}`);
    if (fixed.length > limit) console.log(`  ... 외 ${fixed.length - limit}건`);
  }
}

// 세 구성을 모두 명시적으로 세팅한다 — 기본값이 무엇이든 비교가 흔들리지 않게.
setQueryTokenizer(splitOnNonWordBoundary);
const baseline = runAll("규칙 기반 (조사 안 뗌)");
summarize(baseline);

setQueryTokenizer(splitAndStripParticles);
const improvedRules = runAll("규칙 기반 (조사 반복 제거 — 현재 기본값)");
summarize(improvedRules);

const plain = await createKiwiTokenizer({ userDictionary: false });
setQueryTokenizer(plain.tokenizer);
const kiwiPlain = runAll("Kiwi (사용자 사전 없음)");
console.log(`\n(Kiwi 로드 ${plain.loadMs}ms)`);
summarize(kiwiPlain);

const withDict = await createKiwiTokenizer({ userDictionary: true });
setQueryTokenizer(withDict.tokenizer);
const kiwiDict = runAll("Kiwi (품목명 사용자 사전)");
console.log(`\n(Kiwi 로드 ${withDict.loadMs}ms)`);
summarize(kiwiDict);

setQueryTokenizer(splitAndStripParticles);

diff(baseline, improvedRules);
diff(baseline, kiwiDict);
diff(improvedRules, kiwiDict);
