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
 *
 * 막을 이름은 두 목록으로 나눠 담는다. 표기 그대로 맞추는 쪽이 여기고, 띄어쓰기를
 * 무시하고 맞추는 쪽이 아래 `HEAD_COLLISION_NAMES_ANY_SPACING`이다.
 *
 * ---
 *
 * 이쪽은 표에서 실제로 본 철자만 담는다.
 *
 * 한때 이 목록도 `normalizeText` 키로 돌렸다가 되돌렸다. 정규화는 「유아용싱크대」처럼
 * 붙여 쓴 표기를 잡아 주지만, 동시에 **띄어 쓴 멀쩡한 규격 칸까지** 이 목록에 끌어들인다.
 * 영등포에 「빨래 건조대 / 규격 식기 건조대 / 1,000원」이 저장돼 있는데, `식기 건조대`가
 * `식기건조대`와 같아지는 순간 `usableRow`의 규격 칸 판정이 `head_collision`을 받아
 * `spec_is_not_a_size`로 행을 통째로 버린다 — 다음 `pnpm import:ordinance`에서 저장된
 * 행이 소리 없이 사라진다는 뜻이다.
 *
 * 이 목록은 "이 이름으로 품목을 확정하지 마라"는 뜻인데, 규격 칸에서는 그 거부가 곧
 * 행 삭제로 번역된다. 그래서 넓히는 데 값이 붙는다. 아래 `ANY_SPACING` 쪽만 넓히고
 * 여기는 확인한 철자만 한 줄씩 적는다.
 */
export const HEAD_COLLISION_NAMES = new Set([
  "식기건조대",
  "욕실 수납장",
  // 붙여 쓴 표기도 같은 물건이라 함께 적는다. 정규화로 뭉뚱그리지 않고 철자마다 한 줄씩
  // 적는 것이 이 목록의 방식이다.
  "욕실수납장",
  "상자",
  "김치통",
  "골프채 가방",
]);

/**
 * 띄어쓰기와 무관하게 막는 쪽. 키도 검사도 `normalizeText`를 거친 형태로 한다.
 *
 * `유아용 X`는 핵심어가 뒤라 수식어 검사를 통과하는데, 물건은 전혀 다르다. 마포
 * 조례를 넣으며 실제로 새어 나왔다 — `sink_unit`의 **유일한 행**이 「유아용 씽크대 /
 * 3,000원」이 되어, 주방 싱크대를 물은 사람에게 장난감 싱크대 값이 나갔다.
 *
 * 이 계열만 정규화하는 이유는 표마다 붙여 쓰기가 갈리기 때문이다 — 강서 「유아용카시트」,
 * 강북 「유아카시트」. 원문으로 맞추면 띄어쓰기 한 칸에 규칙이 뚫린다. 반대로 「유아용 X」가
 * 규격 칸에 오는 행은 `SPEC_LIKE`가 `유아용`을 크기 어휘로 이미 잡아 통과시키므로,
 * 여기를 정규화해도 위 목록에서 겪은 규격 칸 부작용이 생기지 않는다.
 *
 * `유아용`을 통째로 막지는 않는다. 「유아용 침대」는 진짜 침대고 금액도 그 품목의
 * 것이다. 어느 쪽인지는 물건마다 달라 규칙으로 못 가르므로, 확인한 이름만 적는다.
 */
