/**
 * 임포터 품명 판정(`classifyName`)의 회귀 방어선.
 *
 * 이 규칙들은 지금까지 **어떤 검사에도 걸려 있지 않았다.** 임포터를 다시 돌려야
 * 드러나는데, 원문 덤프는 gitignore라 CI에서는 임포트 자체가 불가능하다. 실제로
 * 「유아용 X」 아홉 행은 임포터를 다시 돌린 게 아니라 결과 JSON에서 손으로 뺐고,
 * 그래서 `HEAD_COLLISION_NAMES_ANY_SPACING`을 통째로 지워도 `pnpm local:test`가
 * 그대로 통과했다. 막는 규칙이 아무것도 막지 않는 상태였다는 뜻이다.
 *
 * 여기서는 데이터를 거치지 않고 `classifyName`을 직접 태운다. 판정 함수만 있으면
 * 되는 검사라 원문 덤프가 없어도 돌고, 규칙을 지우면 그 자리에서 깨진다.
 *
 * `resolveWasteItem` 쪽 기대값도 함께 적는다. 임포터에서만 쓸 이름을 품목사전
 * 별칭으로 옮기려던 시도가 사용자 질의까지 바꿔 놓은 적이 있어서다 —
 * 「인형류 수납함」이 리빙박스 대신 인형으로 갔다. 임포터 전용 표(`IMPORT_ONLY_NAMES`)를
 * 넓힐 때 질의 쪽이 조용히 따라 움직이지 않는지를 같은 파일에서 본다.
 */
import { classifyName } from "./lib/bulky-item-match.js";
import type { NameSource, Verdict } from "./lib/bulky-item-match.js";

import { resolveWasteItem } from "../src/data.js";

type Expectation = {
  name: string;
  source: NameSource;
  /** 확정돼야 하면 품목 id, 거부돼야 하면 `classifyName`이 내는 `reason`. */
  expect: { itemId: string } | { reason: string };
};

const failures: string[] = [];

/**
 * 표 한 칸이 통째로 품명인 자리(`whole_cell`)의 기대값.
 *
 * 앞쪽은 "이 이름으로 품목을 확정하지 마라"는 차단 목록이고, 뒤쪽은 그 차단이
 * 멀쩡한 이름까지 삼키지 않는지 보는 반례다. 반례가 더 중요하다 — 차단 목록은
 * 규격 칸에서 곧 행 삭제로 번역돼서, 한 칸 넓히면 저장된 행이 소리 없이 사라진다.
 */
const wholeCellExpectations: Expectation[] = [
  // 붙여 쓴 「유아용 X」. 표마다 띄어쓰기가 갈려서 이 계열만 정규화로 막는다.
  // 유아용 싱크대·변기·욕조는 각각 `sink_unit`·`toilet_bowl`·`bathtub`의 **유일한 행**이
  // 된 적이 있고, 그때 주방 싱크대를 물은 사람에게 장난감 싱크대 값이 나갔다.
  { name: "유아용싱크대", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "유아용씽크대", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "유아용주방씽크대", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "유아용변기", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "유아용욕조", source: "whole_cell", expect: { reason: "head_collision" } },
  // 「유아용 놀이매트」는 요가매트가 아니다. 마포에서 이 행이 `yoga_mat`에 붙어
  // 요가매트 답이 돗자리 값에서 2,000원으로 바뀌었다.
  { name: "유아용놀이매트", source: "whole_cell", expect: { reason: "head_collision" } },
  // 띄어 쓴 원문 표기도 같은 판정이어야 한다. 정규화를 걷으면 여기가 먼저 깨진다.
  { name: "유아용 씽크대", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "유아용 변기", source: "whole_cell", expect: { reason: "head_collision" } },

  // 반대쪽. 아래 셋은 띄어쓰기만 다른 멀쩡한 품명이라 계속 확정돼야 한다.
  // 차단 목록을 `normalizeText` 키로 돌리면 이 셋이 함께 막히고, 영등포에 저장된
  // 「빨래 건조대 / 규격 식기 건조대」 같은 행이 규격 칸 판정에서 통째로 빠진다.
  { name: "식기 건조대", source: "whole_cell", expect: { itemId: "drying_rack" } },
  { name: "김치 통", source: "whole_cell", expect: { itemId: "airtight_container" } },
  { name: "상 자", source: "whole_cell", expect: { itemId: "delivery_box" } },
  // 붙여 쓴 철자는 표에서 실제로 본 것만 한 줄씩 적어 막는다.
  { name: "식기건조대", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "욕실수납장", source: "whole_cell", expect: { reason: "head_collision" } },
  { name: "욕실 수납장", source: "whole_cell", expect: { reason: "head_collision" } },

  // 임포터 전용 표. 서초 조례의 품명인데 `resolveWasteItem`으로는 안 열려서,
  // 칸 전체가 곧 품목인 이 자리에서만 확정한다.
  { name: "인형류", source: "whole_cell", expect: { itemId: "stuffed_toy" } },
  { name: "장난감류", source: "whole_cell", expect: { itemId: "toy" } },
  { name: "책상용의자", source: "whole_cell", expect: { itemId: "chair" } },
];

