import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { measureResult } from "./measure-response-size.mjs";

const HOST = "127.0.0.1";
const PLAYMCP_ENDPOINT_HOSTS = [
  "recyling-helper-mcp.playmcp-endpoint.kakaocloud.io",
  "recycle-helper-mcp.playmcp-endpoint.kakaocloud.io",
  "recycling-helper-mcp.playmcp-endpoint.kakaocloud.io",
  // Any hostname under the wildcard must pass, so a finals server created with
  // a new name works without a code change.
  "some-brand-new-server.playmcp-endpoint.kakaocloud.io",
];
const PLAYMCP_ORIGINS = [
  "https://playmcp.kakaocloud.io",
  "https://playmcp.kakao.com",
  "https://preview-chatgpt.kakao.com",
  "https://tools.kakao.com",
];
const STARTUP_TIMEOUT_MS = 15_000;
// 응답이 돌아온 뒤 그 호출의 로그 줄이 stdout 파이프를 건너오기까지 기다리는 상한.
// 한 번 읽고 단언하면 맞는 코드에서도 이따금 실패한다.
const LOG_FLUSH_TIMEOUT_MS = 2_000;
const EXPECTED_PROTOCOL_VERSION = "2025-03-26";
const EXPECTED_SERVER_INFO = {
  name: "recycling-helper",
  version: "0.1.0",
};
const EXPECTED_TOOL_NAMES = [
  "check_confusing_item",
  "classify_waste_item",
  "get_disposal_steps",
  "get_region_disposal_info",
  "make_cleanup_plan",
];
// PRD phase-12 D3: `DATA_GO_KR_SERVICE_KEY`가 있을 때만 여섯 번째 툴이 목록에 선다.
const EXPECTED_TOOL_NAMES_WITH_SPOTS = ["find_disposal_spots", ...EXPECTED_TOOL_NAMES].sort();
const REQUIRED_TOOL_ANNOTATION_FIELDS = [
  "title",
  "readOnlyHint",
  "destructiveHint",
  "openWorldHint",
  "idempotentHint",
];
// 본선 규격의 하드 한도 (docs/prd/phase-0-compliance.md R3, docs/prd/README.md
// "본선 규격 요약"). 넘기면 재등록에서 툴이 거부되거나 description이 잘리는데,
// 잘려나가는 꼬리가 하필 맨 뒤에 새로 붙인 문장이라 조용히 효과만 사라진다.
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;
// PRD phase-0 R5: per-tool structuredContent whitelists. Every answer case
// runs through this, so a handler emitting a field outside its contract fails
// the smoke suite instead of silently regrowing the payload.
// Phase 1 R1 extends the not_found contract with a material-principles
// fallback block: { inferred, materials[], askFor[] }.
const NOT_FOUND_KEYS = ["found", "itemName", "fallback"];
const NOT_FOUND_FALLBACK_KEYS = ["inferred", "materials", "askFor"];
const NOT_FOUND_FALLBACK_MATERIAL_KEYS = ["id", "label", "quickRule", "steps", "whenGeneral", "source"];
const AMBIGUOUS_KEYS = ["found", "ambiguous", "itemName", "candidates", "candidateDetails"];
const STRUCTURED_KEY_WHITELIST = {
  classify_waste_item: [
    "found",
    "matchedItem",
    "matchedBy",
    "disposalGroup",
    "disposalType",
    "summary",
    "confidence",
    "regionCheckLevel",
    "regionGuidance",
    "primarySource",
  ],
  get_disposal_steps: [
    "found",
    "id",
    "itemName",
    "matchedBy",
    "disposalGroup",
    "summary",
    "steps",
    "cautions",
    "confidence",
    "review",
    "region",
    "regionCheckLevel",
    "regionNotes",
    "sources",
  ],
  check_confusing_item: ["found", "matches"],
  make_cleanup_plan: ["region", "items", "nextTool"],
  get_region_disposal_info: [
    "region",
    "matchedRegion",
    // 지역 해상도(자치구 확정/광역 폴백/되묻기/미등록)와 티어. 호스트가 얕은
    // 티어 안내를 확정 안내처럼 다루지 않도록 짧은 스칼라로만 싣는다.
    "regionStatus",
    "regionCandidates",
    "coverageTier",
    "item",
    "ambiguousCandidates",
    "defaultSummary",
    "checkList",
    // 대형폐기물 신청·수수료 주소와 문의 전화. 본문에는 늘 찍히지만 구조화에는 담는
    // 자리가 없어, 전에는 `officialSources` 세 자리 중 하나를 같은 주소로 써야만
    // 구조화만 읽는 호스트에 닿았다. 그 경쟁 때문에 12곳에서 수거함 안내가 밀렸다.
    "bulkyWasteContact",
    "officialSources",
  ],
};
const NESTED_KEY_WHITELIST = {
  check_confusing_item: { field: "matches", keys: ["itemName", "summary", "caution", "confidence", "regionCheckLevel"] },
  make_cleanup_plan: {
    field: "items",
    keys: ["input", "found", "group", "itemName", "summary", "regionCheckLevel", "candidates", "fee"],
  },
};
const answerCasesPath = new URL("../dist/data/mcp-answer-cases.json", import.meta.url);
const wasteItemsPath = new URL("../dist/data/waste-items.json", import.meta.url);
const regionPoliciesPath = new URL("../dist/data/region-policies.json", import.meta.url);
const answerCases = JSON.parse(readFileSync(answerCasesPath, "utf8"));
const wasteItems = JSON.parse(readFileSync(wasteItemsPath, "utf8"));
const regionPolicies = JSON.parse(readFileSync(regionPoliciesPath, "utf8"));
const bulkyFeeSchedules = JSON.parse(readFileSync(new URL("../dist/data/bulky-waste-fees.json", import.meta.url), "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// `지역 요약`도 요일을 왜 안 싣는지 말하므로 같은 낱말이 여러 줄에 걸린다. 확인처
// 링크를 들고 있어야 하는 건 번호가 붙은 `확인할 정보` 쪽이라 그 모양으로만 잡는다.
function findDayCheckLine(answerText) {
  return answerText.split("\n").find((line) => /^\d+\. 일반쓰레기·재활용품 배출 요일과 시간/.test(line));
}

function mentionsDay(answerText) {
  return answerText.includes("요일");
}

// 요일 확인처가 전국 안내로 내려갔는지 가르는 주소. 지자체 페이지로 닫혔으면 이 주소가 없다.
const NATIONAL_DAY_FALLBACK_URL = "region.do";

// 자기 지자체 요일 페이지로 닫히는 지역 수. 이 숫자를 박아 두는 건 **출처를 넣었는데
// 선택이 안 되는** 누락이 조용해서다 — 용산구는 요일 안내가 있는 페이지를 출처로
// 얻고도 basis 어휘가 선택 정규식에 안 걸려 전국 안내로 남았고, 응답은 멀쩡해 보였다.
// 지역이 늘거나 요일 출처를 더 채우면 이 숫자도 같이 올린다.
const REGIONS_WITH_OWN_DAY_PAGE = 31;

// PRD phase-10 R4: 지역 품목 응답의 크기 상한. 노원구 매트리스를 대표로 본다 — 수수료 행이
// 상한(12행)까지 찬 품목이라 지역 품목 응답 가운데 가장 크다. 값은 `pnpm measure:size`가
// 찍은 실측(텍스트 4,951B · 위젯 3,663B, 2026-08-23)에 10% 여유를 둔 것이다.
// **넘으면 실패가 아니라 경고다.** 데이터 확장으로 수수료 행이 늘면 정당하게 넘을 수 있어서다.
// 두 사이클 뒤 안정되면 실패로 올린다 — 그때 `console.warn`을 `assert`로 바꾼다.
const RESPONSE_SIZE_WARN_BYTES = { text: 5_450, widget: 4_050 };
const SIZE_CASE = { itemName: "매트리스", region: "서울 노원구" };
// PRD phase-11 R4. 지역 툴은 위젯 경로가 없어 모드가 하나다. 값은 `pnpm measure:size` 실측
// (4,961B, 2026-08-25)에 10% 여유를 둔 것이고, 여기도 실패가 아니라 경고로 시작한다.
const REGION_TOOL_SIZE_WARN_BYTES = 5_460;
const REGION_SIZE_CASE = { region: "서울 노원구", itemName: "매트리스" };

function warnIfOversized(result, mode) {
  const { total } = measureResult(result, { widgets: mode === "widget" });
  const limit = RESPONSE_SIZE_WARN_BYTES[mode];
  if (total > limit) {
    console.warn(
      `[size] get_disposal_steps ${JSON.stringify(SIZE_CASE)} ${mode} 모드 응답이 ${total}B — 경고 상한 ${limit}B를 넘었다. ` +
        "수수료 행이 늘어 정당하게 커진 것인지 pnpm measure:size로 확인하고, 아니면 지역 블록에 중복이 다시 생긴 것이다.",
    );
  }
  return total;
}

// PRD phase-10 R1-a: 지역 블록(`### 지역 확인 필요`) 안에서 신청·수수료 주소가 두 줄에 찍히면
// 안 된다. 수수료 고시의 주소와 지역 연락처의 주소가 같으면(26곳 전부 그렇다) 한 번만 나간다.
// 단, **한 번은 나가야 한다** — 줄이다가 링크를 없애는 회귀가 더 나쁘다. 판정 범위를 블록으로
// 좁히는 건 `### {지역} 공식 출처`가 같은 주소를 출처 항목으로 한 번 더 들 수 있어서다 — 그건
// basis 문장이 붙은 출처지 안내의 반복이 아니다.
function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function regionSection(answerText) {
  const start = answerText.indexOf("### 지역 확인 필요");
  assert(start >= 0, "응답에 `### 지역 확인 필요` 블록이 없다");
  const end = answerText.indexOf("\n### ", start + 1);
  return end >= 0 ? answerText.slice(start, end) : answerText.slice(start);
}

// `indexOf`가 -1이면 `slice(-1)`이 마지막 한 글자만 남겨, 블록이 통째로 사라져도
// 뒤따르는 `includes` 단언이 조용히 통과한다. 자를 자리부터 단언한다.
function sliceFrom(text, marker, context) {
  const start = text.indexOf(marker);
  assert(start >= 0, `${context}: 응답에 \`${marker}\` 블록이 없다`);
  return text.slice(start);
}

function assertUrlShownOnce(answerText, url, context) {
  const count = countOccurrences(regionSection(answerText), url);
  assert(count >= 1, `${context}: ${url} 가 지역 블록에 없다 — 중복을 지우다가 링크를 없앴다`);
  assert(count === 1, `${context}: ${url} 가 지역 블록에 ${count}번 나간다 — 지역 블록의 자기 중복이 되살아났다`);
}

// 같은 불변식을 structuredContent.regionNotes에 건다. 두 렌더링 모드가 같은 배열을 실으므로
// 여기서 한 번만 보면 위젯 모드도 같이 닫힌다. 요일 확인처처럼 문장 안에 든 주소도 세므로,
// 주소 하나가 두 줄에 걸리면 어느 쪽이든 걸린다.
// 주소 뒤 문장부호는 떼고 본다. 요일 확인처는 "(URL, 확인일 …)" 꼴이라 쉼표가 딸려 와
// 같은 주소가 다른 키로 잡혔다 — 중복을 잡으라고 만든 단언이 중복을 놓치고 있었다.
function normalizeUrl(url) {
  return url.replace(/[),.]+$/, "");
}

function assertRegionNotesUrlsUnique(notes, context) {
  const seen = new Map();
  for (const line of notes ?? []) {
    for (const match of line.match(/https?:\/\/[^\s)]+/g) ?? []) {
      const url = normalizeUrl(match);
      if (seen.has(url)) {
        throw new Error(`${context}: regionNotes에 같은 주소가 두 줄에 있다 — "${seen.get(url)}" / "${line}"`);
      }
      seen.set(url, line);
    }
  }
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object", "Could not allocate a local port");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

function startServer(port, { widgets = false, serviceKey = "", upstreamBaseUrl = "", spotCacheTtlMs = "0" } = {}) {
  const server = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      // PRD phase-3 R4-1: pinned, never inherited. The 183 get_disposal_steps
      // answer cases assert on human-readable text, which a widget response
      // replaces with serialized card JSON — so the suite must not depend on
      // whatever WIDGET_ENABLED happens to be set to in the caller's shell.
      WIDGET_ENABLED: widgets ? "true" : "false",
      // 같은 이유로 고정한다. 런북 2절이 로컬 QA에 CALL_LOG_DETAILS=true를 권하므로
      // 그 셸에서 그대로 돌리면 서버가 물려받고, 아래 로그 단언이 검사하는 기본
      // 동작(인자를 남기지 않는다)이 조용히 빠진다.
      CALL_LOG_DETAILS: "false",
      // PRD phase-12 R7: 같은 이유로 고정한다. 실측 관행상 개발자 셸에 진짜 키가 export돼
      // 있어서, 상속만 하면 툴이 여섯 개가 되어 목록 완전일치 단언부터 깨진다. 더 나쁜 건
      // 목 실행이 아니라 **실서버를 치게 되는** 것이다 — CI가 남의 한도를 쓰고, 그쪽이 느린
      // 날에는 통과 여부가 우리 코드와 무관해진다. 기본은 빈 값(툴 미등록)이고, 목 업스트림
      // 케이스만 더미 키와 목 주소를 함께 넘긴다.
      DATA_GO_KR_SERVICE_KEY: serviceKey,
      MOE_API_BASE_URL: upstreamBaseUrl,
      // 기본은 캐시 끔. 스팟 스모크가 같은 동 이름으로 시나리오(성공·필터·품목별)를
      // 갈아 끼우며 업스트림 호출 수를 단언하므로, 캐시가 켜져 있으면 판정이 캐시
      // 적중 순서에 얹힌다. 캐시 자체는 인코딩 키 서버에서 켜고 따로 잰다.
      SPOT_CACHE_TTL_MS: spotCacheTtlMs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { server, getOutput: () => output };
}

async function waitForHealth(baseUrl, getOutput) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`Health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become healthy: ${lastError?.message ?? "unknown error"}\n${getOutput()}`);
}

function parseSseJson(body) {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]");

  assert(dataLines.length > 0, `MCP response did not contain SSE data:\n${body}`);

  for (const dataLine of dataLines) {
    const message = JSON.parse(dataLine);
    if (message.error) {
      throw new Error(`MCP error: ${JSON.stringify(message.error)}`);
    }
    if (message.result) {
      return message.result;
    }
  }

  throw new Error(`MCP response did not contain a result:\n${body}`);
}

// fetch (undici) silently drops a custom Host header (it is a forbidden fetch
// header), so host-allowlist checks must go through node:http, which sends it
// verbatim. Never pass a Host header to the fetch-based helpers in this file —
// it would be ignored and the check would silently test 127.0.0.1 instead.
function rawStatusWithHost(port, hostHeader, path = "/mcp", method = "POST") {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: HOST,
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Host: hostHeader,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end(method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 999, method: "ping" }) : undefined);
  });
}

async function mcpRequest(baseUrl, method, params, id, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  const body = await response.text();
  assert(response.ok, `MCP ${method} returned HTTP ${response.status}:\n${body}`);
  return parseSseJson(body);
}

async function jsonOnlyMcpRequest(baseUrl, method, params, id, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  const body = await response.text();
  assert(response.ok, `JSON-only MCP ${method} returned HTTP ${response.status}:\n${body}`);

  const message = JSON.parse(body);
  if (message.error) {
    throw new Error(`JSON-only MCP error: ${JSON.stringify(message.error)}`);
  }
  return message.result;
}

async function jsonOnlyMcpNotification(baseUrl, method, params, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    }),
  });

  const body = await response.text();
  assert(response.status === 202, `JSON-only MCP notification ${method} returned HTTP ${response.status}:\n${body}`);
}

async function mcpGetDiscovery(baseUrl, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...extraHeaders,
    },
  });

  const body = await response.text();
  assert(response.ok, `MCP GET discovery returned HTTP ${response.status}:\n${body}`);

  const message = JSON.parse(body);
  return message.result ?? message;
}

async function mcpCorsPreflight(baseUrl, origin) {
  const requestedHeaders = ["content-type", "accept", "mcp-protocol-version", "mcp-session-id", "last-event-id"];
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestedHeaders.join(","),
    },
  });

  const body = await response.text();
  assert(response.status === 204, `MCP CORS preflight returned HTTP ${response.status}:\n${body}`);
  assertCorsAllowOrigin(response, origin, "MCP CORS preflight");
  assert(
    response.headers.get("access-control-allow-methods")?.includes("POST"),
    "MCP CORS preflight did not allow POST",
  );
  const allowedHeaders = response.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
  for (const header of requestedHeaders) {
    assert(allowedHeaders.includes(header), `MCP CORS preflight did not allow ${header}`);
  }
}

function assertCorsAllowOrigin(response, origin, context) {
  assert(
    response.headers.get("access-control-allow-origin") === origin,
    `${context} did not allow the PlayMCP origin ${origin}`,
  );
}

async function jsonOnlyMcpCorsRequest(baseUrl, method, params, id, origin) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  const body = await response.text();
  assert(response.ok, `CORS JSON-only MCP ${method} returned HTTP ${response.status}:\n${body}`);
  assertCorsAllowOrigin(response, origin, `CORS JSON-only MCP ${method}`);

  const message = JSON.parse(body);
  if (message.error) {
    throw new Error(`CORS JSON-only MCP error: ${JSON.stringify(message.error)}`);
  }
  return message.result;
}

async function jsonOnlyMcpCorsNotification(baseUrl, method, params, origin) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    }),
  });

  const body = await response.text();
  assert(response.status === 202, `CORS JSON-only MCP notification ${method} returned HTTP ${response.status}:\n${body}`);
  assertCorsAllowOrigin(response, origin, `CORS JSON-only MCP notification ${method}`);
}

async function callTool(baseUrl, name, args, id) {
  return mcpRequest(
    baseUrl,
    "tools/call",
    {
      name,
      arguments: args,
    },
    id,
  );
}

function assertToolMetadata(tool, context, expectedNames = EXPECTED_TOOL_NAMES) {
  assert(typeof tool.name === "string" && tool.name.length > 0, `${context} tool was missing name`);
  assert(expectedNames.includes(tool.name), `${context} returned unexpected tool ${tool.name}`);
  assert(
    typeof tool.description === "string" && tool.description.trim().length > 0,
    `${context} ${tool.name} was missing description`,
  );
  assert(
    tool.description.length <= MAX_TOOL_DESCRIPTION_LENGTH,
    `${context} ${tool.name} description is ${tool.description.length} chars, over the ${MAX_TOOL_DESCRIPTION_LENGTH} limit`,
  );
  assert(isPlainObject(tool.inputSchema), `${context} ${tool.name} was missing inputSchema`);
  assert(tool.inputSchema.type === "object", `${context} ${tool.name} inputSchema.type must be object`);
  assert(isPlainObject(tool.inputSchema.properties), `${context} ${tool.name} inputSchema.properties must be an object`);
  assert(isPlainObject(tool.annotations), `${context} ${tool.name} was missing annotations`);

  for (const field of REQUIRED_TOOL_ANNOTATION_FIELDS) {
    assert(field in tool.annotations, `${context} ${tool.name} annotations.${field} was missing`);
  }

  assert(
    typeof tool.annotations.title === "string" && tool.annotations.title.trim().length > 0,
    `${context} ${tool.name} annotations.title must be a non-empty string`,
  );
  for (const field of REQUIRED_TOOL_ANNOTATION_FIELDS.filter((entry) => entry !== "title")) {
    assert(typeof tool.annotations[field] === "boolean", `${context} ${tool.name} annotations.${field} must be boolean`);
  }
}

function assertToolList(toolList, context, expectedNames = EXPECTED_TOOL_NAMES) {
  assert(Array.isArray(toolList.tools), `${context} tools/list result did not include tools array`);
  const toolNames = toolList.tools.map((tool) => tool.name).sort();
  assert(toolNames.length === expectedNames.length, `${context} expected ${expectedNames.length} tools, got ${toolNames.length}`);
  assert(toolNames.join(",") === expectedNames.join(","), `${context} returned a different tool list`);
  for (const tool of toolList.tools) {
    assertToolMetadata(tool, context, expectedNames);
  }
  return toolNames;
}

function assertInitializeResult(result, context) {
  assert(result.protocolVersion === EXPECTED_PROTOCOL_VERSION, `${context} returned unexpected protocolVersion ${result.protocolVersion}`);
  assert(isPlainObject(result.capabilities), `${context} was missing capabilities`);
  assert(isPlainObject(result.capabilities.tools), `${context} was missing capabilities.tools`);
  assert(result.capabilities.tools.listChanged === true, `${context} capabilities.tools.listChanged must be true`);
  assert(isPlainObject(result.serverInfo), `${context} was missing serverInfo`);
  assert(result.serverInfo.name === EXPECTED_SERVER_INFO.name, `${context} returned unexpected serverInfo.name`);
  assert(result.serverInfo.version === EXPECTED_SERVER_INFO.version, `${context} returned unexpected serverInfo.version`);
  assert(
    typeof result.instructions === "string" && result.instructions.includes("RecyclingHelper"),
    `${context} was missing RecyclingHelper instructions`,
  );
}

function resultText(result) {
  return result.content?.find((entry) => entry.type === "text")?.text ?? "";
}

function structuredContentText(result) {
  return JSON.stringify(result.structuredContent ?? {});
}

function assertStructuredKeys(result, testCase) {
  const structured = result.structuredContent;
  if (!structured) return;

  const keys = Object.keys(structured);
  const allowed =
    structured.ambiguous === true
      ? AMBIGUOUS_KEYS
      : structured.found === false
      ? NOT_FOUND_KEYS
      : STRUCTURED_KEY_WHITELIST[testCase.tool];
  assert(allowed, `${testCase.id} has no structured key whitelist for tool ${testCase.tool}`);
  for (const key of keys) {
    assert(allowed.includes(key), `${testCase.id} structuredContent has non-whitelisted key "${key}"`);
  }

  // The nested pass below skips found:false responses, so the fallback block —
  // the one not_found payload that carries nested objects — is checked here.
  if (structured.found === false && isPlainObject(structured.fallback)) {
    for (const key of Object.keys(structured.fallback)) {
      assert(NOT_FOUND_FALLBACK_KEYS.includes(key), `${testCase.id} fallback has non-whitelisted key "${key}"`);
    }
    for (const material of structured.fallback.materials ?? []) {
      for (const key of Object.keys(material)) {
        assert(
          NOT_FOUND_FALLBACK_MATERIAL_KEYS.includes(key),
          `${testCase.id} fallback.materials[] has non-whitelisted key "${key}"`,
        );
      }
      assert(
        (material.steps ?? []).length <= 2,
        `${testCase.id} fallback.materials[] must keep at most 2 steps per material`,
      );
    }
  }

  const nested = NESTED_KEY_WHITELIST[testCase.tool];
  if (nested && structured.found !== false && Array.isArray(structured[nested.field])) {
    for (const entry of structured[nested.field]) {
      for (const key of Object.keys(entry)) {
        assert(nested.keys.includes(key), `${testCase.id} ${nested.field}[] has non-whitelisted key "${key}"`);
      }
    }
  }

  if (testCase.tool === "get_disposal_steps" && structured.found === true) {
    assert(Array.isArray(structured.steps) && structured.steps.length > 0, `${testCase.id} found response is missing steps[]`);
    assert(Array.isArray(structured.cautions), `${testCase.id} found response is missing cautions[]`);
  }
}