export const HEAD_COLLISION_NAMES_ANY_SPACING = new Set(
  [
    // 표기가 갈리는 것도 각각 적는다. 「씽크대」만 막아 뒀더니 같은 물건이 다른 철자로
    // 그대로 새어 나왔다 — 노원·도봉은 「유아용 싱크대」, 성북은 「유아용 주방씽크대」다.
    "유아용 씽크대",
    "유아용 싱크대",
    "유아용 주방씽크대",
    // 변기와 욕조도 같은 갈래다. 「유아용 변기」는 유아 변기이고 「유아용 욕조」는
    // 플라스틱 대야다. 둘 다 붙박이 위생도기가 아닌데, 용산 `toilet_bowl`과 도봉·성동
    // `bathtub`은 **유일한 행**이 이것이어서 변기·욕조를 물으면 이 값이 나갔다.
    "유아용 변기",
    "유아용 욕조",
    // 「유아용 놀이매트」는 요가매트가 아니다. 마포에서 이 행이 `yoga_mat`에 붙어
    // 요가매트 답이 1,000원(돗자리)에서 2,000원으로 바뀌었다.
    "유아용 놀이매트",
  ].map(normalizeText),
);

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
 *
 * **낱말 바로 뒤만 보는 것으로는 부족하다.** 강남 구청 표는 세트를 「1인용 세트
 * (매트리스1개+틀) / 10,000원」으로 적는데, `매트리스` 뒤에 오는 것이 `1개+틀`이라
 * 위 `deny`를 그대로 빠져나가 `mattress`로 들어갔다 — 매트리스만 버리려는 사람이
 * 세트 값 10,000원을 후보로 받는다(실제 1인용 매트리스는 5,000원). 그래서 같은 칸에
 * **틀·프레임이 함께 적힌 행**도 막는다.
 *
 * 막으면 그 행은 원래 자리인 `bed_frame`에 남는다. 버리지 않는 이유는 세트가 실제로
 * 존재하는 배출 방식이고, 규격 칸이 「1인용 세트 (매트리스1개+틀)」처럼 스스로를 설명해서
 * 후보 목록에서 프레임만의 값(5,000원)과 구별되기 때문이다. 매트리스 쪽으로 가는 것만
 * 막으면 리뷰가 짚은 해악 — 매트리스만 버리는 사람이 세트 값을 받는 것 — 은 사라진다.
 *
 * 여기에 낱말 `프레임`을 조건 없이 얹었다가 걷었다. 세트를 막으려던 것인데 세트는 위
 * 두 대안이 이미 잡고, 대신 「매트리스만(프레임 제외)」·「매트리스, 프레임 별도」처럼
 * **매트리스 행임을 프레임이라는 낱말로 설명하는 표기**를 통째로 막아 버렸다. 이 규칙이
 * 막으려는 역전을 이 규칙이 만드는 꼴이었다. 받아 둔 원문 다섯 종(강남 구청 213행,
 * 강남·마포·서초·송파 조례 923행)에서 `매트리스|토퍼`가 걸리는 행을 전부 꺼내 대조해
 * 보면 이 낱말을 빼도 판정이 달라지는 행이 하나도 없다 — 위험만 남기고 하는 일이 없었다.
 */
export const SPLIT_HINTS: Array<{ from: string; hint: RegExp; to: string; deny?: RegExp }> = [
  {
    from: "bed_frame",
    hint: /매트리스|토퍼/,
    to: "mattress",
    deny: /(매트리스|토퍼)\s*[)）]?\s*(제외|미포함|불포함|없음|포함|별도)|세\s*트|매트리스[^)）]*[+＋]\s*틀|틀\s*[+＋][^)）]*매트리스/,
  },
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

/**
 * 상위 재질어 + 괄호 안 실제 품목. 괄호를 떼면 재질어만 남아 `ambiguous`로 버려지는데,
 * 그 모호함은 일부러 남긴 것이다 — 「유리」는 확정하지 말고 되묻는 편이 낫다는 결정이
 * 이미 있다. 그렇다고 행을 버리면 금액이 사라진다. 강남 「유리(거울/판유리) / 1㎡당 /
 * 2,000원」이 그 경우고, 구청 표로 갈아타며 실제로 빠져 `gangnam_mirror_fee` 회귀
 * 케이스가 잡아냈다.
 *
 * 「괄호 안 첫 품목을 택한다」는 일반 규칙은 쓰지 않는다. 괄호가 품목이 아니라 재질
 * 열거인 경우가 섞여 있어서다 — 「침대(흙,돌,황토,의료)」를 그렇게 읽으면 흙으로 간다.
 * SPLIT_HINTS와 같은 원칙으로, 근거를 확인한 쌍만 적는다.
 */
