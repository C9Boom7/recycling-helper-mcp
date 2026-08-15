/**
 * R2 골든셋 검증 — 조례 파서를 믿어도 되는지 확인한다 (Phase 6 R2).
 *
 * 이미 검증된 수기 데이터가 있는 4개 지역(강남·서초·송파·마포, 69행)을 조례에서
 * 다시 뽑아 `src/data/bulky-waste-fees.json`과 대조한다. 파서를 새 지역에 쓰기 전에
 * 여기부터 통과시킨다.
 *
 * **통과 조건은 금액 불일치 0건이다.** 조례에는 있는데 우리에게 없는 행은 불일치가
 * 아니라 R3의 후보이므로 세지 않는다.
 *
 * 실행: pnpm fees:verify [regionId...]
 *
 * 대조는 두 단계로 한다. 조례 원문 품명은 셀 안에서 줄바꿈되거나 여러 규격에 걸쳐
 * 병합돼 있어서, 우리가 손으로 적은 라벨과 글자까지 같기를 기대할 수 없다.
 *
 *   1. (품명, 규격)이 둘 다 맞는 행 — 가장 강한 근거다.
 *   2. 규격만 맞는 행 — 후보 금액이 하나로 모일 때만 판정에 쓴다. 예를 들어 서초구
 *      「의자 / 책상용의자(바퀴달린 의자)」는 조례에서 품명이 `책상용의자`, 규격이
 *      `(바퀴달린 의자)`로 갈려 있어 1단계로는 안 잡히지만 금액은 같다.
 *
 * 둘 다 못 잡은 행은 `미확인`으로 남긴다 — 조례에 없다는 뜻이 아니라 파서가 품명
 * 칸을 복원하지 못했다는 뜻이므로, 불일치로 셀 근거가 없다.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

import { GOLDEN_TARGETS, collectRegion } from "./fetch-ordinance-fees.mjs";

const FEES_PATH = "src/data/bulky-waste-fees.json";
const OUTPUT_DIR = "data/ordinance-raw";

/**
 * 라벨 정규화. 조례는 표 안에서 자간을 벌리려고 글자 사이에 공백을 넣고(송파구
 * `의 자`, `돗 자 리`), 괄호·가운뎃점·쉼표 표기가 우리 데이터와 제각각이다.
 * 금액을 비교하는 게 목적이므로 라벨은 최대한 느슨하게 맞춘다.
 */
