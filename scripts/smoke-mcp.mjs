import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const HOST = "127.0.0.1";
const PLAYMCP_ENDPOINT_HOST = "recycle-helper-mcp.playmcp-endpoint.kakaocloud.io";
const PLAYMCP_ORIGINS = ["https://playmcp.kakaocloud.io", "https://playmcp.kakao.com"];
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

function startServer(port) {
  const server = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
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
      Host: PLAYMCP_ENDPOINT_HOST,
    },
  });

  const body = await response.text();
  assert(response.status === 204, `MCP CORS preflight returned HTTP ${response.status}:\n${body}`);
  assert(
    response.headers.get("access-control-allow-origin") === origin,
    `MCP CORS preflight did not allow the PlayMCP origin ${origin}`,
  );
  assert(
    response.headers.get("access-control-allow-methods")?.includes("POST"),
    "MCP CORS preflight did not allow POST",
  );
  const allowedHeaders = response.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
  for (const header of requestedHeaders) {
    assert(allowedHeaders.includes(header), `MCP CORS preflight did not allow ${header}`);
  }
}

async function jsonOnlyMcpCorsRequest(baseUrl, method, params, id, origin) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
      Host: PLAYMCP_ENDPOINT_HOST,
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
  assert(
    response.headers.get("access-control-allow-origin") === origin,
    `CORS JSON-only MCP response did not allow the PlayMCP origin ${origin}`,
  );

  const message = JSON.parse(body);
  if (message.error) {
    throw new Error(`CORS JSON-only MCP error: ${JSON.stringify(message.error)}`);
  }
  return message.result;
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

function assertRegionalPolicyExpectation(result, testCase) {
  const expectation = testCase.expectedRegionalPolicy;
  if (!expectation) return;

  const policy = result.structuredContent?.regionalPolicy;
  assert(policy && typeof policy === "object" && !Array.isArray(policy), `${testCase.id} structuredContent.regionalPolicy was missing`);

  if (expectation.level !== undefined) {
    assert(
      policy.regionCheckLevel === expectation.level,
      `${testCase.id} regionalPolicy.regionCheckLevel expected "${expectation.level}", got "${policy.regionCheckLevel}"`,
    );
  }

  if (expectation.shape === "minimal") {
    for (const field of ["summary", "recycling", "itemGuide", "sources", "bulkyWasteFees"]) {
      assert(policy[field] === undefined, `${testCase.id} regionalPolicy.${field} should be omitted for minimal regional policy`);
    }
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

  assertRegionalPolicyExpectation(result, testCase);

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
      {
        Host: PLAYMCP_ENDPOINT_HOST,
      },
    );
    assertInitializeResult(initialize, "JSON-only initialize");

    const ping = await jsonOnlyMcpRequest(baseUrl, "ping", {}, 2, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    assert(isPlainObject(ping), "JSON-only ping result must be an object");

    await jsonOnlyMcpNotification(
      baseUrl,
      "notifications/initialized",
      {},
      {
        Host: PLAYMCP_ENDPOINT_HOST,
      },
    );

    const toolsList = await mcpRequest(baseUrl, "tools/list", {}, 3);
    assertToolList(toolsList, "SSE tools/list");

    const playMcpToolsList = await mcpRequest(baseUrl, "tools/list", {}, 4, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    assertToolList(playMcpToolsList, "PlayMCP endpoint SSE tools/list");

    const jsonOnlyToolsList = await jsonOnlyMcpRequest(baseUrl, "tools/list", {}, 5, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    assertToolList(jsonOnlyToolsList, "JSON-only tools/list");

    const getDiscovery = await mcpGetDiscovery(baseUrl, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    assertToolList(getDiscovery, "GET discovery");

    let requestId = 6;
    for (const origin of PLAYMCP_ORIGINS) {
      await mcpCorsPreflight(baseUrl, origin);

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

await runSmoke();
