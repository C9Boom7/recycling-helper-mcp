// Runs every question-backlog query through the real resolveWasteItem (from
// dist, so `pnpm build` first) and prints the status distribution. Used for the
// Phase 1 not_found before/after measurement — do not use evaluate-data.mjs's
// simplified matcher for this.
import { readFileSync } from "node:fs";
import { resolveWasteItem } from "../dist/data.js";

const backlogPath = new URL("../src/data/question-backlog.json", import.meta.url);
const backlog = JSON.parse(readFileSync(backlogPath, "utf8"));

let match = 0;
let ambiguous = 0;
let skipped = 0;
const notFoundQueries = [];

for (const entry of backlog) {
  const query = entry.query ?? "";
  if (!query) {
    skipped += 1;
    continue;
  }
  const resolved = resolveWasteItem(query);
  if (resolved.status === "match") match += 1;
  else if (resolved.status === "ambiguous") ambiguous += 1;
  else notFoundQueries.push(query);
}

console.log(
  `Backlog resolution: total ${backlog.length}, match ${match}, ambiguous ${ambiguous}, not_found ${notFoundQueries.length}, skipped ${skipped} (no query)`,
);
for (const query of notFoundQueries) {
  console.log(`- not_found: ${query}`);
}
