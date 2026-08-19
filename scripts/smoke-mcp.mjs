import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";

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

function startServer(port, { widgets = false } = {}) {
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

function assertToolMetadata(tool, context) {
  assert(typeof tool.name === "string" && tool.name.length > 0, `${context} tool was missing name`);
  assert(EXPECTED_TOOL_NAMES.includes(tool.name), `${context} returned unexpected tool ${tool.name}`);
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

function assertToolList(toolList, context) {
  assert(Array.isArray(toolList.tools), `${context} tools/list result did not include tools array`);
  const toolNames = toolList.tools.map((tool) => tool.name).sort();
  assert(toolNames.length === EXPECTED_TOOL_NAMES.length, `${context} expected ${EXPECTED_TOOL_NAMES.length} tools, got ${toolNames.length}`);
  assert(toolNames.join(",") === EXPECTED_TOOL_NAMES.join(","), `${context} returned a different tool list`);
  for (const tool of toolList.tools) {
    assertToolMetadata(tool, context);
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
    // 나가던 시기가 있어, 자연어 안내가 앞에 서고 원문이 상세로 남는지 고정한다.
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
    assert(
      invalidArgs.error.message.includes("상세:"),
      `-32602 message dropped the Zod detail that debugging reads: ${invalidArgs.error.message}`,
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
    for (const policy of regionPolicies) {
      const dayResult = await callTool(baseUrl, "get_region_disposal_info", { region: policy.name }, requestId++);
      assert(
        dayResult.structuredContent?.matchedRegion === policy.name,
        `${policy.name}: 이 이름이 자기 지역으로 안 잡힌다 (matchedRegion=${dayResult.structuredContent?.matchedRegion}) — 아래 요일 단언이 다른 지역 답을 보고 통과한다`,
      );
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
    }

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

await runSmoke();
await runWidgetBuilderCases();
await runWidgetSmoke();
