/**
 * 자치법규 별표 → `src/data/bulky-waste-fees.json` 인제스트 (Phase 6 R3).
 *
 * Phase 6 조례 트랙 10곳 + 마포를 대상으로 한다. 용산·노원·강서·관악은 공공데이터포털
 * 표준데이터 트랙이 `scripts/import-bulky-fees.ts`로 넣고, 골든셋에 남은 셋
 * (강남·서초·송파)은 기존 수기 데이터를 그대로 둔다.
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
  alsoItemIds,
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

/**
 * (regionId, itemId)당 fee 행 상한. `validate-data.mjs`의 MAX_FEE_ROWS_PER_ITEM,
 * `import-bulky-fees.ts`의 MAX_FEE_ROWS와 같은 값이어야 한다. 근거는 출처가 아니라
 * 응답 크기라서 두 트랙에 똑같이 걸린다.
 */
const MAX_FEE_ROWS = 12;

/** Phase 6 조례 트랙 10곳 + 마포. 여기 없는 지역은 인자로 줘도 받지 않는다. */
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
  // 구청이 기계로 읽을 표를 안 내놓는 두 곳. 중구는 조례 별표뿐이고 동대문구는
  // 수수료표가 내려받는 HWP다. `ladderBleed`로 이웃 사다리 오염을 막고 열었다.
  "jung_gu",
  "dongdaemun_gu",
  // 골든셋 4곳 중 **마포만** 연다(2026-08-19). 수기 14행은 Top 50 범위로만 추린
  // 것이라 이사에서 제일 흔한 침대 프레임조차 없었다. 조례 214행을 넣으면 품목이
  // 7→73개가 되고 「1인용 침대틀(서랍별도) 4,000원」이 들어온다.
  //
  // 다만 **공짜는 아니다.** 처음엔 "잃는 행이 하나도 없다"고 적었는데 14행 중 2행에서
  // 틀렸다. 검증을 itemId 단위로만 해서 "같은 품목 안에서 값이 바뀐" 경우를 못 봤다.
  //   - `chair / 좌식의자, 접의자 / 2,000원`은 `multi_item_name`으로 빠진다.
  //   - 요가매트는 돗자리가 `picnic_mat`으로 제자리를 찾으면서 근거 행을 잃었다.
  //     그 빈자리를 「유아용 놀이매트 2,000원」이 메우고 있었고, 그건 요가매트가
  //     아니라서 `HEAD_COLLISION_NAMES`로 막았다. 결과적으로 마포 요가매트는 금액이
  //     없다 — 조례에 그 품목 행이 없다는 뜻이고, 틀린 값보다는 없는 편이 맞다.
  // R2 검증은 마포 14/14 일치, 불일치 0이었다.
  //
  // 나머지 셋은 각각 다른 이유로 뺀다.
  //
  // - **서초**: 조례 258행이 잘 뽑히고 「침대틀 1인용 10,000원」도 잡히지만, 통째로
  //   교체하면 수기로 넣었던 요가매트·리빙박스(플라스틱 수납함) 수수료가 **조용히
  //   사라진다**. 그 둘은 서초 조례 별표에 아예 없고 구청 안내에서 온 값이다.
  //   품목은 10→65개로 늘지만 없어지는 품목이 넷이라, 교체가 아니라 병합이 필요하다.
  //   품명 판정에 걸리던 책상용의자·인형류·장난감류 3행은 열어 뒀다
  //   (`bulky-item-match.ts`의 `IMPORT_ONLY_NAMES`). 처음엔 `waste-items.json`
  //   별칭으로 넣었다가 질의까지 함께 넓어져 「인형류 수납함」이 리빙박스 대신
  //   인형으로 갔고, 표 한 칸에서만 확정하는 쪽으로 옮겼다. 남은 건 병합뿐이다.
  // - **강남·송파**: 파서가 좌우 2단 조판에서 아직 열을 놓쳐, 골든셋 69행 **바깥**
  //   행의 품명이 어긋난다. 강남은 침대 금액이 「텔레비전 / 유아용 침대 3,000원」처럼
  //   TV에 붙고 정작 침대틀 행은 하나도 안 잡히며, 송파는 「TV / 가스 레인지 = 0」류가
  //   42행이다. 지금 넣으면 TV를 물은 사람이 돌침대 값을 받는다.
  //
  //   **강남은 그 뒤 구청 표 트랙으로 갈아탔다**(`fetch-district-fees.mjs`의 `gn_table`).
  //   조례 파서는 그대로라 여기서는 여전히 대상이 아니고, 대조 기준에서도 빠졌다 —
  //   출처가 달라 금액이 갈리는 게 정상이기 때문이다. 이 주석을 믿고 강남을
  //   `GOLDEN_TARGETS`에 되돌리면 R2가 헛되이 깨진다. 수기 데이터로 남아 파서를
  //   대조하는 건 **서초·송파뿐**이다(`GOLDEN_TARGETS` 주석 참고).
  //
  // 원문은 `pnpm fees:fetch mapo_gu`로 받는다. 골든셋에서 뺐으니 `fees:verify`는
  // 마포를 인자로 받지 않는다 — 한동안 이 자리에 그 명령이 적혀 있었고, 둘 다 exit 1이라
  // 140행의 출처를 다시 만들 방법이 없었다.
  "mapo_gu",
];

