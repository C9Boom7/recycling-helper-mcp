import { readFileSync } from "node:fs";

const backlogPath = new URL("../src/data/question-backlog.json", import.meta.url);
const backlog = JSON.parse(readFileSync(backlogPath, "utf8"));

function countBy(field) {
  return backlog.reduce((counts, item) => {
    counts[item[field]] = (counts[item[field]] ?? 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}: ${count}`)
    .join(", ");
}

const openItems = backlog.filter((item) => item.status === "todo" || item.status === "triaged");
const highPriorityOpenItems = openItems.filter((item) => item.priority === "high");

console.log(`Question backlog: ${backlog.length} items`);
console.log(`By status: ${formatCounts(countBy("status"))}`);
console.log(`By priority: ${formatCounts(countBy("priority"))}`);
console.log(`By type: ${formatCounts(countBy("type"))}`);

if (openItems.length > 0) {
  const countOpenBy = (field) =>
    openItems.reduce((counts, item) => {
      counts[item[field]] = (counts[item[field]] ?? 0) + 1;
      return counts;
    }, {});

  console.log("");
  console.log(`Open items: ${openItems.length}`);
  console.log(`Open by priority: ${formatCounts(countOpenBy("priority"))}`);
  console.log(`Open by type: ${formatCounts(countOpenBy("type"))}`);
}

if (highPriorityOpenItems.length > 0) {
  console.log("");
  console.log("High-priority open items:");
  for (const item of highPriorityOpenItems) {
    const region = item.region ? ` (${item.region})` : "";
    console.log(`- ${item.id}: ${item.query}${region}`);
  }
}
