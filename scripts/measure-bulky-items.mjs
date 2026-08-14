/**
 * Phase 7 R5-1 효과 측정.
 *
 * 전국대형폐기물수거수수료정보표준데이터의 빈출 품목을 실제 MCP 서버에 물어
 * `정확 매칭 / 오매칭 / not_found / ambiguous` 분포를 낸다.
 * 이 Phase의 통과 조건은 not_found 감소가 아니라 **오매칭 0**이다.
 *
 * 사전 준비:
 *   1. pnpm build — dist/server.js가 최신이어야 한다
 *   2. logs/bulky-item-queries.example.jsonl 이 있어야 한다 (측정 세트 고정용)
 *
 * 실행: pnpm measure:bulky (빌드까지 함께 돈다) 또는 node scripts/measure-bulky-items.mjs
 * 포트는 매번 비어 있는 것을 잡는다 — 묵은 서버가 고정 포트를 물고 있으면 오측정하기 때문이다.
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
 * 여기 없는 것은 전부 오매칭으로 센다.
 *
 * R2에서 품목을 추가하며 확인한 쌍은 아래 두 번째 묶음으로 옮겼다. 표준데이터의
 * 지자체 표기(씽크대·가스오븐렌지·전축)를 새 품목의 별칭으로 흡수한 결과라
 * 매칭이 의도대로 동작한 것이고, `침대 → 침대 프레임`도 표준데이터의 "침대"가
 * 프레임을 가리키므로 정상이다.
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

  // R2 배치에서 별칭으로 흡수한 표기·동의어
  ["씽크대", "싱크대"],
  ["가스오븐렌지", "가스오븐레인지"],
  ["전축", "오디오"],
  ["온풍기", "전기히터"],
  ["침대", "침대 프레임"],
  ["TV", "텔레비전"],
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

async function waitForHealth(baseUrl, getOutput) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
      lastError = new Error(`/health가 HTTP ${res.status}를 돌려줬습니다.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // 자식 서버의 출력을 붙이지 않으면 dist가 없거나 빌드가 낡았을 때도
  // "기동 안 됨" 한 줄만 남아 원인을 알 수 없다.
  throw new Error(`서버가 기동되지 않았습니다 (${lastError?.message ?? "원인 불명"}).\n${getOutput() || "서버 출력 없음 — pnpm build로 dist/server.js를 만들었는지 확인하세요."}`);
}

async function callTool(baseUrl, name, args) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP 요청이 HTTP ${res.status}로 실패했습니다: ${body.slice(0, 200)}`);

  const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data:"));
  if (!dataLine) throw new Error(`SSE 응답을 파싱하지 못했습니다: ${body.slice(0, 200)}`);

  // error 응답을 걸러내지 않으면 result가 undefined인 채로 classify까지 흘러가
  // "Cannot read properties of undefined"로 죽는다 — 진짜 원인이 메시지에 안 남는다.
  const message = JSON.parse(dataLine.slice("data:".length));
  if (message.error) throw new Error(`MCP 오류 ${message.error.code}: ${message.error.message}`);
  if (!message.result) throw new Error(`MCP 응답에 result가 없습니다: ${dataLine.slice(0, 200)}`);
  return message.result;
}

/**
 * 위젯 응답이면 Card의 Title이 확정된 품목명이고, 아니면 structuredContent를 본다.
 * 이 분기를 빼먹으면 위젯 응답이 전부 "못 찾음"으로 잘못 집계된다.
 */
function verdict(query, matched) {
  if (!matched) return { kind: "mismatch", matched };
  if (normalize(matched) === normalize(query)) return { kind: "exact", matched };
  // has() 없이 get()만 쓰면 목록에 없는 질의에서 normalize(undefined)가 ""가 되어,
  // 품목명이 빈 문자열인 응답이 "동의어 매칭"으로 새어 들어간다.
  if (ACCEPTABLE_MATCHES.has(query) && normalize(ACCEPTABLE_MATCHES.get(query)) === normalize(matched)) {
    return { kind: "acceptable", matched };
  }
  return { kind: "mismatch", matched };
}

function classify(query, result) {
  // tool 레벨 실패를 그냥 두면 matched=null이 되어 오매칭으로 집계된다.
  // 인프라 사고가 이 Phase의 통과 지표를 오염시키므로 측정을 세운다.
  if (result.isError === true) {
    throw new Error(`"${query}" 호출이 tool 오류로 끝났습니다: ${result.content?.[0]?.text?.slice(0, 200) ?? ""}`);
  }

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
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });
server.on("error", error => { serverOutput += `spawn 실패: ${error.message}\n`; });
server.on("exit", (code, signal) => { serverOutput += `서버가 먼저 종료됨 (code=${code}, signal=${signal})\n`; });

// finally만으로는 중간에 끊길 때 서버가 포트를 문 채 고아로 남는다.
// PRD 리스크 항목의 "좀비 프로세스로 인한 오측정"이 바로 이 경우다.
const stopServer = () => { if (!server.killed) server.kill("SIGTERM"); };
process.once("exit", stopServer);
process.once("SIGINT", () => {
  stopServer();
  process.exit(130);
});

try {
  await waitForHealth(baseUrl, () => serverOutput);

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
  stopServer();
}