/**
 * 서울 신규 8개 구 중 **여섯 곳이 여기 없다.**
 *
 * 성북·중랑·양천·서대문·성동·구로는 구청이 직접 띄운 수수료표가 더 정확해서
 * `import-district-fees.ts`가 맡는다. 두 트랙이 같은 지역을 관리하면 인자 없는
 * `pnpm import:ordinance` 한 번에 검수 끝난 행이 조례 행으로 덮인다 — 서대문
 * 세탁기가 다시 1,000원(고무통 값)이 되고, 조례가 표를 못 뽑는 성동·양천·구로는
 * 아예 지워진다.
 *
 * 중구·동대문구는 구청에 기계로 읽을 표가 없어 조례가 유일한 경로다. 이웃 사다리가
 * 넘어오는 문제는 `ladderBleed`가 막는다.
 */

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


/**
 * 규격의 '사다리 지문'. 그 규격이 어떤 자로 재는 것인지를 나타낸다.
 *
 * ㎜·㎝·m는 **하나로 묶는다.** 나누면 같은 사다리를 단위만 바꿔 적은 행이 오탐으로
 * 걸린다 — 광진 「간판 / 가장 긴면 1m 이상」은 다른 행이 ㎝로 적혀 있을 뿐 같은 자다.
 */
const SPEC_SHAPES: Array<[string, RegExp]> = [
  // 단위가 끼어도 치수쌍이다 — 「90㎝×180㎝」를 length로 보면 사다리가 갈리지 않는다.
  ["dimpair", /\d+\s*(㎝|cm|㎜|mm|m)?\s*[xX×*]\s*\d+/i],
  ["liter", /ℓ|리터|\d+\s*L\b/i],
  ["weight", /\d*\s*kg|㎏/i],
  ["aircon", /㎡\s*형|평형/],
  ["seats", /\d+\s*인용/],
  ["tiers", /\d+\s*단/],
  ["inch", /인치/],
  ["length", /㎜|mm|㎝|cm|\d+\s*m\b|미터/i],
  ["area", /㎡|평(?!형)/],
  ["perunit", /자\)?\s*당|폭당|쪽당|개당/],
];

function specShape(spec: string): Set<string> {
  return new Set(SPEC_SHAPES.filter(([, pattern]) => pattern.test(spec)).map(([name]) => name));
}

const shareShape = (a: Set<string>, b: Set<string>) => [...a].some((token) => b.has(token));

/**
 * 이웃 품목의 규격 사다리가 통째로 넘어온 행을 찾는다.
 *
 * 조례 HWP는 여러 품목 사다리를 옆으로 늘어놓은 표다. 한 줄로 펴면서 병합 셀의
 * 품명이 이어지는데, 그 이어짐이 한 칸 어긋나면 **앞 품목의 마지막 계단이 다음
 * 품목의 이름을 달고 들어온다.** 서대문이 그랬다 — 고무통의 「소형(60X100 미만)
 * 1,000원」이 세탁기 행이 되어, 세탁기를 물은 사람에게 1,000원이 나갔다.
 *
 * `usableRow`의 `spec_names_other_item`은 규격 칸에 다른 품목의 **이름**이 올 때만
 * 잡는다. 숫자 사다리가 넘어오는 이 경우는 이름이 없어 그대로 통과했다.
 *
 * 판정은 **세 조건을 모두** 만족할 때만 한다. 하나라도 빼면 멀쩡한 행이 걸린다.
 *   1. 품명을 이어받은 행이다 (`nameInherited`).
 *   2. 그 규격이 **자기 품목의 사다리와 다른 자**로 재고 있다.
 *   3. 그런데 **읽기 순서상 직전 품목의 사다리와는 같은 자**다.
 *
 * 3번이 없으면 정상 행이 무더기로 걸린다 — 책장이 「3단 이상」과 「90X180㎝」를
 * 함께 쓰는 건 흔하다. 18곳 3,689행에 돌려 8행이 걸렸고 전부 서대문의 실제 오염,
 * 오탐은 0이었다.
 */
