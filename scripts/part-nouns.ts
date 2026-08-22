/** 측정 스크립트용 재노출. 목록의 주인은 `src/data.ts`의 `compoundPartNouns`다. */
import { compoundPartNouns } from "../src/data.ts";

export const partNounReasons = compoundPartNouns;
export const PART_NOUNS = Object.keys(compoundPartNouns);
