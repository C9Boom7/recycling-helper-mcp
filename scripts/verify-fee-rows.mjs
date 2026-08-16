/**
 * 적재한 수수료 행을 조례 별표 원문과 대조한다 (Phase 6 R3 후속).
 *
 * 인제스트와 **다른 코드로 같은 표를 다시 읽어** (품명, 규격, 금액)이 제자리에 붙었는지
 * 본다. 조례 표는 여러 품목 사다리를 옆으로 늘어놓은 구조라, 한 줄로 펴는 과정에서
 * 이웃 품목의 계단이 넘어오는 사고가 실제로 있었다 — 서대문 「세탁기 / 소형(60X100
 * 미만) / 1,000원」은 고무통 값이었다.
 *
 * 표본 몇 개를 눈으로 보고 "전부 일치"라고 판단했다가 놓친 적이 있어, 적재한 행을
 * 하나도 빼지 않고 전부 대조한다.
 *
 * 실행: node scripts/verify-fee-rows.mjs <별표.hwp> <regionId>
 *   별표 파일은 `data/ordinance-raw/<regionId>.json`의 `attachment.url`에서 받는다.
 */
import { readFileSync } from "node:fs";
import { extractHwpText } from "./hwp-text.mjs";

// 표는 「연번 | 분야? | 품목 | (규격 금액)+ | 비고?」 꼴이다. 연번(1부터 증가하는 정수)으로
// 블록을 자르고, 블록 안에서 첫 (규격,금액) 앞의 마지막 낱말을 품목으로 본다.
function parseTable(text) {
  const toks = text.replace(/\r/g, "").split("\n").map((t) => t.trim()).filter(Boolean);
  const isFee = (t) => /^\d{1,3}(,\d{3})+$/.test(t) || /^\d{3,6}$/.test(t);
  const isSeq = (t, expect) => t === String(expect);
  const rows = [];
  let i = 0, seq = 1;
  while (i < toks.length && !isSeq(toks[i], 1)) i++;
  while (i < toks.length) {
    let end = i + 1;
    while (end < toks.length && !isSeq(toks[end], seq + 1)) end++;
    const block = toks.slice(i + 1, end);
    // 블록 안에서 첫 금액의 위치를 찾고, 그 앞 두 칸이 (품목, 규격)이다.
    const firstFee = block.findIndex(isFee);
    if (firstFee >= 2) {
      const name = block[firstFee - 2];
      let k = firstFee - 1;
      while (k < block.length) {
        const spec = block[k], fee = block[k + 1];
        if (!fee || !isFee(fee)) break;
        rows.push({ name, spec, fee: Number(fee.replace(/,/g, "")) });
        k += 2;
      }
    }
    seq += 1; i = end;
  }
  return rows;
}

const [file, regionId] = process.argv.slice(2);
// 검증을 읽기보다 먼저 한다. 순서가 반대면 인자를 빠뜨렸을 때 사용법 대신
// ERR_INVALID_ARG_TYPE 스택이 떨어져, 정작 이 가드를 넣은 이유가 사라진다.
if (!file || !regionId) {
  console.error("Usage: node scripts/verify-fee-rows.mjs <별표파일> <regionId>");
  process.exit(1);
}
const parsed = parseTable(await extractHwpText(readFileSync(file)));
const src = new Map();
for (const r of parsed) {
  const key = `${r.name.replace(/\s+/g, "")}|${r.spec.replace(/\s+/g, "")}`;
  src.set(key, (src.get(key) ?? new Set()).add(r.fee));
}
const fees = JSON.parse(readFileSync("src/data/bulky-waste-fees.json", "utf8")).find((s) => s.regionId === regionId);
if (!fees) {
  console.error(`${regionId}: src/data/bulky-waste-fees.json에 이 지역이 없다`);
  process.exit(1);
}
let ok = 0; const miss = [];
for (const f of fees.fees) {
  const key = `${f.itemName.replace(/\s+/g, "")}|${f.spec.replace(/\s+/g, "")}`;
  if (src.get(key)?.has(f.feeKrw)) ok++;
  else miss.push(`${f.itemName} / ${f.spec} / ${f.feeKrw}  (원문: ${[...(src.get(key) ?? [])].join(",") || "없음"})`);
}
console.log(`${regionId}: 원문 ${parsed.length}행(${src.size}종) / 우리 ${fees.fees.length}행 — 일치 ${ok}, 확인 안 됨 ${miss.length}`);
miss.slice(0, 15).forEach((m) => console.log("  ? " + m));
// 대조 실패를 종료 코드로 알린다. 0으로 끝나면 이 도구로 아무것도 막을 수 없다.
if (miss.length > 0) process.exitCode = 1;
