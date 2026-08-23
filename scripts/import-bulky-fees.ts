/**
 * 전국대형폐기물수거수수료정보표준데이터 → `src/data/bulky-waste-fees.json` 인제스트.
 *
 * Phase 7 담당 4개 지역(용산·노원·강서·관악)만 대상으로 한다. 나머지 서울 자치구는
 * Phase 6이 자치법규 조례에서 가져오고, 골든셋 4곳(강남·서초·송파·마포)은 표준데이터가
 * 미수록이거나 모호도가 높아 기존 수기 데이터를 그대로 둔다.
 *
 * 사전 준비:
 *   1. node scripts/fetch-bulky-fee-standard-data.mjs   (원본 22,831행 수집)
 *   2. pnpm build                                        (resolveWasteItem 사용)
 *
 * 실행: pnpm import:fees [원본경로]
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { BulkyWasteFee, BulkyWasteFeeSchedule, RegionalPolicyData } from "../src/data.js";
import { SPLIT_HINTS, alsoItemIds, classifyName, hasBulkyRoute } from "./lib/bulky-item-match.js";

type StandardRow = {
  CTPV_NM: string;
  SGG_NM: string;
  LAR_WAS_NM: string;
  LAR_WAS_SE_NM?: string;
  LAR_WAS_SPCFCT?: string | null;
  PAID_FREE_YN?: string;
  FEE: string;
  CRTR_YMD: string;
};

const RAW_PATH = process.argv[2] ?? "logs/bulky-fee-standard-data.json";
const FEES_PATH = "src/data/bulky-waste-fees.json";
const REGIONS_PATH = "src/data/region-policies.json";

// (regionId, itemId)당 fee 행 상한. `validate-data.mjs`의 MAX_FEE_ROWS_PER_ITEM과
// 같은 값이어야 한다 — 손으로 넣은 행은 이 스크립트를 거치지 않으므로 검사는 거기에 있다.
const MAX_FEE_ROWS = 12;

const TARGETS: Array<[string, string, string]> = [
  ["용산구", "yongsan_gu", "서울 용산구"],
  ["노원구", "nowon_gu", "서울 노원구"],
  ["강서구", "gangseo_gu", "서울 강서구"],
  ["관악구", "gwanak_gu", "서울 관악구"],
];


/**
 * 고시명을 우리 품목에 붙일 수 있는지 판정한다.
 *
 * 사용자 질의를 받을 때보다 훨씬 보수적이다. 질의는 빗나가도 사용자가 다시 물으면
 * 되지만, 여기서 잘못 붙은 이름은 그대로 금액이 되어 확신 있는 오답으로 굳는다.
 * 실측에서 걸러낸 것들:
 *
 * - 오타 티어(fuzzy_jamo): "일반책상*유리별도"가 유리병으로 붙었다. 자모가 비슷하다는
 *   건 지자체가 고시한 품목이 무엇인지에 대한 근거가 못 된다.
 * - 역방향 포함(generic_fragment): 품목명이 고시명을 포함하는 방향이라 고시명보다
 *   넓은 품목에 붙는다.
 * - 수식어 위치: 한국어는 핵심어가 뒤에 온다(R1과 같은 원칙). "전자레인지 수납장"의
 *   핵심은 수납장이지 전자레인지가 아니다.
 * - 복수 품목 표기: "스키, 보드"는 조각마다 다른 품목이라 하나로 붙일 수 없다.
 *   실제로 정규화 후 "키보드"에 걸려 소형가전이 됐다.
 * - 옵션 요금 행: "*유리별도", "추가금"은 품목이 아니라 부가 요금이다.
 * - 핵심어 충돌: 핵심어가 같아도 다른 물건인 고시명은 규칙으로 못 가른다. 아래 목록으로 뺀다.
 */