/**
 * 규격 칸을 낱말로 쪼갠 조각(`spec_fragment`)의 기대값.
 *
 * 조각은 앞뒤에 무엇이 붙어 있었는지를 잃은 상태라 칸 전체라는 전제가 성립하지
 * 않는다. 수납함 행의 규격 칸에 「장난감류 정리함」이 오면 조각 `장난감류`가 `toy`로
 * 확정되고, 품명과 itemId가 달라 행이 통째로 빠진다. 여기서는 원래대로 거부돼야 한다.
 */
const specFragmentExpectations: Expectation[] = [
  { name: "장난감류", source: "spec_fragment", expect: { reason: "modifier_position" } },
  { name: "인형류", source: "spec_fragment", expect: { reason: "not_found" } },
  { name: "책상용의자", source: "spec_fragment", expect: { reason: "ambiguous" } },
];

function describe(verdict: Verdict): string {
  return verdict.ok ? `item ${verdict.itemId}` : `reject ${verdict.reason}`;
}

for (const expectation of [...wholeCellExpectations, ...specFragmentExpectations]) {
  const verdict = classifyName(expectation.name, expectation.source);
  const expected = "itemId" in expectation.expect ? `item ${expectation.expect.itemId}` : `reject ${expectation.expect.reason}`;
  const actual = describe(verdict);
  if (actual !== expected) {
    failures.push(`classifyName("${expectation.name}", "${expectation.source}") → ${actual}; expected ${expected}`);
  }
}

/**
 * 런타임은 건드리지 않았다는 고정.
 *
 * 「인형류」·「장난감류」·「책상용의자」를 `waste-items.json` 별칭으로 넣어 봤다가 걷었다.
 * 별칭은 질의에도 함께 걸리는데 한국어는 핵심어가 뒤에 온다 — 앞에 붙은 「인형류」는
 * 수식어일 뿐인데 96점짜리 접두 매칭이 91점인 진짜 핵심어를 이겨, 「인형류 수납함」이
 * 리빙박스 대신 인형으로 확정됐다. 「책상용의자」는 98점이라 「책상용의자 커버」처럼
 * 되물어야 할 질의까지 의자로 확정했다 — 틀린 카드는 되묻기보다 나쁘다.
 */
const runtimeExpectations: Array<{ query: string; expect: string }> = [
  { query: "인형류 수납함", expect: "plastic_storage_box" },
  { query: "인형류 침대", expect: "bed_frame" },
  { query: "책상용의자 커버", expect: "not_found" },
  // 임포터 전용 표에 있다고 해서 질의로 열리지는 않는다는 것.
  { query: "인형류", expect: "not_found" },
];

for (const { query, expect } of runtimeExpectations) {
  const resolution = resolveWasteItem(query);
  const actual = resolution.status === "match" ? resolution.match.item.id : resolution.status;
  if (actual !== expect) {
    failures.push(`resolveWasteItem("${query}") → ${actual}; expected ${expect} — 임포터 전용 규칙이 질의 쪽으로 새면 안 된다`);
  }
}

if (failures.length > 0) {
  console.error(`Item classification test failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Item classification test passed: ${wholeCellExpectations.length} whole-cell names, ` +
    `${specFragmentExpectations.length} spec fragments, ${runtimeExpectations.length} runtime queries`,
);
