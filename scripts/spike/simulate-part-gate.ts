/**
 * 부품어 게이트가 **기존 발화에서 발동하는지**만 미리 본다. 점수를 바꾸기 전에
 * 오발동 지점을 찾으려는 것이라, 여기서는 매칭 결과를 건드리지 않는다.
 */
import { wasteItems, normalizeText } from "../../src/data.ts";
import { particleStrippedForms } from "../../src/korean/query-tokenizer.ts";
import { UTTERANCE_TEMPLATES } from "../utterance-templates.ts";
import { PART_NOUNS } from "../part-nouns.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const names: string[] = [];
for (const item of wasteItems) for (const name of [item.name, ...item.aliases]) names.push(normalizeText(name));

function tailIsPartNoun(word: string): boolean {
  return particleStrippedForms(word).some((form) => PART_NOUNS.some((part) => form.length >= part.length && form.endsWith(part)));
}

/** 이름이 끝나는 자리 바로 뒤의 어절이 부품어로 끝나는가. */
function firesOn(query: string): string | undefined {
  const words = query.split(/[^\p{L}\p{N}]+/gu).filter(Boolean).map((word) => ({ raw: word, norm: normalizeText(word) }));
  const joined = words.map((word) => word.norm).join("");
  const offsets: number[] = [];
  let running = 0;
  for (const word of words) { offsets.push(running); running += word.norm.length; }

  for (const name of names) {
    if (!name || name.length < 2 || !joined.includes(name)) continue;
    let from = 0;
    let index = joined.indexOf(name, from);
    let firedName: string | undefined;
    let allOccurrencesFire = true;
    while (index !== -1) {
      const end = index + name.length;
      const wordIndex = offsets.findIndex((offset, i) => end > offset && end <= offset + words[i].norm.length);
      let fires = false;
      if (wordIndex !== -1) {
        const rest = words[wordIndex].norm.slice(end - offsets[wordIndex]);
        if (rest) fires = tailIsPartNoun(rest);
        else if (wordIndex + 1 < words.length) fires = tailIsPartNoun(words[wordIndex + 1].norm);
      }
      if (fires) firedName = name; else allOccurrencesFire = false;
      from = index + 1;
      index = joined.indexOf(name, from);
    }
    if (firedName && allOccurrencesFire) return firedName;
  }
  return undefined;
}

let fired = 0;
const hits: string[] = [];
for (const item of wasteItems) {
  for (const template of UTTERANCE_TEMPLATES) {
    const query = template.build(item.name);
    const name = firesOn(query);
    if (name) { fired += 1; if (hits.length < 30) hits.push(`- "${query}" (이름 "${name}")`); }
  }
}
console.log(`보류 발화 3,240건 중 게이트 발동: ${fired}건`);
hits.forEach((hit) => console.log(hit));

const casesPath = fileURLToPath(new URL("../../src/data/evaluation-cases.json", import.meta.url));
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Array<{ query: string }>;
let firedCases = 0;
const caseHits: string[] = [];
for (const testCase of cases) {
  const name = firesOn(testCase.query);
  if (name) { firedCases += 1; if (caseHits.length < 30) caseHits.push(`- "${testCase.query}" (이름 "${name}")`); }
}
console.log("");
console.log(`evaluation-cases ${cases.length}건 중 게이트 발동: ${firedCases}건`);
caseHits.forEach((hit) => console.log(hit));

/**
 * 발동 자체는 문제가 아니다. 발동한 이름 말고 **발동하지 않는 더 긴 이름**이 같은
 * 질의를 덮고 있으면 답은 그대로다. 그게 없는 질의만 실제 회귀 후보다.
 */
function survivingNames(query: string): string[] {
  const words = query.split(/[^\p{L}\p{N}]+/gu).filter(Boolean).map((word) => normalizeText(word));
  const joined = words.join("");
  const offsets: number[] = [];
  let running = 0;
  for (const word of words) { offsets.push(running); running += word.length; }

  const surviving: string[] = [];
  for (const name of names) {
    if (!name || !joined.includes(name)) continue;
    const index = joined.indexOf(name);
    const end = index + name.length;
    const wordIndex = offsets.findIndex((offset, i) => end > offset && end <= offset + words[i].length);
    let fires = false;
    if (wordIndex !== -1) {
      const rest = words[wordIndex].slice(end - offsets[wordIndex]);
      if (rest) fires = tailIsPartNoun(rest);
      else if (wordIndex + 1 < words.length) fires = tailIsPartNoun(words[wordIndex + 1]);
    }
    if (!fires) surviving.push(name);
  }
  return surviving.sort((a, b) => b.length - a.length);
}

console.log("");
console.log("## 발동한 질의에서 살아남는 이름");
const seen = new Set<string>();
for (const testCase of [...cases.map((c) => c.query), ...wasteItems.flatMap((i) => UTTERANCE_TEMPLATES.map((t) => t.build(i.name)))]) {
  if (!firesOn(testCase) || seen.has(testCase)) continue;
  seen.add(testCase);
  const surviving = survivingNames(testCase);
  if (seen.size <= 8 || surviving.length === 0) {
    console.log(`- "${testCase}" -> ${surviving.length ? surviving.slice(0, 3).join(", ") : "**없음 (회귀 후보)**"}`);
  }
}
