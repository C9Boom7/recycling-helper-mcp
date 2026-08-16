/**
 * 구청 수수료표 → `src/data/bulky-waste-fees.json` 인제스트 (Phase 6 R3 후속).
 *
 * 조례 트랙(`import-ordinance-fees.ts`)과 나누는 이유는 **표의 성격이 다르기**
 * 때문이다. 조례 별표는 HWP 표를 한 줄로 펴야 해서 품명이 병합 셀에서 이어지고,
 * 그 이어짐이 어긋나면 이웃 품목의 규격·금액이 넘어온다. 구청 표는 품목·규격·금액이
 * 이미 갈려 있어 그 갈래의 위험이 아예 없다 — 여기서는 `nameInherited` 검사가
 * 필요 없고, 대신 품명 판정과 대형폐기물 갈래 게이트만 걸면 된다.
 *
 * 품명 판정 규칙은 `scripts/lib/bulky-item-match.ts`를 조례·표준데이터 트랙과
 * 함께 쓴다. 출처가 달라도 잘못 붙은 이름이 확신 있는 오답이 되는 건 똑같다.
 *
 * 사전 준비:
 *   1. node scripts/fetch-district-fees.mjs [regionId...]  (구청 표 수집)
 *   2. pnpm build                                          (resolveWasteItem 사용)
 *
 * 실행: pnpm import:district [regionId...]
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { BulkyWasteFee, BulkyWasteFeeSchedule, RegionalPolicyData } from "../src/data.js";
import {
  SPLIT_HINTS,
  classifyName,
  cleanLabel,
  hasBulkyRoute,
  itemCategory,
  specNameCandidates,
} from "./lib/bulky-item-match.js";

type DistrictRow = { itemName: string; spec: string; feeKrw: number };
type DistrictDump = {
  regionId: string;
  name: string;
  kind: string;
  url: string;
  rows: DistrictRow[];
  errors: string[];
};

const RAW_DIR = "data/district-fee-raw";
const FEES_PATH = "src/data/bulky-waste-fees.json";
const REGIONS_PATH = "src/data/region-policies.json";

/** `import-ordinance-fees.ts`·`import-bulky-fees.ts`와 같은 값이어야 한다. 근거는 응답 크기다. */
const MAX_FEE_ROWS = 12;

/** 구청 수수료표를 읽는 지역. `fetch-district-fees.mjs`의 TARGETS와 같아야 한다. */
const TARGETS = ["seongbuk_gu", "jungnang_gu", "yangcheon_gu", "seodaemun_gu", "seongdong_gu", "guro_gu"];

/** 금액 분포를 대표하도록 최저·최고를 남기고 그 사이를 고르게 뽑는다. */
function trimToCap(list: BulkyWasteFee[]): BulkyWasteFee[] {
  if (list.length <= MAX_FEE_ROWS) return list;
  const step = (list.length - 1) / (MAX_FEE_ROWS - 1);
  const picked = Array.from({ length: MAX_FEE_ROWS }, (_, index) => list[Math.round(index * step)]);
  return [...new Map(picked.map((fee) => [`${fee.itemName}|${fee.spec}|${fee.feeKrw}`, fee])).values()];
}

const requested = process.argv.slice(2);
const unknown = requested.filter((regionId) => !TARGETS.includes(regionId));
if (unknown.length > 0) {
  console.error(`구청 수수료표 대상이 아닌 regionId: ${unknown.join(", ")}`);
  console.error(`사용 가능한 regionId: ${TARGETS.join(", ")}`);
  process.exit(1);
}

const targets = requested.length > 0 ? requested : TARGETS;
const regions = JSON.parse(readFileSync(REGIONS_PATH, "utf8")) as RegionalPolicyData[];
const existing = JSON.parse(readFileSync(FEES_PATH, "utf8")) as BulkyWasteFeeSchedule[];
const today = new Date().toISOString().slice(0, 10);

const built: BulkyWasteFeeSchedule[] = [];
const missing: string[] = [];
const failed: string[] = [];

