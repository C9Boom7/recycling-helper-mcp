/**
 * Phase 7 R5-1 효과 측정.
 *
 * 전국대형폐기물수거수수료정보표준데이터의 빈출 품목을 실제 MCP 서버에 물어
 * `정확 매칭 / 오매칭 / not_found / ambiguous` 분포를 낸다.
 * 이 Phase의 통과 조건은 not_found 감소가 아니라 **오매칭 0**이다.
 *
 * 사전 준비:
 *   1. pnpm build
 *   2. logs/bulky-item-queries.example.jsonl 이 있어야 한다 (측정 세트 고정용)
 *
 * 실행: node scripts/measure-bulky-items.mjs [--port 3456]
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const QUERY_SET_PATH = new URL("../logs/bulky-item-queries.example.jsonl", import.meta.url);
const STARTUP_TIMEOUT_MS = 15_000;

/**
 * 질의어와 품목명이 글자로는 다르지만 같은 물건을 가리키는 쌍.
 *
 * 표준데이터 품목명은 지자체 표기를 그대로 쓰므로 우리 품목명과 자주 어긋난다
 * ("쇼파"/"소파", "카펫"/"카페트"). 이건 매칭이 제대로 동작한 결과이지 오매칭이
 * 아니므로, 정확 매칭으로 집계한다. 이 목록을 빼면 통과 조건인 "오매칭 0"이
 * 애초에 달성 불가능해진다.
 *
 * 판단이 갈리는 쌍(침대 → 침대 프레임: 침대는 프레임+매트리스를 아우른다,
 * 선풍기 → 소형가전: 범주 매칭)도 여기 두되, 개선 대상으로 PRD에 남긴다.
 */
const ACCEPTABLE_MATCHES = new Map([
  ["쇼파", "소파"],
  ["장롱", "옷장"],
  ["카펫", "카페트"],
  ["폐소화기", "소화기"],
  ["책꽂이", "책장"],
  ["수족관", "어항"],
  ["장판", "비닐장판"],
  ["침대틀", "침대 프레임"],
  ["밥상", "식탁"],
]);

function normalize(value) {
  return (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // 서버가 아직 안 떴다. 재시도한다.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("서버가 기동되지 않았습니다.");
}

async function callTool(baseUrl, name, args) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data:"));
  if (!dataLine) throw new Error(`SSE 응답을 파싱하지 못했습니다: ${body.slice(0, 200)}`);
  return JSON.parse(dataLine.slice("data:".length)).result;
}

/**
 * 위젯 응답이면 Card의 Title이 확정된 품목명이고, 아니면 structuredContent를 본다.
 * 이 분기를 빼먹으면 위젯 응답이 전부 "못 찾음"으로 잘못 집계된다.
 */
function verdict(query, matched) {
  if (matched === null) return { kind: "mismatch", matched };
  if (normalize(matched) === normalize(query)) return { kind: "exact", matched };
  if (normalize(ACCEPTABLE_MATCHES.get(query)) === normalize(matched)) return { kind: "acceptable", matched };
  return { kind: "mismatch", matched };
}

function classify(query, result) {
  const text = result.content?.find(entry => entry.type === "text")?.text ?? "";

  if (text.startsWith("{")) {
    const widget = JSON.parse(text);
    const title = widget.widget?.children?.find(child => child.type === "Title")?.value ?? null;
    return verdict(query, title);
  }

  const structured = result.structuredContent ?? {};
  if (structured.ambiguous === true) return { kind: "ambiguous", matched: null };
  if (structured.found === false) return { kind: "not_found", matched: null };
  return verdict(query, structured.itemName ?? null);
}

const queries = readFileSync(QUERY_SET_PATH, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line).query);

const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/server.js"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  stdio: "ignore",
});

try {
  await waitForHealth(baseUrl);

  const rows = [];
  for (const query of queries) {
    const result = await callTool(baseUrl, "get_disposal_steps", { itemName: query });
    rows.push({ query, ...classify(query, result) });
  }

  const buckets = {
    exact: rows.filter(r => r.kind === "exact"),
    acceptable: rows.filter(r => r.kind === "acceptable"),
    mismatch: rows.filter(r => r.kind === "mismatch"),
    not_found: rows.filter(r => r.kind === "not_found"),
    ambiguous: rows.filter(r => r.kind === "ambiguous"),
  };
  const answered = buckets.exact.length + buckets.acceptable.length;

  console.log(`대형폐기물 빈출 품목 ${rows.length}건 측정`);
  console.log(`  정확 매칭 : ${buckets.exact.length}`);
  console.log(`  동의어 매칭: ${buckets.acceptable.length}  (표기 차이 — 정상)`);
  console.log(`  → 답변 가능: ${answered}`);
  console.log(`  오매칭    : ${buckets.mismatch.length}`);
  console.log(`  not_found : ${buckets.not_found.length}`);
  console.log(`  ambiguous : ${buckets.ambiguous.length}`);

  if (buckets.mismatch.length > 0) {
    console.log(`\n[오매칭]`);
    for (const row of buckets.mismatch) console.log(`  ${row.query} → ${row.matched}`);
  }
  if (buckets.not_found.length > 0) {
    console.log(`\n[not_found]`);
    console.log(`  ${buckets.not_found.map(r => r.query).join(", ")}`);
  }
  if (buckets.ambiguous.length > 0) {
    console.log(`\n[ambiguous]`);
    console.log(`  ${buckets.ambiguous.map(r => r.query).join(", ")}`);
  }

  // 오매칭이 남아 있으면 실패로 끝낸다 — Phase 7의 통과 조건이다.
  if (buckets.mismatch.length > 0) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
