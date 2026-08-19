import type { WasteItem } from "./data.js";
import { disposalGroupLabel, itemNeedsCriticalRegionCheck, itemNeedsRegionCheck } from "./data.js";

/**
 * Kakao Tools widget payload for get_disposal_steps (PRD phase-3).
 *
 * Kakao's three deviations from plain ChatKit widgets:
 *   1. the whole widget is wrapped in a `widget` property,
 *   2. `status` must be absent (Kakao fills it with its own logo/service name),
 *   3. `copy_text` sits at the top level for 카톡 share.
 * The payload is serialized into `content[0].text`; anything Kakao cannot parse
 * degrades to a plain-text answer rather than an error.
 *
 * Component choice is deliberately conservative — Card/Title/Text/Caption/Divider
 * only. A single unsupported node type drops the whole card to text fallback, and
 * each Preview retry costs a push + redeploy round-trip. Badge for the disposal
 * group is the first upgrade to try once Preview confirms the basic card renders.
 */

const WIDGET_NAME = "disposal_steps";
const SERVICE_LABEL = "재활용척척";
const MAX_CARD_CAUTIONS = 2;
const MAX_CARD_REGION_NOTES = 2;
// R3's 3~6 line copy_text budget. Everything else about the share is derived
// from it rather than pinned separately: the title always takes a line, the
// confidence note takes one when the item has it, and the steps get what is
// left — so adding a line above the steps narrows the steps instead of pushing
// the share past 6 lines.
const MAX_COPY_TEXT_LINES = 6;
// The floor. 11 items resolve to a single step, and a two-line share is a title
// plus one instruction with no verdict attached.
const MIN_COPY_TEXT_LINES = 3;
// The data has no severity field, so injury/fire wording is the only signal that
// a caution must not be the one MAX_CARD_CAUTIONS drops. Ordering, not filtering:
// nothing is removed that the cap would have kept.
const SAFETY_CAUTION_PATTERN = /다치|감싸|감쌉|위험|폭발|인화|화재|날카|베임|감전|누출|밀봉|뾰족/;
// 324개 중 75개가 medium이다. 2026-08-18 결정 변경(phase-3 PRD "R4 결정 변경")으로 위젯 응답도
// structuredContent에 confidence를 실어 보내지만, 그건 모델이 읽는 값이다. 카드만 눈으로 보는
// 사용자는 여전히 한 번 더 확인해야 할 답을 확정된 답으로 읽으므로 이 줄은 카드에 남는다.
// 등급 이름을 옮겨 적는 대신 할 일로 쓴다 — "보통"은 그래서 뭘 하라는 건지 알려주지 않는다.
//
// 확신도는 "분류가 덜 확실하다"는 뜻이지 "지역마다 갈린다"는 뜻이 아니다. 지역을 다시 확인하라는
// 말은 regionNodes가 자기 조건에 맞게 이미 하고 있고, medium 75개 중 40개가 지역 확인 필수라
// 두 줄이 같은 말이 된다. 그래서 이 줄은 분류 이야기만 한다.
const UNCERTAIN_CONFIDENCE_NOTE = "품목 상태나 재질에 따라 분류가 갈릴 수 있으니 아래 근거를 함께 확인하세요.";
// 공유본에는 근거 줄이 없고 한 줄이 길면 그만큼 단계가 밀린다. 같은 이야기를 짧게 줄인 판이다.
const UNCERTAIN_CONFIDENCE_SHARE_NOTE = "※ 상태나 재질에 따라 분류가 갈릴 수 있는 품목입니다.";

type WidgetNode = Record<string, unknown>;

export type DisposalWidgetPayload = {
  widget: WidgetNode;
  copy_text: string;
  name: string;
};

export type DisposalWidgetInput = {
  item: WasteItem;
  /** Representative source title, resolved by the caller (server.ts owns that rule). */
  sourceTitle: string;
  /**
   * Confirmation date of that same source. The text path has carried it since
   * Phase 0 (formatSources), so the card was the one place a reader could not
   * tell whether a 조례 수수료 was checked this summer or last year. Optional
   * because the `sourceRefs` fallback has a title and no date.
   */
  sourceCheckedAt?: string;
  /** Canonical name of the matched region, not the user's raw input. */
  regionName?: string;
  /** Region guidance lines the handler already computed, in "- text" form. */
  regionNotes?: string[];
  /**
   * One-line bulky-waste fee summary, pre-formatted by the handler. Kept out of
   * `regionNotes` on purpose — see regionNodes() for why it needs its own slot.
   */
  regionFeeLine?: string;
  /**
   * 사진으로 들어온 요청에 붙는 확인 문구. 문장은 핸들러가 만들어 넘긴다 — 카드는
   * 다시 만들지 않는다. `copy_text`에는 싣지 않는다: 공유받는 사람은 사진을 보낸
   * 적이 없어서 "사진 속 물건" 이야기가 맥락 없이 뜬금없다.
   */
  photoNote?: string;
};

function text(value: string): WidgetNode {
  return { type: "Text", value };
}

function caption(value: string): WidgetNode {
  return { type: "Caption", value };
}

function divider(): WidgetNode {
  return { type: "Divider" };
}

function stripBullet(line: string): string {
  return line.replace(/^\s*-\s*/, "");
}

