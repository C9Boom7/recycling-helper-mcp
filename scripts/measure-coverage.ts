// 커버리지 측정: 질문 백로그 + 빈출 발화 세트에 대한 resolveWasteItem 결과 분포를 출력한다.
// 실행: pnpm measure:coverage  (tsx로 실행 — 런타임 매칭 로직을 그대로 사용한다)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveWasteItem } from "../src/data.ts";

const backlogPath = fileURLToPath(new URL("../src/data/question-backlog.json", import.meta.url));
const utterancesPath = fileURLToPath(new URL("../logs/coverage-expansion-queries.example.jsonl", import.meta.url));

type QuerySet = { label: string; queries: string[] };

const backlog = JSON.parse(readFileSync(backlogPath, "utf8")) as Array<{ query: string }>;
const utterances = readFileSync(utterancesPath, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as { query: string });

const sets: QuerySet[] = [
  { label: "question-backlog", queries: backlog.map((entry) => entry.query) },
  { label: "coverage-expansion-utterances", queries: utterances.map((entry) => entry.query) },
];

for (const set of sets) {
  const counts: Record<string, number> = {};
  const notFound: string[] = [];
  for (const query of set.queries) {
    const resolution = resolveWasteItem(query);
    counts[resolution.status] = (counts[resolution.status] ?? 0) + 1;
    if (resolution.status === "not_found") notFound.push(query);
  }
  const total = set.queries.length;
  const notFoundCount = counts.not_found ?? 0;
  console.log(`## ${set.label} (${total} queries)`);
  for (const [status, count] of Object.entries(counts).sort()) {
    console.log(`- ${status}: ${count}`);
  }
  console.log(`- not_found rate: ${((notFoundCount / total) * 100).toFixed(1)}%`);
  if (notFound.length > 0) {
    console.log(`- not_found queries: ${notFound.join(" | ")}`);
  }
  console.log("");
}