function assertRegionNotesExpectation(result, testCase) {
  const expectation = testCase.expectedRegionNotes;
  if (!expectation) return;

  const notes = result.structuredContent?.regionNotes;
  if (expectation.present === false) {
    assert(notes === undefined, `${testCase.id} structuredContent.regionNotes should be omitted`);
    return;
  }

  assert(Array.isArray(notes) && notes.length > 0, `${testCase.id} structuredContent.regionNotes was missing`);
  for (const expected of expectation.includes ?? []) {
    assert(
      notes.some((line) => line.includes(expected)),
      `${testCase.id} regionNotes did not include "${expected}"`,
    );
  }
}

async function runAnswerCase(baseUrl, testCase, id) {
  const result = await callTool(baseUrl, testCase.tool, testCase.arguments, id);
  const text = resultText(result);
  const structured = structuredContentText(result);

  // 부정 단언만 있는 케이스가 14개 있다("이 발화가 에어컨으로 매칭되면 안 된다" 류).
  // 그 케이스들은 핸들러가 통째로 터져도 통과한다 — 없는 문자열은 오류 응답에도 없으니까.
  // 케이스마다 긍정 단언을 강제하면 그 갈래의 취지가 흐려지므로, 최소한 답이 나오기는
  // 했다는 것만 여기서 공통으로 잡는다.
  assert(result.isError !== true, `${testCase.id} came back as a tool error: ${text.slice(0, 120)}`);

  for (const expected of testCase.expectedTextIncludes ?? []) {
    assert(text.includes(expected), `${testCase.id} text did not include "${expected}"`);
  }

  for (const unexpected of testCase.expectedTextExcludes ?? []) {
    assert(!text.includes(unexpected), `${testCase.id} text unexpectedly included "${unexpected}"`);
  }

  for (const expected of testCase.expectedStructuredIncludes ?? []) {
    assert(structured.includes(expected), `${testCase.id} structuredContent did not include "${expected}"`);
  }

  for (const unexpected of testCase.expectedStructuredExcludes ?? []) {
    assert(!structured.includes(unexpected), `${testCase.id} structuredContent unexpectedly included "${unexpected}"`);
  }

  assertStructuredKeys(result, testCase);
  assertRegionNotesExpectation(result, testCase);
  assertRegionNotesUrlsUnique(result.structuredContent?.regionNotes, testCase.id);

  return result;
}

