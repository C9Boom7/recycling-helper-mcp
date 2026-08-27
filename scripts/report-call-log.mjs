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
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** 항상 등록되는 다섯. 여기 있는데 호출이 0이면 description이 안 먹히고 있다는 신호다. */
export const ALWAYS_REGISTERED_TOOLS = [
  "classify_waste_item",
  "get_disposal_steps",
  "check_confusing_item",
  "make_cleanup_plan",
  "get_region_disposal_info",
];
/**
 * 여섯 번째 툴은 `DATA_GO_KR_SERVICE_KEY`가 있을 때만 등록된다(PRD phase-12 D3).
 * 키 없이 배포한 기간의 로그에서 이걸 "안 불린 툴"로 함께 세면, 이 리포트에서 가장
 * 중요한 줄이 늘 늑대를 부르게 된다 — 문구를 갈라 둔다.
 */
export const KEY_GATED_TOOL = "find_disposal_spots";

/** 답을 못 준 것으로 세는 status. 툴마다 이름이 달라 한자리에 모은다. */
const UNANSWERED = new Set(["not_found", "ambiguous", "spots_ask", "spots_fallback"]);
/**
 * 답을 못 준 것과 **터진 것**은 다르다. `error`를 위 집합에 섞으면 폴백으로 착지한 건과
 * 한 칸에 뭉치고, 빼 두면 100% 터지는 툴이 `0/N (0.0%)`로 멀쩡해 보인다. 따로 센다.
 */
const FAILED = new Set(["error"]);
/**
 * `get_region_disposal_info`는 되묻거나 지역을 못 알아들어도 `status: "ok"`로 남는다 —
 * 그 툴은 어느 갈래로 가든 안내를 내보내기 때문이다. status만 세면 100번 연속 되물어도
 * `0/100 (0.0%)`이 되어, 이 절을 가른 이유가 무색해진다. 그 툴에서는 지역 해상도로 본다.
 */
const REGION_TOOL = "get_region_disposal_info";
const REGION_UNANSWERED = new Set(["ambiguous", "unknown"]);

function isUnanswered(entry) {
  if (UNANSWERED.has(entry.status)) return true;
  return entry.tool === REGION_TOOL && REGION_UNANSWERED.has(entry.regionStatus);
}

function readInput(path) {
  if (path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      console.error(`로그 파일을 읽지 못했다: ${path} (${error.code ?? error.message})`);
      process.exit(1);
    }
  }
  // 인자도 없고 파이프도 없으면 stdin에서 영원히 멈춘다. 무엇을 하라는 건지 알려주고 끝낸다.
  if (process.stdin.isTTY) {
    console.error("읽을 로그가 없다. 파일 경로를 주거나 로그를 파이프로 넘긴다.");
    console.error("  pnpm report:calls logs/call-log.jsonl");
    console.error("  kubectl logs deploy/recycling-helper-mcp | pnpm report:calls");
    process.exit(1);
  }
  return readFileSync(0, "utf8");
}

/** 표본이 십만 줄을 넘으면 `Math.max(...arr)`가 인자 한도에 걸려 리포트가 중간에 죽는다. */
function maxOf(values) {
  return values.reduce((max, value) => (value > max ? value : max), -Infinity);
}

/**
 * 못 읽은 줄을 두 갈래로 나눠 센다.
 *
 * `noise`는 JSON이 아예 아닌 줄이다 — 서버 기동 배너가 늘 여기 들어가고, 컨테이너 로그
 * 수집기가 붙이는 접두사도 마찬가지다. **정상이다.**
 * `malformed`는 JSON 객체로는 읽혔는데 `tool`이 없는 줄이다. 이건 로그 형식이 바뀌었다는
 * 뜻이라 다르게 다뤄야 한다 — 둘을 한 칸에 뭉쳤더니, 재시작 직후 호출이 0건인 조용한
 * 구간에서 배너 한 줄 때문에 "형식이 바뀌었다"고 끊었다.
 */