function ladderBleed(rows: OrdinanceRow[]): Set<OrdinanceRow> {
  const ownShapes = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.nameInherited) continue;
    const shapes = ownShapes.get(row.itemName) ?? new Set<string>();
    for (const token of specShape(String(row.spec ?? ""))) shapes.add(token);
    ownShapes.set(row.itemName, shapes);
  }

  // 직전 품목은 **행 순서로** 잡는다. 이름을 키로 쓰면 같은 이름이 두 번 나오는
  // 표에서 마지막 것만 남아, 이웃이 자기 자신이 되어 검사가 통째로 꺼지거나
  // 엉뚱한 이웃과 비교해 멀쩡한 행을 버린다. 동대문 표에 이미 이름이 두 번
  // 나오는 품목이 있다.
  const bled = new Set<OrdinanceRow>();
  let currentName: string | null = null;
  let previousName: string | null = null;
  for (const row of rows) {
    if (!row.nameInherited) {
      if (row.itemName !== currentName) {
        previousName = currentName;
        currentName = row.itemName;
      }
      continue;
    }
    if (row.free || !row.feeKrw) continue;
    const shape = specShape(String(row.spec ?? ""));
    if (shape.size === 0) continue;
    const mine = ownShapes.get(row.itemName) ?? new Set<string>();
    if (mine.size === 0 || shareShape(shape, mine)) continue;
    const neighbour = ownShapes.get(previousName ?? "") ?? new Set<string>();
    if (neighbour === mine || !shareShape(shape, neighbour)) continue;
    bled.add(row);
  }
  return bled;
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

  const bledRows = ladderBleed(dump.rows);

  for (const row of dump.rows) {
    if (bledRows.has(row)) {
      note("neighbour_ladder_bleed");
      continue;
    }
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
    // 품명을 앞 행에서 이어 쓴 행이라도 **품명 자체는 본다.** 예전에는 규격만 봐서
    // 갈래 판정이 그룹의 첫 행에만 걸렸다 — 강동구 헬스자전거는 「(접이식)」 행만
    // 운동기구로 가고 이어진 「기타5kg이하」·「기타10kg이하」는 자전거에 남아, 강동구에서
    // 자전거를 물으면 헬스자전거 값 3,000·7,000원이 그대로 나갔다.
    //
    // 다만 품명의 **괄호 안은 뗀다.** 병합 셀의 괄호는 그 그룹 전체를 설명하는
    // 열거지 이 행의 성격이 아니다 — 강동구 「침대(흙,돌,황토,의료)」를 그대로 보면
    // 아래 접이식 침대 행까지 돌침대가 된다.
    // 품명을 직접 든 행은 괄호까지 그대로 본다 — 강동구 「침대(흙,돌,황토,의료)」는
    // 괄호가 곧 그 행의 성격이라, 떼면 돌침대 갈래가 사라진다.
    // 이어 쓴 행은 괄호를 뗀 품명으로 본다 — 병합 셀의 괄호는 그룹 전체를 설명하는
    // 열거지 이 행의 성격이 아니라, 그대로 두면 같은 표의 접이식 침대까지 돌침대가 된다.
    const hintName = row.nameInherited ? itemName.replace(/[(（][^)）]*[)）]/g, " ").replace(/\s+/g, " ").trim() : itemName;
    const hintText = `${hintName} ${spec}`;
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

    // 한 줄이 두 품목을 겸하면 품목마다 한 행씩 만든다. 구청 트랙만 이걸 하고 있어서
    // 트랙마다 답이 갈렸다 — 마포 조례에 「돗자리 1m²당 1,000원」이 있는데도 요가매트가
    // 금액을 통째로 잃었고, 같은 라벨을 구청 표로 받은 강남은 요가매트를 지켰다.
    for (const target of [itemId, ...alsoItemIds(itemName, itemId)]) {
      if (!hasBulkyRoute(target)) continue;
      const list = grouped.get(target) ?? [];
      list.push({
        itemId: target,
        category: itemCategory(target),
        itemName,
        spec,
        feeKrw: row.feeKrw,
      });
      grouped.set(target, list);
    }
  }

  const fees: BulkyWasteFee[] = [];
  const preCapFeeRowCountByItemId: Record<string, number> = {};
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
    if (sorted.length > MAX_FEE_ROWS) {
      trimmed.push(`${itemId} ${sorted.length}→${MAX_FEE_ROWS}`);
      preCapFeeRowCountByItemId[itemId] = sorted.length;
    }
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
    ...(Object.keys(preCapFeeRowCountByItemId).length > 0 ? { preCapFeeRowCountByItemId } : {}),
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
