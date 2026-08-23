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
// 대상 목록은 수집 스크립트가 진실이다. 여기에 다시 적으면 두 곳이 어긋난다.
import { TARGETS as FETCH_TARGETS } from "./fetch-district-fees.mjs";
import {
  SPLIT_HINTS,
  alsoItemIds,
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
  collectedAt?: string;
  rows: DistrictRow[];
  warnings?: string[];
  errors: string[];
};

const RAW_DIR = "data/district-fee-raw";
const FEES_PATH = "src/data/bulky-waste-fees.json";
const REGIONS_PATH = "src/data/region-policies.json";

/** `import-ordinance-fees.ts`·`import-bulky-fees.ts`와 같은 값이어야 한다. 근거는 응답 크기다. */
const MAX_FEE_ROWS = 12;

const TARGETS = FETCH_TARGETS.map((target) => target.regionId);

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

  // 수집이 실패한 덤프는 건너뛰되 **기존 행은 그대로 둔다.** 네트워크 실패나
  // 일시적인 5xx로 빈 덤프가 남는 일이 있는데, 그걸 "그 지역엔 수수료가 없다"로
  // 읽고 검수 끝난 행을 지우면 한 번의 타임아웃이 데이터를 날린다. 페이지 구조가
  // 정말 바뀐 경우와 구분할 방법이 없으니, 지우는 쪽이 아니라 남기고 알리는 쪽을 고른다.
  if (dump.rows.length === 0) {
    console.error(`${regionId}: 수집된 행이 없다 (${dump.errors.join(" / ") || "사유 없음"}) — 기존 행을 그대로 둔다`);
    failed.push(regionId);
    continue;
  }

  const region = regions.find((item) => item.id === regionId);
  if (!region?.bulkyWaste?.applicationUrl || !region.bulkyWaste.feeUrl || !region.bulkyWaste.phone) {
    throw new Error(`${regionId}: region-policies.json에 대형폐기물 신청 URL·수수료 URL·전화번호가 모두 있어야 합니다.`);
  }

  // 수집한 날이 확인일이다. 임포트 시각을 쓰면 몇 주 전 표에 오늘 날짜가 붙는다.
  const collectedAt = dump.collectedAt;
  if (!collectedAt) {
    console.error(`${regionId}: 덤프에 collectedAt이 없다 — 수집 스크립트를 다시 돌려라`);
    failed.push(regionId);
    continue;
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
    const verdict = classifyName(itemName, "whole_cell");
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
        const specVerdict = classifyName(candidate, "spec_fragment");
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

    // 한 줄이 두 품목을 겸하면 품목마다 한 행씩 만든다. 하나만 남기면 나머지 품목은
    // 금액을 통째로 잃는다 — 강남에서 요가매트·인형·장난감이 그랬다.
    // 대형폐기물 갈래 문턱은 겸하는 품목까지 본 뒤 건다. 확정 품목에서 먼저 끊으면 그
    // 품목이 갈래를 잃는 순간 겸하던 품목의 행까지 조용히 사라진다.
    const targets = [itemId, ...alsoItemIds(itemName, itemId)].filter(hasBulkyRoute);
    if (targets.length === 0) {
      note("not_bulky_route");
      continue;
    }
    for (const target of targets) {
      const list = grouped.get(target) ?? [];
      list.push({ itemId: target, category: itemCategory(target), itemName, spec, feeKrw: row.feeKrw });
      grouped.set(target, list);
    }
  }

  const fees: BulkyWasteFee[] = [];
  const preCapFeeRowCountByItemId: Record<string, number> = {};
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
    if (sorted.length > MAX_FEE_ROWS) {
      trimmed.push(`${itemId} ${sorted.length}→${MAX_FEE_ROWS}`);
      preCapFeeRowCountByItemId[itemId] = sorted.length;
    }
    fees.push(...trimToCap(sorted));
  }

  // 한 행도 안 남았으면 스케줄을 만들지 않는다. 빈 `fees`로 덮으면 검수 끝난 행이
  // 사라진 뒤에야 validate가 터진다 — charset 회귀로 품명이 전부 깨졌을 때가 그랬다.
  if (fees.length === 0) {
    console.error(`${regionId}: 쓸 수 있는 행이 하나도 안 남았다 — 기존 행을 그대로 둔다`);
    failed.push(regionId);
    continue;
  }

  built.push({
    regionId,
    regionName: region.name,
    checkedAt: collectedAt,
    applicationUrl: region.bulkyWaste.applicationUrl,
    feeUrl: region.bulkyWaste.feeUrl,
    phone: region.bulkyWaste.phone,
    source: {
      title: `${region.name} 대형폐기물 수수료표`,
      url: dump.url,
      sourceType: "local_guidance",
      checkedAt: collectedAt,
      basis: `${region.name} 누리집에 게시된 품목별 수수료표에서 뽑았습니다. 원문 ${dump.rows.length}행 중 우리 품목으로 확정되는 대형폐기물 행만 반영했습니다.`,
      note: "무상수거 행, 품명이 확정되지 않는 행, 대형폐기물 갈래가 없는 품목은 제외했습니다. 실제 부과액은 구청 접수 시 규격 판정에 따라 달라질 수 있습니다.",
    },
    ...(Object.keys(preCapFeeRowCountByItemId).length > 0 ? { preCapFeeRowCountByItemId } : {}),
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

// 다른 트랙이 넣은 지역과 이번에 실패한 지역은 건드리지 않는다.
const managed = new Set(built.map((schedule) => schedule.regionId));
const merged = [...existing.filter((schedule) => !managed.has(schedule.regionId)), ...built];
writeFileSync(FEES_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((sum, schedule) => sum + schedule.fees.length, 0)}행`);
if (missing.length > 0) console.log(`표가 없어 건너뛴 지역: ${missing.join(", ")}`);
if (failed.length > 0) console.log(`이번에 넣지 못해 기존 행을 그대로 둔 지역: ${failed.join(", ")}`);
