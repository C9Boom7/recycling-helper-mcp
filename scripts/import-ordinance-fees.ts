/**
 * 자치법규 별표 → `src/data/bulky-waste-fees.json` 인제스트 (Phase 6 R3).
 *
 * Phase 6 담당 10곳만 대상으로 한다. 용산·노원·강서·관악은 공공데이터포털
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

import { normalizeText, resolveWasteItem } from "../src/data.js";
import type { BulkyWasteFee, BulkyWasteFeeSchedule, RegionalPolicyData, WasteItem } from "../src/data.js";

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

/** Phase 6 담당 10곳. 여기 없는 지역은 인자로 줘도 받지 않는다. */
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
];

/**
 * 품명 판정은 `import-bulky-fees.ts`의 규칙을 그대로 쓴다 — 출처는 달라도 위험은
 * 같다. 질의는 빗나가도 사용자가 다시 물으면 되지만, 여기서 잘못 붙은 이름은
 * 그대로 금액이 되어 확신 있는 오답으로 굳는다.
 *
 * 조례에서만 나오는 위험이 둘 더 있어 아래 usableRow에서 따로 막는다.
 */
const HEAD_COLLISION_NAMES = new Set(["식기건조대", "욕실 수납장", "상자", "김치통", "골프채 가방"]);

/**
 * 상위어로 뭉뚱그려진 품명에서 실제 품목을 가르는 표. `import-bulky-fees.ts`의
 * SPLIT_HINTS와 같은 규칙이고 이유도 같다 — 조례도 매트리스를 침대 아래 적는다.
 * 광진구 「침대 / 1인용 매트리스, 토퍼(라텍스 포함)」이 그대로 침대 프레임에
 * 붙어서, 매트리스를 물어본 사람에게 프레임 값이 나갈 뻔했다.
 *
 * 괄호나 규격에서 다른 품목이 잡히면 무조건 그쪽으로 보내는 일반 규칙은
 * 표준데이터 트랙이 실측으로 버렸다(새 오귀속이 그만큼 생긴다). 근거를 확인한
 * 쌍만 적는다.
 *
 * `deny`는 낱말이 걸려도 옮기지 말아야 할 문맥이다. 조례는 침대 행을 세 갈래로
 * 적는다 — 프레임만(`매트리스제외`), 세트(`매트리스포함`), 매트리스만. 낱말만
 * 보면 셋 다 매트리스로 가서, 매트리스를 물어본 사람에게 매트리스를 뺀 프레임
 * 값이나 세트 값이 나간다. 실제로 강북구 6행 중 4행이 그렇게 들어갔다.
 * `(라텍스 포함)`처럼 다른 낱말에 붙은 `포함`은 걸리지 않도록 낱말 바로 뒤만 본다.
 */
const SPLIT_HINTS: Array<{ from: string; hint: RegExp; to: string; deny?: RegExp }> = [
  { from: "bed_frame", hint: /매트리스|토퍼/, to: "mattress", deny: /(매트리스|토퍼)\s*[)）]?\s*(제외|미포함|불포함|없음|포함)/ },
  // 조례는 돌·옥·황토 침대를 「침대」 아래 규격으로 적는다 — 종로 「1인용 돌침대
  // 26,000」, 강북 「돌침대, 전동침대 1인용」, 광진 「1인용 돌, 옥, 황토」. 그대로 두면
  // 돌침대를 물은 사람은 금액을 못 받고, 침대 프레임을 물은 사람은 돌침대 값을 받는다.
  { from: "bed_frame", hint: /돌\s*침대|옥\s*침대|흙\s*침대|황\s*토/, to: "stone_bed" },
  // 헬스자전거는 핵심어가 `자전거`라 수식어 위치 검사를 통과해 버린다. 타는 물건이
  // 아니라 운동기구이고 `exercise_machine` 별칭에도 `실내자전거`가 있다. 그대로 두면
  // 강동구에서 자전거를 물은 사람이 헬스자전거 3,000~7,000원을 함께 받는다.
  { from: "bicycle", hint: /헬스\s*자전거|실내\s*자전거/, to: "exercise_machine" },
];

/**
 * 셀 안에서 줄바꿈된 품명은 뒷줄만 남아 괄호 짝이 깨진다 — 성남시
 * 「(장식장, 문갑 등)」이 `문갑 등)`으로 들어온다. 답변에 그대로 찍히는 문자열이라
 * 짝 없는 괄호만 떼어낸다. 안쪽 글자는 건드리지 않는다.
 */
function cleanLabel(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  const open = (out.match(/[(（]/g) ?? []).length;
  const close = (out.match(/[)）]/g) ?? []).length;
  if (close > open) out = out.replace(/[)）]+\s*$/, "").trim();
  if (open > close) out = out.replace(/^[(（]+\s*/, "").trim();
  return out;
}

type Verdict = { ok: true; itemId: string } | { ok: false; reason: string };