// 키는 `normalizeText`를 거친 형태로 담는다. 원문 표기를 그대로 키로 쓰면 괄호·슬래시가
// 정규화에서 사라져 영원히 안 맞는다 — 실제로 처음 그렇게 넣었다가 조용히 통과했다.
const LABEL_PICKS = new Map<string, string>(
  (
    [
      ["유리(거울/판유리)", "mirror"],
      // 강남 표에는 리빙박스 행이 없고, 무게로 매기는 이 줄이 그 자리를 맡는다. 수기
      // 데이터가 그렇게 이어 놨고 `gangnam_large_plastic_storage_box_size_split` 회귀
      // 케이스가 그 결정을 붙들고 있다 — 자동 판정만으로는 상위어라 거부된다.
      ["기타 프라스틱류", "plastic_storage_box"],
      // 우리 품목 둘을 한 칸에 묶어 적은 라벨. `/` 때문에 아래 `multi_item_name`에서
      // 거부돼 두 품목이 다 금액을 잃는다 — 강남 toy·stuffed_toy가 4행에서 0행이 됐고,
      // 처음엔 `ALSO_ITEM_IDS`만 넣었다가 여기서 먼저 걸러지는 걸 못 봐서 죽은 코드가
      // 됐다. 확정은 toy로 하고 stuffed_toy는 `ALSO_ITEM_IDS`가 겸하게 한다.
      ["인형/ 장난감류", "toy"],
    ] as const
  ).map(([label, itemId]) => [normalizeText(label), itemId]),
);

/**
 * 조례·구청 표가 쓰는 품명 표기 중 **질의 별칭으로는 두면 안 되는** 것들.
 *
 * 셋 다 서초 조례에 실제로 있는 품명인데 `resolveWasteItem`이 못 연다 —
 * 「인형류」는 `not_found`, 「장난감류」는 `modifier_position`, 「책상용의자」는
 * `ambiguous`다. 그래서 `waste-items.json`에 별칭으로 넣어 봤다가 걷었다.
 * 별칭은 질의에도 함께 걸리는데, 「인형류」는 세 글자라 짧은 별칭 예외를 못 받고
 * 96점짜리 접두 매칭(`query_contains_name`) 자리를 차지한다. 한국어는 핵심어가
 * 뒤에 오므로 앞에 붙은 「인형류」는 수식어일 뿐인데도, 91점인 진짜 핵심어를 이겨
 * 「인형류 수납함」이 리빙박스 대신 인형으로, 「인형류 옷장」이 옷장 대신 인형으로
 * 확정됐다. 「책상용의자」는 98점이라 더해서, 「책상용의자 커버」처럼 되물어야 할
 * 질의까지 의자로 확정했다 — 틀린 카드는 되묻기보다 나쁘다.
 *
 * 애초에 필요한 곳은 질의가 아니라 표 한 칸이다. 표의 품명은 칸 전체가 곧 품목이라
 * 수식어 자리가 없고, 여기서만 확정하면 질의 쪽은 아무것도 바뀌지 않는다.
 * `LABEL_PICKS`와 나눠 둔 이유는 사연이 달라서다 — 저쪽은 괄호를 떼면 판정 근거가
 * 사라지는 라벨이고, 이쪽은 표기 자체는 멀쩡한데 질의로 열면 손해가 나는 이름이다.
 *
 * **"칸 전체"라는 근거가 성립하는 자리에서만 본다**(`classifyName`의 `source` 인자).
 * 임포터는 규격 칸도 낱말 단위로 쪼개 `classifyName`에 태우는데, 그 조각은 칸 전체가
 * 아니라 수식어일 수 있는 낱말이다. 수납함 행의 규격 칸에 「장난감류 정리함」이 오면
 * 조각 `장난감류`가 여기서 `toy`로 확정되고, 품명과 itemId가 달라 `spec_names_other_item`
 * 으로 행이 통째로 빠진다 — 전에는 `modifier_position`으로 걸러져 행이 살아 있었다.
 * 이 표를 만든 목적인 서초 병합 임포트가 바로 그 자리다.
 */
const IMPORT_ONLY_NAMES = new Map<string, string>(
  (
    [
      ["인형류", "stuffed_toy"],
      ["장난감류", "toy"],
      ["책상용의자", "chair"],
    ] as const
  ).map(([label, itemId]) => [normalizeText(label), itemId]),
);

