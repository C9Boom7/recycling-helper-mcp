/**
 * 보류 발화 세트로 현재 매칭기의 조사·어미 내성을 잰다.
 *
 * 실행: pnpm measure:utterances [--verbose]
 */
import { resolveWasteItem, wasteItems } from "../src/data.ts";
import { UTTERANCE_TEMPLATES } from "./utterance-templates.ts";

const verbose = process.argv.includes("--verbose");

type Outcome = "match" | "wrong" | "ambiguous" | "not_found";

const outcomeByTemplate = new Map<string, Record<Outcome, number>>();
const failures: Array<{ template: string; query: string; expected: string; got: string }> = [];

for (const template of UTTERANCE_TEMPLATES) {
  outcomeByTemplate.set(template.id, { match: 0, wrong: 0, ambiguous: 0, not_found: 0 });
}

for (const item of wasteItems) {
  for (const template of UTTERANCE_TEMPLATES) {
    const query = template.build(item.name);
    const resolved = resolveWasteItem(query);
    const counts = outcomeByTemplate.get(template.id)!;

    let outcome: Outcome;
    let got: string;
    if (resolved.status === "not_found") {
      outcome = "not_found";
      got = "-";
    } else if (resolved.status === "ambiguous") {
      outcome = "ambiguous";
      got = resolved.candidates.map((candidate) => candidate.item.id).join(",");
    } else if (resolved.match.item.id === item.id) {
      outcome = "match";
      got = resolved.match.item.id;
    } else {
      outcome = "wrong";
      got = `${resolved.match.item.id} (${resolved.match.matchKind}, ${resolved.match.score})`;
    }

    counts[outcome] += 1;
    if (outcome !== "match") failures.push({ template: template.id, query, expected: item.id, got });
  }
}

const total = wasteItems.length * UTTERANCE_TEMPLATES.length;
const totals: Record<Outcome, number> = { match: 0, wrong: 0, ambiguous: 0, not_found: 0 };
for (const counts of outcomeByTemplate.values()) {
  for (const key of Object.keys(totals) as Outcome[]) totals[key] += counts[key];
}

console.log(`# 보류 발화 내성 (${wasteItems.length} 품목 x ${UTTERANCE_TEMPLATES.length} 발화 = ${total})`);
console.log(`- match: ${totals.match} (${((totals.match / total) * 100).toFixed(1)}%)`);
console.log(`- wrong: ${totals.wrong}`);
console.log(`- ambiguous: ${totals.ambiguous}`);
console.log(`- not_found: ${totals.not_found}`);
console.log("");
console.log("## 발화 틀별 정확도");
for (const template of UTTERANCE_TEMPLATES) {
  const counts = outcomeByTemplate.get(template.id)!;
  const rate = ((counts.match / wasteItems.length) * 100).toFixed(1);
  console.log(
    `- ${template.id.padEnd(14)} ${rate.padStart(5)}%  (wrong ${counts.wrong}, ambiguous ${counts.ambiguous}, not_found ${counts.not_found})`,
  );
}

if (verbose && failures.length > 0) {
  console.log("");
  console.log(`## 실패 ${failures.length}건`);
  for (const failure of failures) {
    console.log(`- [${failure.template}] "${failure.query}" -> ${failure.got}; expected ${failure.expected}`);
  }
}