function classifyName(rawName: string): Verdict {
  const base = rawName.replace(/[(（][^)）]*[)）]/g, " ").replace(/\s+/g, " ").trim();
  if (base.length === 0) return { ok: false, reason: "empty_after_paren_strip" };
  if (/[,/·ㆍ]/.test(base)) return { ok: false, reason: "multi_item_name" };
  if (/별도|추가금|추가 요금/.test(rawName)) return { ok: false, reason: "surcharge_row" };
  if (HEAD_COLLISION_NAMES.has(base)) return { ok: false, reason: "head_collision" };

  const resolved = resolveWasteItem(base);
  if (resolved.status !== "match") return { ok: false, reason: resolved.status };

  const { item, matchedBy, matchKind } = resolved.match;
  if (matchKind === "fuzzy_jamo") return { ok: false, reason: "typo_tier" };
  if (matchKind === "generic_fragment") return { ok: false, reason: "reverse_containment" };
  // 한국어는 핵심어가 뒤에 온다. 붙은 이름이 조례 품명의 앞쪽에 있으면 그 품목의
  // 수식어일 뿐이다 — "TV 받침대"는 텔레비전이 아니라 받침대이고, "소파 스툴"은
  // 소파가 아니다. 표준데이터 트랙은 `query_contains_name`에만 이 검사를 걸었는데,
  // 조례에서는 짧은 별칭(`TV`, `소파`)이 `short_alias_standalone`으로 붙어 그대로
  // 새어 나왔다.
  if (
    (matchKind === "query_contains_name" || matchKind === "short_alias_standalone") &&
    !normalizeText(base).endsWith(normalizeText(matchedBy))
  ) {
    return { ok: false, reason: "modifier_position" };
  }

  return { ok: true, itemId: item.id };
}

const items = JSON.parse(readFileSync(ITEMS_PATH, "utf8")) as WasteItem[];
const groupLabels = JSON.parse(readFileSync(GROUPS_PATH, "utf8")) as Record<string, string>;
const itemsById = new Map(items.map((item) => [item.id, item]));

/**
 * 런타임 `findBulkyWasteFees`와 같은 게이트다. 대형폐기물 갈래가 없는 품목에
 * 수수료를 붙이면 "종량제봉투에 버리세요" 다음 줄에 금액이 붙는다. 판정은
 * `disposal-groups.json` 라벨로 한다 — disposalType 문자열 부분 일치는 새 값이
 * 조용히 샌다.
 */
function hasBulkyRoute(itemId: string): boolean {
  const item = itemsById.get(itemId);
  return item ? (groupLabels[item.disposalType] ?? "").includes("대형폐기물") : false;
}

/**
 * 규격 칸에 실제로 적히는 표현. 숫자와 단위가 들어가거나, 크기·용도를 가르는
 * 닫힌 어휘다. 규격 열이 비어 있는 표를 가려내는 데 쓴다.
 */
const SPEC_LIKE =
  /\d|모든\s*규격|소\s*형|중\s*형|대\s*형|특대|일\s*반|업소용|영업용|가정용|유아용|아동용|성인용|미\s*만|이\s*상|이\s*하|초\s*과|당$|개당|쪽당|폭당|접이식|휴대용|기\s*타/;

/**
 * 규격 칸에서 품목명 후보를 뽑는다. 괄호 안은 버린다 — 조례가 괄호에 적는 것은
 * 「(세면대 제외)」·「(측면책꽂이 포함)」·「(책상+의자 1개)」처럼 값에 무엇이 들고
 * 나는지에 대한 설명이라, 그 자체가 다른 품목의 행이라는 뜻이 아니다.
 *
 * 나머지는 구분자와 공백으로 쪼개 낱말 단위로 본다. 한 낱말짜리는 건너뛴다.
 */
function specNameCandidates(spec: string): string[] {
  const stripped = spec.replace(/[(（][^)）]*[)）]/g, " ");
  // `없음`·`제외`가 붙은 구절은 무엇이 빠졌는지를 적은 것이다 — 강북구
  // 「서랍, 수납장 없음」은 수납장 행이 아니라 수납장이 없는 책상 행이다.
  if (/없\s*음|제\s*외|미포함|불포함|별\s*도/.test(stripped)) return [];
  return stripped
    .split(/[\s/,·ㆍ、]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

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
    console.error(`${regionId}: 조례에서 행을 뽑지 못했다 (${dump.errors.join(" / ") || "사유 없음"})`);
    process.exit(1);
  }

  const region = regions.find((item) => item.id === regionId);
  if (!region?.bulkyWaste?.applicationUrl || !region.bulkyWaste.feeUrl || !region.bulkyWaste.phone) {
    throw new Error(`${regionId}: region-policies.json에 대형폐기물 신청 URL·수수료 URL·전화번호가 모두 있어야 합니다.`);
  }

  const grouped = new Map<string, BulkyWasteFee[]>();
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

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
      category: itemsById.get(itemId)!.category,
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
  console.error(`\n넣을 지역이 없다 — 먼저 pnpm fees:fetch [regionId...]로 원문을 받아라.`);
  process.exit(1);
}

// 다른 트랙이 넣은 지역(골든셋 4곳, 표준데이터 4곳)은 건드리지 않는다.
const managed = new Set(built.map((schedule) => schedule.regionId));
const merged = [...existing.filter((schedule) => !managed.has(schedule.regionId)), ...built];
writeFileSync(FEES_PATH, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((n, s) => n + s.fees.length, 0)}행`);
if (missing.length > 0) console.log(`원문이 없어 건너뛴 지역: ${missing.join(", ")}`);