export function parseLines(text) {
  const entries = [];
  let noise = 0;
  let malformed = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 컨테이너 로그는 앞에 타임스탬프가 붙기도 한다. 첫 `{`부터 읽어 본다.
    const start = trimmed.indexOf("{");
    if (start === -1) { noise += 1; continue; }
    try {
      const entry = JSON.parse(trimmed.slice(start));
      if (entry && typeof entry === "object" && typeof entry.tool === "string") entries.push(entry);
      else malformed += 1;
    } catch {
      noise += 1;
    }
  }
  return { entries, noise, malformed };
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

  const { entries, noise, malformed } = parseLines(readInput(args[0]));
  if (entries.length === 0) {
    // 호출이 0건인 구간은 정상이다(재시작 직후 배너만 있는 창이 그렇다). `tool`이 빠진
    // JSON 줄이 있을 때만 형식이 바뀐 것으로 보고 끊는다.
    if (malformed > 0) {
      console.error(`호출 로그 줄을 하나도 못 읽었다 (tool이 없는 JSON 줄 ${malformed}개). 로그 형식이 바뀌었는지 본다.`);
      process.exit(1);
    }
    console.log(`이 구간에는 툴 호출이 없다${noise > 0 ? ` (로그 줄이 아닌 줄 ${noise}개는 건너뛰었다)` : ""}.`);
    return;
  }

  const total = entries.length;
  const stamps = entries.map((entry) => entry.ts).filter((ts) => typeof ts === "string").sort();
  console.log(`# 호출 로그 요약 — ${total}건`);
  if (stamps.length > 0) console.log(`기간: ${stamps[0]} ~ ${stamps[stamps.length - 1]}`);
  if (malformed > 0) console.log(`tool이 없는 JSON 줄: ${malformed}개 — 로그 형식이 바뀌었는지 본다`);

  section("툴별 호출");
  const byTool = countBy(entries, (entry) => entry.tool);
  for (const [tool, count] of byTool) {
    console.log(`- ${tool}: ${count}건 (${share(count, total)})`);
  }
  // **호출이 0인 툴이 이 리포트에서 가장 중요한 줄이다.** 데이터가 아무리 좋아도
  // 호스트가 그 툴을 안 고르면 사용자에게 닿지 않는다.
  const unused = ALWAYS_REGISTERED_TOOLS.filter((tool) => !byTool.some(([name]) => name === tool));
  if (unused.length > 0) {
    console.log(`- 한 번도 안 불린 툴: ${unused.join(", ")} — description이 안 먹히고 있는지 본다`);
  }
  if (!byTool.some(([name]) => name === KEY_GATED_TOOL)) {
    console.log(`- ${KEY_GATED_TOOL} 호출이 없다 — 인증키 없이 배포했다면 아예 등록되지 않으므로 정상이다`);
  }

  section("답을 못 준 비율");
  for (const [tool] of byTool) {
    const rows = entries.filter((entry) => entry.tool === tool);
    const missed = rows.filter(isUnanswered);
    const detail = countBy(missed, (entry) => (tool === REGION_TOOL ? `지역 ${entry.regionStatus}` : entry.status))
      .map(([status, count]) => `${status} ${count}`)
      .join(", ");
    console.log(`- ${tool}: ${missed.length}/${rows.length} (${share(missed.length, rows.length)})${detail ? ` — ${detail}` : ""}`);
  }

  // 터진 호출은 위 비율과 갈라 센다. 0건이어도 줄을 남긴다 — 없는 줄과 0인 줄은 다르다.
  const failed = entries.filter((entry) => FAILED.has(entry.status));
  section("오류로 끝난 호출");
  if (failed.length === 0) {
    console.log("- 없음");
  } else {
    console.log(`- 전체 ${failed.length}건 (${share(failed.length, total)})`);
    for (const [tool, count] of countBy(failed, (entry) => entry.tool)) {
      console.log(`  - ${tool}: ${count}건`);
    }
    console.log("  (한 툴에 몰리면 그 핸들러를 먼저 본다. 서버 로그 원문의 예외 서명과 대조한다)");
  }

  // 여러 품목을 한 번에 받는 플랜은 status만으로는 절반만 답한 호출이 안 보인다.
  // `partial`은 위 비율에서 "답을 준 것"으로 세지므로, 품목 단위 커버리지를 따로 낸다.
  const plans = entries.filter((entry) => entry.tool === "make_cleanup_plan" && typeof entry.total === "number");
  if (plans.length > 0) {
    const items = plans.reduce((sum, entry) => sum + entry.total, 0);
    const matched = plans.reduce((sum, entry) => sum + (typeof entry.matched === "number" ? entry.matched : 0), 0);
    section("대청소 플랜의 품목 커버리지");
    console.log(`- 품목 ${items}개 중 ${matched}개 확정 (${share(matched, items)})`);
    const partial = plans.filter((entry) => entry.status === "partial").length;
    console.log(`- 일부만 확정된 호출: ${partial}/${plans.length}`);
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
      console.log(`- 업스트림 지연: p50 ${percentile(upstreamMs, 0.5)}ms · p95 ${percentile(upstreamMs, 0.95)}ms · 최대 ${maxOf(upstreamMs)}ms`);
    }
  }

  section("서버 처리 시간");
  for (const [tool] of byTool) {
    const durations = entries.filter((entry) => entry.tool === tool).map((entry) => entry.ms).filter((ms) => typeof ms === "number");
    if (durations.length === 0) continue;
    console.log(`- ${tool}: p50 ${percentile(durations, 0.5)}ms · p95 ${percentile(durations, 0.95)}ms · 최대 ${maxOf(durations)}ms`);
  }
}

// 스모크가 이 파일에서 툴 목록과 파서를 가져다 쓴다(손으로 베낀 목록이 서버와 어긋나는
// 것을 거기서 잡는다). 가져다 쓸 때 리포트가 돌면 안 되므로 직접 실행일 때만 부른다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
