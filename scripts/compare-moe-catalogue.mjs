/**
 * 기후에너지환경부 분리배출 품목 사전(getItem 전수 수집본)을 우리 카탈로그와 대조한다.
 *
 * 입력: logs/moe-api/catalogue.json — `node scripts/probe-moe-recycling-api.mjs item --enumerate`가 만든다.
 * 사전 준비: pnpm build (dist/data.js의 resolveWasteItem을 쓴다 — 실제 런타임 매처로 재야 의미가 있다).
 *
 * 그쪽 품목명 하나하나를 우리 매처에 넣어 세 가지를 뽑는다.
 *   1. 매칭률 — 공식 사전 기준 커버리지(match / ambiguous / not_found)
 *   2. 배출 갈래 불일치 — 매칭됐는데 그쪽 배출방법 라벨과 우리 disposalType의 거친 갈래가 하나도 안 겹치는 것.
 *      과매칭(엉뚱한 품목으로 확정)과 정책 차이(같은 품목인데 결론이 다름)가 여기 섞여 나오므로 사람이 가른다.
 *   3. not_found 목록 — 그쪽 라벨별로 묶어 커버리지 구멍을 본다.
 *
 * 출력: logs/moe-api/compare.json (전체 행), stdout 요약.
 * 실행: node scripts/compare-moe-catalogue.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWasteItem } from "../dist/data.js";

const CATALOGUE = "logs/moe-api/catalogue.json";
const OUT = "logs/moe-api/compare.json";

const cat = JSON.parse(readFileSync(resolve(CATALOGUE), "utf8")).items;

/** 그쪽 배출방법 라벨 → 거친 갈래. 라벨은 쉼표로 여러 개가 오므로 집합이다. */
function theirBuckets(label) {
  const b = new Set();
  if (/종량제봉투/.test(label)) b.add("general");
  if (/대형폐기물/.test(label)) b.add("bulky");
  if (/소형전기전자제품 수거함|무상방문수거|전지 수거함|형광등 수거함/.test(label)) b.add("ewaste");
  if (/음식물류폐기물/.test(label)) b.add("food");
  if (/불연성 종량제 특수마대/.test(label)) b.add("nonburnable");
  if (/폐의약품|생활계유해|전문처리|역회수|폐식용유|아이스팩|의류 수거함|공동집하장|지자체 배출방법|전용 봉투/.test(label)) b.add("special");
  // 위에서 특수 수거함으로 분류한 것을 뺀 나머지 "수거함"은 재활용 분리배출이다.
  const stripped = label.replace(/소형전기전자제품 수거함|전지 수거함|형광등 수거함|폐의약품 수거함|생활계유해폐기물 수거함|폐식용유 수거함|아이스팩 수거함|의류 수거함/g, "");
  if (/수거함|재활용폐기물|보증금 환급|종류별 분리배출|무인회수기/.test(stripped)) b.add("recycle");
  return b;
}

/** 우리 disposalType → 거친 갈래. 문자열 부분 일치라 새 값이 생기면 여기도 본다. */
function ourBuckets(disposalType) {
  const b = new Set();
  if (/general|safe_wrap/.test(disposalType)) b.add("general");
  if (/bulky/.test(disposalType)) b.add("bulky");
  if (/recycle|paper|glass|plastic|metal|container|case|deposit|lens/.test(disposalType)) b.add("recycle");
  if (/small_electronics|free_visit|takeback|special_collection/.test(disposalType)) b.add("ewaste");
  if (/food/.test(disposalType)) b.add("food");
  if (/nonburnable/.test(disposalType)) b.add("nonburnable");
  if (/special|hazardous|region_specific|collection_point|reuse|construction|manufacturer/.test(disposalType)) b.add("special");
  return b;
}

const rows = [];
const stat = { match: 0, ambiguous: 0, not_found: 0 };
for (const { itemNm, dschgMthd } of cat) {
  const r = resolveWasteItem(itemNm);
  stat[r.status] = (stat[r.status] ?? 0) + 1;
  const row = { theirs: itemNm, theirMethod: dschgMthd, status: r.status };
  if (r.status === "match") {
    const item = r.match.item;
    const tb = theirBuckets(dschgMthd);
    const ob = ourBuckets(item.disposalType);
    Object.assign(row, {
      ours: item.name,
      ourId: item.id,
      ourType: item.disposalType,
      matchedBy: r.match.matchedBy,
      score: r.match.score,
      theirBuckets: [...tb].join("+"),
      ourBuckets: [...ob].join("+"),
      overlap: [...tb].some((x) => ob.has(x)),
    });
  } else if (r.status === "ambiguous") {
    row.candidates = r.candidates.slice(0, 3).map((c) => c.item?.name ?? c.name);
  }
  rows.push(row);
}
writeFileSync(resolve(OUT), JSON.stringify(rows, null, 2));

const matched = rows.filter((r) => r.status === "match");
const conflicts = matched.filter((r) => !r.overlap);
console.log(`그쪽 사전 ${cat.length}개 → match ${stat.match} / ambiguous ${stat.ambiguous} / not_found ${stat.not_found}`);
console.log(`매칭 ${matched.length} 중 갈래 겹침 ${matched.length - conflicts.length}, 안 겹침 ${conflicts.length}`);
console.log("\n== 갈래가 안 겹치는 매칭 — 과매칭인지 정책 차이인지 사람이 가른다 ==");
for (const r of conflicts) console.log(`${r.theirs} [${r.theirMethod}] → ${r.ours} (${r.ourType}) via "${r.matchedBy}"`);
console.log("\n== ambiguous ==");
for (const r of rows.filter((x) => x.status === "ambiguous")) console.log(`${r.theirs} [${r.theirMethod}] → ${r.candidates.join(" / ")}`);
const byMethod = new Map();
for (const r of rows.filter((x) => x.status === "not_found")) byMethod.set(r.theirMethod, [...(byMethod.get(r.theirMethod) ?? []), r.theirs]);
console.log("\n== not_found — 그쪽 라벨별 ==");
for (const [method, names] of [...byMethod.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`[${method}] ${names.length}: ${names.join(", ")}`);
console.log(`\n저장: ${OUT}`);