/**
 * 한 줄이 두 품목을 겸하는 경우. 고시·구청 표는 우리 품목 둘을 한 칸에 묶어 적기도
 * 하고(「인형/ 장난감류」), 우리 품목 하나에만 해당하는 줄이 다른 품목의 유일한 후보이기도
 * 하다(강남 표에 요가매트 행이 없어서 「돗자리(대자리/놀이매트) 1㎡당」이 그 자리를 맡는다).
 *
 * 하나만 고르면 나머지 품목은 금액을 통째로 잃는다. 수기 데이터는 같은 줄을 두 품목에
 * 각각 달아 뒀고, `gangnam_yoga_mat_not_blanket`·`gangnam_toy_fee` 계열 회귀 케이스가
 * 그 결정을 붙들고 있다. 그래서 표를 따로 두고 임포터가 품목마다 한 행씩 만든다.
 *
 * 여기 적는 값은 `classifyName`이 이미 확정한 품목에 **더하는** 것이다. 확정 자체를
 * 바꾸지 않으므로, 이 표를 지우면 동작이 예전으로 돌아갈 뿐 엉뚱한 품목이 생기지 않는다.
 *
 * 처음엔 구청 임포터만 이 표를 소비했다. 그래서 같은 라벨이 트랙에 따라 다른 답을 냈고,
 * 마포가 그 값을 치렀다 — 조례에 돗자리 행이 있는데도 요가매트가 금액을 잃었다. 지금은
 * 조례 임포터도 함께 쓴다. 표준데이터 트랙(`import-bulky-fees.ts`)은 아직 아니다.
 */
const ALSO_ITEM_IDS = new Map<string, readonly string[]>(
  (
    [
      // 확정은 `LABEL_PICKS`가 toy로 낸다. 여기서는 겸하는 쪽만 적는다.
      ["인형/ 장난감류", ["stuffed_toy"]],
      ["돗자리(대자리/놀이매트)", ["yoga_mat"]],
      // 강남 구청 표는 괄호를 달아 적고 마포 조례는 「돗자리」 한 낱말로 적는다. 같은
      // 물건인데 라벨이 달라 마포만 요가매트가 빈손이 됐다 — 수기 데이터도 서초 데이터도
      // 돗자리를 요가매트 자리에 놓는다. `돗자리`는 `picnic_mat`으로 확정되고 여기서
      // 요가매트를 겸한다.
      ["돗자리", ["yoga_mat"]],
    ] as const
  ).map(([label, ids]) => [normalizeText(label), ids]),
);

/**
 * 이 라벨이 겸하는 **추가** 품목. 확정 품목은 포함하지 않는다.
 * 임포터가 확정 행을 만든 뒤 같은 금액으로 한 행씩 더 만드는 데 쓴다.
 */
export function alsoItemIds(rawName: string, decidedItemId: string): readonly string[] {
  const extra = ALSO_ITEM_IDS.get(normalizeText(rawName));
  if (!extra) return [];
  return extra.filter((itemId) => itemId !== decidedItemId);
}

/**
 * 이 이름이 표의 어느 자리에서 왔는가.
 *
 * - `whole_cell` — 품명 칸 전체, 또는 규격 칸 전체. 칸 하나가 곧 품목이라 수식어 자리가 없다.
 * - `spec_fragment` — 규격 칸을 `specNameCandidates`가 낱말로 쪼갠 조각. 앞뒤에 무엇이
 *   붙어 있었는지 잃은 상태라, 칸 전체임을 전제하는 규칙(`IMPORT_ONLY_NAMES`)은 걸지 않는다.
 */
export type NameSource = "whole_cell" | "spec_fragment";

export function classifyName(rawName: string, source: NameSource): Verdict {
  // 괄호를 떼기 전에 먼저 본다. 떼고 나면 판정 근거가 되는 괄호 내용이 사라진다.
  const normalizedRaw = normalizeText(rawName);
  const picked =
    LABEL_PICKS.get(normalizedRaw) ??
    (source === "whole_cell" ? IMPORT_ONLY_NAMES.get(normalizedRaw) : undefined);
  if (picked) return { ok: true, itemId: picked };

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
  if (HEAD_COLLISION_NAMES.has(base) || HEAD_COLLISION_NAMES_ANY_SPACING.has(normalizeText(base))) {
    return { ok: false, reason: "head_collision" };
  }

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
