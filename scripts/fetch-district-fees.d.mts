/**
 * `fetch-district-fees.mjs`의 타입 선언.
 *
 * 수집 스크립트는 `.mjs`인데 인제스트는 `.ts`라, 대상 목록을 가져다 쓰려면 선언이
 * 필요하다. 목록을 양쪽에 적어 두면 어긋나서 "수집은 했는데 인제스트가 모르는 지역"이
 * 생기므로, 사본을 만들지 않고 이 선언을 둔다.
 */
export declare const TARGETS: ReadonlyArray<{
  regionId: string;
  name: string;
  kind: "smartclean" | "sdm_table" | "sd_popup" | "guro_list";
  url: string;
}>;
