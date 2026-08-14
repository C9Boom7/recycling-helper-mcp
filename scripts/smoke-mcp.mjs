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
    "review",
    "region",
    "regionCheckLevel",
    "regionNotes",
    "sources",
  ],
  check_confusing_item: ["found", "matches"],
  make_cleanup_plan: ["region", "items"],
  get_region_disposal_info: [
    "region",
    "matchedRegion",
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
    keys: ["input", "found", "group", "itemName", "summary", "regionCheckLevel", "candidates"],
  },
};
const answerCasesPath = new URL("../dist/data/mcp-answer-cases.json", import.meta.url);
const wasteItemsPath = new URL("../dist/data/waste-items.json", import.meta.url);
const answerCases = JSON.parse(readFileSync(answerCasesPath, "utf8"));
const wasteItems = JSON.parse(readFileSync(wasteItemsPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
      // answer cases assert on human-readable text and structuredContent, which
      // a widget response replaces — so the suite must not depend on whatever
      // WIDGET_ENABLED happens to be set to in the caller's shell.
      WIDGET_ENABLED: widgets ? "true" : "false",
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
    requestId += 1;

    console.log(`MCP smoke test passed at ${baseUrl} (${answerCases.length} answer cases)`);
  } finally {
    stopServer();
  }
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
  assert(!nationwideCard.includes("기준으로 배출 요일"), "nationally uniform item should carry no region line");

  // R2-1: only a *required* region check earns the ask. Advisory-level items —
  // 42 of the 130 — read as complete without one, and formatItemGuide adds no
  // region section for them either.
  const advisoryCard = card({ item: advisory });
  assert(!advisoryCard.includes("거주 지역 기준 확인 필요"), "advisory-level item should not demand a region");
  assert(card({ item: advisory, regionName: "서울 강남구" }).includes("서울 강남구 기준으로 배출 요일"), "advisory item with a matched region should name it");

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
  assert(withoutNotes.includes("서울 강남구 기준으로 배출 요일"), "matched region without guidance should still name the region");

  const withoutRegion = card({ item: regional });
  assert(withoutRegion.includes("거주 지역 기준 확인 필요"), "region-sensitive item without a region should ask for one");

  // R2: safety wording outranks authoring order, or the cap can drop the one
  // caution that keeps a 수거 작업자 from getting cut.
  const sharp = items.find((item) => item.id === "chopsticks");
  assert(sharp, "widget builder cases are missing their 주의 fixture");
  assert(card({ item: sharp }).includes("다치지 않게"), "safety caution should outrank informational ones");

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
}

/**
 * Every item through the widget path once. The 183 get_disposal_steps answer
 * cases are pinned to WIDGET_ENABLED=false, so on their own they would only
 * cover a shape production never serves (R1 leaves widgets on by default) —
 * this keeps the whole catalogue on the real path. Structure only, no wording:
 * the answer cases already own what the text says.
 */
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

    // A display name can still resolve as ambiguous; that path stays text by design.
    if (result.structuredContent !== undefined) {
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

  const skipNote = skipped.length > 0 ? ` (skipped as non-match: ${skipped.join(", ")})` : "";
  console.log(`Widget catalogue sweep: ${validated}/${wasteItems.length} cards validated${skipNote}`);
}

/**
 * PRD phase-3 R4-1. Widget responses replace both the text body and
 * structuredContent that the 211 answer cases assert on, so they run against
 * their own server instance with WIDGET_ENABLED on.
 */
async function runWidgetSmoke() {
  const port = await getFreePort();
  const baseUrl = `http://${HOST}:${port}`;
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
    assert(match.structuredContent === undefined, "widget response must not carry structuredContent");
    assert(
      JSON.stringify(payload.widget).includes("깨끗한 부분과 오염된 부분을 분리합니다."),
      "widget card is missing the disposal steps",
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
    const regionlessCard = JSON.stringify(parseWidgetPayload(regionless, "regionless match").widget);
    assert(regionlessCard.includes("거주 지역 기준 확인 필요"), "region-sensitive item without a region should ask for one");

    // PRD phase-3 R5: a widget response has no structuredContent for callStatus()
    // to read, so the handler must log status explicitly or every confirmed
    // match would land in the logs as a plain "ok".
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

    await sweepWidgetCatalogue(baseUrl, requestId + 1);

    console.log(`Widget smoke passed at ${baseUrl} (WIDGET_ENABLED=true)`);
  } finally {
    stopServer();
  }
}

await runSmoke();
await runWidgetBuilderCases();
await runWidgetSmoke();
