/**
 * 조례·구청 수수료표를 우리 품목으로 잇는 공용 규칙 (Phase 6).
 *
 * 지금 이 모듈을 쓰는 트랙은 **둘**이다 — 자치법규 조례(`import-ordinance-fees.ts`)와
 * 구청 수수료표(`import-district-fees.ts`). 출처는 달라도 위험은 같다: 질의는
 * 빗나가도 사용자가 다시 물으면 되지만, 여기서 잘못 붙은 이름은 그대로 금액이 되어
 * 확신 있는 오답으로 굳는다.
 *
 * 원래는 `import-ordinance-fees.ts`에 있던 코드다. 구청 트랙을 만들며 세 번째
 * 사본이 생길 참이라 여기로 뺐다 — 사본이 어긋나면 트랙마다 다른 답이 나오고,
 * 그게 어느 쪽 잘못인지 알아내는 데 시간이 다 든다.
 *
 * 2026-08-16에 `import-bulky-fees.ts`(공공데이터포털 표준데이터)의 사본까지 걷어
 * **세 트랙이 모두 이 모듈을 쓴다.** 그 사본은 이미 갈라져 있었다 — 매트리스 힌트에
 * `deny`가 없고 `stone_bed`·`bicycle` 규칙과 짧은 별칭 수식어 검사도 없었다.
 * 옮기면서 용산·노원·강서·관악 4곳의 행이 실제로 바뀌었고(+8/−19) 변화를 하나씩
 * 확인했다. 자세한 내용은 [Phase 6 PRD](../../docs/prd/phase-6-bulky-fee-etl.md).
 */
import { readFileSync } from "node:fs";

import { normalizeText, resolveWasteItem } from "../../src/data.js";
import type { WasteItem } from "../../src/data.js";

const ITEMS_PATH = "src/data/waste-items.json";
const GROUPS_PATH = "src/data/disposal-groups.json";

/**
 * 품명 판정은 `import-bulky-fees.ts`의 규칙을 그대로 쓴다 — 출처는 달라도 위험은
 * 같다. 질의는 빗나가도 사용자가 다시 물으면 되지만, 여기서 잘못 붙은 이름은
 * 그대로 금액이 되어 확신 있는 오답으로 굳는다.
 *
 * 조례에서만 나오는 위험이 둘 더 있어 아래 usableRow에서 따로 막는다.
 */
export const HEAD_COLLISION_NAMES = new Set([
  "식기건조대",
  "욕실 수납장",
  "상자",
  "김치통",
  "골프채 가방",
  // `유아용 X`는 핵심어가 뒤라 수식어 검사를 통과하는데, 물건은 전혀 다르다. 마포
  // 조례를 넣으며 실제로 새어 나왔다 — `sink_unit`의 **유일한 행**이 「유아용 씽크대 /
  // 3,000원」이 되어, 주방 싱크대를 물은 사람에게 장난감 싱크대 값이 나갔다.
  //
  // `유아용`을 통째로 막지는 않는다. 「유아용 침대」는 진짜 침대고 금액도 그 품목의
  // 것이다. 어느 쪽인지는 물건마다 달라 규칙으로 못 가르므로, 확인한 이름만 적는다.
  "유아용 씽크대",
  // 「유아용 놀이매트」는 요가매트가 아니다. 마포에서 이 행이 `yoga_mat`에 붙어
  // 요가매트 답이 1,000원(돗자리)에서 2,000원으로 바뀌었다.
  "유아용 놀이매트",
]);

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
 * `별도`도 같은 뜻인데 빠져 있었다 — 성동구 「침대틀 / 1인용, 매트리스 별도 / 5,000원」이
 * `mattress`로 들어가, 매트리스를 물은 사람이 프레임만의 값을 후보로 받았다.
 */
export const SPLIT_HINTS: Array<{ from: string; hint: RegExp; to: string; deny?: RegExp }> = [
  { from: "bed_frame", hint: /매트리스|토퍼/, to: "mattress", deny: /(매트리스|토퍼)\s*[)）]?\s*(제외|미포함|불포함|없음|포함|별도)/ },
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
export function cleanLabel(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  // 같은 품명을 여러 줄에 적을 때 뒤에 마침표를 붙여 구분하는 표가 있다 — 서대문
  // 「냉장고.」·「선풍기..」·「오디오..」. 답변에 그대로 찍히므로 떼어낸다. 품명 안쪽
  // 마침표(`1.5L` 같은)는 건드리지 않도록 끝에 붙은 것만 본다.
  out = out.replace(/[.·]+$/, "").trim();
  const open = (out.match(/[(（]/g) ?? []).length;
  const close = (out.match(/[)）]/g) ?? []).length;
  if (close > open) out = out.replace(/[)）]+\s*$/, "").trim();
  if (open > close) out = out.replace(/^[(（]+\s*/, "").trim();
  return out;
}

