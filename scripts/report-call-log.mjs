/**
 * 런타임 호출 로그 요약 — 카카오 QA(9/1~9/11)와 본선(9/16~10/12)에 "지금 뭐가 안 되고
 * 있나"를 보는 자리다.
 *
 * 서버는 툴 호출마다 JSON 한 줄을 stdout에 찍는다(`withCallLog`). 필드는 잘 설계돼
 * 있는데 그걸 읽는 도구가 없어서, 로그가 쌓여도 사람이 눈으로 훑는 것 말고는 방법이
 * 없었다. **프리징(9/14) 이후에는 데이터만 고칠 수 있으므로, 어디를 고쳐야 하는지
 * 아는 일이 그때 가장 중요해진다.**
 *
 * 실행:
 *   pnpm report:calls logs/call-log.jsonl
 *   kubectl logs deploy/recycling-helper-mcp | pnpm report:calls
 *
 * 로그 줄이 아닌 것(기동 메시지 등)은 조용히 건너뛴다 — 파이프로 통째로 넘겨도 되게
 * 하려는 것이다. 이 스크립트는 판정하지 않고 세기만 한다. 문턱을 넘었다고 exit 1을
 * 내면 운영 중에 "리포트가 실패했다"로 읽혀 정작 볼 숫자를 못 보게 된다.
 */
import { readFileSync } from "node:fs";

/** 서버가 등록하는 툴. 여기 있는데 호출이 0인 툴은 description이 안 먹히고 있다는 신호다. */
const KNOWN_TOOLS = [
  "classify_waste_item",
  "get_disposal_steps",
  "check_confusing_item",
  "make_cleanup_plan",
  "get_region_disposal_info",
  "find_disposal_spots",
];

/** 답을 못 준 것으로 세는 status. 툴마다 이름이 달라 한자리에 모은다. */
const UNANSWERED = new Set(["not_found", "ambiguous", "spots_ask", "spots_fallback"]);

function readInput(path) {
  if (path) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

function parseLines(text) {
  const entries = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 컨테이너 로그는 앞에 타임스탬프가 붙기도 한다. 첫 `{`부터 읽어 본다.
    const start = trimmed.indexOf("{");
    if (start === -1) { skipped += 1; continue; }
    try {
      const entry = JSON.parse(trimmed.slice(start));
      if (entry && typeof entry === "object" && typeof entry.tool === "string") entries.push(entry);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

function countBy(entries, pick) {
  const counts = new Map();
  for (const entry of entries) {
    const key = pick(entry);
    if (key === undefined || key === null || key === "") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function share(count, total) {
  return total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
}

function percentile(values, ratio) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  // 최근접 순위법. 표본이 적을 때 보간하면 실제로 나온 적 없는 값이 지표로 올라간다.
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function section(title) {
  console.log(`\n## ${title}`);
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: pnpm report:calls [로그파일]   (생략하면 stdin을 읽는다)");
    return;
  }

  const { entries, skipped } = parseLines(readInput(args[0]));
  if (entries.length === 0) {
    console.log("호출 로그 줄을 하나도 찾지 못했다.");
    if (skipped > 0) console.log(`(JSON으로 못 읽은 줄 ${skipped}개 — 로그 형식을 확인한다)`);
    return;
  }

  const total = entries.length;
  const stamps = entries.map((entry) => entry.ts).filter((ts) => typeof ts === "string").sort();
  console.log(`# 호출 로그 요약 — ${total}건`);
  if (stamps.length > 0) console.log(`기간: ${stamps[0]} ~ ${stamps[stamps.length - 1]}`);
  if (skipped > 0) console.log(`읽지 못한 줄: ${skipped}개`);

  section("툴별 호출");
  const byTool = countBy(entries, (entry) => entry.tool);
  for (const [tool, count] of byTool) {
    console.log(`- ${tool}: ${count}건 (${share(count, total)})`);
  }
  // **호출이 0인 툴이 이 리포트에서 가장 중요한 줄이다.** 데이터가 아무리 좋아도
  // 호스트가 그 툴을 안 고르면 사용자에게 닿지 않는다.
  const unused = KNOWN_TOOLS.filter((tool) => !byTool.some(([name]) => name === tool));
  if (unused.length > 0) {
    console.log(`- 한 번도 안 불린 툴: ${unused.join(", ")} — description이 안 먹히고 있는지 본다`);
  }

  section("답을 못 준 비율");
  for (const [tool] of byTool) {
    const rows = entries.filter((entry) => entry.tool === tool);
    const missed = rows.filter((entry) => UNANSWERED.has(entry.status));
    const detail = countBy(missed, (entry) => entry.status)
      .map(([status, count]) => `${status} ${count}`)
      .join(", ");
    console.log(`- ${tool}: ${missed.length}/${rows.length} (${share(missed.length, rows.length)})${detail ? ` — ${detail}` : ""}`);
  }

  const fallbackTiers = countBy(entries, (entry) => entry.fallbackTier);
  if (fallbackTiers.length > 0) {
    section("못 찾았을 때 착지한 재질");
    for (const [tier, count] of fallbackTiers) console.log(`- ${tier}: ${count}건`);
  }

  const regionStatuses = countBy(entries, (entry) => entry.regionStatus);
  if (regionStatuses.length > 0) {
    section("지역 해상도");
    const asked = regionStatuses.reduce((sum, [, count]) => sum + count, 0);
    for (const [status, count] of regionStatuses) {
      console.log(`- ${status}: ${count}건 (${share(count, asked)})`);
    }
    console.log("  (unregistered_district·unknown이 크면 지역 데이터를 더 넣을 자리다)");
  }

  const upstreams = countBy(entries, (entry) => entry.upstream);
  if (upstreams.length > 0) {
    section("외부 API (find_disposal_spots)");
    const calls = upstreams.reduce((sum, [, count]) => sum + count, 0);
    for (const [status, count] of upstreams) console.log(`- ${status}: ${count}건 (${share(count, calls)})`);
    console.log("  (body가 쌓이면 키 오류나 일 한도 초과다 — network·http와 원인이 다르다)");
    const upstreamMs = entries.map((entry) => entry.upstreamMs).filter((ms) => typeof ms === "number");
    if (upstreamMs.length > 0) {
      console.log(`- 업스트림 지연: p50 ${percentile(upstreamMs, 0.5)}ms · p95 ${percentile(upstreamMs, 0.95)}ms · 최대 ${Math.max(...upstreamMs)}ms`);
    }
  }

  section("서버 처리 시간");
  for (const [tool] of byTool) {
    const durations = entries.filter((entry) => entry.tool === tool).map((entry) => entry.ms).filter((ms) => typeof ms === "number");
    if (durations.length === 0) continue;
    console.log(`- ${tool}: p50 ${percentile(durations, 0.5)}ms · p95 ${percentile(durations, 0.95)}ms · 최대 ${Math.max(...durations)}ms`);
  }
}

main();