/**
 * 품명 판정과 갈래 재지정은 `scripts/lib/bulky-item-match.ts`를 조례·구청 트랙과
 * 함께 쓴다. 예전에는 이 파일이 자기 사본을 들고 있었는데, 조례 트랙이 실측으로
 * 고친 규칙(매트리스 힌트의 `deny`, 돌·옥·황토 침대 분리, 헬스자전거 분리, 짧은
 * 별칭의 수식어 위치 검사)이 여기에는 없어 이미 갈라져 있었다. 그대로 두면 이
 * 스크립트를 다시 돌릴 때마다 고쳐 둔 오귀속이 되살아난다.
 */
function overrideItemId(rawName: string, spec: string, baseItemId: string): string | undefined {
  const text = `${rawName} ${spec}`;
  return SPLIT_HINTS.find(
    (rule) => rule.from === baseItemId && rule.hint.test(text) && !(rule.deny?.test(text) ?? false),
  )?.to;
}

/** 금액 분포를 대표하도록 최저·최고를 남기고 그 사이를 고르게 뽑는다. */
function trimToCap(list: BulkyWasteFee[]): BulkyWasteFee[] {
  if (list.length <= MAX_FEE_ROWS) return list;
  const step = (list.length - 1) / (MAX_FEE_ROWS - 1);
  const picked = Array.from({ length: MAX_FEE_ROWS }, (_, i) => list[Math.round(i * step)]);
  return [...new Map(picked.map(p => [`${p.itemName}|${p.spec}|${p.feeKrw}`, p])).values()];
}

const rows = JSON.parse(readFileSync(RAW_PATH, "utf8")) as StandardRow[];
const regions = JSON.parse(readFileSync(REGIONS_PATH, "utf8")) as RegionalPolicyData[];
const existing = JSON.parse(readFileSync(FEES_PATH, "utf8")) as BulkyWasteFeeSchedule[];

