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
import { normalizeText, resolveWasteItem } from "../src/data.js";
import type { BulkyWasteFee, BulkyWasteFeeSchedule, RegionalPolicyData } from "../src/data.js";

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

// (regionId, itemId)당 fee 행 상한. Phase 6이 validate에 거는 값과 같아야 한다.
const MAX_FEE_ROWS = 12;

const TARGETS: Array<[string, string, string]> = [
  ["용산구", "yongsan_gu", "서울 용산구"],
  ["노원구", "nowon_gu", "서울 노원구"],
  ["강서구", "gangseo_gu", "서울 강서구"],
  ["관악구", "gwanak_gu", "서울 관악구"],
];

type Verdict =
  | { ok: true; itemId: string }
  | { ok: false; reason: string };

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
 */
function classifyName(rawName: string): Verdict {
  const base = rawName.replace(/[(（][^)）]*[)）]/g, " ").trim();
  if (/[,/·]/.test(base)) return { ok: false, reason: "multi_item_name" };
  if (/별도|추가금|추가 요금/.test(rawName)) return { ok: false, reason: "surcharge_row" };

  const resolved = resolveWasteItem(base);
  if (resolved.status !== "match") return { ok: false, reason: resolved.status };

  const { item, matchedBy, matchKind } = resolved.match;
  if (matchKind === "fuzzy_jamo") return { ok: false, reason: "typo_tier" };
  if (matchKind === "generic_fragment") return { ok: false, reason: "reverse_containment" };
  if (matchKind === "query_contains_name" && !normalizeText(base).endsWith(normalizeText(matchedBy))) {
    return { ok: false, reason: "modifier_position" };
  }

  return { ok: true, itemId: item.id };
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

  const grouped = new Map<string, StandardRow[]>();
  const skipped = new Map<string, number>();
  for (const row of regionRows) {
    const verdict = classifyName(row.LAR_WAS_NM);
    if (!verdict.ok) {
      skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
      continue;
    }
    const list = grouped.get(verdict.itemId) ?? [];
    list.push(row);
    grouped.set(verdict.itemId, list);
  }

  const fees: BulkyWasteFee[] = [];
  const trimmed: string[] = [];
  for (const [itemId, group] of grouped) {
    const unique = new Map<string, BulkyWasteFee>();
    for (const row of group) {
      const rawSpec = row.LAR_WAS_SPCFCT;
      const spec = rawSpec && rawSpec !== "null" && String(rawSpec).trim() ? String(rawSpec).trim() : row.LAR_WAS_NM;
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
    if (sorted.length > MAX_FEE_ROWS) trimmed.push(`${itemId} ${sorted.length}→${MAX_FEE_ROWS}`);
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
    fees,
  });

  console.log(`${gu}: 원본 ${regionRows.length}행 → 품목 ${grouped.size}개 / fee ${fees.length}행`);
  console.log(`  제외: ${JSON.stringify(Object.fromEntries(skipped))}`);
  if (trimmed.length) console.log(`  상한 적용: ${trimmed.join(", ")}`);
}

// 기존 지역(골든셋 4곳, Phase 6 결과)은 건드리지 않고 담당 지역만 갈아끼운다.
const managed = new Set(built.map(s => s.regionId));
const merged = [...existing.filter(s => !managed.has(s.regionId)), ...built];
writeFileSync(FEES_PATH, JSON.stringify(merged, null, 2) + "\n");
console.log(`\n${FEES_PATH}: 지역 ${merged.length}곳, fee ${merged.reduce((n, s) => n + s.fees.length, 0)}행`);
