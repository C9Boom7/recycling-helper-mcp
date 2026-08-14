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
// Title line + steps must stay within the 3~6 line copy_text budget, so a 7-step
// item shares its first 5 steps and leaves the rest to the card.
const MAX_COPY_TEXT_STEPS = 5;
// When steps are cut, one line of that budget buys the "there is more" marker.
// Silent truncation reads as a complete procedure to whoever receives the share.
const MAX_COPY_TEXT_STEPS_WHEN_TRUNCATED = MAX_COPY_TEXT_STEPS - 1;
// R3's floor. 11 items resolve to a single step, and a two-line share is a title
// plus one instruction with no verdict attached.
const MIN_COPY_TEXT_LINES = 3;
// The data has no severity field, so injury/fire wording is the only signal that
// a caution must not be the one MAX_CARD_CAUTIONS drops. Ordering, not filtering:
// nothing is removed that the cap would have kept.
const SAFETY_CAUTION_PATTERN = /다치|감싸|감쌉|위험|폭발|인화|화재|날카|베임|감전|누출|밀봉|뾰족/;

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
  /** Canonical name of the matched region, not the user's raw input. */
  regionName?: string;
  /** Region guidance lines the handler already computed, in "- text" form. */
  regionNotes?: string[];
  /**
   * One-line bulky-waste fee summary, pre-formatted by the handler. Kept out of
   * `regionNotes` on purpose — see regionNodes() for why it needs its own slot.
   */
  regionFeeLine?: string;
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
  // lines always ate it — and with no structuredContent on a widget response it
  // was unrecoverable in that turn. It gets its own line outside that budget.
  const fee = regionFeeLine ? [text(regionFeeLine)] : [];

  if (regionNotes && regionNotes.length > 0) {
    return [
      caption(`${regionName} 기준`),
      ...fee,
      ...regionNotes.slice(0, MAX_CARD_REGION_NOTES).map((note) => text(stripBullet(note))),
    ];
  }

  return [...fee, text(`${regionName} 기준으로 배출 요일·장소만 확인하면 됩니다.`)];
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
  const { item, sourceTitle } = input;
  const cautions = orderCautions(item.cautions).slice(0, MAX_CARD_CAUTIONS);
  const region = regionNodes(input);

  const children: WidgetNode[] = [
    { type: "Title", value: item.name },
    caption(disposalGroupLabel(item.disposalType)),
    text(item.summary),
    divider(),
    ...item.steps.map((step, index) => text(`${index + 1}. ${step}`)),
    ...(cautions.length > 0 ? [divider(), ...cautions.map((line) => caption(`주의: ${line}`))] : []),
    ...(region.length > 0 ? [divider(), ...region] : []),
    caption(`근거: ${sourceTitle}`),
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
  const truncated = item.steps.length > MAX_COPY_TEXT_STEPS;
  const steps = item.steps.slice(0, truncated ? MAX_COPY_TEXT_STEPS_WHEN_TRUNCATED : MAX_COPY_TEXT_STEPS);
  // Title + steps can fall under the floor on a one-step item. The conclusion is
  // what the recipient is missing there, so it fills the gap rather than padding.
  const lead = steps.length + 1 < MIN_COPY_TEXT_LINES ? [item.summary] : [];
  return [
    `**${item.name} 버리는 법** — ${SERVICE_LABEL}`,
    ...lead,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    ...(truncated ? [`(남은 ${item.steps.length - steps.length}단계는 카드에서 확인하세요)`] : []),
  ].join("\n");
}