async function runSmoke() {
  const port = await getFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const { server, getOutput } = startServer(port);

  const stopServer = () => {
    if (!server.killed) server.kill("SIGTERM");
  };

  process.once("exit", stopServer);
  process.once("SIGINT", () => {
    stopServer();
    process.exit(130);
  });

  try {
    const health = await waitForHealth(baseUrl, getOutput);
    assert(health.ok === true, "Health response did not report ok=true");
    assert(health.items === wasteItems.length, `Expected ${wasteItems.length} waste items, got ${health.items}`);

    const initialize = await jsonOnlyMcpRequest(
      baseUrl,
      "initialize",
      {
        protocolVersion: EXPECTED_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "recycling-helper-smoke",
          version: "0.0.0",
        },
      },
      1,
    );
    assertInitializeResult(initialize, "JSON-only initialize");

    const ping = await jsonOnlyMcpRequest(baseUrl, "ping", {}, 2);
    assert(isPlainObject(ping), "JSON-only ping result must be an object");

    await jsonOnlyMcpNotification(baseUrl, "notifications/initialized", {});

    const toolsList = await mcpRequest(baseUrl, "tools/list", {}, 3);
    assertToolList(toolsList, "SSE tools/list");

    const jsonOnlyToolsList = await jsonOnlyMcpRequest(baseUrl, "tools/list", {}, 5);
    assertToolList(jsonOnlyToolsList, "JSON-only tools/list");

    // The SSE path (SDK-registered tools) and the JSON-only compat path are
    // generated from a single TOOL_DEFS source; assert they can never drift.
    const sortByName = (tools) => [...tools].sort((a, b) => a.name.localeCompare(b.name));
    assert(
      JSON.stringify(sortByName(toolsList.tools)) === JSON.stringify(sortByName(jsonOnlyToolsList.tools)),
      "SSE tools/list and JSON-only tools/list must be identical",
    );

    const getDiscovery = await mcpGetDiscovery(baseUrl);
    assertToolList(getDiscovery, "GET discovery");

    // PRD phase-12 D3·R7⑥: 이 서버는 키 없이 떴으므로 여섯 번째 툴이 없어야 한다. 위 목록
    // 단언들이 개수를 지키지만 **무엇이 빠졌는지는 말해 주지 않아서** 이름으로 한 번 더 박는다.
    // 등록되지 않은 툴은 호출도 못 한다 — 그래야 되돌리기(키 제거 후 재배포)가 실제로 툴을 내린다.
    assert(
      !toolsList.tools.some((tool) => tool.name === "find_disposal_spots"),
      "find_disposal_spots must not be registered when DATA_GO_KR_SERVICE_KEY is empty",
    );
    let unknownToolError;
    try {
      await jsonOnlyMcpRequest(baseUrl, "tools/call", { name: "find_disposal_spots", arguments: { dong: "상계동" } }, 4);
    } catch (error) {
      unknownToolError = error;
    }
    assert(
      unknownToolError && String(unknownToolError.message).includes("Unknown tool"),
      "calling find_disposal_spots without a service key should come back as an unknown tool",
    );

    // 사진 경로는 description으로 안내하고 `inputSource`로 신호를 받는다. description만
    // 고치고 파라미터가 스키마에 안 실리면 호스트는 보낼 방법이 없으므로 여기서 잡는다.
    const disposalTool = toolsList.tools.find((tool) => tool.name === "get_disposal_steps");
    assert(disposalTool, "tools/list is missing get_disposal_steps");
    const inputSourceSchema = disposalTool.inputSchema.properties.inputSource;
    assert(isPlainObject(inputSourceSchema), "get_disposal_steps inputSchema is missing inputSource");
    assert(
      JSON.stringify(inputSourceSchema.enum) === JSON.stringify(["photo"]),
      `inputSource should accept only "photo", got ${JSON.stringify(inputSourceSchema)}`,
    );
    assert(
      !(disposalTool.inputSchema.required ?? []).includes("inputSource"),
      "inputSource must stay optional — a typed item name carries no source",
    );
    assert(
      disposalTool.description.includes("make_cleanup_plan"),
      "get_disposal_steps description should send multi-item photos to make_cleanup_plan",
    );

    let requestId = 6;

    // A JSON-only client (Accept: application/json without text/event-stream)
    // must be able to invoke tools, not just list them — the SDK transport
    // alone would reject such POSTs with 406.
    const jsonOnlyCall = await jsonOnlyMcpRequest(
      baseUrl,
      "tools/call",
      { name: "get_disposal_steps", arguments: { itemName: "기름 묻은 피자박스" } },
      requestId,
    );
    assert(
      Array.isArray(jsonOnlyCall.content) && jsonOnlyCall.content.some((entry) => entry.type === "text"),
      "JSON-only tools/call did not return text content",
    );
    assert(
      jsonOnlyCall.structuredContent?.found === true,
      "JSON-only tools/call did not return structuredContent",
    );
    requestId += 1;

    // -32602는 호스트 모델이 읽고 다음 호출을 고치는 복구 프롬프트다. Zod 원문만
    // 나가던 시기가 있어, 자연어 안내가 앞에 서는지 고정한다.
    const invalidArgsResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name: "get_disposal_steps", arguments: {} },
      }),
    });
    const invalidArgs = JSON.parse(await invalidArgsResponse.text());
    assert(invalidArgs.error?.code === -32602, `missing itemName should return -32602, got ${JSON.stringify(invalidArgs)}`);
    assert(
      invalidArgs.error.message.includes("itemName은(는) 필수 항목입니다") &&
        invalidArgs.error.message.includes("버릴 품목명을 한국어로 전달하세요"),
      `-32602 message lost its natural-language recovery line: ${invalidArgs.error.message}`,
    );
    // Zod 원문 상세는 CALL_LOG_DETAILS=true에서만 붙는다. 기본 설정에서는 수백 바이트짜리
    // pretty-print JSON이 호스트 컨텍스트를 먹지 않아야 한다 — 이 스위트는 false로 고정돼
    // 있으므로(startServer) 여기서는 빠져 있는 쪽이 정상이다.
    assert(
      !invalidArgs.error.message.includes("상세:"),
      `-32602 message carries the Zod detail with CALL_LOG_DETAILS off: ${invalidArgs.error.message}`,
    );
    requestId += 1;

    // 배열 원소가 걸린 이슈는 경로가 items.1로 나온다. 라벨은 그대로 두되 안내는
    // 최상위 필드(items)에서 찾아야 한다 — 경로 전체로 찾던 때는 어디가 틀렸는지만
    // 알려주고 정작 어떻게 고치는지가 빠졌다.
    const emptyElementResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name: "make_cleanup_plan", arguments: { items: ["침대", ""] } },
      }),
    });
    const emptyElement = JSON.parse(await emptyElementResponse.text());
    assert(
      emptyElement.error?.code === -32602,
      `an empty items element should return -32602, got ${JSON.stringify(emptyElement)}`,
    );
    assert(
      emptyElement.error.message.includes("items.1이(가) 비어 있습니다") &&
        emptyElement.error.message.includes("버릴 품목명 1~30개"),
      `-32602 for an array element lost its recovery hint: ${emptyElement.error.message}`,
    );
    requestId += 1;

    // Host allowlist checks must use node:http — see rawStatusWithHost.
    for (const endpointHost of PLAYMCP_ENDPOINT_HOSTS) {
      const status = await rawStatusWithHost(port, endpointHost);
      assert(status === 200, `Allowed host ${endpointHost} should return 200, got ${status}`);
    }
    const disallowedStatus = await rawStatusWithHost(port, "evil.example.com");
    assert(disallowedStatus === 403, `Disallowed host should return 403, got ${disallowedStatus}`);

    // Host validation is scoped to /mcp: /health must stay reachable for
    // probes that send a pod IP (or any other hostname) as the Host header.
    const healthProbeStatus = await rawStatusWithHost(port, "10.244.0.7:3000", "/health", "GET");
    assert(healthProbeStatus === 200, `/health with pod-IP Host should return 200, got ${healthProbeStatus}`);

    for (const origin of PLAYMCP_ORIGINS) {
      await mcpCorsPreflight(baseUrl, origin);

      const corsInitialize = await jsonOnlyMcpCorsRequest(
        baseUrl,
        "initialize",
        {
          protocolVersion: EXPECTED_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "recycling-helper-smoke-cors",
            version: "0.0.0",
          },
        },
        requestId,
        origin,
      );
      assertInitializeResult(corsInitialize, `CORS JSON-only initialize for ${origin}`);
      requestId += 1;

      const corsPing = await jsonOnlyMcpCorsRequest(baseUrl, "ping", {}, requestId, origin);
      assert(isPlainObject(corsPing), `CORS JSON-only ping result for ${origin} must be an object`);
      requestId += 1;

      await jsonOnlyMcpCorsNotification(baseUrl, "notifications/initialized", {}, origin);

      const corsToolsList = await jsonOnlyMcpCorsRequest(baseUrl, "tools/list", {}, requestId, origin);
      assertToolList(corsToolsList, `CORS JSON-only tools/list for ${origin}`);
      requestId += 1;
    }
    for (const answerCase of answerCases) {
      await runAnswerCase(baseUrl, answerCase, requestId);
      requestId += 1;
    }

    // PRD phase-10 — 지역 안내 중복 제거. 지역 품목 응답에서 같은 정보가 두 번 실리는 자리를
    // 걷어냈고, 그 자리마다 "정보는 남아 있다"를 여기서 함께 잡는다.
    {
      const nowon = regionPolicies.find((policy) => policy.name === SIZE_CASE.region);
      assert(nowon?.bulkyWaste?.applicationUrl && nowon?.bulkyWaste?.feeUrl, "size case needs 노원구 bulkyWaste URLs");
      const sizeResult = await callTool(baseUrl, "get_disposal_steps", SIZE_CASE, requestId++);
      const sizeText = resultText(sizeResult);
      warnIfOversized(sizeResult, "text");

      // R1-a: 연락처 블록이 찍은 주소를 수수료 블록이 다시 적지 않는다. 각각 정확히 한 번.
      assertUrlShownOnce(sizeText, nowon.bulkyWaste.applicationUrl, "노원구 매트리스 text");
      assertUrlShownOnce(sizeText, nowon.bulkyWaste.feeUrl, "노원구 매트리스 text");
      assert(!sizeText.includes("- 신청 URL:") && !sizeText.includes("- 수수료 출처:"), "노원구 매트리스: 수수료 블록 끝의 옛 URL 줄이 되살아났다");

      // R1-b: 수수료 행은 고시명 하나에 규격을 잇는다. 고시명이 행마다 반복되면 안 된다.
      const feeRowLines = sizeText.split("\n").filter((line) => line.startsWith("  - (침대)매트리스"));
      const distinctNames = new Set(feeRowLines.map((line) => line.slice(0, line.indexOf(":"))));
      assert(feeRowLines.length > 0, "노원구 매트리스: 수수료 행이 없다");
      assert(
        feeRowLines.length === distinctNames.size,
        `노원구 매트리스: 같은 고시명이 여러 줄에 흩어져 있다 — 고시명 묶기가 풀렸다:\n${feeRowLines.join("\n")}`,
      );
      // 잘린 사실은 규격 수가 아니라 행 수로 말한다(PR #66 리뷰 2라운드).
      if (bulkyFeeSchedules.find((schedule) => schedule.regionId === nowon.id)?.preCapFeeRowCountByItemId?.mattress) {
        assert(/수수료표 \d+행 중 대표 \d+행만 추렸습니다\. 전체 표는 수수료 조회 링크에서 확인하세요\./.test(sizeText), "노원구 매트리스: 잘린 행 안내가 행 단위가 아니거나 가리키는 링크 이름이 어긋난다");
        assert(!/개 규격 중 대표/.test(sizeText), "노원구 매트리스: 잘린 행 안내가 '규격'으로 되돌아갔다");
      }

      // R2-b: 지역 안내가 수수료표와 신청 경로를 냈으니 그 항목은 다시 묻지 않는다. 답하지 않은
      // 항목(배출 장소와 배출일)은 남는다.
      assert(!sizeText.includes("- 확인 항목: 품목별 수수료"), "노원구 매트리스: 수수료표를 내고도 '품목별 수수료'를 다시 묻는다");
      assert(sizeText.includes("- 확인 항목: 배출 장소와 배출일"), "노원구 매트리스: 지역 안내가 답하지 않은 확인 항목까지 사라졌다");
      // 부착은 확인한 지역에서만 답한 것이다(PR #70 리뷰 1라운드). 노원구는 `prePosting`도
      // 품목별 안내도 없어 지역 안내의 "접수증 또는 접수번호를 부착"이 조사한 값이 아니므로
      // 항목이 남고, 품목별 안내가 부착 방식을 직접 적은 강남구에서는 빠진다.
      assert(sizeText.includes("- 확인 항목: 신고필증 부착 방식"), "노원구 매트리스: 확인하지 않은 기본 문구를 근거로 '신고필증 부착 방식'을 지웠다");
      const gangnamText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "매트리스", region: "서울 강남구" }, requestId++));
      assert(gangnamText.includes("접수증 또는 접수번호를 품목별로 부착"), "강남구 매트리스: 품목별 지역 안내의 부착 문구가 사라졌다");
      assert(!gangnamText.includes("- 확인 항목: 신고필증 부착 방식"), "강남구 매트리스: 부착 방식을 직접 적고도 '신고필증 부착 방식'을 다시 묻는다");
      // `prePosting`이 차 있어도 문장이 갈아끼워지는 건 `none`일 때뿐이다. 부평구는 `sticker`라
      // 확인한 스티커 방식은 한 번도 안 나가는데 항목만 사라지고 있었다(PR #70 리뷰 2라운드).
      const bupyeongText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "매트리스", region: "인천 부평구" }, requestId++));
      assert(
        bupyeongText.includes("- 확인 항목: 신고필증 부착 방식"),
        "부평구 매트리스: 기본 부착 문구만 내보내면서 'sticker' 값을 근거로 '신고필증 부착 방식'을 지웠다",
      );

      // "신고 대상 여부"는 "신고 방법"과 다른 질문이다. 대형폐기물이 보조 배출로인 품목에
      // 지역 안내는 "해당할 때만 신청한다"고만 말하므로 해당 여부는 답하지 않은 것이다.
      const ceramicText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "도자기 그릇", region: "서울 노원구" }, requestId++));
      assert(ceramicText.includes("- 확인 항목: 대형폐기물 신고 대상 여부"), "노원구 도자기 그릇: 보조 배출로인데 '대형폐기물 신고 대상 여부'를 답한 것으로 쳤다");

      // 복합 항목의 반쪽이 주제 밖이면 항목을 남긴다. 해운대구는 `prePosting: "none"`이라 부착은
      // 답했지만 "배출 장소"는 아무도 답하지 않았다 — 통째로 지우면 그 반쪽을 잃는다.
      const dryingRackText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "빨래건조대", region: "부산 해운대구" }, requestId++));
      assert(
        dryingRackText.includes("접수증이나 접수번호를 붙이지 않고"),
        "해운대구 빨래건조대: 확인한 'none' 부착 문구가 사라졌다 — 픽스처가 더 이상 이 갈래를 타지 않는다",
      );
      assert(
        dryingRackText.includes("- 확인 항목: 배출 장소와 접수번호 부착 방식"),
        "해운대구 빨래건조대: 부착 주제 하나로 복합 항목을 지워 '배출 장소'까지 잃었다",
      );

      // 지역 요약 줄은 근거가 아니다(PR #70 리뷰 3라운드). 소형가전 수거함 품목은
      // `formatRegionItemGuide`의 마지막 갈래로 떨어져 `- {지역 요약}` 한 줄만 받는데,
      // 노원 요약의 "수수료 조회"·"동주민센터"에 걸려 확인 항목이 빠지고 있었다.
      const lampText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "스탠드 조명", region: "서울 노원구" }, requestId++));
      assert(!lampText.includes("수수료 후보:"), "노원구 스탠드 조명: 수수료표가 나간다 — 픽스처가 더 이상 지역 요약만 받는 갈래를 타지 않는다");
      assert(
        lampText.includes("- 확인 항목: 대형폐기물 신고 방법과 수수료"),
        "노원구 스탠드 조명: 지역 요약 문장의 낱말을 근거로, 답한 적 없는 확인 항목을 지웠다",
      );

      // 괄호 안이 한정 질문이면 항목을 지우지 않는다. "품목별 수수료(일반·전동 구분)"는
      // 괄호를 떼면 "품목별 수수료"로 줄어 수수료표만으로 닫히는데, 정작 묻는 건
      // 일반·전동을 갈라 매기느냐라 표가 그 답을 하지 않는다.
      const scooterText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "킥보드", region: "서울 노원구" }, requestId++));
      assert(scooterText.includes("수수료 후보:"), "노원구 킥보드: 수수료표가 없다 — 픽스처가 더 이상 이 갈래를 타지 않는다");
      assert(
        scooterText.includes("- 확인 항목: 품목별 수수료(일반·전동 구분)"),
        "노원구 킥보드: 괄호를 떼면서 한정 질문까지 지워 일반·전동 구분을 잃었다",
      );

      // 품목 안쪽 범위를 묻는 "별도 신고 여부"는 대형폐기물 해당 여부와 다른 질문이라
      // 신청 주소로 닫히지 않는다. 같은 응답에서 수수료·신고 방법은 그대로 빠져야 한다.
      const vanityText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "화장대", region: "서울 강서구" }, requestId++));
      assert(vanityText.includes("수수료 후보:"), "강서구 화장대: 수수료표가 없다 — 픽스처가 더 이상 이 갈래를 타지 않는다");
      assert(vanityText.includes("- 확인 항목: 거울 별도 신고 여부"), "강서구 화장대: 품목 안쪽 범위를 묻는 항목을 신청 주소만으로 지웠다");
      assert(!vanityText.includes("- 확인 항목: 품목별 수수료"), "강서구 화장대: 수수료표를 내고도 '품목별 수수료'를 다시 묻는다");
      assert(!vanityText.includes("- 확인 항목: 대형폐기물 신고 방법"), "강서구 화장대: 신청 경로를 내고도 '대형폐기물 신고 방법'을 다시 묻는다");

      // R2-a: 지역 공식 출처는 품목 갈래에 맞는 것만. 대형폐기물 품목에 폐건전지 출처가 붙지 않고,
      // 수수료표를 실었으니 그 표의 출처(수수료 고시)가 선다.
      const sizeSources = sliceFrom(sizeText, `### ${SIZE_CASE.region} 공식 출처`, "노원구 매트리스");
      assert(sizeSources.includes("전국대형폐기물수거수수료정보표준데이터"), "노원구 매트리스: 수수료표의 출처가 공식 출처에 없다");
      assert(!sizeSources.includes("폐형광등·폐건전지 배출안내"), "노원구 매트리스: 품목과 무관한 수거함 출처가 공식 출처에 붙는다");

      // R2-b 반대편: 광역 착지는 신청 경로를 준 게 아니라 '수수료'·'신고 방법' 항목을 남긴다.
      const metroText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "소파", region: "청주시" }, requestId++));
      assert(metroText.includes("- 확인 항목: 수수료"), "청주시 소파: 광역 착지인데 수수료 확인 항목이 빠졌다 — 답하지 않은 항목을 지웠다");

      // R2-a 반대편: 수거함 품목에는 그 수거함 출처가 남는다.
      const batteryText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "건전지", region: "서울 마포구" }, requestId++));
      const batterySources = sliceFrom(batteryText, "### 서울 마포구 공식 출처", "마포구 건전지");
      assert(batterySources.includes("폐형광등·폐건전지 수거함 배치 현황"), "마포구 건전지: 수거함 출처가 공식 출처에서 빠졌다");
      assert(!batterySources.includes("투명페트병 무인회수기"), "마포구 건전지: 품목과 무관한 출처가 공식 출처에 붙는다");

      // R2-a 세 번째 갈래: 배출 그룹 라벨에 고를 어휘가 아예 없는 품목(`region_specific` →
      // "지역 확인 필요")은 거를 근거가 없으니 지역 출처를 전부 낸다. 대표 1개로 줄이면
      // 도봉구 sources[0] 하나만 남아 이 품목이 봐야 할 다른 안내를 잃는다 — 그 자리가 무엇인지는
      // 출처 순서에 달려 있어(2026-08-25 순서 정리로 바뀌었다) 지역 출처를 전부 내는 이 갈래
      // 자체가 안전장치다.
      const ledText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "LED등", region: "서울 도봉구" }, requestId++));
      const ledSources = sliceFrom(ledText, "### 서울 도봉구 공식 출처", "도봉구 LED등");
      assert(ledSources.includes("도봉구 폐형광등·폐건전지 배출안내"), "도봉구 LED등: 고를 어휘가 없는 품목에서 지역 출처를 대표 1개로 잘라 수거함 안내를 잃었다");
      assert(ledSources.includes("도봉구 생활폐기물 배출안내"), "도봉구 LED등: 고를 어휘가 없는 품목인데 지역 출처가 전부 나오지 않는다");

      // 품목별 지역 안내가 있는 지역(마포)은 연락처 블록을 안 거치므로 수수료 블록이 유일한
      // 링크 자리다 — 거기서는 두 주소가 그대로 한 번씩 나가야 한다.
      const mapo = regionPolicies.find((policy) => policy.name === "서울 마포구");
      assert(mapo?.bulkyWaste?.applicationUrl && mapo.bulkyWaste.feeUrl, "마포구 픽스처에 bulkyWaste 신청·수수료 URL이 있어야 이 갈래를 볼 수 있다");
      const mapoText = resultText(await callTool(baseUrl, "get_disposal_steps", { itemName: "의자", region: "서울 마포구" }, requestId++));
      assertUrlShownOnce(mapoText, mapo.bulkyWaste.applicationUrl, "마포구 의자 text");
      assertUrlShownOnce(mapoText, mapo.bulkyWaste.feeUrl, "마포구 의자 text");

      // 반대로 지역 툴에서는 호출부가 연락처 블록으로 같은 주소를 먼저 찍는다. 품목별 지역
      // 안내가 있는 지역은 그 블록이 대형폐기물 갈래를 안 타 자체 중복 판정이 걸리지 않아,
      // 라벨을 통일한 뒤로 같은 줄이 글자까지 똑같이 두 번 나갔다(PR #70 리뷰 3라운드).
      // 판정 범위는 안내 본문까지다. 아래 "공식 확인처"는 basis 문장이 붙은 출처 목록이라
      // 같은 주소가 한 번 더 들어도 안내의 반복이 아니다 — `assertUrlShownOnce`가 블록으로
      // 좁히는 이유와 같다.
      const mapoRegionText = resultText(
        await callTool(baseUrl, "get_region_disposal_info", { region: "서울 마포구", itemName: "의자" }, requestId++),
      );
      const mapoRegionBody = mapoRegionText.slice(0, mapoRegionText.indexOf("\n공식 확인처"));
      assert(mapoRegionBody.length > 0, "마포구 의자 지역 툴: 응답에 `공식 확인처` 블록이 없다");
      const mapoFeeUrlCount = countOccurrences(mapoRegionBody, mapo.bulkyWaste.feeUrl);
      assert(mapoFeeUrlCount >= 1, "마포구 의자 지역 툴: 수수료 조회 주소가 본문에 없다 — 중복을 지우다가 링크를 없앴다");
      assert(
        mapoFeeUrlCount === 1,
        `마포구 의자 지역 툴: 수수료 조회 주소가 본문에 ${mapoFeeUrlCount}번 나간다 — 연락처 블록과 수수료 블록이 같은 줄을 두 번 찍는다`,
      );

      // PRD phase-11 — 지역 툴 다이어트. `확인할 정보`는 사용자가 아직 확인해야 할 것의
      // 목록인데, 같은 응답 위쪽이 이미 답한 것을 다시 싣고 있었다.
      const regionSizeResult = await callTool(baseUrl, "get_region_disposal_info", REGION_SIZE_CASE, requestId++);
      const regionSizeText = resultText(regionSizeResult);
      const regionSizeTotal = measureResult(regionSizeResult, { widgets: false }).total;
      if (regionSizeTotal > REGION_TOOL_SIZE_WARN_BYTES) {
        console.warn(
          `[size] get_region_disposal_info ${JSON.stringify(REGION_SIZE_CASE)} 응답이 ${regionSizeTotal}B — 경고 상한 ${REGION_TOOL_SIZE_WARN_BYTES}B를 넘었다. ` +
            "수수료 행이나 지역 출처가 늘어 정당하게 커진 것인지 pnpm measure:size로 확인하고, 아니면 체크리스트에 중복이 다시 생긴 것이다.",
        );
      }

      // 구분용 빈 줄이 살아 있어야 한다. 줄 배열의 filter(Boolean)이 빈 문자열까지 지워
      // 제목이 앞 블록에 그대로 붙어 나간 적이 있다 — 마크다운 헤더가 아닌 제목이라
      // 빈 줄이 유일한 섹션 경계다.
      assert(
        regionSizeText.includes("\n\n"),
        "노원구 매트리스 지역 툴: 응답에 빈 줄이 하나도 없다 — 구분용 빈 문자열이 filter에 지워졌다",
      );

      // R1·R2 공통: 지역 툴 응답에 글자 단위로 같은 줄이 두 번 있으면 안 된다. 연락처 블록이
      // 두 번 찍히던 것과 체크리스트가 위 블록을 옮겨 적던 것이 한 단언에 함께 걸린다.
      // 빈 줄만 뺀다. `확인할 정보`의 항목은 앞에 번호가 붙어(`1. `) 같은 값이라도 줄이 달라지므로
      // 이 판정에 걸리지 않는다 — 체크리스트 안의 중복은 위 R2 단언들이 따로 잡는다.
      const regionSizeLines = regionSizeText.split("\n").filter((line) => line.trim().length > 0);
      const regionDuplicateLine = regionSizeLines.find(
        (line, index) => regionSizeLines.indexOf(line) !== index,
      );
      assert(
        !regionDuplicateLine,
        `노원구 매트리스 지역 툴: 같은 줄이 두 번 나간다 — "${regionDuplicateLine}"`,
      );

      // R2-a: 수수료는 위 블록이 냈으니 체크리스트는 범위 한 줄로 접는다. **한 줄은 남아야
      // 한다** — 이 툴의 structuredContent에서 금액이 실리는 자리는 checkList뿐이다.
      const regionChecks = regionSizeResult.structuredContent?.checkList ?? [];
      const regionFeeChecks = regionChecks.filter((check) => /수수료/.test(check) && /원/.test(check));
      assert(
        regionFeeChecks.length === 1,
        `노원구 매트리스 지역 툴: 체크리스트의 금액 줄이 ${regionFeeChecks.length}개다 — 1개여야 한다: ${JSON.stringify(regionFeeChecks)}`,
      );
      assert(
        /\d+원~[\d,]+원/.test(regionFeeChecks[0]),
        `노원구 매트리스 지역 툴: 체크리스트 수수료 줄이 범위를 안 담았다: "${regionFeeChecks[0]}"`,
      );
      assert(regionSizeText.includes("수수료 후보:"), "노원구 매트리스 지역 툴: 위 수수료 후보 블록이 사라졌다 — 범위 한 줄이 가리킬 곳이 없다");

      // R2-b: 품목별 안내의 steps는 위 블록과 겹쳐도 체크리스트에 남아야 한다 — 이 툴의
      // structuredContent에서 지역별 품목 안내가 실리는 자리가 `checkList`뿐이라, 빼면
      // 구조화 출력만 읽는 호스트가 그 안내를 통째로 잃는다(PR #74 리뷰 1라운드).
      const mapoRegionChecks =
        (await callTool(baseUrl, "get_region_disposal_info", { region: "서울 마포구", itemName: "의자" }, requestId++))
          .structuredContent?.checkList ?? [];
      const mapoGuide = mapo.itemGuides?.find((guide) => guide.itemIds.includes("chair"));
      assert(mapoGuide, "마포구 의자 픽스처에 품목별 지역 안내가 있어야 이 갈래를 볼 수 있다");
      for (const step of mapoGuide.steps) {
        assert(
          mapoRegionChecks.includes(step),
          `마포구 의자 지역 툴: 품목별 안내가 structuredContent에서 사라졌다 — checkList가 그 유일한 자리다: "${step}"`,
        );
        assert(mapoRegionText.includes(step), `마포구 의자 지역 툴: 품목별 안내에서 "${step}"이 사라졌다`);
      }

      // R2-c: 두 툴이 같은 품목·지역에서 같은 확인 항목을 낸다. 호스트가 어느 툴을 고르느냐로
      // 답이 갈리면 안 된다 — 지역 툴만 안 거르고 있었다.
      //
      // 한 쌍만 보면 안 된다. 지역 툴의 근거를 "실제로 찍힌 줄"로 잡았을 때 `스탠드 조명`처럼
      // 대형폐기물이 아닌 품목이 지역 대형폐기물 블록에 걸려 항목을 잃었는데, 노원구 매트리스
      // 한 쌍으로는 안 보였다(PR #74 리뷰 2라운드). 갈래가 다른 품목을 함께 본다.
      const parityCases = [
        REGION_SIZE_CASE, // 대형폐기물 주 배출로 + 수수료 있음
        { region: "서울 노원구", itemName: "스탠드 조명" }, // 소형가전 — 지역 대형폐기물 블록과 무관
        { region: "서울 노원구", itemName: "변기커버" }, // 확인 항목이 하나뿐이고 그게 위에서 답해진다
        { region: "서울 마포구", itemName: "다리미판" }, // 대형폐기물이 보조 배출로
        { region: "서울 마포구", itemName: "의자" }, // 품목별 지역 안내가 있는 지역
      ];
      for (const parityCase of parityCases) {
        const parityRegion = await callTool(baseUrl, "get_region_disposal_info", parityCase, requestId++);
        const parityChecks = parityRegion.structuredContent?.checkList ?? [];
        assert(parityChecks.length > 0, `${JSON.stringify(parityCase)}: 지역 툴 체크리스트가 비었다`);
        const parityStepsChecks = resultText(
          await callTool(baseUrl, "get_disposal_steps", { itemName: parityCase.itemName, region: parityCase.region }, requestId++),
        )
          .split("\n")
          .filter((line) => line.startsWith("- 확인 항목: "))
          .map((line) => line.slice("- 확인 항목: ".length));
        for (const check of parityStepsChecks) {
          // 요일 줄은 두 툴이 붙이는 자리가 달라(품목 툴은 확인 항목, 지역 툴은 닫는 줄) 문구가
          // 갈린다. 그 불변식은 아래 49곳 회귀가 따로 지킨다.
          if (check.includes("요일")) continue;
          assert(
            parityChecks.includes(check),
            `${JSON.stringify(parityCase)}: 품목 툴은 "${check}"을 묻는데 지역 툴 체크리스트에는 없다 — 두 툴의 답이 갈린다`,
          );
        }
        // 걸러 낸 결과가 비어도 품목을 모를 때 쓰는 일반 폴백으로 되돌아가면 안 된다.
        assert(
          !parityChecks.includes("전용 수거함, 지정 수거처, 신고 또는 수수료 기준"),
          `${JSON.stringify(parityCase)}: 품목별 확인 항목이 일반 폴백으로 바뀌었다 — 거른 결과가 비었을 때 거르기 전 목록으로 돌아가야 한다`,
        );
      }

      // 보조 배출로 품목은 체크리스트의 금액에도 카드·플랜과 같은 단서가 붙어야 한다.
      const secondaryChecks =
        (await callTool(baseUrl, "get_region_disposal_info", { region: "서울 마포구", itemName: "다리미판" }, requestId++))
          .structuredContent?.checkList ?? [];
      const secondaryFee = secondaryChecks.find((check) => /수수료 [\d,]+원/.test(check));
      assert(secondaryFee, "마포구 다리미판 지역 툴: 체크리스트에 금액 줄이 없다");
      assert(
        secondaryFee.startsWith("대형폐기물에 해당할 때만"),
        `마포구 다리미판 지역 툴: 보조 배출로인데 금액을 조건 없이 말한다 — 카드·플랜과 답이 갈린다: "${secondaryFee}"`,
      );

      // 연락처 블록을 위에서 찍었으면 기한 문장도 그 방향을 가리켜야 한다. `아래`로 남으면
      // 아무것도 없는 곳을 가리킨다.
      const deadlineLine = regionSizeText.split("\n").find((line) => line.includes("신청 기한은"));
      if (deadlineLine) {
        assert(
          !deadlineLine.includes("아래 신청 경로"),
          `노원구 매트리스 지역 툴: 신청 경로는 위에 있는데 기한 문장이 아래를 가리킨다: "${deadlineLine}"`,
        );
      }

      // R3: 규격 칸이 빈 행(`-`)을 규격처럼 싣지 않는다. 세 경로를 한 자리에서 본다.
      const dashRegion = await callTool(baseUrl, "get_region_disposal_info", { region: "서울 마포구", itemName: "빨래건조대" }, requestId++);
      const dashSteps = await callTool(baseUrl, "get_disposal_steps", { itemName: "빨래건조대", region: "서울 마포구" }, requestId++);
      const dashPlan = await callTool(baseUrl, "make_cleanup_plan", { items: ["빨래건조대"], region: "서울 마포구" }, requestId++);
      // cleanup plan도 구분용 빈 줄이 살아 있어야 한다(지역 툴의 같은 단언 참고).
      assert(
        resultText(dashPlan).includes("\n\n"),
        "마포구 빨래건조대 cleanup plan: 응답에 빈 줄이 하나도 없다 — 구분용 빈 문자열이 filter에 지워졌다",
      );
      // 행이 여럿인데 규격이 전부 빈 경우도 본다 — 마포구 `피아노`는 `피아노`와
      // `전자피아노(오르간)` 두 고시명이 규격 없이 금액만 다르다. 단일 행만 고치면 이쪽은
      // `규격 2종`으로 남아 고시에 없는 구분을 지어낸다(PR #74 리뷰 1라운드).
      //
      // 이 문구를 내는 건 `buildRegionFeeLine`이라 텍스트 모드 `get_disposal_steps`에는 안 실린다.
      // 렌더링 모드와 무관하게 그 함수를 타는 `make_cleanup_plan`으로 본다.
      const dashMultiPlan = JSON.stringify(
        await callTool(baseUrl, "make_cleanup_plan", { items: ["피아노"], region: "서울 마포구" }, requestId++),
      );
      assert(!dashMultiPlan.includes("규격 2종"), "마포구 피아노: 규격이 없는 두 행을 `규격 2종`이라고 부른다");
      assert(dashMultiPlan.includes("수수료표 2행"), "마포구 피아노: 규격 없는 여러 행을 행 수로 말하지 않는다");

      // 규격을 대는 행과 안 대는 행이 섞인 조합도 본다 — 마포구 `운동기구`는 세 행 중 둘만
      // 규격을 댄다(`러닝머신`이 `-`). 하나라도 비면 `규격 N종`은 없는 구분을 지어내는 셈이다.
      const mixedSpecPlan = JSON.stringify(
        await callTool(baseUrl, "make_cleanup_plan", { items: ["러닝머신"], region: "서울 마포구" }, requestId++),
      );
      assert(!mixedSpecPlan.includes("규격 3종"), "마포구 운동기구: 규격 칸이 빈 행까지 세어 `규격 3종`이라고 부른다");
      assert(mixedSpecPlan.includes("수수료표 3행"), "마포구 운동기구: 규격이 섞인 행 묶음을 행 수로 말하지 않는다");
      for (const [label, payload] of [["지역 툴", dashRegion], ["품목 툴", dashSteps], ["cleanup plan", dashPlan]]) {
        const serialized = JSON.stringify(payload);
        assert(!serialized.includes("(-,"), `마포구 빨래건조대 ${label}: 규격 없는 행이 \`(-,\`로 나간다`);
        assert(!serialized.includes("(-)"), `마포구 빨래건조대 ${label}: 규격 없는 행이 \`(-)\`로 나간다`);
        assert(!serialized.includes("빨래건조대 - 수수료"), `마포구 빨래건조대 ${label}: 규격 없는 행이 \`빨래건조대 - 수수료\`로 나간다`);
        // 규격 자리의 `-`만 잡는다. 앞에 공백이 오는 `  - 수수료 …`는 목록 불릿이라 정상이다.
        assert(!/\S - 수수료 /.test(serialized), `마포구 빨래건조대 ${label}: 규격 자리에 \`-\`가 그대로 남았다`);
        assert(serialized.includes("1,000원"), `마포구 빨래건조대 ${label}: 금액이 사라졌다 — 표기를 고치다가 값을 지웠다`);
      }
    }

    const classify = await callTool(baseUrl, "classify_waste_item", { itemName: "일회용 마스크" }, requestId);
    assert(classify.structuredContent?.matchedItem === "일회용 마스크", "classify_waste_item did not match disposable mask");
    requestId += 1;

    const confusing = await callTool(baseUrl, "check_confusing_item", { itemName: "깨진 유리" }, requestId);
    assert(resultText(confusing).includes("깨진 유리컵"), "check_confusing_item did not include broken glass");
    requestId += 1;

    const cleanup = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["칫솔", "닭뼈", "책상의자"], region: "서울 강남구" },
      requestId,
    );
    assert(resultText(cleanup).includes("의자"), "make_cleanup_plan did not include chair");
    // 플랜이 금액을 직접 싣는지. 이걸 지역 툴에 미루던 시절, 호스트는 두 번째 호출을 하는
    // 대신 자기 지식으로 답해버렸다(Preview 측정 2026-08-18). 수수료는 이 툴이 부를 값을
    // 갖는 유일한 이유라 text와 structuredContent 양쪽에서 지킨다.
    assert(
      /수수료 [\d,]+원/.test(resultText(cleanup)),
      `plan with a fee-bearing item must carry the amount: ${resultText(cleanup)}`,
    );
    const cleanupChair = cleanup.structuredContent?.items?.find((entry) => entry.input === "책상의자");
    assert(
      typeof cleanupChair?.fee === "string" && /[\d,]+원/.test(cleanupChair.fee),
      `plan structuredContent lost the fee: ${JSON.stringify(cleanupChair)}`,
    );
    // 다음 툴 힌트. 텍스트에는 자연어만(호스트가 사용자에게 그대로 인용할 수 있다),
    // 호출에 필요한 툴 이름·인자는 structuredContent.nextTool로만 나간다. 예고는 지역 툴이
    // 실제로 내놓는 것까지만이다 — 규격별 표를 통째로 주는 경로도, 신청·수수료 URL을 지역
    // 개요로 내보내는 경로도 없다(그 주소는 bulky-waste-fees.json에 있고 개요 경로는 그
    // 파일을 안 읽는다).
    assert(
      resultText(cleanup).includes("서울 강남구의 대형폐기물 신고 절차와 전용 수거함 위치, 공식 확인처도 이어서 안내할 수 있습니다."),
      "critical-item plan with a region should end with the follow-up line",
    );
    for (const forbidden of ["전체 표", "신청 주소", "수수료 조회처"]) {
      assert(
        !resultText(cleanup).includes(forbidden),
        `the plan must not promise "${forbidden}" — no region-overview path delivers it`,
      );
    }
    assert(
      !resultText(cleanup).includes("get_region_disposal_info"),
      "the tool name must never appear in user-facing text",
    );
    assert(
      cleanup.structuredContent?.nextTool?.name === "get_region_disposal_info" &&
        cleanup.structuredContent.nextTool.arguments?.region === "서울 강남구",
      `plan structuredContent lost its nextTool hint: ${JSON.stringify(cleanup.structuredContent?.nextTool)}`,
    );
    requestId += 1;

    // 예고를 지키는지는 **강남구로 재면 안 된다.** 강남구는 지역 출처 목록에 마침
    // clean.gangnam.go.kr가 들어 있어서, 못 지킬 문장을 걸어도 화면상 URL이 있는 것처럼
    // 보인다. 서초구는 수수료 고시는 가졌는데 개요 응답에 신청·수수료 주소가 하나도 없다 —
    // 예고가 과했는지는 이쪽에서만 드러난다.
    const cleanupSeocho = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["책상의자"], region: "서울 서초구" },
      requestId,
    );
    assert(
      resultText(cleanupSeocho).includes("서울 서초구의 대형폐기물 신고 절차와 전용 수거함 위치, 공식 확인처도 이어서 안내할 수 있습니다."),
      `fee-bearing plan in 서초구 lost the follow-up line: ${resultText(cleanupSeocho)}`,
    );
    const seochoRegion = await callTool(baseUrl, "get_region_disposal_info", { region: "서울 서초구" }, requestId + 1);
    for (const promised of ["신청 주소", "수수료 조회처", "전체 표"]) {
      assert(
        !resultText(cleanupSeocho).includes(promised),
        `서초구 plan promises "${promised}" but its region overview has no such URL`,
      );
    }
    assert(
      !/clean\.|biwa/.test(resultText(seochoRegion)),
      "서초구 fixture assumes no bulky application/fee URL in the overview — refresh this guard if the data gained one",
    );
    requestId += 2;

    // 요일 질문은 되묻지 않고 링크로 닫는다. 요일을 값으로 안 주는 건 그대로인데,
    // **어디서 확인하는지**를 안 적었더니 호스트 모델이 그 빈자리를 "사는 동 이름을
    // 알려주세요"로 메웠다. 사용자가 동을 답해도 우리가 줄 게 없어서, 그 뒤 후속 턴이
    // 통째로 웹 검색으로 샜다(2026-08-19 Preview 측정).
    //
    // 49곳 전부에 같은 불변식을 건다. 확인처가 **그 지역의 대형폐기물 신청·수수료
    // 페이지면 실패**다 — 출처를 고르는 정규식은 `basis` 어휘만 보는데 신청 페이지
    // 설명에도 "수거일"이 흔히 적혀 있어, 용인시는 요일 질문에 신청 페이지를 확인처로
    // 주고 있었다. 특정 지역이 나중에 진짜 요일 페이지를 얻어도 이 단언은 그대로 맞다.
    //
    // 이름이 실제로 그 지역으로 매칭됐는지부터 본다. 광역으로 폴백하거나 되묻기로 빠지면
    // 다른 지역의 요일 줄을 놓고 아래 단언이 전부 통과해, 49곳을 돈다는 이 루프가 헛돈다.
    const GUIDE_KINDS = [
      { label: "폐의약품", re: /의약품/, field: "medicine" },
      { label: "폐건전지·폐형광등", re: /건전지|전지류|형광등|배터리/, field: "batteryAndFluorescentLamp" },
    ];
    // 본문은 수거함 안내를 말하는데 그 근거 출처가 하나도 없는 자리. 순서로는 못 고치고
    // 출처를 찾아야 하는 일이라 이 PR에서 닫지 못했다. 조용히 넘기지 않고 이름을 남긴다 —
    // **줄어야 할 목록이지 늘어야 할 목록이 아니다.** 새 지역이 같은 상태로 들어오면
    // 위 단언에서 걸린다. 사유와 진행은 `docs/data-decision-backlog.md`에 있다.
    const KNOWN_GUIDE_SOURCE_GAPS = new Set([
      "songpa_gu:batteryAndFluorescentLamp",
      "mapo_gu:medicine",
      "seongnam_si:medicine",
      "jongno_gu:medicine",
      "jongno_gu:batteryAndFluorescentLamp",
      "yongsan_gu:batteryAndFluorescentLamp",
      "gwangjin_gu:medicine",
      "gangbuk_gu:medicine",
      "dobong_gu:medicine",
      "eunpyeong_gu:medicine",
      "gangseo_gu:batteryAndFluorescentLamp",
      "geumcheon_gu:batteryAndFluorescentLamp",
      "yeongdeungpo_gu:medicine",
      "dongjak_gu:medicine",
      "gangdong_gu:medicine",
    ]);
    let ownDayPageCount = 0;
    for (const policy of regionPolicies) {
      const dayResult = await callTool(baseUrl, "get_region_disposal_info", { region: policy.name }, requestId++);
      assert(
        dayResult.structuredContent?.matchedRegion === policy.name,
        `${policy.name}: 이 이름이 자기 지역으로 안 잡힌다 (matchedRegion=${dayResult.structuredContent?.matchedRegion}) — 아래 요일 단언이 다른 지역 답을 보고 통과한다`,
      );

      // 수거함 안내 근거가 구조화 출력에 남는지 같은 응답에서 함께 본다. 따로 루프를
      // 돌면 40번을 더 부르고, `ownDayPageCount` 단언과도 멀어진다.
      if (policy.coverageTier !== "metro") {
        const shown = dayResult.structuredContent?.officialSources ?? [];
        for (const kind of GUIDE_KINDS) {
          // 노출된 쪽은 `{title, url}`뿐이라 `basis`로 종류를 가릴 수 없다. 지역 데이터에서
          // 그 종류의 출처를 먼저 고른 뒤 **URL로** 맞춘다. URL 없는 출처를 허용하는
          // 스키마라(`validate-data.mjs`) `undefined === undefined`로 통과하지 않게 거른다.
          const urls = (policy.sources ?? [])
            .filter((source) => kind.re.test(source.title ?? "") || kind.re.test(source.basis ?? ""))
            .map((source) => source.url)
            .filter(Boolean);
          if (urls.length === 0) {
            // 출처가 아예 없는 쪽이 더 나쁘다 — 본문은 "전용 수거함에 배출합니다"라고
            // 말하는데 근거가 하나도 없다. 순서로는 못 고치고 출처를 찾아야 하는 일이라
            // 이 PR에서 닫지 못했다. 조용히 넘기지 말고 목록으로 묶어 둔다.
            if (policy.specialCollections?.[kind.field]?.method?.length > 0) {
              assert(
                KNOWN_GUIDE_SOURCE_GAPS.has(`${policy.id}:${kind.field}`),
                `${policy.name}: ${kind.label} 안내를 본문에서 말하면서 그 근거 출처가 하나도 없다 — 출처를 찾아 넣거나 KNOWN_GUIDE_SOURCE_GAPS에 근거와 함께 등록해라`,
              );
            }
            continue;
          }
          // 목록에 있는데 출처가 생겼다면 그 항목은 낡았다. 지우지 않으면 그 지역이
          // 나중에 다시 출처를 잃어도 위 갈래가 조용히 면제한다.
          assert(
            !KNOWN_GUIDE_SOURCE_GAPS.has(`${policy.id}:${kind.field}`),
            `${policy.name}: ${kind.label} 출처가 생겼는데 KNOWN_GUIDE_SOURCE_GAPS에 아직 남아 있다 — 목록에서 지워라`,
          );
          assert(
            shown.some((source) => urls.includes(source?.url)),
            `${policy.name}: ${kind.label} 안내 출처를 갖고 있는데 officialSources에서 잘렸다 — 구조화만 읽는 호스트는 수거함 안내를 근거 없이 받는다`,
          );
        }
      }
      const dayAnswer = resultText(dayResult);
      const dayLine = findDayCheckLine(dayAnswer);
      assert(dayLine, `${policy.name}: 요일 확인 항목이 사라졌다 — 되묻기를 막던 줄이다`);
      assert(
        dayLine.includes("http"),
        `${policy.name}: 요일 항목에 확인처 링크가 없다 — 이러면 모델이 사용자에게 동을 되묻는다: "${dayLine}"`,
      );
      const bulkyUrl = [policy.bulkyWaste?.applicationUrl, policy.bulkyWaste?.feeUrl]
        .filter(Boolean)
        .find((url) => dayLine.includes(url));
      assert(
        !bulkyUrl,
        `${policy.name}: 요일 확인처가 대형폐기물 신청·수수료 페이지다 (${bulkyUrl}) — 요일은 그 페이지에 없다`,
      );
      if (!dayLine.includes(NATIONAL_DAY_FALLBACK_URL)) {
        ownDayPageCount++;
        // 본문이 가리키는 링크가 구조화 출력에서 잘리면 안 된다. `officialSources`는 앞
        // 세 개까지만 싣는데 요일 출처는 뒤늦게 채운 게 많아 배열 뒤쪽에 몰려 있어서,
        // 세종시·고양시는 본문이 "여기서 확인하세요"라고 말한 그 페이지가 목록에 없었다.
        // 전국 안내로 닫힌 지역은 뺀다 — 분리배출.kr은 광역에만 목록으로 들어간다.
        const officialSources = dayResult.structuredContent?.officialSources ?? [];
        assert(
          officialSources.some((source) => source?.url && dayLine.includes(source.url)),
          `${policy.name}: 본문 요일 링크가 officialSources에서 잘렸다 — 구조화 출력만 읽는 호스트는 본문이 가리킨 페이지를 못 받는다: "${dayLine}"`,
        );
      }
    }
    // 수거함 안내 근거가 구조화 출력에 남는지 **자치구 전수**로 본다. 케이스 몇 건으로
    // 막으면 안 짚은 지역이 조용히 되돌아간다 — 출처를 하나 끼워 넣는 것만으로 밀려나고,
    // 본문은 여전히 "약국·행정복지센터에 내세요"라고 말하는데 근거 링크만 사라진다.
    //
    // `officialSources`는 앞 세 개까지인데 요일 출처가 한 자리를 예약하므로 실제 창은 둘이다.
    // 안내인지는 제목이 아니라 `basis`까지 봐야 한다 — 서대문 「폐금속자원 배출」·수원
    // 「재활용분리배출」은 제목에 낱말이 없고 근거에만 있다.

    assert(
      ownDayPageCount === REGIONS_WITH_OWN_DAY_PAGE,
      `자기 지자체 요일 페이지로 닫히는 지역이 ${ownDayPageCount}곳이다 (기대 ${REGIONS_WITH_OWN_DAY_PAGE}곳) — 줄었으면 출처의 basis가 선택 정규식에 안 걸리는 것이고, 늘었으면 이 숫자를 올린다`,
    );

    // 어느 페이지로 닫는지까지 고정한다. 매칭이 여럿인 지역은 JSON 배열 순서에 답이
    // 매달려서, 순서가 바뀌면 확인처가 대형폐기물 포털로 조용히 옮겨간다.
    const dayLinkExpectations = [
      // 매칭이 하나뿐인 지역. 자기 지자체 요일 페이지로 닫힌다.
      { region: "성남시", contains: "recycle.seongnam.go.kr" },
      // 매칭이 둘 이상인 지역. 첫 항목이 빠지면 두 번째인 대형폐기물 포털이 올라온다.
      { region: "서울 강남구", contains: "www.gangnam.go.kr", absent: "clean.gangnam.go.kr" },
      { region: "서울 서초구", contains: "10411010600002018030711.jsp" },
      { region: "서울 송파구", contains: "www.songpa.go.kr", absent: "smartclean.songpa.go.kr" },
      // 이 PR로 요일 출처를 얻은 지역. 전국 안내가 아니라 자기 지자체 조회 페이지로 닫힌다.
      { region: "서울 종로구", contains: "jongno.go.kr", absent: "region.do" },
      // 요일 안내가 있는 페이지를 출처로 넣고도 basis 어휘 때문에 전국 안내로 남았던 곳.
      { region: "서울 용산구", contains: "menuNo=200680", absent: "region.do" },
      // 요일이 대형폐기물 문맥으로만 적혀 있어 선택 근거가 틀렸던 곳. 같은 페이지가 맞지만
      // 일반 생활쓰레기 요일 안내로 걸려야 한다. 대형폐기물 포털로 새면 실패다.
      { region: "남양주시", contains: "contents.do?key=3005", absent: "smartclean.nyj.go.kr" },
      // 출처가 많아 `officialSources` 상한(3개)에 걸리는 지역. 요일 출처가 배열 뒤쪽에
      // 있어 본문 링크만 남고 구조화 출력에서는 잘려 나갔다. 어느 페이지로 닫는지도
      // 함께 고정한다 — 고양시는 대형폐기물 쪽 출처가 앞에 셋이나 있다.
      { region: "세종시", contains: "sub03_01_02.do" },
      { region: "고양시", contains: "www03_3_3_tab1.jsp", absent: "clean.gys.or.kr" },
      // 요일 안내가 없는 페이지를 요일 출처로 잡고 있던 곳. 구로구 청소행정서비스헌장은
      // 배출·수거 시각 표만 있고 요일은 "변경되면 알려드리겠다"는 문장에만 나온다 —
      // 요일을 물은 사람을 답 없는 페이지로 보내느니 전국 안내로 닫는 편이 낫다.
      // 페이지 자체는 유효해서 `공식 확인처` 목록에는 남아 있다. 요일 확인처로만 안 뽑힌다.
      { region: "서울 구로구", contains: "region.do", absent: "contents.do?key=1649" },
      // 요일 출처가 없는 지역. 전국 지역별 안내로 닫는다. 용인은 시 누리집에 일반
      // 생활쓰레기 요일 안내가 없다는 걸 2026-08-20에 확인했다 — 검색에 뜨는 구별
      // 요일(수지 화·금 등)은 대형폐기물 수거 요일이라 여기 쓸 값이 아니다.
      { region: "용인시", contains: "region.do", absent: "yongin.go.kr" },
      // 지역을 못 찾은 입력. 되묻기의 결과가 실제로 이 갈래로 떨어지므로 여기도 링크로
      // 닫아야 한다. 실재하는 동 이름을 쓰면 그 동이 나중에 alias로 등록될 때 — 그것도
      // 같은 Preview 기록에 대한 정당한 개선이다 — 이 케이스가 막아서게 되니, 지역
      // 데이터에 오를 리 없는 이름을 쓴다.
      { region: "스모크테스트미등록지역", contains: "region.do" },
    ];
    for (const { region, contains, absent } of dayLinkExpectations) {
      const dayAnswer = resultText(await callTool(baseUrl, "get_region_disposal_info", { region }, requestId++));
      const dayLine = findDayCheckLine(dayAnswer);
      assert(dayLine, `${region}: 요일 확인 항목이 사라졌다 — 되묻기를 막던 줄이다`);
      assert(
        dayLine.includes(contains),
        `${region}: 요일 확인처가 예상과 다르다 (기대 "${contains}"): "${dayLine}"`,
      );
      assert(
        !absent || !dayLine.includes(absent),
        `${region}: 요일 확인처로 대형폐기물 페이지("${absent}")가 잡혔다: "${dayLine}"`,
      );
    }

    // 요일 확인처로 안 뽑히는 것과 출처를 지우는 것은 다른 이야기다. 구로구
    // 청소행정서비스헌장은 배출·수거 시각 표를 가진 유일한 구로구 페이지라 출처로
    // 값이 있는데, basis만 고치겠다고 해놓고 항목을 통째로 지운 적이 있다.
    // 응답 본문이 아니라 데이터를 본다 — 본문 "공식 확인처"는 구조화 응답과 같은
    // 3개 상한을 쓰게 되면서 뒤쪽 출처가 응답에 안 실릴 수 있고, 이 단언이 막는
    // 사고는 응답 축소가 아니라 데이터 삭제다.
    const guroPolicy = regionPolicies.find((policy) => policy.name === "서울 구로구");
    assert(
      guroPolicy?.sources.some((source) => source.url?.includes("guro.go.kr/www/contents.do?key=1649")),
      "구로구 청소행정서비스헌장이 지역 출처 데이터에서 사라졌다 — 요일 확인처로 안 뽑는 것과 출처를 지우는 것은 다르다",
    );

    // 품목이 붙으면 체크리스트가 그 품목으로 좁혀진다. 좁히는 건 의도지만, 되묻기를
    // 부르는 질문은 오히려 이쪽이 흔하다("강남구 오피스텔은 비닐봉지 목요일 배출 맞아?").
    // 좁힌 목록에서도 요일을 말하는 줄에는 확인처가 따라붙어야 한다.
    const itemDayAnswer = resultText(
      await callTool(
        baseUrl,
        "get_region_disposal_info",
        { region: "서울 강남구", itemName: "강남구 오피스텔은 비닐봉지 목요일 배출 맞아?" },
        requestId++,
      ),
    );
    const itemDayLine = itemDayAnswer.split("\n").find((line) => /^\d+\. .*요일/.test(line));
    assert(itemDayLine, "품목 체크리스트에서 요일 줄이 사라졌다 — 되묻기를 막을 자리가 없어진다");
    assert(
      itemDayLine.includes("www.gangnam.go.kr"),
      `품목 체크리스트의 요일 줄에 확인처 링크가 없다 — 지역만 물었을 때와 달리 여기서 되묻기가 샌다: "${itemDayLine}"`,
    );

    // 요일과 무관한 품목. 체크리스트는 대형폐기물 신고로 좁혀져 요일 줄이 없는데,
    // **지역 요약은 여전히 "배출 요일과 시간은 이 데이터에 넣지 않았다"고 말한다.**
    // 못 준다고 말해놓고 어디서 확인하는지는 안 적으면 그게 되묻기를 부른 그 모양이다.
    // 불변식은 하나다 — 응답이 요일을 말하면 그 응답 어딘가에 확인처 링크가 있어야 한다.
    const bulkyDayAnswer = resultText(
      await callTool(baseUrl, "get_region_disposal_info", { region: "서울 강남구", itemName: "침대" }, requestId++),
    );
    assert(
      mentionsDay(bulkyDayAnswer),
      "강남구+침대 응답이 요일을 아예 말하지 않는다 — 지역 요약 문구가 바뀌었으면 이 픽스처를 요일을 말하는 지역으로 갈아 끼운다",
    );
    const bulkyDayLine = bulkyDayAnswer.split("\n").find((line) => /^\d+\. .*요일/.test(line));
    assert(
      bulkyDayLine,
      "강남구+침대: 요일을 못 준다고 말해놓고 확인할 항목에는 요일 줄이 없다 — 호스트 모델이 그 빈자리를 사용자에게 동을 되묻는 걸로 메운다",
    );
    assert(
      bulkyDayLine.includes("http"),
      `강남구+침대: 요일 줄에 확인처 링크가 없다: "${bulkyDayLine}"`,
    );
    // 좁히기는 그대로여야 한다. 닫는 줄 하나만 더할 뿐, 일반 체크리스트를 되살리지 않는다.
    for (const general of ["폐건전지, 폐형광등, 폐의약품", "음식물류폐기물 전용봉투"]) {
      assert(
        !bulkyDayAnswer.includes(`. ${general}`),
        `강남구+침대: 요일을 닫으면서 일반 체크리스트("${general}")까지 되살아났다 — 품목 좁히기가 풀린다`,
      );
    }

    // 같은 불변식이 품목 툴에도 걸린다. `빗자루`는 `regionCheckLevel: required`에
    // checkItems가 "배출 장소·요일"이라, 지역을 함께 주면 "- 확인 항목: 배출 장소·요일"
    // 한 줄로 끝나 있었다 — 요일을 말해놓고 어디서 확인하는지는 안 적는, 되묻기를 부른
    // 바로 그 모양이다. 지역 툴과 같은 확인처로 닫는지 본다.
    const stepsDayAnswer = resultText(
      await callTool(baseUrl, "get_disposal_steps", { itemName: "빗자루", region: "서울 강남구" }, requestId++),
    );
    const stepsDayLine = stepsDayAnswer.split("\n").find((line) => line.startsWith("- 확인 항목:") && line.includes("요일"));
    assert(stepsDayLine, "get_disposal_steps 빗자루+강남구: 요일 확인 항목이 사라졌다 — 픽스처를 요일이 든 품목으로 갈아 끼운다");
    assert(
      stepsDayLine.includes("www.gangnam.go.kr"),
      `get_disposal_steps 빗자루+강남구: 요일 확인 항목에 확인처 링크가 없다 — 호스트 모델이 그 빈자리를 동 되묻기로 메운다: "${stepsDayLine}"`,
    );

    // 위 픽스처는 checkItems에 요일이 든 품목이라, 그 갈래만 닫아 두면 통과해 버린다.
    // 실제로 새던 건 `regionCheckLevel: required`인데 **checkItems에 요일이 없는** 품목
    // 쪽이다 — 뚝배기·와인잔·즉석밥 용기가 그렇다. 이 품목들은 지역 요약 한 줄("배출
    // 요일과 시간은 … 넣지 않았습니다")만 받고 끝났다.
    const stepsSummaryResult = await callTool(
      baseUrl,
      "get_disposal_steps",
      { itemName: "뚝배기", region: "서울 강남구" },
      requestId++,
    );
    const stepsSummaryAnswer = resultText(stepsSummaryResult);
    const stepsSummaryLine = stepsSummaryAnswer
      .split("\n")
      .find((line) => line.startsWith("- ") && line.includes("배출 요일과 시간은"));
    assert(
      stepsSummaryLine,
      "get_disposal_steps 뚝배기+강남구: 지역 요약 줄이 사라졌다 — 요약 문구가 바뀌었으면 요일을 말하는 다른 품목으로 픽스처를 갈아 끼운다",
    );
    assert(
      stepsSummaryLine.includes("www.gangnam.go.kr"),
      `get_disposal_steps 뚝배기+강남구: 지역 요약이 요일을 못 준다고만 하고 확인처를 안 준다: "${stepsSummaryLine}"`,
    );
    // 같은 줄이 structuredContent로도 나간다. 텍스트만 닫으면 구조화 출력만 읽는
    // 호스트에서 되묻기가 그대로 살아난다.
    assert(
      (stepsSummaryResult.structuredContent?.regionNotes ?? []).some(
        (note) => typeof note === "string" && note.includes("배출 요일과 시간은") && note.includes("www.gangnam.go.kr"),
      ),
      `get_disposal_steps 뚝배기+강남구: regionNotes의 요일 줄에 확인처가 없다: ${JSON.stringify(stepsSummaryResult.structuredContent?.regionNotes)}`,
    );

    // 마지막 구멍은 **참고 등급** 품목이었다. `빈 약통`은 checkItems를 렌더하지도
    // `formatRegionItemGuide`를 타지도 않는데, 품목 단계에 "플라스틱류 배출 요일과 장소는
    // 지역 기준을 확인합니다"가 그대로 나간다. 위 required 갈래만 닫아 두면 통과해 버린다.
    const advisoryDayResult = await callTool(
      baseUrl,
      "get_disposal_steps",
      { itemName: "약병", region: "서울 강남구" },
      requestId++,
    );
    const advisoryDayAnswer = resultText(advisoryDayResult);
    assert(
      mentionsDay(advisoryDayAnswer),
      "get_disposal_steps 약병+강남구: 응답이 요일을 아예 말하지 않는다 — 품목 단계가 바뀌었으면 요일을 말하는 다른 참고 등급 품목으로 갈아 끼운다",
    );
    assert(
      advisoryDayAnswer.includes("www.gangnam.go.kr"),
      `get_disposal_steps 약병+강남구: 요일을 말해놓고 확인처가 응답 어디에도 없다:\n${advisoryDayAnswer}`,
    );
    // 위젯 응답의 content는 카드 JSON이라 문장을 이어 붙일 자리가 없다. 이 줄이
    // regionNotes로 안 나가면 카드를 켠 배포에서는 확인처가 통째로 빠진다.
    assert(
      (advisoryDayResult.structuredContent?.regionNotes ?? []).some(
        (note) => typeof note === "string" && note.includes("요일") && note.includes("www.gangnam.go.kr"),
      ),
      `get_disposal_steps 약병+강남구: regionNotes에 요일 확인처가 없다 — 카드에도 구조화 출력에도 링크가 안 실린다: ${JSON.stringify(advisoryDayResult.structuredContent?.regionNotes)}`,
    );

    // 닫는 건 한 번만. 확인처를 붙이는 자리가 늘면서 이미 닫힌 응답에 체크리스트 줄이
    // 하나 더 붙어, 같은 주소가 한 응답에 두 번 나갔다(지역 요약 줄 + 확인할 정보 줄).
    // 판정은 체크 항목이 아니라 응답 전체를 보고 해야 한다.
    for (const args of [
      { region: "서울 강남구", itemName: "뚝배기" },
      { region: "서울 강남구", itemName: "침대" },
      { region: "서울 강남구" },
      { region: "서울 구로구" },
    ]) {
      const answer = resultText(await callTool(baseUrl, "get_region_disposal_info", args, requestId++));
      const hints = answer.split("확인하세요 (http").length - 1;
      assert(
        hints === 1,
        `get_region_disposal_info ${JSON.stringify(args)}: 요일 확인처 문구가 ${hints}번 나온다 (기대 1번)\n${answer}`,
      );
    }

    // 남은 두 툴. 참고 등급 품목에 붙는 "실제 배출 요일·장소나 …" 한 줄이 링크 없이
    // 나가고 있었다 — 같은 사람이 툴만 갈아타면 되묻기가 그대로 살아나는 자리다.
    for (const [tool, args] of [
      ["classify_waste_item", { itemName: "페트병", region: "서울 강남구" }],
      ["make_cleanup_plan", { items: ["페트병"], region: "서울 강남구" }],
    ]) {
      const answer = resultText(await callTool(baseUrl, tool, args, requestId++));
      const line = answer.split("\n").find((candidate) => candidate.includes("실제 배출 요일"));
      assert(line, `${tool} 페트병+강남구: 요일을 말하는 지역 줄이 사라졌다 — 픽스처를 참고 등급 품목으로 갈아 끼운다`);
      assert(
        line.includes("www.gangnam.go.kr"),
        `${tool} 페트병+강남구: 요일 줄에 확인처 링크가 없다 — 툴만 갈아타면 되묻기가 살아난다: "${line}"`,
      );
    }

    // 한 품목의 금액이 플랜 전체를 덮으면 안 된다. 예전에는 "금액이 하나라도 있으면"
    // 수수료 확인 문구가 통째로 사라져, 행이 없는 품목까지 값이 확인된 것처럼 읽혔다.
    //
    // 픽스처는 강남에 행이 있는 품목(의자) + 없는 품목(여행용 캐리어)이다. 없는 쪽은
    // **주 배출로가 대형폐기물인** 품목이어야 한다 — 텐트처럼 「일반쓰레기/대형폐기물」인
    // 보조 배출로는 애초에 조건부라 이 문구를 안 부른다(그게 맞는 동작이다). 처음엔 옷장을
    // 썼는데 강남이 구청 표로 갈아타며 장롱 행이 들어와 조건이 깨졌다 — 아래 단언이 깨지면
    // 데이터가 그 품목을 얻은 것이니, 그때는 여전히 행이 없는 주-대형폐기물 품목으로 갈아 끼운다.
    const cleanupPartialFee = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["책상의자", "여행용 캐리어"], region: "서울 강남구" },
      requestId,
    );
    assert(
      resultText(cleanupPartialFee).includes("금액을 적지 못한 대형폐기물 품목의 수수료"),
      `a bulky item with no fee row must keep its fee-check instruction — swap the fee-less fixture item if 강남 gained a row: ${resultText(cleanupPartialFee)}`,
    );
    requestId += 1;

    // 대형폐기물이 보조 배출로일 뿐인 품목. 작은 플라스틱 화분은 그냥 재활용이라
    // 수수료가 안 드는데, 조건 없이 금액만 찍으면 같은 품목·같은 지역에서 카드와
    // 플랜이 서로 다른 말을 하게 된다.
    const cleanupSecondaryRoute = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["화분"], region: "서울 강남구" },
      requestId,
    );
    const cleanupPot = cleanupSecondaryRoute.structuredContent?.items?.find((entry) => entry.input === "화분");
    assert(
      typeof cleanupPot?.fee === "string" && cleanupPot.fee.startsWith("대형폐기물에 해당할 때만"),
      `a secondary-route item must carry the card's caveat with its fee: ${JSON.stringify(cleanupPot)}`,
    );
    requestId += 1;

    // 지역 없이 부른 필수 품목 플랜: 문장은 지역을 청하고, 인자를 완성할 수 없으니
    // nextTool은 없다.
    const cleanupNoRegion = await callTool(baseUrl, "make_cleanup_plan", { items: ["책상의자"] }, requestId);
    assert(
      resultText(cleanupNoRegion).includes(
        "거주 지역을 알려주시면 대형폐기물 신고 방법·수수료나 전용 수거함 위치까지 확인해 드릴 수 있습니다.",
      ),
      "critical-item plan without a region should ask for one in the follow-up line",
    );
    assert(cleanupNoRegion.structuredContent?.nextTool === undefined, "nextTool must not ship without a region to fill its arguments");
    requestId += 1;

    // 수수료가 없는 필수 품목. 건전지는 전용 수거함이 답이라, 힌트가 수수료만 약속하면
    // 없는 요금을 예고하는 셈이 된다.
    const cleanupFree = await callTool(baseUrl, "make_cleanup_plan", { items: ["건전지"], region: "서울 강남구" }, requestId);
    assert(
      resultText(cleanupFree).includes("서울 강남구의 대형폐기물 신고 방법·수수료나 전용 수거함 위치도 이어서 안내할 수 있습니다."),
      "a fee-free critical item must still be covered by the follow-up line",
    );
    assert(
      cleanupFree.structuredContent?.nextTool?.arguments?.region === "서울 강남구",
      `fee-free critical plan lost its nextTool hint: ${JSON.stringify(cleanupFree.structuredContent?.nextTool)}`,
    );
    requestId += 1;

    // 데이터에 없는 지역. 문장은 그 지역 안내를 아는 척하지 않고 낮춰 잡되, 지역 툴은
    // 공식 확인 경로를 주므로 후속 호출은 그대로 이어 준다.
    const cleanupUnknownRegion = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["책상의자"], region: "봉담읍" },
      requestId,
    );
    assert(
      resultText(cleanupUnknownRegion).includes("봉담읍 기준 배출 확인이 필요하면 지역 안내도 이어서 도와드릴 수 있습니다."),
      "an unregistered region should get the softer follow-up line",
    );
    assert(
      !resultText(cleanupUnknownRegion).includes("이어서 안내할 수 있습니다"),
      "an unregistered region must not be promised fee and collection-point details",
    );
    assert(
      cleanupUnknownRegion.structuredContent?.nextTool?.arguments?.region === "봉담읍",
      `unregistered-region plan should still carry nextTool: ${JSON.stringify(cleanupUnknownRegion.structuredContent?.nextTool)}`,
    );
    requestId += 1;

    // 앞뒤 공백이 붙은 지역. 문장에도 후속 호출 인자에도 다듬은 이름만 나가야 한다.
    const cleanupPaddedRegion = await callTool(
      baseUrl,
      "make_cleanup_plan",
      { items: ["책상의자"], region: " 서울 강남구 " },
      requestId,
    );
    assert(
      resultText(cleanupPaddedRegion).includes("서울 강남구의 대형폐기물 신고 절차와 전용 수거함 위치, 공식 확인처도 이어서 안내할 수 있습니다."),
      "a padded region must be trimmed before it lands in the follow-up line",
    );
    assert(
      cleanupPaddedRegion.structuredContent?.nextTool?.arguments?.region === "서울 강남구",
      `padded region leaked into nextTool arguments: ${JSON.stringify(cleanupPaddedRegion.structuredContent?.nextTool)}`,
    );
    requestId += 1;

    // 지역이 답을 바꾸지 않는 플랜(참고 이하뿐): 힌트 줄 자체가 없다 — 지역 줄
    // 소음 금지 원칙 그대로.
    const cleanupNoCritical = await callTool(baseUrl, "make_cleanup_plan", { items: ["페트병"], region: "서울 강남구" }, requestId);
    assert(
      !resultText(cleanupNoCritical).includes("이어서 안내할 수 있습니다") && cleanupNoCritical.structuredContent?.nextTool === undefined,
      "a plan with no region-critical items must not carry the follow-up hint",
    );
    requestId += 1;

    // 사진 경로의 텍스트 분기. 서버는 이미지를 받지 않고 호스트가 알아본 이름만 넘어오므로,
    // 잘못 알아본 이름도 확정 매칭으로 착지한다. 무엇으로 봤는지 되비추는 줄이 답 맨 앞에
    // 붙어야 사용자가 바로 잡을 수 있다.
    const photoText = await callTool(
      baseUrl,
      "get_disposal_steps",
      { itemName: "기름 묻은 피자박스", inputSource: "photo" },
      requestId,
    );
    requestId += 1;
    assert(
      resultText(photoText).startsWith('사진 속 물건은 "기름 묻은 피자박스" 품목 기준으로 안내합니다.'),
      `photo-sourced text answer should open with the confirmation line:\n${resultText(photoText).slice(0, 120)}`,
    );

    const typedText = await callTool(baseUrl, "get_disposal_steps", { itemName: "기름 묻은 피자박스" }, requestId);
    requestId += 1;
    assert(
      !resultText(typedText).includes("사진 속 물건"),
      "a typed item name must not be answered as if it came from a photo",
    );

    // inputSource는 로그 필드 하나일 뿐이라, 호스트가 "image"처럼 다른 말을 얹었다고
    // 배출 안내까지 잃으면 손익이 안 맞는다. 이 파라미터가 없던 때처럼 조용히 무시하고
    // 답은 그대로 나가야 한다 (mcpRequest는 -32602를 받으면 throw한다).
    const oddSourceText = await callTool(
      baseUrl,
      "get_disposal_steps",
      { itemName: "기름 묻은 피자박스", inputSource: "image" },
      requestId,
    );
    requestId += 1;
    assert(
      resultText(oddSourceText) === resultText(typedText),
      "an unrecognized inputSource should be ignored, not answered differently",
    );

    // 사진에서 알아본 이름일수록 카탈로그에 없는 말로 나오기 쉬워서, 확정된 호출만 세면
    // 정작 궁금한 쪽(사진을 보냈는데 답을 못 준 경우)이 로그에서 통째로 빠진다.
    await callTool(baseUrl, "get_disposal_steps", { itemName: "존재하지않는품목zzz", inputSource: "photo" }, requestId);
    requestId += 1;
    const disposalLogs = getOutput()
      .split("\n")
      .filter((line) => line.includes('"tool":"get_disposal_steps"'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    // 개수는 세지 않는다. 위 파서는 stdout/stderr가 한 버퍼에 섞여 조각난 줄을 조용히
    // 버리고, getOutput()은 응답 직후에 읽는다 — 로그 한 줄이 늦게 도착하기만 해도
    // 정확한 개수 단언은 깨진다. 두 갈래가 각각 찍혔는지만 본다.
    const photoLogs = disposalLogs.filter((entry) => entry.inputSource === "photo");
    assert(
      photoLogs.some((entry) => entry.status === "match"),
      "a photo-sourced confirmed match should be logged as such",
    );
    assert(
      photoLogs.some((entry) => entry.status === "not_found"),
      "a photo-sourced miss should be logged too, or the photo path can only be counted when it works",
    );
    assert(
      disposalLogs.some((entry) => entry.inputSource === undefined),
      "typed calls must not carry an inputSource",
    );

    // WIDGET_ENABLED is a rendering rollback, so it must not move the telemetry
    // the finals-window 지역 해상도 numbers are read off. This server runs with
    // widgets *off* — the branch where classify used to skip region matching
    // entirely and log no matchedRegion at all.
    await callTool(baseUrl, "classify_waste_item", { itemName: "책상의자", region: "서울 강남구" }, requestId);
    requestId += 1;
    const classifyTextLog = getOutput()
      .split("\n")
      .filter((line) => line.includes('"tool":"classify_waste_item"'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
      .at(-1);
    assert(classifyTextLog, "no classify_waste_item call was logged on the text path");
    assert(
      classifyTextLog.matchedRegion === "서울 강남구",
      `classify text path logged matchedRegion=${classifyTextLog.matchedRegion}, expected it to match the widget path`,
    );

    // `regionStatus`는 지역 해상도(자치구 확정 / 광역 폴백 / 미등록 시·군·구)를 세는
    // 필드인데, 핸들러가 `_log`에 담고도 `withCallLog`가 찍지 않아 운영 로그에서 아예
    // 읽을 수 없었다. `structuredContent` 사본만 살아남았고 그건 응답이지 로그가 아니다.
    // 값이 하나뿐이면 상수를 찍어도 통과하므로 서로 다른 갈래 셋을 함께 본다.
    const regionStatusExpectations = [
      { region: "서울 강남구", matchedRegion: "서울 강남구", expected: "district" },
      { region: "청주시", matchedRegion: "충청북도", expected: "unregistered_district" },
      { region: "충북", matchedRegion: "충청북도", expected: "metro" },
    ];
    for (const { region, matchedRegion, expected } of regionStatusExpectations) {
      await awaitLoggedCall({
        getOutput,
        tool: "get_region_disposal_info",
        // 지역 원문은 로그에 없으니(개인정보) `matchedRegion`과 짝지어 찾는다 — 청주시와
        // 충북은 같은 광역으로 착지하므로 그 짝이 있어야 두 갈래가 갈린다.
        seen: (entry) => entry.matchedRegion === matchedRegion && entry.regionStatus === expected,
        call: () => callTool(baseUrl, "get_region_disposal_info", { region }, requestId++),
        what: `${region} → matchedRegion=${matchedRegion}, regionStatus=${expected}`,
      });
    }

    // 품목 툴도 같은 어휘로 남겨야 집계가 한 축으로 선다 — 사용자가 자기 구를 말하는 건
    // 오히려 이쪽이 더 흔하다. 지역을 안 물은 호출은 값이 없어야 한다. "안 물었다"와
    // "물었는데 못 찾았다"가 같은 값으로 뭉치면 미등록 지역 수요가 부풀려진다.
    const itemRegionExpectations = [
      { id: "sofa", args: { itemName: "소파", region: "청주시" }, expected: "unregistered_district" },
      { id: "sofa", args: { itemName: "소파", region: "서울 강남구" }, expected: "district" },
      { id: "sofa", args: { itemName: "소파" }, expected: undefined },
      // 되묻기 갈래. `findRegionalPolicy`가 그 상태를 버리므로 한 번 더 보지 않으면
      // 지역 툴은 `ambiguous`, 품목 툴은 `unknown`으로 갈린다. 로마자 접두어가
      // 여러 지역에 걸리는 실제 입력이다.
      { id: "sofa", args: { itemName: "소파", region: "seong" }, expected: "ambiguous" },
      // 지역을 물었지만 이 품목은 조회 자체를 안 한다(324개 중 224개). 여기에 `unknown`을
      // 남기면 미등록 지역 수요가 통째로 부풀려진다 — 값이 아예 없어야 한다.
      { id: "pizza_box_oily", args: { itemName: "기름 묻은 피자박스", region: "서울 강남구" }, expected: undefined },
      // 공백만 넣은 것도 안 물은 것이다. `optionalRegionParam`에 min(1)도 trim도 없어서
      // 그대로 들어오는데, 조회하면 `unknown`이 되어 "찾아봤는데 없더라" 칸을 오염시킨다.
      { id: "sofa", args: { itemName: "소파", region: "   " }, expected: undefined },
    ];
    for (const { id, args, expected } of itemRegionExpectations) {
      await awaitLoggedCall({
        getOutput,
        tool: "get_disposal_steps",
        seen: (entry) => entry.matchedId === id && entry.regionStatus === expected,
        call: () => callTool(baseUrl, "get_disposal_steps", args, requestId++),
        what: `${args.itemName} + region=${args.region ?? "(none)"} → regionStatus=${expected}`,
      });
    }

    // 품목을 못 찾은 갈래에도 지역 해상도가 남아야 한다. **하필 이쪽이 이 필드가 재려는
    // 수요 그 자체다** — 미등록 지역 사람이 카탈로그에 없는 품목을 묻는 경우라, 빠지면
    // "그 지역을 채워야 한다"는 신호가 가장 센 표본을 놓친다. 두 핸들러가 이 갈래에서
    // 먼저 return해서 실제로 빠져 있었다.
    for (const status of ["not_found", "ambiguous"]) {
      const itemName = status === "not_found" ? "존재하지않는품목zzz" : "전구";
      await awaitLoggedCall({
        getOutput,
        tool: "get_disposal_steps",
        seen: (entry) => entry.status === status && entry.regionStatus === "unregistered_district",
        call: () => callTool(baseUrl, "get_disposal_steps", { itemName, region: "청주시" }, requestId++),
        what: `${status} + region=청주시 → regionStatus=unregistered_district`,
      });
    }

    console.log(`MCP smoke test passed at ${baseUrl} (${answerCases.length} answer cases)`);
  } finally {
    stopServer();
  }
}

/**
 * 한 번의 툴 호출이 남긴 로그 줄만 보고 단언한다. 이 자리에서 두 번 틀렸다.
 *
 * 1. 응답이 돌아와도 그 호출의 로그 줄은 아직 stdout 파이프에 있을 수 있다.
 *    한 번 읽고 단언하면 맞는 코드에서도 이따금 실패한다 — 그래서 기다린다.
 * 2. 그렇다고 전체 출력을 `.some()`으로 뒤지면 앞선 answer case가 남긴 줄에 걸려
 *    통과한다. 실제로 `pizza_box_oily`는 지역 없이 부르는 케이스가 많아, 검사가
 *    보려던 갈래를 지워도 초록불이 떴다.
 *
 * 그래서 호출 직전 길이를 재고 그 뒤에 붙은 줄만 본다.
 */
async function awaitLoggedCall({ getOutput, tool, seen, call, what }) {
  const offset = getOutput().length;
  await call();
  const fresh = () =>
    getOutput()
      .slice(offset)
      .split("\n")
      .filter((line) => line.includes(`"tool":"${tool}"`))
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });

  const startedAt = Date.now();
  while (!fresh().some(seen) && Date.now() - startedAt < LOG_FLUSH_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(fresh().some(seen), `${tool} call did not log ${what} (saw: ${JSON.stringify(fresh())})`);
}

function parseWidgetPayload(result, context) {
  const text = resultText(result);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${context} did not return a serialized widget payload:\n${text}`);
  }
  assert(isPlainObject(payload), `${context} widget payload must be an object`);
  return payload;
}

function assertPlainTextResponse(result, context) {
  assert(result.structuredContent !== undefined, `${context} should keep its structuredContent (text response)`);
  assert(!resultText(result).trimStart().startsWith("{"), `${context} should stay plain text, not a widget payload`);
}

// PRD phase-3 R2: one unsupported node type drops the whole card to text
// fallback, and that only shows up in Preview — a push + redeploy away.
const ALLOWED_WIDGET_NODE_TYPES = new Set(["Card", "Title", "Text", "Caption", "Divider"]);

/** 카드 안의 모든 텍스트 값을 트리 순서대로 펼친다. 어느 줄이 무엇을 싣는지 보는 케이스는
 * 카드 전체를 JSON.stringify로 훑으면 이웃 줄의 문자열까지 같이 걸려서 통과해버린다. */
function cardTextValues(node) {
  if (!isPlainObject(node)) return [];
  const own = typeof node.value === "string" ? [node.value] : [];
  const children = Array.isArray(node.children) ? node.children.flatMap(cardTextValues) : [];
  return [...own, ...children];
}

function assertWidgetNode(node, context) {
  assert(isPlainObject(node), `${context} is not a widget node`);
  assert(ALLOWED_WIDGET_NODE_TYPES.has(node.type), `${context} uses unsupported node type ${JSON.stringify(node.type)}`);
  assert(!("status" in node), `${context} must not define status — Kakao fills it`);

  if (node.type === "Divider") return;

  if (node.type === "Card") {
    assert(Array.isArray(node.children) && node.children.length > 0, `${context} has no children`);
    node.children.forEach((child, index) => assertWidgetNode(child, `${context} > child[${index}]`));
    return;
  }

  assert(typeof node.value === "string" && node.value.trim().length > 0, `${context} has an empty value`);
}

/**
 * PRD phase-3 R2-1 branch table, exercised on the builder directly. The
 * "region matched but no item-specific guide" branch needs an input the server
 * only produces for a narrow slice of items, so it is pinned here instead.
 */
async function runWidgetBuilderCases() {
  const { buildDisposalWidget } = await import("../dist/widgets.js");
  const { wasteItems: items } = await import("../dist/data.js");

  const nationwide = items.find((item) => item.id === "pizza_box_oily");
  const regional = items.find((item) => item.id === "chair");
  const advisory = items.find((item) => item.id === "pet_bottle");
  assert(nationwide && regional && advisory, "widget builder cases are missing their fixtures");

  const card = (input) => JSON.stringify(buildDisposalWidget({ sourceTitle: "테스트 출처", ...input }).widget);

  const nationwideCard = card({ item: nationwide });
  assert(!nationwideCard.includes("거주 지역 기준 확인 필요"), "nationally uniform item should carry no region line");
  assert(!nationwideCard.includes("거주지 배출 기준만"), "nationally uniform item should carry no region line");

  // R2-1: only a *required* region check earns the ask. Advisory-level items —
  // 42 of the 130 — read as complete without one, and formatItemGuide adds no
  // region section for them either.
  const advisoryCard = card({ item: advisory });
  assert(!advisoryCard.includes("거주 지역 기준 확인 필요"), "advisory-level item should not demand a region");
  assert(card({ item: advisory, regionName: "서울 강남구" }).includes("서울 강남구 거주지 배출 기준만"), "advisory item with a matched region should name it");

  const withNotes = card({ item: regional, regionName: "서울 강남구", regionNotes: ["- 강남구 기준 안내", "- 두 번째 줄", "- 세 번째 줄"] });
  assert(withNotes.includes("서울 강남구 기준"), "region card is missing the region caption");
  assert(withNotes.includes("강남구 기준 안내"), "region card is missing the region guidance line");
  assert(!withNotes.includes("- 강남구 기준 안내"), "region guidance keeps its list bullet");
  assert(!withNotes.includes("세 번째 줄"), "region guidance should be capped at two lines");

  // The fee sits outside the two-line note budget — the boilerplate that
  // formatRegionItemGuide emits first must never be able to crowd it out.
  const withFee = card({
    item: regional,
    regionName: "서울 강남구",
    regionNotes: ["- 사전 신청 안내", "- 접수증 부착 안내", "- 세 번째 줄"],
    regionFeeLine: "수수료 2,000원~5,000원 (규격 4종)",
  });
  assert(withFee.includes("수수료 2,000원~5,000원"), "fee line must survive the region note cap");
  assert(!withFee.includes("세 번째 줄"), "fee line must not widen the region note cap");

  const withoutNotes = card({ item: regional, regionName: "서울 강남구" });
  assert(withoutNotes.includes("서울 강남구 거주지 배출 기준만"), "matched region without guidance should still name the region");

  const withoutRegion = card({ item: regional });
  assert(withoutRegion.includes("거주 지역 기준 확인 필요"), "region-sensitive item without a region should ask for one");

  // R2: safety wording outranks authoring order, or the cap can drop the one
  // caution that keeps a 수거 작업자 from getting cut.
  const sharp = items.find((item) => item.id === "chopsticks");
  assert(sharp, "widget builder cases are missing their 주의 fixture");
  assert(card({ item: sharp }).includes("다치지 않게"), "safety caution should outrank informational ones");

  // The card names a source; without the date a reader cannot tell a 조례
  // 수수료 checked this summer from one checked a year ago. The text path has
  // always carried it, so the card was the only place it was missing.
  const dated = card({ item: nationwide, sourceCheckedAt: "2026-06-27" });
  assert(dated.includes("근거: 테스트 출처 · 2026-06-27 확인"), "card should date the source it names");
  // Closing quote included: a dateless source must end the caption there rather
  // than trail a separator with nothing after it.
  assert(card({ item: nationwide }).includes('"근거: 테스트 출처"'), "a source with no date must not leave a dangling separator");

  const payload = buildDisposalWidget({ item: regional, sourceTitle: "테스트 출처" });
  assert(!("status" in payload), "widget payload must not define status — Kakao fills it");
  assert(!("status" in payload.widget), "widget node must not define status — Kakao fills it");
  assert(typeof payload.copy_text === "string" && payload.copy_text.split("\n").length <= 6, "copy_text must stay within 6 lines");
  assert(typeof payload.name === "string" && payload.name.length > 0, "widget payload is missing name");

  // R3: a truncated copy_text has to say so. Shared to 카톡 it is all the
  // recipient sees, and silently ending at step 5 of 7 reads as complete.
  const longSteps = items.find((item) => item.steps.length > 5);
  assert(longSteps, "widget builder cases are missing their long-steps fixture");
  const longCopy = buildDisposalWidget({ item: longSteps, sourceTitle: "테스트 출처" }).copy_text.split("\n");
  assert(longCopy.length <= 6, "truncated copy_text must stay within 6 lines");
  assert(longCopy.at(-1).startsWith("(남은 "), "truncated copy_text must say how many steps it left out");
  assert(!buildDisposalWidget({ item: nationwide, sourceTitle: "테스트 출처" }).copy_text.includes("(남은 "), "untruncated copy_text must not claim it left steps out");

  // R3's floor from the other side: a one-step item would share as a title and a
  // bare instruction, so the conclusion fills it out.
  const oneStep = items.find((item) => item.steps.length === 1);
  assert(oneStep, "widget builder cases are missing their single-step fixture");
  const shortCopy = buildDisposalWidget({ item: oneStep, sourceTitle: "테스트 출처" }).copy_text.split("\n");
  assert(shortCopy.length >= 3, `single-step copy_text is ${shortCopy.length} lines, under the 3-line floor`);
  assert(shortCopy.includes(oneStep.summary), "single-step copy_text should carry the conclusion");

  // The caveat the card shows on a non-high item has to ride along on the share.
  // copy_text is all the recipient of a 카톡 forward sees, so leaving it off the
  // share hands them a medium verdict dressed as a settled one.
  const uncertain = items.find((item) => item.confidence !== "high");
  const certain = items.find((item) => item.confidence === "high");
  assert(uncertain && certain, "widget builder cases are missing their confidence fixtures");
  const copyOf = (item) => buildDisposalWidget({ item, sourceTitle: "테스트 출처" }).copy_text;
  assert(copyOf(uncertain).includes("분류가 갈릴 수 있"), "a non-high item's copy_text must carry the confidence caveat");
  assert(!copyOf(certain).includes("분류가 갈릴 수 있"), "a high-confidence item's copy_text must not hedge");

  // That caveat costs a line, so the steps have to give one back. No catalogue
  // item is both non-high and long enough to prove it today, so the fixture is
  // built — the budget has to hold the day one of them is.
  const longest = items.reduce((worst, item) => (item.steps.length > worst.steps.length ? item : worst), items[0]);
  const uncertainLong = copyOf({ ...longest, confidence: "medium" }).split("\n");
  assert(
    uncertainLong.length >= 3 && uncertainLong.length <= 6,
    `a ${longest.steps.length}-step medium item shares as ${uncertainLong.length} lines, outside the 3~6 budget`,
  );
  assert(uncertainLong.at(-1).startsWith("(남은 "), "the caveat must not push steps out silently");
  assert(uncertainLong.some((line) => line.includes("분류가 갈릴 수 있")), "the caveat is what the extra line was spent on");
}

/**
 * `- 키: 값` 머리말에 영문 내부 키가 새지 않는지 카탈로그 전수로 본다.
 *
 * 이 자리는 세 번 같은 식으로 샜다 — `- 판단 조건:`이 조건 키를(PR #75), `- 분류:`가
 * `category`를, `- 배출 판단:`이 `disposalType`을 그대로 찍었다. 셋 다 데이터가 아니라
 * 렌더링 쪽 결함이라 `validate-data.mjs`의 매핑 전수 대응 검사로는 걸리지 않는다.
 * 매핑이 멀쩡해도 그 매핑을 안 거치고 원본을 찍으면 그만이기 때문이다.
 *
 * **표면을 둘 다 훑는다.** 처음 넣을 때는 `formatItemGuide`만 봤는데, 같은 머리말을 찍는
 * 자리가 `classify_waste_item`의 텍스트 갈래에도 있다(`분류 결과:`로 시작하는 블록).
 * 그쪽은 `- 세부 판단:`으로 `disposalType`을 그대로 내던 세 번째 누수 지점인데 가드가
 * 안 닿아, 같은 줄을 도로 넣어도 스위트가 초록불이었다. HTTP 스모크를 품목 수만큼 더
 * 때우는 대신 조립부를 `formatClassifyResultText`로 빼서 여기서 나란히 렌더한다.
 *
 * 대상은 이 둘뿐이다. `check_confusing_item`은 `1. 소파` 아래에 세 칸 들여쓴
 * `   - 결론:` 후보 목록을, `make_cleanup_plan`은 `## 배출 그룹` 아래에
 * `- 입력 -> 품목명: 요약` 항목 줄을 낸다. 카드 머리말과 모양이 달라 여기 억지로 끼우면
 * 검사 대상이 아닌 줄까지 잡는다(두 툴 모두 값은 이미 라벨 함수를 거친다).
 *
 * 머리말만 보는 이유는 `### 배출 방법`부터는 URL과 출처 제목이 섞이기 때문이고,
 * 새 줄이 붙는 자리도 머리말이다. 키별로 무엇을 요구하는지는 아래 목록을 본다.
 */

/**
 * 머리말 키를 성격별로 가른다. 값을 우리가 매핑으로 짓는 줄, 사람이 쓴 문장이 실리는 줄,
 * 외부 문자열이 그대로 오는 줄을 한 자로 재면 한쪽은 오탐이 나고 다른 쪽은 누수를 놓친다.
 *
 * **라벨 목록**은 `, `로 쪼개 토큰마다 한글을 요구한다. 값 전체에 한글 한 글자만 있으면
 * 통과시키면 `- 판단 조건: 전자제품, foo bar`처럼 여럿 중 **하나만** 영문인 모양이 그대로
 * 빠져나가는데, 그게 바로 PR #75가 닫은 누수다(라벨 없는 조건 하나가 영문으로 샜다).
 *
 * **문장**은 값 전체에 한글이 있으면 통과다. 사람이 쓴 문장이라 쉼표로 쪼개면 오탐이 난다.
 *
 * **모르는 키는 라벨 목록과 같은 엄격한 규칙을 쓴다.** 머리말에 줄을 새로 붙이는 사람이
 * 그 줄을 어느 갈래에 둘지 여기에 적게 만드는 게 요점이다. 조용히 통과시키면 검사에
 * 구멍이 도로 난다.
 */
const ITEM_CARD_LABEL_LIST_KEYS = ["판단 조건", "배출 그룹", "확신도", "지역 영향"];
const ITEM_CARD_SENTENCE_KEYS = ["결론", "판단 범위", "입력 지역"];
/**
 * 검사에서 빼는 키. **사유를 안 적으면 다음 사람이 "왜 여기만 빠졌지" 하고 도로 넣는다.**
 *
 * `대표 근거`는 `briefSourceLabel`이 짓는 줄이라 출처 제목 + basis + URL이 그대로 실린다.
 * 우리가 라벨로 짓는 값이 아니라 데이터가 가진 문자열이다. 지금은 336개 제목에 다 한글이
 * 있어 통과하지만, 영문 제목 출처가 하나 들어오거나 `sources`가 비어 `sourceRefs[0]`이
 * ASCII인 품목이 생기면 CI가 "영문 키 누수"라는 **틀린 진단**으로 떨어진다 — 데이터
 * 선택을 렌더링 결함으로 오인시키는 메시지다.
 */
const ITEM_CARD_EXEMPT_KEYS = ["대표 근거"];

/** 새는 토큰을 돌려준다. 깨끗하면 `undefined`. */
function findItemCardHeaderLeak(key, value) {
  if (ITEM_CARD_EXEMPT_KEYS.includes(key)) return undefined;
  const tokens = ITEM_CARD_SENTENCE_KEYS.includes(key) ? [value] : value.split(", ");
  return tokens.find((token) => !/[가-힣]/.test(token));
}

async function runItemCardLabelSweep() {
  const { formatClassifyResultText, formatItemGuide, wasteItems } = await import("../dist/data.js");
  const surfaces = [
    ["get_disposal_steps 카드", formatItemGuide],
    ["classify_waste_item 텍스트", formatClassifyResultText],
  ];
  const leaked = [];
  const seenKeys = new Set();

  for (const item of wasteItems) {
    // 지역을 넘겨 지역 줄이 붙는 갈래까지 같은 렌더로 훑는다.
    for (const region of [undefined, "서울 강남구"]) {
      for (const [surface, render] of surfaces) {
        // 첫 줄(`## 품목명`·`분류 결과: 품목명`)은 `- `로 시작하지 않아 아래 정규식에
        // 걸리지 않는다. 표면마다 자를 자리를 따로 세지 않으려고 그대로 흘려보낸다.
        for (const line of render(item, region).split("\n")) {
          if (line.startsWith("###")) break;
          const field = /^- ([^:]+): (.+)$/.exec(line);
          if (!field) continue;
          seenKeys.add(field[1]);
          const leak = findItemCardHeaderLeak(field[1], field[2]);
          if (leak !== undefined)
            leaked.push(`${item.id} (${surface}, region=${region ?? "없음"}): ${line}\n    새는 값: "${leak}"`);
        }
      }
    }
  }

  assert(leaked.length === 0, `item card header leaked a non-Korean value:\n${leaked.slice(0, 5).join("\n")}`);

  // 목록에 없는 키가 나왔다면 엄격한 규칙으로 이미 검사한 뒤다. 통과했더라도 어느 갈래에
  // 둘지는 사람이 정해야 해서 여기서 이름을 부른다 — 쉼표로 잇는 문장 키가 목록 밖에
  // 남아 있으면 다음에 값이 늘 때 오탐으로 떨어진다.
  const classified = [...ITEM_CARD_LABEL_LIST_KEYS, ...ITEM_CARD_SENTENCE_KEYS, ...ITEM_CARD_EXEMPT_KEYS];
  const unclassified = [...seenKeys].filter((key) => !classified.includes(key));
  if (unclassified.length > 0)
    console.log(`  머리말에 갈래가 안 정해진 키가 있다(엄격 규칙으로 검사함): ${unclassified.join(", ")}`);

  console.log(
    `Item card label sweep passed: ${wasteItems.length} items x 2 region modes x ${surfaces.length} surfaces, ` +
      `머리말 키 ${seenKeys.size}종(라벨 목록은 토큰 단위, 문장은 값 단위, \`${ITEM_CARD_EXEMPT_KEYS.join("`·`")}\`는 면제)`,
  );
}

/**
 * Every item through the widget path once. The 183 get_disposal_steps answer
 * cases are pinned to WIDGET_ENABLED=false, so on their own they would only
 * cover a shape production never serves (R1 leaves widgets on by default) —
 * this keeps the whole catalogue on the real path. Structure only, no wording:
 * the answer cases already own what the text says.
 */
// 표시명으로 물어도 ambiguous로 갈리는 품목이 몇 개는 남는다(그건 설계대로 텍스트
// 경로다). 다만 그런 품목이 카탈로그의 10%나 될 이유는 없으니, 그보다 커지면
// 판별이 망가진 쪽을 의심한다.
const MAX_SWEEP_SKIP_RATIO = 0.1;

async function sweepWidgetCatalogue(baseUrl, startRequestId) {
  const { wasteItems, itemNeedsCriticalRegionCheck } = await import("../dist/data.js");
  let requestId = startRequestId;
  let validated = 0;
  const skipped = [];

  for (const item of wasteItems) {
    // Region-critical items get a region so the R2-1 branch that carries fees
    // and guidance is exercised too, not just the "ask for a region" fallback.
    const args = itemNeedsCriticalRegionCheck(item)
      ? { itemName: item.name, region: "서울 강남구" }
      : { itemName: item.name };
    const result = await callTool(baseUrl, "get_disposal_steps", args, requestId);
    requestId += 1;

    // A display name can still resolve as ambiguous; that path stays text by
    // design. Widget responses now carry structuredContent too, so the
    // discriminator is the resolution status, not the field's presence.
    if (result.structuredContent?.found !== true) {
      skipped.push(item.id);
      continue;
    }

    const context = `catalogue sweep (${item.id})`;
    const payload = parseWidgetPayload(result, context);
    assert(payload.widget?.type === "Card", `${context} root should be a Card, got ${payload.widget?.type}`);
    assertWidgetNode(payload.widget, `${context} widget`);
    assert(!("status" in payload), `${context} payload must not define status`);
    assert(payload.name === "disposal_steps", `${context} has the wrong widget name: ${payload.name}`);

    const copyLines = payload.copy_text.split("\n");
    assert(copyLines.length >= 3 && copyLines.length <= 6, `${context} copy_text is ${copyLines.length} lines, outside the 3~6 budget`);
    assert(
      copyLines.every((line) => line.trim().length > 0),
      `${context} copy_text has a blank line`,
    );
    validated += 1;
  }

  // 판별을 `found` 값에 맡긴 대가로, 필드 이름이 바뀌거나 한쪽 분기에서
  // structuredContent가 빠지면 324개가 전부 skipped로 흘러 "0/324 validated"로
  // 조용히 통과한다. 아래 세 줄이 그 바닥이다 — 합계가 맞는지, 한 장이라도
  // 실제로 검사했는지, skipped가 설명 가능한 규모인지.
  assert(
    validated + skipped.length === wasteItems.length,
    `catalogue sweep accounted for ${validated + skipped.length} of ${wasteItems.length} items`,
  );
  assert(validated > 0, "catalogue sweep validated no cards at all — the widget/text discriminator is broken");
  const skipCap = Math.floor(wasteItems.length * MAX_SWEEP_SKIP_RATIO);
  assert(
    skipped.length <= skipCap,
    `catalogue sweep skipped ${skipped.length} of ${wasteItems.length} items (cap ${skipCap}): ${skipped.join(", ")}`,
  );

  const skipNote = skipped.length > 0 ? ` (skipped as non-match: ${skipped.join(", ")})` : "";
  console.log(`Widget catalogue sweep: ${validated}/${wasteItems.length} cards validated${skipNote}`);
}

/**
 * PRD phase-3 R4-1. Widget responses replace the text body the 211 answer
 * cases assert on (structuredContent은 이제 두 모드가 같은 것을 싣는다), so they
 * run against their own server instance with WIDGET_ENABLED on.
 */
async function runWidgetSmoke() {
  const port = await getFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const { wasteItems, bulkyWasteFeeSchedules } = await import("../dist/data.js");
  const pizzaBox = wasteItems.find((item) => item.id === "pizza_box_oily");
  const chair = wasteItems.find((item) => item.id === "chair");
  const mediumItem = wasteItems.find((item) => item.id === "spring_notebook");
  assert(pizzaBox && chair && mediumItem, "widget smoke is missing its confirmed-match fixtures");
  const { server, getOutput } = startServer(port, { widgets: true });

  const stopServer = () => {
    if (!server.killed) server.kill("SIGTERM");
  };

  process.once("exit", stopServer);

  try {
    await waitForHealth(baseUrl, getOutput);
    let requestId = 1;

    const match = await callTool(baseUrl, "get_disposal_steps", { itemName: "기름 묻은 피자박스" }, requestId);
    requestId += 1;
    const payload = parseWidgetPayload(match, "confirmed match");
    assert(isPlainObject(payload.widget), "confirmed match is missing the widget wrapper");
    assert(payload.widget.type === "Card", `widget root should be a Card, got ${payload.widget.type}`);
    assert(Array.isArray(payload.widget.children) && payload.widget.children.length > 0, "widget Card has no children");
    assert(!("status" in payload) && !("status" in payload.widget), "widget response must not define status");
    assert(typeof payload.copy_text === "string" && payload.copy_text.includes("기름 묻은 피자박스"), "copy_text is missing the item name");
    // 카드는 렌더링용, structuredContent는 모델 추론용 — 위젯 응답도 텍스트 경로와
    // 같은 데이터를 실어야 한다 (R4 결정 변경, 2026-08-18).
    assert(match.structuredContent?.found === true, "widget response must carry the text path's structuredContent");
    assert(match.structuredContent.id === "pizza_box_oily", `widget structuredContent matched the wrong item: ${match.structuredContent.id}`);
    assert(
      JSON.stringify(match.structuredContent.steps) === JSON.stringify(pizzaBox.steps),
      "widget structuredContent should carry the same steps the text path serves",
    );
    // 확신도 등급 원문이 나가는 경로는 structuredContent뿐이다. 카드는 medium일 때
    // 할 일 한 줄로 접어 싣고 등급 이름은 버리므로, 여기서 빠지면 티 없이 사라진다.
    assert(
      match.structuredContent.confidence === pizzaBox.confidence,
      `widget structuredContent lost the confidence grade: ${match.structuredContent.confidence}`,
    );
    assert(
      JSON.stringify(payload.widget).includes("깨끗한 부분과 오염된 부분을 분리합니다."),
      "widget card is missing the disposal steps",
    );
    // The date comes off the same sources[0] the title does, so this pins the
    // wiring end to end rather than just the builder's formatting.
    assert(
      JSON.stringify(payload.widget).includes(`${pizzaBox.sources[0].checkedAt} 확인`),
      "widget card is missing the source confirmation date",
    );

    const ambiguous = await callTool(baseUrl, "get_disposal_steps", { itemName: "전구" }, requestId);
    requestId += 1;
    assert(ambiguous.structuredContent?.ambiguous === true, "전구 should still resolve as ambiguous");
    // Which candidates 전구 resolves to is data, and Phase 1·2 already moved it
    // once. What this case owns is that the ask-back keeps its candidates — so
    // it reads them off the response instead of naming one.
    const candidates = ambiguous.structuredContent?.candidates ?? [];
    assert(candidates.length > 0, "ambiguous response lost its candidates");
    assert(
      candidates.every((candidate) => resultText(ambiguous).includes(candidate)),
      `ambiguous text is missing a candidate: ${candidates.join(", ")}`,
    );
    assertPlainTextResponse(ambiguous, "ambiguous response");

    const notFound = await callTool(baseUrl, "get_disposal_steps", { itemName: "존재하지않는품목zzz" }, requestId);
    requestId += 1;
    assert(notFound.structuredContent?.found === false, "unknown item should still resolve as not_found");
    assertPlainTextResponse(notFound, "not_found response");

    const regional = await callTool(baseUrl, "get_disposal_steps", { itemName: "책상의자", region: "서울 강남구" }, requestId);
    requestId += 1;
    const regionalCard = JSON.stringify(parseWidgetPayload(regional, "regional match").widget);
    assert(regionalCard.includes("서울 강남구 기준"), "regional card is missing the matched region name");
    assert(!regionalCard.includes("거주 지역 기준 확인 필요"), "regional card should not ask for a region the user already gave");

    // PRD phase-10 R4: 위젯 모드 크기 상한(경고). 카드의 수수료 줄은 잘린 행을 규격이 아니라
    // 행으로 말해야 한다 — 텍스트 답변이 "대표 12행만"이라고 밝히는데 카드만 12종이 전부인
    // 척하면 안 된다.
    const sizeWidgetResult = await callTool(baseUrl, "get_disposal_steps", SIZE_CASE, requestId);
    requestId += 1;
    warnIfOversized(sizeWidgetResult, "widget");
    const sizeFeeLine = cardTextValues(parseWidgetPayload(sizeWidgetResult, "노원구 매트리스 card").widget).find((value) => value.startsWith("수수료 "));
    assert(sizeFeeLine, "노원구 매트리스 card is missing its fee line");
    if (bulkyWasteFeeSchedules.find((schedule) => schedule.regionId === "nowon_gu")?.preCapFeeRowCountByItemId?.mattress) {
      assert(/수수료표 \d+행 중 대표 \d+행/.test(sizeFeeLine), `노원구 매트리스 card: 잘린 행 안내가 행 단위가 아니다: ${sizeFeeLine}`);
    }
    assertRegionNotesUrlsUnique(sizeWidgetResult.structuredContent?.regionNotes, "노원구 매트리스 widget");

    const regionless = await callTool(baseUrl, "get_disposal_steps", { itemName: "책상의자" }, requestId);
    requestId += 1;
    const regionlessCard = JSON.stringify(parseWidgetPayload(regionless, "regionless match").widget);
    assert(regionlessCard.includes("거주 지역 기준 확인 필요"), "region-sensitive item without a region should ask for one");

    // 수수료는 품목이 아니라 지역 고시에서 오고 확인일도 따로 붙는데, 카드에서 그 줄 바로 아래가
    // sources[0] 날짜를 실은 근거 줄이다. 용산구는 두 날짜가 8개월 벌어져 있어(수수료 2025-11-03,
    // 의자 출처 2026-07-02) 근거 줄 날짜를 수수료로 읽는 회귀가 여기서 걸린다.
    const feeSchedule = bulkyWasteFeeSchedules.find((schedule) => schedule.regionId === "yongsan_gu");
    assert(feeSchedule, "fee-date case is missing its 용산구 fee schedule");
    assert(
      feeSchedule.checkedAt !== chair.sources[0].checkedAt,
      `fee-date case needs a region whose fee date differs from the item source date (both are ${feeSchedule.checkedAt})`,
    );
    const feeDated = await callTool(baseUrl, "get_disposal_steps", { itemName: "책상의자", region: "서울 용산구" }, requestId);
    requestId += 1;
    const feeLine = cardTextValues(parseWidgetPayload(feeDated, "용산구 fee card").widget).find((value) => value.startsWith("수수료 "));
    assert(feeLine, "용산구 card is missing its fee line");
    assert(feeLine.includes(`${feeSchedule.checkedAt} 확인`), `fee line should carry the fee schedule's own date, got: ${feeLine}`);
    assert(!feeLine.includes(chair.sources[0].checkedAt), `fee line is dated with the item source date instead: ${feeLine}`);

    // 확신도 등급 원문은 이제 structuredContent로 모델에 항상 가지만, 카드만 보는
    // 사용자를 위한 신호는 여전히 이 한 줄뿐이다. 324개 중 75개가 medium이라, 그 줄이
    // 없으면 한 번 더 확인해야 할 답이 확정된 답으로 나간다. high 249개는 종전대로
    // 아무 말도 덧붙이지 않는다. 문구는 분류 이야기만 한다 — 지역을 다시 확인하라는
    // 말은 지역 줄이 이미 자기 조건에 맞게 하고 있다.
    assert(mediumItem.confidence === "medium" && pizzaBox.confidence === "high", "confidence-note case lost its high/medium pair");
    const mediumMatch = await callTool(baseUrl, "get_disposal_steps", { itemName: mediumItem.name }, requestId);
    requestId += 1;
    const mediumValues = cardTextValues(parseWidgetPayload(mediumMatch, "medium confidence card").widget);
    assert(
      mediumValues.some((value) => value.includes("분류가 갈릴 수 있")),
      `medium-confidence card should flag that the classification may go either way: ${mediumValues.join(" | ")}`,
    );
    assert(
      !cardTextValues(payload.widget).some((value) => value.includes("분류가 갈릴 수 있")),
      "high-confidence card should not hedge a verdict it is sure of",
    );

    // 사진 경로. 서버로 이미지가 오지는 않고 호스트가 알아본 이름만 문자열로 넘어오므로,
    // 잘못 알아본 이름도 확정 매칭으로 착지해 카드가 된다. 무엇으로 봤는지 카드에 되비춘다.
    const photoMatch = await callTool(
      baseUrl,
      "get_disposal_steps",
      { itemName: "기름 묻은 피자박스", inputSource: "photo" },
      requestId,
    );
    requestId += 1;
    const photoPayload = parseWidgetPayload(photoMatch, "photo-sourced match");
    assertWidgetNode(photoPayload.widget, "photo-sourced match widget");
    const photoValues = cardTextValues(photoPayload.widget);
    assert(
      photoValues.some((value) => value.includes("사진 속 물건") && value.includes(pizzaBox.name)),
      `photo-sourced card should name what it took the photo to be: ${photoValues.join(" | ")}`,
    );
    assert(
      !cardTextValues(payload.widget).some((value) => value.includes("사진 속 물건")),
      "a typed item name must not be answered as if it came from a photo",
    );
    // 공유본은 사진을 보낸 적 없는 사람이 받는다. "사진 속 물건" 이야기가 거기 실리면
    // 맥락 없이 뜬금없고, 3~6줄 예산에서 단계 한 줄을 밀어내기까지 한다.
    assert(!photoPayload.copy_text.includes("사진 속 물건"), "copy_text must not carry the photo confirmation line");
    assert(
      photoPayload.copy_text === payload.copy_text,
      "photo input must not change the share text at all",
    );

    // A text answer is the host's to rewrite and carries no Kakao Tools label,
    // so a confirmed match must not depend on which of the two item tools the
    // host picked. The card is built by one shared function — this pins that
    // the two tools actually reach it with the same inputs.
    const classified = await callTool(baseUrl, "classify_waste_item", { itemName: "기름 묻은 피자박스" }, requestId);
    requestId += 1;
    const classifiedPayload = parseWidgetPayload(classified, "classify confirmed match");
    // 확신도는 카드가 medium일 때만 한 줄로 접어 싣는다. structuredContent가 함께
    // 나가면서 등급 원문은 모델이 항상 받는다 — 위젯을 켜도 잃지 않는지 여기서 고정.
    assert(classified.structuredContent?.matchedItem === pizzaBox.name, "classify widget response must carry the text path's structuredContent");
    assert(classified.structuredContent.confidence === pizzaBox.confidence, `classify widget structuredContent lost the confidence grade: ${classified.structuredContent.confidence}`);
    assert(
      JSON.stringify(classifiedPayload.widget) === JSON.stringify(payload.widget),
      "classify and get_disposal_steps should serve the same card for the same match",
    );

    // 같은 단언을 지역을 준 채로 한 번 더. 위 케이스는 지역이 없어 두 툴이 카드 빌더에
    // 넘기는 선택 인자가 전부 비어 있고, 그래서 인자를 서로 바꿔 넣어도 통과한다 —
    // 실제로 사진 경로와 지역 되부르기를 합치다 region이 photoNote 자리로 들어가
    // 카드에 지역 문자열이 캡션으로 뜰 뻔했고, 이 줄이 없으면 그게 그대로 나갔다.
    const classifiedRegional = await callTool(baseUrl, "classify_waste_item", { itemName: "책상의자", region: "서울 강남구" }, requestId);
    requestId += 1;
    const stepsRegional = await callTool(baseUrl, "get_disposal_steps", { itemName: "책상의자", region: "서울 강남구" }, requestId);
    requestId += 1;
    assert(
      JSON.stringify(parseWidgetPayload(classifiedRegional, "classify regional card").widget) ===
        JSON.stringify(parseWidgetPayload(stepsRegional, "steps regional card").widget),
      "classify and get_disposal_steps should serve the same card when a region is given too",
    );

    // R1's line holds on this tool too: the two paths that need a follow-up turn
    // stay text, because a card closes the conversation.
    const classifyAmbiguous = await callTool(baseUrl, "classify_waste_item", { itemName: "전구" }, requestId);
    requestId += 1;
    assert(classifyAmbiguous.structuredContent?.ambiguous === true, "classify 전구 should still resolve as ambiguous");
    assertPlainTextResponse(classifyAmbiguous, "classify ambiguous response");

    const classifyNotFound = await callTool(baseUrl, "classify_waste_item", { itemName: "존재하지않는품목zzz" }, requestId);
    requestId += 1;
    assert(classifyNotFound.structuredContent?.found === false, "classify unknown item should still resolve as not_found");
    assertPlainTextResponse(classifyNotFound, "classify not_found response");

    // classify used to echo the raw region string without resolving it, so the
    // card is the first time this tool has to actually match a 구.
    const classifyRegional = await callTool(baseUrl, "classify_waste_item", { itemName: "책상의자", region: "서울 강남구" }, requestId);
    requestId += 1;
    const classifyRegionalCard = JSON.stringify(parseWidgetPayload(classifyRegional, "classify regional match").widget);
    assert(classifyRegionalCard.includes("서울 강남구 기준"), "classify regional card is missing the matched region name");
    assert(!classifyRegionalCard.includes("거주 지역 기준 확인 필요"), "classify regional card should not ask for a region the user already gave");

    // 시·군·구를 댔는데 상세 데이터가 없어 광역으로 착지한 경우. 되묻기는
    // `get_region_disposal_info`에서만 없앴던 시기가 있었는데, 자기 구를 말하는 건
    // 지역 질문보다 품목 질문 쪽이 더 흔하다("청주시 사는데 소파 어떻게 버려?").
    // 카드의 지역 줄은 두 개가 상한이라, 되묻기가 이름 부르기로 **바뀌기만** 하고
    // 줄이 하나 더 늘지는 않아야 배출 절차 줄이 밀려나지 않는다.
    for (const tool of ["get_disposal_steps", "classify_waste_item"]) {
      const named = await callTool(baseUrl, tool, { itemName: "소파", region: "청주시" }, requestId);
      requestId += 1;
      const namedValues = cardTextValues(parseWidgetPayload(named, `${tool} named-district card`).widget);
      assert(
        namedValues.some((value) => value.includes("청주시 상세 데이터는 아직 없어 충청북도 광역 기준으로 안내합니다")),
        `${tool} card should name the 시·군·구 the user already gave: ${namedValues.join(" | ")}`,
      );
      assert(
        !namedValues.some((value) => value.includes("거주 중인 시·군·구를 확인해야")),
        `${tool} card asked back for a 시·군·구 the user already gave: ${namedValues.join(" | ")}`,
      );
      assert(
        namedValues.some((value) => value.includes("사전 신청하고 접수증 또는 접수번호를 부착")),
        `${tool} card lost its disposal line to the region budget: ${namedValues.join(" | ")}`,
      );
    }

    // PRD phase-3 R5. 본선 매칭률 집계가 읽는 건 로그 줄의 status라, 위젯 응답에서도
    // status=match와 matchedId가 실제로 찍히는지 여기서 고정한다. 그 값이 핸들러의
    // 명시적 `_log.status`에서 왔는지까지는 못 잡는다 — 위젯 응답도 structuredContent를
    // 싣게 되면서 callStatus()가 스스로 match를 뽑아내므로, 명시를 지워도 이 단언은
    // 통과한다. 명시를 남겨두는 건 구조가 롤백될 때를 대비한 이중 안전장치다
    // (server.ts widgetResult 주석 참고).
    const logLines = getOutput()
      .split("\n")
      .filter((line) => line.includes('"tool":"get_disposal_steps"'))
      // stdout and stderr land in one unframed buffer, so a chunk boundary or an
      // interleaved stderr write can leave a fragment that still matches the
      // filter. Skip what does not parse instead of dying on a SyntaxError that
      // has nothing to do with the behaviour under test.
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    assert(logLines.length > 0, "no get_disposal_steps call was logged");
    assert(
      logLines[0].status === "match" && logLines[0].matchedId === "pizza_box_oily",
      `widget call logged status=${logLines[0].status}, matchedId=${logLines[0].matchedId}`,
    );
    // `_log`에 담아도 withCallLog가 출력에서 빼면 셀 수 없다. regionStatus가 실제로 그렇게
    // 빠져 있었고, 응답의 structuredContent 사본만 남아 로그로는 집계가 불가능했다.
    // 그래서 필드마다 "줄에 실제로 나오는지"를 이렇게 따로 고정한다.
    assert(
      logLines.some((line) => line.inputSource === "photo"),
      "the photo-sourced call should reach the log output, not just the handler's _log",
    );

    // 위젯이 막 붙은 툴에도 같은 고정. 여기서도 잡는 건 로그 줄에 남은 최종
    // status·matchedId지 그 값의 출처가 아니다 (바로 위 주석과 같은 이유).
    const classifyLog = getOutput()
      .split("\n")
      .filter((line) => line.includes('"tool":"classify_waste_item"'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    assert(classifyLog.length > 0, "no classify_waste_item call was logged");
    assert(
      classifyLog[0].status === "match" && classifyLog[0].matchedId === "pizza_box_oily",
      `classify widget call logged status=${classifyLog[0].status}, matchedId=${classifyLog[0].matchedId}`,
    );

    // 인자와 예외 메시지를 운영 로그에서 뺀 건 본선 규격 때문이라 조용히 되살아나면
    // 안 된다. 기본값 서버의 로그 줄에 input이나 message가 다시 끼면 여기서 걸린다.
    const leakedLines = [...logLines, ...classifyLog].filter((line) => "input" in line || "message" in line);
    assert(
      leakedLines.length === 0,
      `call log kept caller detail without CALL_LOG_DETAILS: ${JSON.stringify(leakedLines[0])}`,
    );

    // not_found는 matchedId도 score도 없다. fallbackTier까지 빠지면 남는 건
    // status와 ms뿐이라, 폴백이 어디로 착지했는지 로그로는 알 수 없다.
    const notFoundLog = classifyLog.find((line) => line.status === "not_found");
    assert(
      typeof notFoundLog?.fallbackTier === "string",
      `not_found call logged no fallbackTier: ${JSON.stringify(notFoundLog)}`,
    );

    await sweepWidgetCatalogue(baseUrl, requestId + 1);

    console.log(`Widget smoke passed at ${baseUrl} (WIDGET_ENABLED=true)`);
  } finally {
    stopServer();
  }
}

/* ───────────────────── find_disposal_spots (PRD phase-12 R7) ───────────────────── */

/**
 * 목 업스트림. **실서버는 절대 치지 않는다** — 남의 한도를 쓰는 것도 문제고, 그쪽이 느린 날
 * 통과 여부가 우리 코드와 무관해지는 게 더 문제다.
 *
 * 픽스처는 실측(docs/moe-recycling-api-2026-08-24.md 2-2-1)의 축약본이다. 상계동은 종류
 * 분포와 개수 상한을, `우동`·`서교동`·`중앙동`은 동음 오염 세 갈래를 재현한다.
 */
const SPOT_FIXTURES = {
  // 표기 두 가지(`의류 수거함`/`의류수거함`)가 한 묶음으로 합쳐지는 것도 여기서 본다.
  상계동: [
    { spotNm: "폐의약품 수거함", addrBase: "서울특별시 노원구 상계로 121", addrDtl: "노원구보건소 1층" },
    { spotNm: "폐의약품 수거함", addrBase: "서울특별시 노원구 동일로 1414", addrDtl: "상계동주민센터" },
    { spotNm: "전지 수거함", addrBase: "서울특별시 노원구 노해로 437", addrDtl: "노원구청 앞" },
    { spotNm: "형광등 수거함", addrBase: "서울특별시 노원구 노해로 437", addrDtl: "노원구청 앞" },
    // 두 묶음 표기를 겸하는 실측 사례. 표 순서상 `battery_lamp`가 이겨야 한다.
    { spotNm: "폐형광등∙폐건전지 전용 배출함", addrBase: "서울특별시 노원구 한글비석로 220", addrDtl: "" },
    { spotNm: "폐건전지 수거함", addrBase: "서울특별시 노원구 상계로1길 10", addrDtl: "" },
    // 표기가 붙은 지자체도 있다 — `전지` 패턴이 공백에 민감하면 이 행이 기타로 샌다.
    { spotNm: "폐건전지수거함", addrBase: "서울특별시 노원구 상계로1길 20", addrDtl: "" },
    { spotNm: "의류 수거함", addrBase: "서울특별시 노원구 상계로 88", addrDtl: "" },
    { spotNm: "의류 수거함", addrBase: "서울특별시 노원구 상계로 92", addrDtl: "" },
    { spotNm: "의류수거함", addrBase: "서울특별시 노원구 동일로204길 12", addrDtl: "" },
    { spotNm: "의류수거함", addrBase: "서울특별시 노원구 동일로207길 3", addrDtl: "" },
    { spotNm: "의류수거함", addrBase: "서울특별시 노원구 한글비석로 100", addrDtl: "" },
    { spotNm: "중소형 수거함", addrBase: "서울특별시 노원구 노원로 330", addrDtl: "상계주공아파트 관리사무소" },
    { spotNm: "폐휴대폰 배출처", addrBase: "서울특별시 노원구 노해로 437", addrDtl: "노원구청 민원실" },
    { spotNm: "소형가전 수거함", addrBase: "서울특별시 노원구 상계로 200", addrDtl: "" },
    { spotNm: "투명페트병 무인회수기", addrBase: "서울특별시 노원구 동일로 1400", addrDtl: "지하철 4호선 상계역" },
    { spotNm: "페트병·캔 무인회수기", addrBase: "서울특별시 노원구 노해로 480", addrDtl: "" },
    { spotNm: "음식물 RFID", addrBase: "서울특별시 노원구 상계로 300", addrDtl: "" },
    { spotNm: "음식물 RFID", addrBase: "서울특별시 노원구 상계로 320", addrDtl: "" },
    { spotNm: "식용유 수거함", addrBase: "서울특별시 노원구 상계로 340", addrDtl: "" },
    // 기본 노출에서 빠지는 둘. 응답의 절반을 차지하는 종량제봉투와 이름만으로는 알 수 없는 기타.
    { spotNm: "종량제봉투 판매소", addrBase: "서울특별시 노원구 상계로 11", addrDtl: "○○마트" },
    { spotNm: "종량제봉투 판매소", addrBase: "서울특별시 노원구 상계로 13", addrDtl: "○○편의점" },
    { spotNm: "재활용정거장(이동식)", addrBase: "서울특별시 노원구 상계로 15", addrDtl: "" },
  ],
  // 실측 동음 오염: `우동`은 화성 `석우동`에 부분일치로 걸린다.
  우동: [
    { spotNm: "폐의약품 수거함", addrBase: "부산광역시 해운대구 우동 1418", addrDtl: "해운대구보건소" },
    { spotNm: "의류수거함", addrBase: "부산광역시 해운대구 좌동순환로 30", addrDtl: "" },
    { spotNm: "폐의약품 수거함", addrBase: "경기도 화성시 석우동 92", addrDtl: "동탄보건지소" },
  ],
  // 전국 동명 자치구. 구 이름만 보고 거르면 `광주 북구` 질의에 대구 북구 주소가 그대로 통과한다.
  중앙동: [
    { spotNm: "폐의약품 수거함", addrBase: "대구광역시 북구 중앙대로 100", addrDtl: "북구보건소" },
    { spotNm: "폐의약품 수거함", addrBase: "대구광역시 북구 중앙대로 200", addrDtl: "" },
    { spotNm: "폐의약품 수거함", addrBase: "광주광역시 북구 금재로 30", addrDtl: "북구청 1층" },
  ],
  // 실측: 마포 95건에 여수 9건이 섞인다.
  서교동: [
    { spotNm: "의류수거함", addrBase: "서울특별시 마포구 월드컵북로 21", addrDtl: "" },
    { spotNm: "폐의약품 수거함", addrBase: "서울특별시 마포구 서교동 358", addrDtl: "마포구보건소" },
    { spotNm: "폐의약품 수거함", addrBase: "전라남도 여수시 서교동 12", addrDtl: "여수시보건소" },
  ],
  단건동: [{ spotNm: "폐의약품 수거함", addrBase: "충청북도 청주시 흥덕구 단건로 1", addrDtl: "단건동주민센터" }],
  // 이름을 품은 이웃 구 — `부산 서구` 질의에 강서구 주소가 부분 문자열로 통과하면 안 된다.
  경계동: [
    { spotNm: "폐의약품 수거함", addrBase: "부산광역시 서구 구덕로 120", addrDtl: "서구보건소" },
    { spotNm: "폐의약품 수거함", addrBase: "부산광역시 강서구 낙동북로 477", addrDtl: "강서구보건소" },
  ],
  // 이중 중첩 `items: [{ item: [...] }]` — 실서버가 이 모양을 실제로 낸다.
  중첩동: [
    { spotNm: "폐의약품 수거함", addrBase: "대전광역시 서구 둔산로 100", addrDtl: "서구보건소" },
    { spotNm: "의류수거함", addrBase: "대전광역시 서구 둔산로 200", addrDtl: "" },
  ],
  절단동: [
    { spotNm: "폐의약품 수거함", addrBase: "서울특별시 강남구 학동로 426", addrDtl: "강남구보건소" },
    { spotNm: "의류수거함", addrBase: "서울특별시 강남구 학동로 400", addrDtl: "" },
  ],
  느린동: [{ spotNm: "폐의약품 수거함", addrBase: "서울특별시 성동구 고산자로 270", addrDtl: "성동구보건소" }],
  // 판매소·기타뿐인 동 — 노출 묶음이 하나도 없다.
  판매소동: [
    { spotNm: "종량제봉투 판매소", addrBase: "서울특별시 노원구 판매로 1", addrDtl: "○○마트" },
    { spotNm: "재활용정거장(이동식)", addrBase: "서울특별시 노원구 판매로 3", addrDtl: "" },
  ],
  빈동: [],
};

/** 상계동 응답에서 기대하는 묶음과 개수. 표 순서·묶음당 3곳·전체 12곳이 한꺼번에 걸린다. */
const SPOT_EXPECTED_SECTIONS = [
  "### 폐의약품 수거함 (2곳)",
  "### 폐건전지·폐형광등 수거함 (5곳 중 3곳)",
  "### 의류 수거함 (5곳 중 3곳)",
  "### 폐휴대폰·소형가전 수거함 (3곳)",
  "### 투명페트병·캔 무인회수기 (2곳 중 1곳)",
];

// PRD phase-12 R7: 이 툴의 크기 상한은 다른 툴 기준을 빌리지 않고 새로 잰다. 목표였던 "성공
// 응답 text 2.5KB 이하"는 12곳이 다 찬 상계동 응답이 1,612B라 여유 있게 지킨다. 아래 값은 그
// 실측(text 1,612B · 전체 3,537B, 2026-08-26)에 10%를 얹은 것이다 — 전체가 text의 두 배가 넘는
// 건 structuredContent가 같은 주소를 한 벌 더 싣기 때문이고, 다른 툴도 같은 성질을 안고 있다.
// 기존 관행대로 실패가 아니라 경고로 시작한다.
//
// 첫 실측은 text 1,433B(2026-08-25)였다. 그 뒤 PR #77 리뷰 라운드가 상계동 픽스처에
// 폐건전지·식용유 행을 더해 기대 응답 자체가 커진 것이라(런타임 변화 아님) 기준을 다시 쟀다.
const SPOT_SIZE_WARN_BYTES = { text: 1_780, total: 3_890 };

// structuredContent 화이트리스트(PRD phase-12 R5). 세 갈래가 모양이 달라 따로 둔다.
const SPOT_FOUND_KEYS = ["found", "dong", "region", "categories", "truncated", "omitted", "source"];
const SPOT_OMITTED_KEYS = ["id", "label", "found"];
const SPOT_CATEGORY_KEYS = ["id", "label", "spots"];
const SPOT_SPOT_KEYS = ["name", "address"];
const SPOT_FALLBACK_KEYS = ["found", "dong", "fallback"];
const SPOT_FALLBACK_INNER_KEYS = ["mapUrl", "regionSources", "itemLine"];
const SPOT_ASK_KEYS = ["found", "dong", "ambiguousDong", "regions"];

function assertKeysWithin(object, allowed, context) {
  for (const key of Object.keys(object ?? {})) {
    assert(allowed.includes(key), `${context}: structuredContent에 화이트리스트 밖 키 "${key}"가 있다`);
  }
}

function assertSpotStructured(result, context) {
  const structured = result.structuredContent;
  assert(isPlainObject(structured), `${context}: structuredContent가 없다`);

  if (structured.found === true) {
    assertKeysWithin(structured, SPOT_FOUND_KEYS, context);
    assert(Array.isArray(structured.categories) && structured.categories.length > 0, `${context}: categories[]가 비었다`);
    for (const category of structured.categories) {
      assertKeysWithin(category, SPOT_CATEGORY_KEYS, `${context} categories[]`);
      assert(Array.isArray(category.spots) && category.spots.length > 0, `${context}: ${category.id} spots[]가 비었다`);
      assert(category.spots.length <= 3, `${context}: ${category.id}가 묶음당 3곳 상한을 넘었다`);
      for (const spot of category.spots) {
        assertKeysWithin(spot, SPOT_SPOT_KEYS, `${context} spots[]`);
        assert(isNonEmptyText(spot.name) && isNonEmptyText(spot.address), `${context}: 이름이나 주소가 빈 곳이 있다`);
      }
    }
    const total = structured.categories.reduce((sum, category) => sum + category.spots.length, 0);
    assert(total <= 12, `${context}: 전체 12곳 상한을 넘어 ${total}곳이 나갔다`);
    for (const entry of structured.omitted ?? []) {
      assertKeysWithin(entry, SPOT_OMITTED_KEYS, `${context} omitted[]`);
    }
    return;
  }

  if (structured.ambiguousDong === true) {
    assertKeysWithin(structured, SPOT_ASK_KEYS, context);
    assert(Array.isArray(structured.regions) && structured.regions.length > 1, `${context}: 되묻기인데 후보 지역이 둘 미만이다`);
    return;
  }

  assertKeysWithin(structured, SPOT_FALLBACK_KEYS, context);
  assert(isPlainObject(structured.fallback), `${context}: fallback 블록이 없다`);
  assertKeysWithin(structured.fallback, SPOT_FALLBACK_INNER_KEYS, `${context} fallback`);
  assert(isNonEmptyText(structured.fallback.mapUrl), `${context}: fallback.mapUrl이 비었다`);
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 폴백이 늘 들고 나가는 전국 확인 경로. `src/data.ts`의 `REGION_SELECT_GUIDE_LINK`와 같은 주소다. */
const REGION_SELECT_GUIDE_URL = "https://www.분리배출.kr/front/region/region.do";

/** 목 업스트림이 받은 요청. 키 인코딩과 법정동 정규화를 여기서 확인한다. */
function startMockUpstream() {
  const requests = [];
  const server = createHttpServer((req, res) => {
    // 타임아웃 케이스에서는 클라이언트가 먼저 끊는다. 그 뒤에 쓰면 ECONNRESET이 떠서
    // 목 서버가 스모크 전체를 넘어뜨린다.
    res.on("error", () => {});
    const url = new URL(req.url, `http://${HOST}`);
    const addr = url.searchParams.get("addr") ?? "";
    requests.push({
      path: url.pathname,
      addr,
      rawQuery: url.search,
      serviceKey: url.searchParams.get("serviceKey") ?? "",
      numOfRows: url.searchParams.get("numOfRows"),
    });

    const rows = SPOT_FIXTURES[addr];
    const send = (payload) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify(payload));
    };

    if (rows === undefined) {
      // NODATA도 정상 응답이다(resultCode 03). 실패로 접으면 폴백 이유가 뒤바뀐다.
      send({ response: { header: { resultCode: "03", resultMsg: "NODATA_ERROR" }, body: { items: "", totalCount: 0 } } });
      return;
    }

    const header = { resultCode: "00", resultMsg: "NORMAL SERVICE." };
    // 단건이면 배열이 아니라 객체로 온다 — 수거함이 한 곳뿐인 동에서만 터지는 자리다.
    // 중첩동은 실서버가 내는 또 다른 모양(`items: [{ item: [...] }]`)을 재현한다.
    const items = addr === "중첩동" ? [{ item: rows }] : rows.length === 1 ? { item: rows[0] } : { item: rows };
    // 1,000행 절단은 totalCount로만 드러난다.
    const totalCount = addr === "절단동" ? 2_000 : rows.length;

    if (addr === "느린동") {
      // 타임아웃(2.5초)보다 늦게 답한다. 클라이언트가 먼저 끊어야 한다.
      const timer = setTimeout(() => send({ response: { header, body: { items, totalCount } } }), 3_000);
      timer.unref();
      return;
    }

    send({ response: { header, body: { items, totalCount } } });
  });

  server.listen(0, HOST);
  return once(server, "listening").then(() => ({
    baseUrl: `http://${HOST}:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        // keep-alive로 열려 있는 연결까지 끊어야 close가 걸리지 않는다.
        server.closeAllConnections();
        server.close(resolve);
      }),
  }));
}

// 실제 포털 디코딩 키를 닮은 더미. `+`와 `=`가 들어 있어야 인코딩 규칙이 실제로 걸린다.
const SPOT_DUMMY_KEY = "smoke+dummy/key==";
// 인코딩 키(`%`가 들어 있는 쪽)는 그대로 실려야 한다. 두 번 인코딩하면 증상이
// "툴은 등록됐는데 100% 폴백"이라 가장 늦게 발견된다.
const SPOT_DUMMY_ENCODED_KEY = "smoke%2Bdummy%2Fkey%3D%3D";

async function runSpotSmoke() {
  const upstream = await startMockUpstream();
  const port = await getFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const { server, getOutput } = startServer(port, {
    serviceKey: SPOT_DUMMY_KEY,
    upstreamBaseUrl: upstream.baseUrl,
  });

  const stopServer = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.once("exit", stopServer);

  let requestId = 1;
  const call = (args) => callTool(baseUrl, "find_disposal_spots", args, requestId++);

  try {
    await waitForHealth(baseUrl, getOutput);

    // 키가 있으면 여섯 번째 툴이 선다. 두 목록이 여전히 바이트 동일해야 한다 —
    // 조건부 구성이 `TOOL_DEFS` 한 곳이 아니면 여기서 갈린다.
    const toolsList = await mcpRequest(baseUrl, "tools/list", {}, requestId++);
    assertToolList(toolsList, "spot SSE tools/list", EXPECTED_TOOL_NAMES_WITH_SPOTS);
    const jsonOnlyToolsList = await jsonOnlyMcpRequest(baseUrl, "tools/list", {}, requestId++);
    assertToolList(jsonOnlyToolsList, "spot JSON-only tools/list", EXPECTED_TOOL_NAMES_WITH_SPOTS);
    const sortByName = (tools) => [...tools].sort((a, b) => a.name.localeCompare(b.name));
    assert(
      JSON.stringify(sortByName(toolsList.tools)) === JSON.stringify(sortByName(jsonOnlyToolsList.tools)),
      "with a service key the SSE and JSON-only tool lists must still be identical",
    );

    const spotTool = toolsList.tools.find((tool) => tool.name === "find_disposal_spots");
    assert(spotTool.inputSchema.required?.includes("dong"), "find_disposal_spots must require dong");
    assert(
      !(spotTool.inputSchema.required ?? []).includes("region") && !(spotTool.inputSchema.required ?? []).includes("itemName"),
      "region and itemName must stay optional",
    );
    assert(spotTool.description.includes("법정동"), "description must say a 법정동 name is required");
    assert(
      spotTool.description.includes("get_disposal_steps"),
      "description must send how-to-throw-away questions to get_disposal_steps",
    );

    // ① 성공 — 묶음 순서, 묶음당 3곳, 전체 12곳, 주소 이어 붙이기.
    const success = await call({ dong: "상계동", region: "서울 노원구" });
    const successText = resultText(success);
    assert(
      successText.startsWith("## 서울 노원구 상계동 근처 배출 장소"),
      `상계동 응답의 머리가 다르다:\n${successText.slice(0, 80)}`,
    );
    for (const section of SPOT_EXPECTED_SECTIONS) {
      assert(successText.includes(section), `상계동 응답에 "${section}"이 없다:\n${successText}`);
    }
    const shownSpots = successText.split("\n").filter((line) => line.startsWith("- ") && line.includes(" | "));
    assert(shownSpots.length === 12, `전체 12곳 상한이 안 지켜졌다 — ${shownSpots.length}곳이 나갔다`);
    // 상한이 순서대로 채워졌다면 표 뒤쪽 노출 묶음(음식물·식용유)이 잘린다. 실제 자료에는 있다.
    assert(!successText.includes("### 음식물류 배출기"), "전체 상한에 닿으면 표 뒤쪽 묶음부터 잘려야 한다");
    // 잘린 묶음은 "없는 것"이 아니라 "못 실은 것"으로 읽혀야 한다 — 리뷰 1라운드 지적.
    assert(
      successText.includes("자리가 모자라 음식물류 배출기 2곳 · 폐식용유 수거함 1곳은 싣지 못했습니다"),
      `전체 상한이 지운 묶음을 밝히지 않았다:\n${successText}`,
    );
    assert(!successText.includes("종량제봉투"), "종량제봉투 판매소는 기본 노출에서 빠진다");
    assert(!successText.includes("재활용정거장"), "기타 묶음은 노출하지 않는다");
    assert(
      successText.includes("- 폐의약품 수거함 | 서울특별시 노원구 상계로 121 노원구보건소 1층"),
      "addrBase와 addrDtl을 공백 하나로 이어 붙여야 한다",
    );
    assert(successText.includes("- 출처: 기후에너지환경부 분리배출 정보조회 서비스"), "출처 줄이 없다");
    assert(successText.includes("수거함 위치는 바뀔 수 있습니다"), "확인 안내 줄이 없다");
    assert(!successText.includes("자료가 많아"), "절단되지 않았는데 절단 안내가 붙었다");
    assertSpotStructured(success, "상계동 성공");
    assert(success.structuredContent.region === "서울 노원구", "성공 응답은 착지한 지역 이름을 밝힌다");
    assert(
      success.structuredContent.categories.map((category) => category.id).join(",") ===
        "medicine,battery_lamp,clothing,electronics,pet_bottle",
      "묶음 순서가 표 순서와 다르다",
    );
    assert(success.structuredContent.truncated === undefined, "절단되지 않은 응답에 truncated가 실렸다");
    assert(
      JSON.stringify(success.structuredContent.omitted) ===
        JSON.stringify([
          { id: "food", label: "음식물류 배출기", found: 2 },
          { id: "cooking_oil", label: "폐식용유 수거함", found: 1 },
        ]),
      `전체 상한이 지운 묶음이 structuredContent에 없다: ${JSON.stringify(success.structuredContent.omitted)}`,
    );

    // 키가 응답 어디에도 실리면 안 된다. 키를 다루는 곳은 클라이언트 모듈 한 곳이다.
    const successPayload = JSON.stringify(success);
    assert(!successPayload.includes(SPOT_DUMMY_KEY), "응답에 서비스 키가 실렸다");
    assert(!successPayload.includes("smoke"), "응답에 서비스 키 조각이 실렸다");

    const successSize = measureResult(success, { widgets: false });
    if (successSize.content > SPOT_SIZE_WARN_BYTES.text || successSize.total > SPOT_SIZE_WARN_BYTES.total) {
      console.warn(
        `[size] find_disposal_spots 상계동 응답이 text ${successSize.content}B · 전체 ${successSize.total}B — ` +
          `경고 상한 ${SPOT_SIZE_WARN_BYTES.text}B / ${SPOT_SIZE_WARN_BYTES.total}B를 넘었다. 개수 상한이나 줄 모양이 늘어난 것이다.`,
      );
    }

    // 요청이 규칙대로 나갔는지. 디코딩 키는 인코딩해서, 쪽 넘김 없이 1,000행을 한 번에.
    const successRequest = upstream.requests.at(-1);
    assert(successRequest.path.endsWith("/getSpot"), `getSpot이 아니라 ${successRequest.path}를 쳤다`);
    assert(successRequest.numOfRows === "1000", "numOfRows=1000 한 번으로 받아야 한다");
    assert(
      successRequest.rawQuery.includes(`serviceKey=${encodeURIComponent(SPOT_DUMMY_KEY)}`),
      `디코딩 키는 인코딩해서 보내야 한다: ${successRequest.rawQuery.replace(/serviceKey=[^&]*/, "serviceKey=<redacted>")}`,
    );

    // ② 타임아웃 폴백 — 목이 3초 뒤에 답한다. 2.5초에 끊고 폴백이 나가야 한다.
    const startedAt = Date.now();
    const timeout = await call({ dong: "느린동" });
    const timeoutMs = Date.now() - startedAt;
    assert(timeoutMs < 2_900, `타임아웃이 안 걸렸다 — ${timeoutMs}ms 만에 돌아왔다`);
    assert(timeout.isError !== true, "업스트림이 죽어도 MCP 오류로 끝내지 않는다");
    const timeoutText = resultText(timeout);
    assert(timeoutText.startsWith("느린동의 배출 장소를 지금 조회하지 못했습니다"), `폴백 문구가 다르다:\n${timeoutText}`);
    assert(timeoutText.includes(REGION_SELECT_GUIDE_URL), "폴백에 전국 확인 경로가 없다");
    assertSpotStructured(timeout, "타임아웃 폴백");
    assert(timeout.structuredContent.found === false, "폴백은 found:false다");

    // ③ 0건 폴백 — 지역과 품목이 함께 오면 세 요소가 전부 선다.
    const empty = await call({ dong: "빈동", region: "서울 노원구", itemName: "폐의약품" });
    const emptyText = resultText(empty);
    // 품목을 물었으면 무엇을 못 찾았는지까지 밝힌다 — "이 동에는 배출 장소가 없다"는 다른 말이다.
    assert(emptyText.startsWith("빈동에서 폐의약품 배출 장소를 찾지 못했습니다"), `0건 폴백 문구가 다르다:\n${emptyText}`);
    assert(emptyText.includes(REGION_SELECT_GUIDE_URL), "0건 폴백에 전국 확인 경로가 없다");
    assert(emptyText.includes("약국"), "품목이 확정됐으면 그 묶음의 일반 안내 한 줄이 붙는다");
    assertSpotStructured(empty, "0건 폴백");
    assert(Array.isArray(empty.structuredContent.fallback.regionSources), "지역이 있으면 공식 확인처가 실린다");
    // sources[0]을 그냥 집으면 자치구 대부분에서 대형폐기물 신청 페이지가 잡힌다 — 품목 주제로 골라야 한다.
    assert(
      empty.structuredContent.fallback.regionSources.every((source) => !/대형/.test(source.title)),
      `폐의약품 폴백의 확인처가 품목과 무관하다: ${JSON.stringify(empty.structuredContent.fallback.regionSources)}`,
    );
    assert(isNonEmptyText(empty.structuredContent.fallback.itemLine), "품목이 확정되면 itemLine이 실린다");

    // 지역 없이 0건이어도 폴백이 비면 안 된다 — 이쪽이 이 툴의 기본 시나리오다.
    const bareEmpty = await call({ dong: "없는동" });
    const bareEmptyText = resultText(bareEmpty);
    assert(bareEmptyText.startsWith("없는동에 등록된 배출 장소를 찾지 못했습니다"), `0건 폴백 문구가 다르다:\n${bareEmptyText}`);
    assert(bareEmptyText.includes(REGION_SELECT_GUIDE_URL), "지역 없는 폴백에도 확인 경로 한 줄은 나가야 한다");
    assertSpotStructured(bareEmpty, "지역 없는 0건 폴백");
    assert(bareEmpty.structuredContent.fallback.regionSources === undefined, "지역이 없으면 지역 출처도 없다");

    // ④ 동음 되묻기 — 시·군·구가 둘로 갈리면 오염된 주소 대신 되묻는다.
    const ask = await call({ dong: "서교동" });
    const askText = resultText(ask);
    assert(askText.includes("시·군·구를 함께 알려주세요"), `되묻기 문구가 다르다:\n${askText}`);
    assertSpotStructured(ask, "동음 되묻기");
    assert(ask.structuredContent.ambiguousDong === true, "되묻기에는 ambiguousDong 표시가 있다");
    assert(
      ask.structuredContent.regions.includes("서울특별시 마포구") && ask.structuredContent.regions.includes("전라남도 여수시"),
      `되묻기 후보가 다르다: ${JSON.stringify(ask.structuredContent.regions)}`,
    );

    // 지역을 대긴 했는데 못 알아들은 경우(맨 `중구`) — 그 사실을 밝히고 되묻는다.
    const unresolvedRegion = await call({ dong: "서교동", region: "중구" });
    const unresolvedText = resultText(unresolvedRegion);
    assert(
      unresolvedText.startsWith('말씀하신 지역 "중구"만으로는'),
      `못 알아들은 지역을 밝히지 않고 지역을 또 물었다:\n${unresolvedText}`,
    );

    // 지역 필터가 행을 전부 거르면 "이 동에는 없다"가 아니라 지역·동 불일치로 말한다.
    const filteredAll = await call({ dong: "서교동", region: "서울 노원구" });
    const filteredAllText = resultText(filteredAll);
    assert(
      filteredAllText.startsWith('서울 노원구에서 "서교동" 주소를 찾지 못했습니다'),
      `지역 필터 전멸을 "등록된 배출 장소 없음"으로 말했다:\n${filteredAllText}`,
    );
    assert(filteredAll.structuredContent.found === false, "지역 필터 전멸은 성공 응답이 아니다");

    // 같은 질의에 지역을 얹으면 오염이 걸러지고 답이 나간다.
    const askResolved = await call({ dong: "서교동", region: "서울 마포구" });
    const askResolvedText = resultText(askResolved);
    assert(askResolvedText.includes("마포구"), "지역을 얹으면 그 지역 주소가 나가야 한다");
    assert(!askResolvedText.includes("여수"), "다른 시·도의 같은 이름 동이 섞였다");
    assertSpotStructured(askResolved, "서교동 + 마포구");

    // 실측 오염 사례. `우동`은 화성 `석우동`에 부분일치로 걸린다.
    const pollution = await call({ dong: "우동", region: "부산 해운대구" });
    const pollutionText = resultText(pollution);
    assert(pollutionText.includes("해운대구"), "해운대 주소가 빠졌다");
    assert(!pollutionText.includes("화성시"), "다른 시·도의 부분일치 주소가 섞였다");

    // 이름을 품은 이웃 구 — 시·군·구는 어절 첫머리에서만 맞아야 한다.
    const boundary = await call({ dong: "경계동", region: "부산 서구" });
    const boundaryText = resultText(boundary);
    assert(boundaryText.includes("부산광역시 서구"), "부산 서구 주소가 빠졌다");
    assert(!boundaryText.includes("강서구"), "이름을 품은 이웃 구(강서구)가 부분 문자열로 통과했다");

    // 이중 중첩 items — 안 풀면 행 0개로 읽혀 "이 동에는 없다"는 거짓 답이 된다.
    const nested = await call({ dong: "중첩동", region: "대전 서구" });
    assert(resultText(nested).includes("서구보건소"), `이중 중첩 응답이 비었다:\n${resultText(nested)}`);
    assertSpotStructured(nested, "이중 중첩");

    // **구 이름만 보면 안 되는 갈래.** 자치구 이름은 광역시 여섯 곳에 흩어져 있다.
    const sameNameDistrict = await call({ dong: "중앙동", region: "광주 북구" });
    const sameNameText = resultText(sameNameDistrict);
    assert(sameNameText.includes("광주광역시 북구"), "광주 북구 주소가 빠졌다");
    assert(!sameNameText.includes("대구광역시"), "구 이름만 맞는 다른 광역의 주소가 통과했다");

    // ⑤ 단건 `items.item` 객체 정규화 — 수거함이 한 곳뿐인 동에서만 터지는 자리다.
    const single = await call({ dong: "단건동" });
    const singleText = resultText(single);
    assert(singleText.includes("단건동주민센터"), `단건 응답이 비었다:\n${singleText}`);
    assertSpotStructured(single, "단건 정규화");
    assert(single.structuredContent.categories[0].spots.length === 1, "단건 응답은 한 곳이다");
    // 지역을 안 줬으면 응답이 수렴한 지역 이름을 스스로 밝힌다.
    assert(single.structuredContent.region === "충청북도 청주시", "수렴한 지역명을 응답 머리에 밝혀야 한다");

    // ⑦ 1,000행 절단 — 오류가 아니라 "완전해 보이는 답"으로 나타나는 유일한 실패다.
    const truncated = await call({ dong: "절단동", region: "서울 강남구" });
    const truncatedText = resultText(truncated);
    assert(truncatedText.includes("자료가 많아 일부만 표시했습니다"), `절단 안내가 없다:\n${truncatedText}`);
    assertSpotStructured(truncated, "절단 표시");
    assert(truncated.structuredContent.truncated === true, "절단 플래그가 structuredContent에 없다");

    // 행정동 정규화 — `상계1동`은 그대로 보내면 NODATA다.
    const normalized = await call({ dong: "상계1동", region: "서울 노원구" });
    assert(upstream.requests.at(-1).addr === "상계동", `행정동을 법정동으로 줄이지 않았다: ${upstream.requests.at(-1).addr}`);
    assert(resultText(normalized).startsWith("## 서울 노원구 상계동"), "정규화된 동 이름으로 답해야 한다");

    // 품목 필터 — 확정되면 그 묶음만, 못 찾거나 모호하면 되묻지 않고 전 묶음으로 간다.
    const filtered = await call({ dong: "상계동", region: "서울 노원구", itemName: "폐의약품" });
    const filteredText = resultText(filtered);
    assert(filteredText.includes("폐의약품 수거함 (2곳)"), "확정된 품목의 묶음이 없다");
    assert(!filteredText.includes("의류 수거함"), "품목이 확정되면 그 묶음만 내보낸다");
    assert(filtered.structuredContent.categories.length === 1, "품목 필터가 걸리면 묶음은 하나다");

    // 리뷰 1라운드 지적: 폐식용유는 getSpot에 수거함이 실제로 오는데 묶음이 없어 폴백으로 떨어졌다.
    const oilItem = await call({ dong: "상계동", region: "서울 노원구", itemName: "식용유" });
    const oilText = resultText(oilItem);
    assert(oilText.includes("### 폐식용유 수거함 (1곳)"), `식용유 질의가 수거함 주소를 받지 못했다:\n${oilText}`);
    assert(oilItem.structuredContent.categories.length === 1, "품목 필터가 걸리면 묶음은 하나다");

    const unknownItem = await call({ dong: "상계동", region: "서울 노원구", itemName: "존재하지않는품목zzz" });
    const unknownItemText = resultText(unknownItem);
    assert(unknownItemText.includes("폐의약품 수거함"), "품목을 못 찾아도 전 묶음 요약으로 답한다");
    assert(unknownItemText.includes("의류 수거함"), "품목을 못 찾으면 필터 없이 간다");
    assert(!unknownItemText.includes("찾으시나요"), "장소 질문에 품목 되묻기로 답하지 않는다");

    // 판매소·기타만 있는 동 — 행을 받아 놓고 "등록된 배출 장소가 없다"고 말하면 거짓이다.
    const hiddenOnly = await call({ dong: "판매소동", region: "서울 노원구" });
    const hiddenOnlyText = resultText(hiddenOnly);
    assert(
      hiddenOnlyText.startsWith("판매소동에서 전용 수거함류 배출 장소는 찾지 못했습니다"),
      `숨은 묶음만 있는 동의 폴백 문구가 다르다:\n${hiddenOnlyText}`,
    );
    assert(hiddenOnly.structuredContent.found === false, "숨은 묶음만 있으면 성공 응답을 내지 않는다");

    // 백열전구는 형광등 수거함에 넣으면 안 되는 품목이다(waste-items 카드가 그렇게 말한다).
    // battery_lamp 묶음에 물려 있으면 이 툴이 같은 서버의 그 카드와 반대말을 한다.
    const bulbItem = await call({ dong: "상계동", region: "서울 노원구", itemName: "백열전구" });
    const bulbText = resultText(bulbItem);
    assert(bulbItem.structuredContent.found === false, "백열전구가 형광등 수거함 주소를 받으면 안 된다");
    assert(!bulbText.includes("폐건전지·폐형광등"), "백열전구 응답에 형광등 수거함이 실렸다");

    // 수거함이 없는 품목(소파)은 억지로 다른 묶음을 보여 주는 대신 폴백으로 내려앉는다.
    const noCategoryItem = await call({ dong: "상계동", region: "서울 노원구", itemName: "소파" });
    const noCategoryText = resultText(noCategoryItem);
    assert(noCategoryText.includes(REGION_SELECT_GUIDE_URL), "묶음이 없는 품목은 폴백으로 간다");
    assert(
      noCategoryText.startsWith("상계동에서 소파 배출 장소를 찾지 못했습니다"),
      `수거함이 실제로 있는 동이므로 "이 동에는 배출 장소가 없다"고 말하면 안 된다:\n${noCategoryText}`,
    );
    assert(noCategoryItem.structuredContent.found === false, "묶음이 없으면 성공 응답을 내지 않는다");

    // 입력 검증 실패만 MCP 오류로 끝난다(D2). 그 오류는 다음 호출을 고칠 안내를 달고 나간다.
    let invalidError;
    try {
      await jsonOnlyMcpRequest(baseUrl, "tools/call", { name: "find_disposal_spots", arguments: {} }, requestId++);
    } catch (error) {
      invalidError = error;
    }
    assert(invalidError && String(invalidError.message).includes("법정동"), "dong 누락은 복구 안내가 붙은 -32602여야 한다");

    // 공백만 온 dong도 스키마가 끊는다 — 통과하면 빈 addr로 업스트림 한도를 쓰고
    // "## 서울 노원구  근처"처럼 빈 이름이 찍힌다.
    const upstreamCallsBefore = upstream.requests.length;
    let blankError;
    try {
      await jsonOnlyMcpRequest(baseUrl, "tools/call", { name: "find_disposal_spots", arguments: { dong: "   " } }, requestId++);
    } catch (error) {
      blankError = error;
    }
    assert(blankError && String(blankError.message).includes("법정동"), "공백 dong은 복구 안내가 붙은 -32602여야 한다");
    assert(upstream.requests.length === upstreamCallsBefore, "공백 dong이 업스트림 호출을 쓰면 안 된다");

    // ⑥ 로그 — 세 status와 upstream 낱말이 실제로 찍히는지. 실패를 세는 유일한 자리다.
    const logExpectations = [
      { args: { dong: "상계동", region: "서울 노원구" }, status: "spots", upstream: "ok" },
      { args: { dong: "느린동" }, status: "spots_fallback", upstream: "timeout" },
      { args: { dong: "빈동" }, status: "spots_fallback", upstream: "empty" },
      { args: { dong: "서교동" }, status: "spots_ask", upstream: "ok" },
      { args: { dong: "절단동", region: "서울 강남구" }, status: "spots", upstream: "truncated" },
    ];
    for (const { args, status, upstream: upstreamStatus } of logExpectations) {
      await awaitLoggedCall({
        getOutput,
        tool: "find_disposal_spots",
        seen: (entry) => entry.status === status && entry.upstream === upstreamStatus && typeof entry.upstreamMs === "number",
        call: () => call(args),
        what: `status=${status}, upstream=${upstreamStatus}`,
      });
    }

    // 동 이름은 기본 로그에 남지 않는다 — 사용자가 사는 곳이라 다른 인자와 같은 규칙이다.
    assert(!getOutput().includes("상계동"), "기본 설정에서는 로그에 동 이름이 남지 않아야 한다");
    // 키는 로그에도 남지 않는다.
    assert(!getOutput().includes(SPOT_DUMMY_KEY), "로그에 서비스 키가 남았다");
  } finally {
    stopServer();
  }

  // 인코딩 키(`%`가 든 쪽)는 그대로 실려야 한다. 두 번 인코딩하면 인증이 깨진다.
  const encodedPort = await getFreePort();
  const encodedRun = startServer(encodedPort, {
    serviceKey: SPOT_DUMMY_ENCODED_KEY,
    upstreamBaseUrl: upstream.baseUrl,
    // 이 서버만 캐시를 켠다 — 같은 동 재질의가 업스트림으로 다시 나가지 않는지를 여기서 잰다.
    spotCacheTtlMs: "300000",
  });
  const stopEncoded = () => {
    if (!encodedRun.server.killed) encodedRun.server.kill("SIGTERM");
  };
  process.once("exit", stopEncoded);

  try {
    const encodedBaseUrl = `http://${HOST}:${encodedPort}`;
    await waitForHealth(encodedBaseUrl, encodedRun.getOutput);
    const cacheMiss = await callTool(encodedBaseUrl, "find_disposal_spots", { dong: "상계동", region: "서울 노원구" }, 1);
    const encodedRequest = upstream.requests.at(-1);
    assert(
      encodedRequest.rawQuery.includes(`serviceKey=${SPOT_DUMMY_ENCODED_KEY}`),
      "인코딩 키는 그대로 보내야 한다 — 두 번 인코딩되면 증상이 100% 폴백이라 가장 늦게 발견된다",
    );

    // 동 이름 캐시. 개발계정 일 한도 소진이 곧 툴의 수명이라, 같은 동 재질의가 TTL 안에
    // 업스트림으로 다시 나가면 안 된다 — 응답은 첫 조회와 같아야 한다.
    const callsBeforeCacheHit = upstream.requests.length;
    const cacheHit = await callTool(encodedBaseUrl, "find_disposal_spots", { dong: "상계동", region: "서울 노원구" }, 2);
    assert(
      upstream.requests.length === callsBeforeCacheHit,
      `같은 동 재질의가 업스트림으로 다시 나갔다 — 캐시가 동작하지 않는다 (${callsBeforeCacheHit} → ${upstream.requests.length})`,
    );
    assert(
      resultText(cacheHit) === resultText(cacheMiss),
      "캐시 적중 응답이 첫 조회와 다르다",
    );
  } finally {
    stopEncoded();
    await upstream.close();
  }

  console.log(`find_disposal_spots smoke test passed (${upstream.requests.length} upstream calls, all mocked)`);
}

await runSmoke();
await runItemCardLabelSweep();
await runWidgetBuilderCases();
await runWidgetSmoke();
await runSpotSmoke();
