/**
 * 자치법규 별표 → `src/data/bulky-waste-fees.json` 인제스트 (Phase 6 R3).
 *
 * Phase 6 담당 18곳만 대상으로 한다(2026-08-16에 서울 신규 8개 구를 더했다).
 * 용산·노원·강서·관악은 공공데이터포털
 * 표준데이터 트랙이 `scripts/import-bulky-fees.ts`로 넣고, 골든셋 4곳
 * (강남·서초·송파·마포)은 기존 수기 데이터를 그대로 둔다.
 *
 * 사전 준비:
 *   1. pnpm fees:fetch [regionId...]   (조례 별표 수집 → data/ordinance-raw/)
 *   2. pnpm build                      (resolveWasteItem 사용)
 *
 * 실행: pnpm import:ordinance [regionId...]
 *   인자가 없으면 원문이 준비된 담당 지역을 전부 넣는다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { BulkyWasteFee, BulkyWasteFeeSchedule, RegionalPolicyData } from "../src/data.js";
import {
  SPEC_LIKE,
  SPLIT_HINTS,
  classifyName,
  cleanLabel,
  hasBulkyRoute,
  itemCategory,
  specNameCandidates,
} from "./lib/bulky-item-match.js";

type OrdinanceRow = {
  itemName: string;
  spec: string;
  feeKrw: number;
  free: boolean;
  lane: number;
  nameInherited: boolean;
  rawGroup: string[];
};

type OrdinanceDump = {
  regionId: string;
  기관명: string;
  collectedAt: string;
  law: { name: string; kind: string; effectiveDate: string; mst: string } | null;
  attachment: { title: string; header: string; columns: string[] } | null;
  rows: OrdinanceRow[];
  errors: string[];
};

const RAW_DIR = "data/ordinance-raw";
const FEES_PATH = "src/data/bulky-waste-fees.json";
const REGIONS_PATH = "src/data/region-policies.json";
const ITEMS_PATH = "src/data/waste-items.json";
const GROUPS_PATH = "src/data/disposal-groups.json";

/**
 * (regionId, itemId)당 fee 행 상한. `validate-data.mjs`의 MAX_FEE_ROWS_PER_ITEM,
 * `import-bulky-fees.ts`의 MAX_FEE_ROWS와 같은 값이어야 한다. 근거는 출처가 아니라
 * 응답 크기라서 두 트랙에 똑같이 걸린다.
 */
const MAX_FEE_ROWS = 12;

/** Phase 6 담당 18곳. 여기 없는 지역은 인자로 줘도 받지 않는다. */
const TARGETS = [
  "seongnam_si",
  "jongno_gu",
  "gwangjin_gu",
  "gangbuk_gu",
  "dobong_gu",
  "eunpyeong_gu",
  "geumcheon_gu",
  "yeongdeungpo_gu",
  "dongjak_gu",
  "gangdong_gu",
  // 2026-08-16 서울 나머지 8개 구가 열리며 추가된 대상.
  "jung_gu",
  "seongdong_gu",
  "dongdaemun_gu",
  "jungnang_gu",
  "seongbuk_gu",
  "seodaemun_gu",
  "yangcheon_gu",
  "guro_gu",
];