export type Verdict = { ok: true; itemId: string } | { ok: false; reason: string };

export function classifyName(rawName: string): Verdict {
  // 밑줄은 「품목_조건」을 가르는 표기다 — 관악구 고시명이 그렇다. 「식탁_유리제외」는
  // 유리를 뺀 식탁이고, 「화장대_거울+의자 제외」는 화장대다. 한국어는 핵심어가 뒤에
  // 온다는 규칙을 그대로 적용하면 뒤쪽 조건이 핵심어로 잡혀 통째로 버려진다 — 실제로
  // 관악구는 이 규칙 하나로 식탁과 난로가 전부 사라졌다. 밑줄 앞을 품명으로 본다.
  // 「커튼 지지대_커튼 봉」처럼 앞쪽 자체가 부속품이면 아래 수식어 검사가 그대로 잡는다.
  const named = rawName.split("_")[0];
  const base = named.replace(/[(（][^)）]*[)）]/g, " ").replace(/\s+/g, " ").trim();
  if (base.length === 0) return { ok: false, reason: "empty_after_paren_strip" };
  // `+`는 규칙으로 가르지 않는다. 여러 품목을 묶은 것(「난로+가스히터」,
  // 「골프채+낚싯대+등산스틱」)도 있지만, 한 품목의 재질·동의어를 잇는 것
  // (「돌+옥+황토 침대」, 「김장독+항아리」, 「천막+텐트」)도 있어서 `+`만 보고
  // 버리면 멀쩡한 행이 함께 사라진다. 실제로 넣어 봤다가 관악구에서 항아리·천막·
  // 라켓이 통째로 빠지고 돌침대 재지정까지 막혀 되돌렸다. 뒤쪽이 핵심어면 아래
  // 수식어 검사가, 정말 다른 품목이면 규격 검사가 각각 맡는다.
  if (/[,/·ㆍ]/.test(base)) return { ok: false, reason: "multi_item_name" };
  if (/별도|추가금|추가 요금/.test(named)) return { ok: false, reason: "surcharge_row" };
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
export function hasBulkyRoute(itemId: string): boolean {
  const item = itemsById.get(itemId);
  return item ? (groupLabels[item.disposalType] ?? "").includes("대형폐기물") : false;
}

/**
 * 규격 칸에 실제로 적히는 표현. 숫자와 단위가 들어가거나, 크기·용도를 가르는
 * 닫힌 어휘다. 규격 열이 비어 있는 표를 가려내는 데 쓴다.
 */
export const SPEC_LIKE =
  /\d|모든\s*규격|소\s*형|중\s*형|대\s*형|특대|일\s*반|업소용|영업용|가정용|유아용|아동용|성인용|미\s*만|이\s*상|이\s*하|초\s*과|당$|개당|쪽당|폭당|접이식|휴대용|기\s*타/;

/**
 * 규격 칸에서 품목명 후보를 뽑는다. 괄호 안은 버린다 — 조례가 괄호에 적는 것은
 * 「(세면대 제외)」·「(측면책꽂이 포함)」·「(책상+의자 1개)」처럼 값에 무엇이 들고
 * 나는지에 대한 설명이라, 그 자체가 다른 품목의 행이라는 뜻이 아니다.
 *
 * 나머지는 구분자와 공백으로 쪼개 낱말 단위로 본다. 한 낱말짜리는 건너뛴다.
 */
export function specNameCandidates(spec: string): string[] {
  const stripped = spec.replace(/[(（][^)）]*[)）]/g, " ");
  // `없음`·`제외`가 붙은 구절은 무엇이 빠졌는지를 적은 것이다 — 강북구
  // 「서랍, 수납장 없음」은 수납장 행이 아니라 수납장이 없는 책상 행이다.
  if (/없\s*음|제\s*외|미포함|불포함|별\s*도/.test(stripped)) return [];
  return stripped
    .split(/[\s/,·ㆍ、]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

/** 수수료 행에 실을 품목 분류. 세 트랙이 같은 값을 써야 응답에서 갈래가 갈리지 않는다. */
export function itemCategory(itemId: string): string {
  const item = itemsById.get(itemId);
  if (!item) throw new Error(`unknown itemId: ${itemId}`);
  return item.category;
}
