/**
 * Kiwi를 넣었을 때 치르는 값: 기동 시간, 질의당 지연, 메모리.
 *
 * 실행: KIWI_SPIKE_DIR=/path/to/kiwi-spike pnpm tsx scripts/spike/measure-kiwi-cost.ts
 */
import { resolveWasteItem, wasteItems } from "../../src/data.ts";
import { setQueryTokenizer, splitAndStripParticles } from "../../src/korean/query-tokenizer.ts";
import { UTTERANCE_TEMPLATES } from "../utterance-templates.ts";
import { createKiwiTokenizer } from "./kiwi-tokenizer.ts";

const queries = wasteItems.flatMap((item) => UTTERANCE_TEMPLATES.map((template) => template.build(item.name)));

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function timeResolve(label: string): void {
  // 워밍업 — 첫 회 JIT 비용을 지연 분포에서 뺀다.
  for (const query of queries.slice(0, 200)) resolveWasteItem(query);

  const samples: number[] = [];
  for (const query of queries) {
    const started = process.hrtime.bigint();
    resolveWasteItem(query);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  console.log(
    `- ${label.padEnd(24)} 평균 ${mean.toFixed(2)}ms  p50 ${percentile(samples, 50).toFixed(2)}ms  p95 ${percentile(samples, 95).toFixed(2)}ms  p99 ${percentile(samples, 99).toFixed(2)}ms`,
  );
}

const rssMb = (): number => Math.round(process.memoryUsage().rss / 1048576);

console.log(`# 비용 측정 (질의 ${queries.length}건)\n`);
console.log(`## 질의당 지연 (resolveWasteItem 전체)`);
console.log(`(기준선 RSS ${rssMb()}MB)`);
setQueryTokenizer(splitAndStripParticles);
timeResolve("규칙 기반 (현재 기본값)");

const beforeLoadRss = rssMb();
const kiwi = await createKiwiTokenizer({ userDictionary: true });
setQueryTokenizer(kiwi.tokenizer);
console.log(`(Kiwi 로드 ${kiwi.loadMs}ms, RSS ${beforeLoadRss}MB -> ${rssMb()}MB)`);
timeResolve("Kiwi");

setQueryTokenizer(splitAndStripParticles);