for (const regionId of targets) {
  let dump: DistrictDump;
  try {
    dump = JSON.parse(readFileSync(`${RAW_DIR}/${regionId}.json`, "utf8")) as DistrictDump;
  } catch {
    if (requested.length > 0) {
      console.error(`${regionId}: ${RAW_DIR}/${regionId}.json이 없다 — 먼저 node scripts/fetch-district-fees.mjs ${regionId}`);
      process.exit(1);
    }
    missing.push(regionId);
    continue;
  }

  // 수집이 실패한 덤프는 건너뛴다. 빈 표를 "그 지역엔 수수료가 없다"로 넘기면
  // 커버리지 착시가 생긴다 — 조례 트랙에서 실제로 겪은 실패다.
  if (dump.rows.length === 0) {
    console.error(`${regionId}: 수집된 행이 없다 (${dump.errors.join(" / ") || "사유 없음"})`);
    failed.push(regionId);
    continue;
  }

  const region = regions.find((item) => item.id === regionId);
  if (!region?.bulkyWaste?.applicationUrl || !region.bulkyWaste.feeUrl || !region.bulkyWaste.phone) {
    throw new Error(`${regionId}: region-policies.json에 대형폐기물 신청 URL·수수료 URL·전화번호가 모두 있어야 합니다.`);
  }

  const grouped = new Map<string, BulkyWasteFee[]>();
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const row of dump.rows) {
    // 무상수거 행. 0원을 수수료로 적으면 "무상으로 가져갑니다" 옆에 "0원"이 붙는다.
    if (row.feeKrw === 0) {
      note("free_row");
      continue;
    }

    const itemName = cleanLabel(row.itemName);
    const spec = cleanLabel(row.spec) || "모든 규격";
    const verdict = classifyName(itemName);
    if (!verdict.ok) {
      note(verdict.reason);
      continue;
    }

    // 규격 칸이 다른 품목으로 확정되는 행은 넣지 않는다. 구청 표에도 「장판 /
    // 전기장판(1인용)」처럼 규격 자리에 다른 품목을 적는 칸이 있다.
    let itemId = verdict.itemId;
    const hint = SPLIT_HINTS.find(
      (rule) => rule.from === itemId && rule.hint.test(`${itemName} ${spec}`) && !(rule.deny?.test(`${itemName} ${spec}`) ?? false),
    );
    if (hint) itemId = hint.to;

    if (!hint) {
      let stolen = false;
      for (const candidate of specNameCandidates(spec)) {
        const specVerdict = classifyName(candidate);
        if (specVerdict.ok && specVerdict.itemId !== itemId && hasBulkyRoute(specVerdict.itemId)) {
          stolen = true;
          break;
        }
      }
      if (stolen) {
        note("spec_names_other_item");
        continue;
      }
    }

    if (!hasBulkyRoute(itemId)) {
      note("not_bulky_route");
      continue;
    }

    const list = grouped.get(itemId) ?? [];
    list.push({ itemId, category: itemCategory(itemId), itemName, spec, feeKrw: row.feeKrw });
    grouped.set(itemId, list);
  }

  const fees: BulkyWasteFee[] = [];
  const trimmed: string[] = [];
  const conflicts: string[] = [];
  for (const [itemId, group] of grouped) {
    const unique = new Map<string, BulkyWasteFee>();
    for (const fee of group) unique.set(`${fee.itemName}|${fee.spec}|${fee.feeKrw}`, fee);

    // 라벨은 같은데 금액만 다르면 어느 쪽이 맞는지 가릴 근거가 없다. `validate-data.mjs`가
    // (itemId, itemName, spec) 중복을 error로 막기도 하고, 답변에 같은 줄이 값만
    // 다르게 두 번 찍히기도 한다. 그 라벨은 통째로 뺀다.
    const byLabel = new Map<string, BulkyWasteFee[]>();
    for (const fee of unique.values()) {
      const label = `${fee.itemName}|${fee.spec}`;
      byLabel.set(label, [...(byLabel.get(label) ?? []), fee]);
    }
    const kept: BulkyWasteFee[] = [];
    for (const [label, rows] of byLabel) {
      if (rows.length === 1) {
        kept.push(rows[0]);
        continue;
      }
      conflicts.push(`${label} (${rows.map((fee) => fee.feeKrw).join("/")})`);
      note("conflicting_fee");
    }

    const sorted = kept.sort((a, b) => a.feeKrw - b.feeKrw);
    if (sorted.length > MAX_FEE_ROWS) trimmed.push(`${itemId} ${sorted.length}→${MAX_FEE_ROWS}`);
    fees.push(...trimToCap(sorted));
  }

  built.push({
    regionId,
    regionName: region.name,
    checkedAt: today,
    applicationUrl: region.bulkyWaste.applicationUrl,
    feeUrl: region.bulkyWaste.feeUrl,
    phone: region.bulkyWaste.phone,
    source: {
      title: `${region.name} 대형폐기물 수수료표`,
      url: dump.url,
      sourceType: "local_guidance",
      checkedAt: today,
      basis: `${region.name}이 누리집에 게시한 품목별 수수료표에서 뽑았습니다. 원문 ${dump.rows.length}행 중 우리 품목으로 확정되는 대형폐기물 행만 반영했습니다.`,
      note: "무상수거 행, 품명이 확정되지 않는 행, 대형폐기물 갈래가 없는 품목은 제외했습니다. 실제 부과액은 구청 접수 시 규격 판정에 따라 달라질 수 있습니다.",
    },
    fees,
  });

  console.log(`${regionId} (${region.name}): 구청 표 ${dump.rows.length}행 → 품목 ${grouped.size}개 / fee ${fees.length}행`);
  console.log(`  제외: ${JSON.stringify(Object.fromEntries([...skipped].sort((a, b) => b[1] - a[1])))}`);
  if (trimmed.length > 0) console.log(`  상한 적용: ${trimmed.join(", ")}`);
  if (conflicts.length > 0) console.log(`  라벨 같고 금액 다름 — 제외: ${conflicts.join(", ")}`);
}

if (built.length === 0) {
  console.error(`\n넣을 지역이 없다 — 먼저 node scripts/fetch-district-fees.mjs [regionId...]로 표를 받아라.`);
  process.exit(1);
}

// 다른 트랙이 넣은 지역은 건드리지 않는다. 실패한 지역도 managed에 넣어야
// 낡은 행이 남지 않는다.
const managed = new Set([...built.map((schedule) => schedule.regionId), ...failed]);
const merged = [...existing.filter((schedule) => !managed.has(schedule.regionId)), ...built];
writeFileSync(FEES_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((sum, schedule) => sum + schedule.fees.length, 0)}행`);
if (missing.length > 0) console.log(`표가 없어 건너뛴 지역: ${missing.join(", ")}`);
if (failed.length > 0) console.log(`수집이 실패해 넣지 않은 지역: ${failed.join(", ")}`);