/**
 * PRD R2-1. A user who named their region should see that region's rule on the
 * card, not a generic "check your area" line. `regionName` is only set when the
 * item actually needs a region check, so a nationally uniform item gets no
 * region line at all.
 */
function regionNodes({ item, regionName, regionNotes, regionFeeLine }: DisposalWidgetInput): WidgetNode[] {
  if (!itemNeedsRegionCheck(item)) return [];

  if (!regionName) {
    // Only a *required* region check earns the ask. Advisory-level items read as
    // complete without one — formatItemGuide adds no region section for them
    // either — and they are a third of the catalogue, so gating on
    // itemNeedsRegionCheck here would put a needless demand on 42 of 130 cards.
    return itemNeedsCriticalRegionCheck(item) ? [text("거주 지역 기준 확인 필요")] : [];
  }

  // The fee is the one number the user came for. formatRegionItemGuide emits it
  // last, behind the generic 사전 신청 boilerplate, so slicing regionNotes to two
  // lines always ate it. Since 2026-08-18 a widget response carries the text
  // path's structuredContent too (phase-3 PRD "R4 결정 변경"), so the model can
  // recover the dropped lines from the uncut `regionNotes` — but the user reading
  // the card cannot, and the fee is what they asked for. It keeps its own line
  // outside that budget.
  const fee = regionFeeLine ? [text(regionFeeLine)] : [];

  if (regionNotes && regionNotes.length > 0) {
    return [
      caption(`${regionName} 기준`),
      ...fee,
      ...regionNotes.slice(0, MAX_CARD_REGION_NOTES).map((note) => text(stripBullet(note))),
    ];
  }

  return [...fee, text(`${regionName} 거주지 배출 기준만 확인하면 됩니다.`)];
}

/**
 * Safety cautions first, everything else after, each group keeping its data
 * order. Without this the cap slices by authoring order, which on 나무젓가락
 * kept two informational lines and dropped "날카롭게 부러진 젓가락은 수거
 * 작업자가 다치지 않게 감싸서 배출하세요".
 */
function orderCautions(cautions: string[]): string[] {
  const safety = cautions.filter((line) => SAFETY_CAUTION_PATTERN.test(line));
  return safety.length > 0 ? [...safety, ...cautions.filter((line) => !SAFETY_CAUTION_PATTERN.test(line))] : cautions;
}

export function buildDisposalWidget(input: DisposalWidgetInput): DisposalWidgetPayload {
  const { item, sourceTitle, sourceCheckedAt, photoNote } = input;
  const cautions = orderCautions(item.cautions).slice(0, MAX_CARD_CAUTIONS);
  const region = regionNodes(input);

  const children: WidgetNode[] = [
    { type: "Title", value: item.name },
    caption(disposalGroupLabel(item.disposalType)),
    // 확신도 문구처럼 아래에 몰아두지 않고 배출 그룹 캡션과 결론 사이에 둔다. 확신도는
    // "이 답을 한 번 더 확인하라"지만 이쪽은 "이 카드가 네 물건 이야기가 맞느냐"라,
    // 단계까지 다 읽은 뒤에 나오면 이미 엉뚱한 품목을 따라 한 뒤가 된다.
    ...(photoNote ? [caption(photoNote)] : []),
    text(item.summary),
    divider(),
    ...item.steps.map((step, index) => text(`${index + 1}. ${step}`)),
    ...(cautions.length > 0 ? [divider(), ...cautions.map((line) => caption(`주의: ${line}`))] : []),
    ...(region.length > 0 ? [divider(), ...region] : []),
    ...(item.confidence === "high" ? [] : [caption(UNCERTAIN_CONFIDENCE_NOTE)]),
    caption(sourceCheckedAt ? `근거: ${sourceTitle} · ${sourceCheckedAt} 확인` : `근거: ${sourceTitle}`),
  ];

  return {
    widget: { type: "Card", children },
    copy_text: buildCopyText(item),
    name: WIDGET_NAME,
  };
}

/**
 * Simple markdown only — bold/italic/list/inline code. Links and headings are
 * unsupported by 카톡 share and would render as raw characters.
 */
export function buildCopyText(item: WasteItem): string {
  // The card's caveat has to ride along: shared to 카톡 this is everything the
  // recipient sees, so without it a medium item arrives as a settled verdict.
  const note = item.confidence === "high" ? [] : [UNCERTAIN_CONFIDENCE_SHARE_NOTE];
  // Title plus the note, if there is one — the steps get the rest of the budget.
  const stepBudget = MAX_COPY_TEXT_LINES - 1 - note.length;
  const truncated = item.steps.length > stepBudget;
  // When steps are cut, one line of that budget buys the "there is more" marker.
  // Silent truncation reads as a complete procedure to whoever receives the share.
  const steps = item.steps.slice(0, truncated ? stepBudget - 1 : stepBudget);
  // Title + steps can fall under the floor on a one-step item. The conclusion is
  // what the recipient is missing there, so it fills the gap rather than padding
  // — and the caveat cannot stand in for it, which is why it is not counted here.
  const lead = 1 + steps.length < MIN_COPY_TEXT_LINES ? [item.summary] : [];
  return [
    `**${item.name} 버리는 법** — ${SERVICE_LABEL}`,
    ...note,
    ...lead,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    ...(truncated ? [`(남은 ${item.steps.length - steps.length}단계는 카드에서 확인하세요)`] : []),
  ].join("\n");
}