function normalize(text) {
  return (text ?? "")
    .replace(/[\s()（）[\]·ㆍ・,，.\/\-~∼〜'"“”]/g, "")
    .replace(/㎡/g, "m2")
    .toLowerCase();
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

const won = (value) => `${value.toLocaleString("ko-KR")}원`;

function verifyRegion(schedule, ordinanceRows) {
  const byPair = groupBy(ordinanceRows, (row) => `${normalize(row.itemName)}|${normalize(row.spec)}`);
  const bySpec = groupBy(ordinanceRows, (row) => normalize(row.spec));

  const matched = [];
  const matchedBySpec = [];
  const mismatched = [];
  const unresolved = [];

  for (const fee of schedule.fees) {
    const pairKey = `${normalize(fee.itemName)}|${normalize(fee.spec)}`;
    const pairHits = byPair.get(pairKey);
    if (pairHits) {
      if (pairHits.some((row) => row.feeKrw === fee.feeKrw)) matched.push(fee);
      else mismatched.push({ fee, tier: "품명+규격", candidates: pairHits });
      continue;
    }

    const specHits = bySpec.get(normalize(fee.spec)) ?? [];
    const amounts = new Set(specHits.map((row) => row.feeKrw));
    if (specHits.length > 0 && amounts.size === 1) {
      // 후보 금액이 하나로 모일 때만 판정에 쓴다. 여러 값이면 어느 품목의 행인지
      // 가릴 근거가 없으므로 일치로도 불일치로도 세지 않는다.
      if (amounts.has(fee.feeKrw)) matchedBySpec.push({ fee, hit: specHits[0] });
      else mismatched.push({ fee, tier: "규격", candidates: specHits });
      continue;
    }
    unresolved.push({ fee, candidates: specHits });
  }

  return { matched, matchedBySpec, mismatched, unresolved };
}

async function main() {
  const requested = process.argv.slice(2);
  const known = new Set(GOLDEN_TARGETS.map((target) => target.regionId));
  const unknown = requested.filter((regionId) => !known.has(regionId));
  if (unknown.length > 0) {
    console.error(`골든셋이 아닌 regionId: ${unknown.join(", ")}`);
    console.error(`사용 가능한 regionId: ${GOLDEN_TARGETS.map((target) => target.regionId).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const targets = requested.length > 0 ? GOLDEN_TARGETS.filter((t) => requested.includes(t.regionId)) : GOLDEN_TARGETS;
  const schedules = JSON.parse(readFileSync(FEES_PATH, "utf8"));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalRows = 0;
  let totalMatched = 0;
  let totalBySpec = 0;
  let totalMismatched = 0;
  let totalUnresolved = 0;

  for (const target of targets) {
    const schedule = schedules.find((item) => item.regionId === target.regionId);
    if (!schedule) {
      console.error(`${target.regionId}: ${FEES_PATH}에 수수료표가 없다 — 골든셋이 아니다`);
      process.exitCode = 1;
      continue;
    }

    process.stdout.write(`${target.regionId} (${target.기관명}) ... `);
    const collected = await collectRegion(target);
    writeFileSync(`${OUTPUT_DIR}/${target.regionId}.json`, `${JSON.stringify(collected, null, 2)}\n`, "utf8");

    const law = collected.law;
    console.log(
      collected.rows.length > 0
        ? `조례 ${collected.rows.length}행 — ${law.kind} 「${law.name}」 시행 ${law.effectiveDate}`
        : "조례에서 행을 뽑지 못했다",
    );
    for (const error of collected.errors) console.log(`    ! ${error}`);

    const { matched, matchedBySpec, mismatched, unresolved } = verifyRegion(schedule, collected.rows);
    totalRows += schedule.fees.length;
    totalMatched += matched.length;
    totalBySpec += matchedBySpec.length;
    totalMismatched += mismatched.length;
    totalUnresolved += unresolved.length;

    console.log(
      `    우리 ${schedule.fees.length}행 → 일치 ${matched.length + matchedBySpec.length}` +
        `(품명+규격 ${matched.length} / 규격만 ${matchedBySpec.length})` +
        `, 불일치 ${mismatched.length}, 미확인 ${unresolved.length}`,
    );
    for (const { fee, tier, candidates } of mismatched) {
      const found = [...new Set(candidates.map((row) => row.feeKrw))].map(won).join(", ");
      console.log(`    X [${tier}] ${fee.itemName} / ${fee.spec}: 우리 ${won(fee.feeKrw)} ↔ 조례 ${found}`);
    }
    for (const { fee, candidates } of unresolved) {
      const hint = candidates.length > 0 ? candidates.map((row) => `${row.itemName}=${won(row.feeKrw)}`).join(" ; ") : "규격이 같은 행 없음";
      console.log(`    ? ${fee.itemName} / ${fee.spec} = ${won(fee.feeKrw)} — ${hint}`);
    }
  }

  console.log(
    `\n합계 ${totalRows}행 — 일치 ${totalMatched + totalBySpec}, 불일치 ${totalMismatched}, 미확인 ${totalUnresolved}`,
  );
  if (totalMismatched > 0) {
    console.log("불일치가 있다. 파서 결함인지 조례 개정인지 판별해 문서에 남긴 뒤 진행한다.");
    process.exitCode = 1;
    return;
  }
  console.log("금액 불일치 0건 — R2 통과.");
}

await main();