/**
 * 이 행을 근거로 써도 되는가. 조례 표에서만 나오는 두 가지를 막는다.
 *
 * 1. **무상 행.** 폐가전 무상방문수거 대상은 금액이 `무상`이다. 0원을 수수료로
 *    적으면 "무상으로 가져갑니다" 옆에 "0원"이 붙는 이상한 답이 된다. 애초에
 *    사용자가 알아야 할 것은 금액이 아니라 무상수거 신청 경로다.
 * 2. **품명 칸이 병합돼 이어 쓴 행 중, 규격 칸이 규격이 아닌 것.** 규격 열을
 *    거의 안 채운 표에서는 다음 품목명이 규격 자리로 밀린다 — 동작구
 *    「전기매트 / 타자기」, 「선풍기 / 앰프」, 강동구 「보행기 / 볼링공」,
 *    「휠체어 / 고무통입간판」이 그렇다. 이대로 넣으면 전기매트 수수료로
 *    타자기 금액이 나간다.
 *
 *    규격처럼 보이지 않아도, 규격 칸이 이어 쓴 품명과 같은 품목으로 풀리면
 *    남긴다 — 금천구 「의자 / 흔들의자」처럼 규격 자리에 세부 품명을 적는 표가
 *    있고, 그건 밀린 게 아니라 원래 그 품목의 행이다.
 * 3. **규격 칸이 다른 품목으로 확정되는 행.** 2번의 크기 어휘 검사는 숫자나
 *    `유아용` 하나만 있어도 통과시켜서, 규격 자리로 밀려온 품목명을 그대로
 *    지나 보냈다 — 영등포구 「유아용 의자(쇼파) / 어린이 2층 침대 15,000」,
 *    광진·은평·영등포 「장판 / 전기장판(1인용)」·「장판 / 온수매트 1인용」이
 *    그렇게 들어갔다. 의자를 물으면 2층 침대 값이, 전기장판을 물으면 전기담요
 *    값이 나가고 정작 전기장판 금액은 장판 아래 숨는다.
 *
 *    SPLIT_HINTS로 근거를 확인한 쌍만 옮기고, 나머지는 넣지 않는다. 어느 쪽 행인지
 *    가릴 근거가 없는데 상위 품명 쪽으로 미는 것이 가장 나쁜 선택이다.
 */
function usableRow(row: OrdinanceRow, itemId: string): { ok: boolean; reason?: string } {
  if (row.free || row.feeKrw === 0) return { ok: false, reason: "free_row" };

  const spec = cleanLabel(row.spec);
  for (const candidate of specNameCandidates(spec)) {
    const verdict = classifyName(candidate);
    if (verdict.ok && verdict.itemId !== itemId && hasBulkyRoute(verdict.itemId)) {
      return { ok: false, reason: "spec_names_other_item" };
    }
  }

  if (!row.nameInherited) return { ok: true };
  if (SPEC_LIKE.test(spec)) return { ok: true };

  const specVerdict = classifyName(spec);
  if (specVerdict.ok && specVerdict.itemId === itemId) return { ok: true };
  return { ok: false, reason: "spec_is_not_a_size" };
}

/** 금액 분포를 대표하도록 최저·최고를 남기고 그 사이를 고르게 뽑는다. */
function trimToCap(list: BulkyWasteFee[]): BulkyWasteFee[] {
  if (list.length <= MAX_FEE_ROWS) return list;
  const step = (list.length - 1) / (MAX_FEE_ROWS - 1);
  const picked = Array.from({ length: MAX_FEE_ROWS }, (_, i) => list[Math.round(i * step)]);
  return [...new Map(picked.map((fee) => [`${fee.itemName}|${fee.spec}|${fee.feeKrw}`, fee])).values()];
}

