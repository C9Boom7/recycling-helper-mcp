/**
 * 부품 복합어 내성 측정.
 *
 * 품목명 뒤에 부품·부속을 가리키는 낱말이 붙으면 다른 물건이 된다. `모니터 받침대`는
 * 나무·플라스틱인데 모니터는 대형가전 무상방문수거고, `소파 커버`는 종량제봉투인데
 * 소파는 대형폐기물 수수료다. 그런데 지금 매칭은 질의가 품목명을 품고 있다는 이유로
 * 96~98점 확정을 내보낸다.
 *
 * `utterance-templates.ts`와 같은 방식이다 — 품목 대표명에 부품어를 기계적으로 붙여
 * 세트를 만든다. 사람이 고른 문장이 아니라서 규칙을 여기 맞춰 튜닝한 적이 없다.
 *
 * 결과는 세 갈래로 센다.
 *  - covered   : 복합어 자체가 등록된 이름·별칭이다. 그 품목이 나와야 한다(회귀 방어).
 *  - tail_item : 꼬리가 등록 품목이다. 꼬리 쪽이 나와야 한다(`가위 칼날` -> knife_blade).
 *  - open      : 어느 쪽도 등록되지 않았다. 앞 품목 확정은 오답이다.
 *
 * 마지막 canary 세트는 반대 방향을 본다. 부품어를 너무 넓게 잡으면 멀쩡한 발화가
 * 깨지는데, 그게 이 변경의 진짜 위험이다.
 */
import { resolveWasteItem, wasteItems, normalizeText } from "../src/data.ts";
import { PART_NOUNS } from "./part-nouns.ts";

const verbose = process.argv.includes("--verbose");

const nameIndex = new Map<string, string>();
for (const item of wasteItems) {
  for (const name of [item.name, ...item.aliases]) {
    nameIndex.set(normalizeText(name), item.id);
  }
}

type Bucket = "covered" | "tail_item" | "open";
type Outcome = "base_item" | "expected_item" | "other_item" | "ambiguous" | "not_found";

const tally = new Map<Bucket, Map<Outcome, number>>();
const byPart = new Map<string, { open: number; baseConfirmed: number }>();
const examples: string[] = [];

function bump(bucket: Bucket, outcome: Outcome): void {
  const row = tally.get(bucket) ?? new Map<Outcome, number>();
  row.set(outcome, (row.get(outcome) ?? 0) + 1);
  tally.set(bucket, row);
}

for (const item of wasteItems) {
  for (const part of PART_NOUNS) {
    const query = `${item.name} ${part}`;
    const compoundId = nameIndex.get(normalizeText(query));
    const tailId = nameIndex.get(normalizeText(part));
    const bucket: Bucket = compoundId ? "covered" : tailId ? "tail_item" : "open";
    const expectedId = compoundId ?? tailId;

    const resolution = resolveWasteItem(query);
    let outcome: Outcome;
    if (resolution.status === "ambiguous") {
      outcome = "ambiguous";
    } else if (resolution.status === "not_found") {
      outcome = "not_found";
    } else if (resolution.match.item.id === expectedId) {
      outcome = "expected_item";
    } else if (resolution.match.item.id === item.id) {
      outcome = "base_item";
    } else {
      outcome = "other_item";
    }

    bump(bucket, outcome);

    if (bucket === "open") {
      const row = byPart.get(part) ?? { open: 0, baseConfirmed: 0 };
      row.open += 1;
      if (outcome === "base_item") row.baseConfirmed += 1;
      byPart.set(part, row);
    }

    if (verbose && outcome === "base_item" && examples.length < 40) {
      examples.push(`- "${query}" -> ${item.id}`);
    }
  }
}

const total = wasteItems.length * PART_NOUNS.length;
console.log(`# 부품 복합어 내성 (${wasteItems.length} 품목 x ${PART_NOUNS.length} 부품어 = ${total})`);
console.log("");
console.log("| 갈래 | 기대 품목 | 앞 품목 확정 | 다른 품목 | 되묻기 | not_found |");
console.log("|---|---|---|---|---|---|");
for (const bucket of ["covered", "tail_item", "open"] as Bucket[]) {
  const row = tally.get(bucket) ?? new Map<Outcome, number>();
  const get = (outcome: Outcome): number => row.get(outcome) ?? 0;
  console.log(
    `| ${bucket} | ${get("expected_item")} | ${get("base_item")} | ${get("other_item")} | ${get("ambiguous")} | ${get("not_found")} |`,
  );
}

console.log("");
console.log("## 부품어별 — open 갈래에서 앞 품목을 확정한 비율");
const sorted = [...byPart.entries()].sort((a, b) => b[1].baseConfirmed - a[1].baseConfirmed);
for (const [part, row] of sorted) {
  const rate = row.open === 0 ? 0 : (row.baseConfirmed / row.open) * 100;
  console.log(`- ${part.padEnd(6)} ${String(row.baseConfirmed).padStart(4)}/${String(row.open).padEnd(4)} ${rate.toFixed(1)}%`);
}

/**
 * 부품어를 문자열 꼬리로만 보면 용언 활용형에 걸린다 — `소파 살 거예요`의 `살`,
 * `이불 줄 거예요`의 `줄`. 그래서 1글자 부품어는 목록에 넣지 않았고, 넣지 않았다는
 * 사실을 여기서 회귀로 고정한다. 아래는 전부 지금 답이 유지돼야 한다.
 */
const CANARIES: Array<{ query: string; expectId: string }> = [
  { query: "소파 살 거예요", expectId: "sofa" },
  { query: "소파 살까요?", expectId: "sofa" },
  { query: "소파 어떻게 버려요", expectId: "sofa" },
  { query: "이불 줄 거예요", expectId: "blanket" },
  { query: "우산살 버리는 법", expectId: "umbrella" },
  { query: "냄비뚜껑 어떻게 버려요", expectId: "pot_glass_lid" },
  { query: "정수기 필터 버리는 법", expectId: "water_purifier_filter" },
  { query: "변기커버 분리수거 되나요?", expectId: "toilet_seat_cover" },
  { query: "침대 프레임 버리는 법", expectId: "bed_frame" },
  { query: "샤워기 호스 어떻게 버려요", expectId: "shower_head" },
  { query: "다리미 받침대 버리는 법", expectId: "ironing_board" },
  { query: "에어컨 실외기 어떻게 버려요", expectId: "air_conditioner" },
];

console.log("");
console.log("## canary — 지금 답이 유지돼야 하는 발화");
let canaryFails = 0;
for (const canary of CANARIES) {
  const resolution = resolveWasteItem(canary.query);
  const got = resolution.status === "match" ? resolution.match.item.id : resolution.status;
  const ok = got === canary.expectId;
  if (!ok) canaryFails += 1;
  console.log(`- ${ok ? "OK  " : "FAIL"} "${canary.query}" -> ${got}${ok ? "" : ` (기대 ${canary.expectId})`}`);
}
console.log("");
console.log(`canary ${CANARIES.length - canaryFails}/${CANARIES.length}`);

if (verbose && examples.length > 0) {
  console.log("");
  console.log("## open 갈래에서 앞 품목을 확정한 예");
  examples.forEach((example) => console.log(example));
}