const built: BulkyWasteFeeSchedule[] = [];
for (const [gu, regionId, regionName] of TARGETS) {
  const region = regions.find(r => r.id === regionId);
  if (!region?.bulkyWaste?.applicationUrl || !region.bulkyWaste.feeUrl || !region.bulkyWaste.phone) {
    throw new Error(`${regionId}: region-policies.json에 대형폐기물 신청 URL·수수료 URL·전화번호가 모두 있어야 합니다.`);
  }

  const regionRows = rows.filter(r => r.CTPV_NM.startsWith("서울") && r.SGG_NM === gu);
  if (regionRows.length === 0) throw new Error(`${gu}: 표준데이터에 행이 없습니다.`);
  // 지자체 제출 기준일. 수집일이 아니라 이 값을 써야 신선도가 정직하게 드러난다.
  const checkedAt = [...new Set(regionRows.map(r => r.CRTR_YMD))].sort().pop()!;

  const grouped = new Map<string, Array<{ row: StandardRow; spec: string }>>();
  const skipped = new Map<string, number>();
  const rerouted: string[] = [];
  for (const row of regionRows) {
    const verdict = classifyName(row.LAR_WAS_NM, "whole_cell");
    if (!verdict.ok) {
      skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
      continue;
    }
    const rawSpec = row.LAR_WAS_SPCFCT;
    const spec = rawSpec && rawSpec !== "null" && String(rawSpec).trim() ? String(rawSpec).trim() : row.LAR_WAS_NM;
    const override = overrideItemId(row.LAR_WAS_NM, spec, verdict.itemId);
    if (override) rerouted.push(`${row.LAR_WAS_NM}/${spec}: ${verdict.itemId}→${override}`);
    const itemId = override ?? verdict.itemId;

    // 조례·구청 임포터와 같은 문턱. 대형폐기물 갈래가 없는 품목의 행은 런타임이
    // 어차피 안 읽고(`findBulkyWasteFees`), 남겨 두면 갈래가 바뀌는 순간 "수수료 0원"이
    // 답으로 나간다 — 노원구 「젖병소독기 / 가정용 소형 / 0원」이 그렇게 들어왔었다.
    if (!hasBulkyRoute(itemId)) {
      skipped.set("not_bulky_route", (skipped.get("not_bulky_route") ?? 0) + 1);
      continue;
    }

    // 한 줄이 두 품목을 겸하면 품목마다 한 행씩 만든다 — 관악구 「인형+장난감류」는
    // 장난감으로만 확정돼 인형은 금액을 통째로 잃고 있었다. 구청·조례 임포터와 같다.
    for (const target of [itemId, ...alsoItemIds(row.LAR_WAS_NM, itemId)]) {
      if (!hasBulkyRoute(target)) continue;
      const list = grouped.get(target) ?? [];
      list.push({ row, spec });
      grouped.set(target, list);
    }
  }

  const fees: BulkyWasteFee[] = [];
  const preCapFeeRowCountByItemId: Record<string, number> = {};
  const trimmed: string[] = [];
  for (const [itemId, group] of grouped) {
    const unique = new Map<string, BulkyWasteFee>();
    for (const { row, spec } of group) {
      // 고시명까지 키에 넣는다. 매트리스 일반/모션/라텍스는 spec이 "퀸"으로 같아도
      // 다른 제품이고 금액이 다르다 — spec만으로 합치면 한 규격에 금액이 둘 붙는다.
      const key = `${row.LAR_WAS_NM}|${spec}|${row.FEE}`;
      if (!unique.has(key)) {
        unique.set(key, {
          itemId,
          category: row.LAR_WAS_SE_NM ?? "기타",
          itemName: row.LAR_WAS_NM,
          spec,
          feeKrw: Number(row.FEE),
        });
      }
    }
    const sorted = [...unique.values()].sort((a, b) => a.feeKrw - b.feeKrw);
    if (sorted.length > MAX_FEE_ROWS) {
      trimmed.push(`${itemId} ${sorted.length}→${MAX_FEE_ROWS}`);
      preCapFeeRowCountByItemId[itemId] = sorted.length;
    }
    fees.push(...trimToCap(sorted));
  }

  built.push({
    regionId,
    regionName,
    checkedAt,
    applicationUrl: region.bulkyWaste.applicationUrl,
    feeUrl: region.bulkyWaste.feeUrl,
    phone: region.bulkyWaste.phone,
    source: {
      title: "전국대형폐기물수거수수료정보표준데이터 (행정안전부)",
      url: "https://www.data.go.kr/data/15114146/standard.do",
      sourceType: "official_guidance",
      checkedAt,
      basis: `${regionName}에서 제출한 대형폐기물 수수료 고시 ${regionRows.length}행 중 품목이 확정되는 행만 반영했습니다. 기준일은 지자체 제출일(CRTR_YMD)입니다.`,
      note: "오타 매칭·역방향 포함 매칭·수식어 위치 매칭·복수 품목 표기·옵션 요금 행은 제외했습니다.",
    },
    ...(Object.keys(preCapFeeRowCountByItemId).length > 0 ? { preCapFeeRowCountByItemId } : {}),
    fees,
  });

  console.log(`${gu}: 원본 ${regionRows.length}행 → 품목 ${grouped.size}개 / fee ${fees.length}행`);
  console.log(`  제외: ${JSON.stringify(Object.fromEntries(skipped))}`);
  if (rerouted.length) console.log(`  품목 재지정: ${rerouted.join(" / ")}`);
  if (trimmed.length) console.log(`  상한 적용: ${trimmed.join(", ")}`);
}

// 기존 지역(골든셋 4곳, Phase 6 결과)은 건드리지 않고 담당 지역만 갈아끼운다.
const managed = new Set(built.map(s => s.regionId));
const merged = [...existing.filter(s => !managed.has(s.regionId)), ...built];
writeFileSync(FEES_PATH, JSON.stringify(merged, null, 2) + "\n");
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((n, s) => n + s.fees.length, 0)}행`);