/** 법제처가 주는 `20251226`을 `2025-12-26`으로 편다. */
function formatDate(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : String(raw);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((regionId) => !TARGETS.includes(regionId));
if (unknown.length > 0) {
  console.error(`Phase 6 담당이 아닌 regionId: ${unknown.join(", ")}`);
  console.error(`사용 가능한 regionId: ${TARGETS.join(", ")}`);
  process.exit(1);
}

const targets = requested.length > 0 ? requested : TARGETS;
const regions = JSON.parse(readFileSync(REGIONS_PATH, "utf8")) as RegionalPolicyData[];
const misalignedRegions: string[] = [];
const tableless: string[] = [];
const existing = JSON.parse(readFileSync(FEES_PATH, "utf8")) as BulkyWasteFeeSchedule[];

const built: BulkyWasteFeeSchedule[] = [];
const missing: string[] = [];
for (const regionId of targets) {
  let dump: OrdinanceDump;
  try {
    dump = JSON.parse(readFileSync(`${RAW_DIR}/${regionId}.json`, "utf8")) as OrdinanceDump;
  } catch {
    // 콕 집어 요청한 지역이 없으면 오타이거나 수집을 빠뜨린 것이라 세워야 한다.
    // 인자 없이 전체를 돌릴 때는 준비된 지역까지 함께 막을 이유가 없다 — 원문은
    // gitignore 대상이라 한 배치씩 받아 넣는 게 정상 흐름이다.
    if (requested.length > 0) {
      console.error(`${regionId}: ${RAW_DIR}/${regionId}.json이 없다 — 먼저 pnpm fees:fetch ${regionId}`);
      process.exit(1);
    }
    missing.push(regionId);
    continue;
  }
  if (!dump.law || !dump.attachment || dump.rows.length === 0) {
    // 표가 없는 지역이 전체 배치를 세우면 안 된다. 성동·양천이 그 경우다 —
    // `fees:fetch`는 못 찾아도 덤프 파일을 쓰기 때문에, 예전 코드는 대상 목록에
    // 이 둘이 들어온 순간 `pnpm fees:fetch && pnpm import:ordinance` 재현 흐름이
    // 통째로 죽고 수수료 파일이 아예 안 써졌다. 콕 집어 요청했을 때만 세운다.
    console.error(`${regionId}: 조례에서 행을 뽑지 못했다 (${dump.errors.join(" / ") || "사유 없음"})`);
    if (requested.length === 1) process.exit(1);
    tableless.push(regionId);
    continue;
  }

  const region = regions.find((item) => item.id === regionId);
  if (!region?.bulkyWaste?.applicationUrl || !region.bulkyWaste.feeUrl || !region.bulkyWaste.phone) {
    throw new Error(`${regionId}: region-policies.json에 대형폐기물 신청 URL·수수료 URL·전화번호가 모두 있어야 합니다.`);
  }

  const grouped = new Map<string, BulkyWasteFee[]>();
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  // 품명 칸에 금액이 들어앉아 있으면 열이 통째로 밀린 것이다. 구로구 조례가
  // 「분야 | 품목 | 규격 | 수수료 | 비고」 5열이라 파서가 한 칸씩 밀려 읽었고,
  // `itemName: "5,000원"` / `spec: "다리미"` 같은 행이 나왔다. 이런 덤프는 대부분
  // 금액 0으로 걸러져 살아남는 몇 행만 통과하는데, 그 몇 행이 바로 "확신 있는
  // 오답"이 된다 — 실제로 구로 1행(`air_purifier 6,000원`)은 구청 수수료표에
  // 아예 없는 품목이었다. 행 단위로 버리지 않고 **지역 전체를 거부**한다.
  // 열이 밀린 표에서 우연히 맞은 행을 골라낼 방법이 없기 때문이다.
  const misaligned = dump.rows.filter((row) => /^[\d,]+\s*원$/.test((row.itemName ?? "").trim()));
  if (misaligned.length > 0) {
    console.error(
      `${regionId}: 품명 칸에서 금액이 ${misaligned.length}행 나왔다 — 조례 표의 열 구성이 파서와 어긋난다. ` +
        `이 지역은 넣지 않는다 (예: "${misaligned[0].itemName}" / 규격 "${misaligned[0].spec}").`,
    );
    misalignedRegions.push(regionId);
    continue;
  }

  for (const row of dump.rows) {
    if (row.free || row.feeKrw === 0) {
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
    // 품명을 앞 행에서 이어 쓴 행은 규격 칸만 본다. 품명 쪽 수식어는 그 행의
    // 것이 아니라 병합된 셀의 것이라, 같이 보면 한 행의 갈래가 그룹 전체로 번진다 —
    // 강동구 「침대(흙,돌,황토,의료)」 아래의 접이식 침대 행까지 돌침대가 된다.
    const hintText = row.nameInherited ? spec : `${itemName} ${spec}`;
    const hint = SPLIT_HINTS.find(
      (rule) => rule.from === verdict.itemId && rule.hint.test(hintText) && !(rule.deny?.test(hintText) ?? false),
    );
    const itemId = hint?.to ?? verdict.itemId;
    if (!hasBulkyRoute(itemId)) {
      note("not_bulky_route");
      continue;
    }
    const usable = usableRow(row, itemId);
    if (!usable.ok) {
      note(usable.reason!);
      continue;
    }

    const list = grouped.get(itemId) ?? [];
    list.push({
      itemId,
      category: itemCategory(itemId),
      itemName,
      spec,
      feeKrw: row.feeKrw,
    });
    grouped.set(itemId, list);
  }

  const fees: BulkyWasteFee[] = [];
  const trimmed: string[] = [];
  const conflicts: string[] = [];
  for (const [itemId, group] of grouped) {
    // 조례 표는 같은 행이 쪽마다 반복되기도 하고, 좌우 2단에서 같은 셀이 두 번
    // 읽히기도 한다. 라벨·금액이 모두 같으면 같은 행이다.
    const unique = new Map<string, BulkyWasteFee>();
    for (const fee of group) unique.set(`${fee.itemName}|${fee.spec}|${fee.feeKrw}`, fee);

    // 라벨이 같은데 금액만 다르면 같은 행으로 볼 수 없다. `validate-data.mjs`가
    // (itemId, itemName, spec) 중복을 error로 막으므로 그대로 두면 방금 쓴 파일이
    // `pnpm check`에서 걸린다. 답변에도 같은 줄이 값만 다르게 두 번 찍힌다.
    // 어느 금액이 맞는지 가릴 근거가 없으니 그 라벨은 통째로 뺀다.
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

  const effectiveDate = formatDate(dump.law.effectiveDate);
  built.push({
    regionId,
    regionName: region.name,
    checkedAt: dump.collectedAt,
    applicationUrl: region.bulkyWaste.applicationUrl,
    feeUrl: region.bulkyWaste.feeUrl,
    phone: region.bulkyWaste.phone,
    source: {
      title: `${dump.law.name} ${dump.attachment.title}`,
      url: `https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=${dump.law.mst}`,
      sourceType: "law",
      checkedAt: dump.collectedAt,
      // 시행일자를 함께 적는다. 다음 갱신 때 개정 여부를 비교할 기준이 된다 —
      // 조례가 바뀌어도 알아챌 수단이 없다는 게 이 Phase를 연 이유 중 하나다.
      basis: `${dump.law.kind} 「${dump.law.name}」(시행 ${effectiveDate}) ${dump.attachment.title} "${dump.attachment.header}"에서 뽑았습니다. 조례 원문 ${dump.rows.length}행 중 우리 품목으로 확정되는 대형폐기물 행만 반영했습니다.`,
      note: "무상수거 행, 품명이 확정되지 않는 행, 대형폐기물 갈래가 없는 품목은 제외했습니다. 실제 부과액은 구청 접수 시 규격 판정에 따라 달라질 수 있습니다.",
    },
    fees,
  });

  console.log(`${regionId} (${region.name}): 조례 ${dump.rows.length}행 → 품목 ${grouped.size}개 / fee ${fees.length}행`);
  console.log(`  제외: ${JSON.stringify(Object.fromEntries([...skipped].sort((a, b) => b[1] - a[1])))}`);
  if (trimmed.length > 0) console.log(`  상한 적용: ${trimmed.join(", ")}`);
  if (conflicts.length > 0) console.log(`  라벨 같고 금액 다름 — 제외: ${conflicts.join(", ")}`);
}

if (built.length === 0) {
  if (misalignedRegions.length > 0 || tableless.length > 0) {
    console.error(
      `\n넣을 지역이 없다 — 표의 열 구성이 어긋난 지역: ${misalignedRegions.join(", ") || "없음"} / ` +
        `표를 못 찾은 지역: ${tableless.join(", ") || "없음"}. 수집 문제가 아니라 파싱 문제다.`,
    );
  } else {
    console.error(`\n넣을 지역이 없다 — 먼저 pnpm fees:fetch [regionId...]로 원문을 받아라.`);
  }
  process.exit(1);
}

// 다른 트랙이 넣은 지역(골든셋 4곳, 표준데이터 4곳)은 건드리지 않는다.
// 거부·실패한 지역도 `managed`에 넣는다. 안 넣으면 예전에 잘 들어갔던 지역이
// 나중에 어긋났을 때 낡은 행을 그대로 달고 있으면서 실행 로그에는 "넣지 않은
// 지역"으로 찍힌다 — 데이터와 보고가 어긋나는 최악의 조합이다.
const managed = new Set([...built.map((schedule) => schedule.regionId), ...misalignedRegions, ...tableless]);
const merged = [...existing.filter((schedule) => !managed.has(schedule.regionId)), ...built];
writeFileSync(FEES_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((n, s) => n + s.fees.length, 0)}행`);
if (missing.length > 0) console.log(`원문이 없어 건너뛴 지역: ${missing.join(", ")}`);
if (misalignedRegions.length > 0) {
  console.log(`표의 열 구성이 어긋나 넣지 않은 지역: ${misalignedRegions.join(", ")}`);
}
if (tableless.length > 0) console.log(`조례에서 표를 못 찾아 넣지 않은 지역: ${tableless.join(", ")}`);
