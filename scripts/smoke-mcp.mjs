import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const HOST = "127.0.0.1";
const PLAYMCP_ENDPOINT_HOST = "recycle-helper-mcp.playmcp-endpoint.kakaocloud.io";
const PLAYMCP_ORIGIN = "https://playmcp.kakaocloud.io";
const STARTUP_TIMEOUT_MS = 15_000;
const answerCasesPath = new URL("../dist/data/mcp-answer-cases.json", import.meta.url);
const wasteItemsPath = new URL("../dist/data/waste-items.json", import.meta.url);
const answerCases = JSON.parse(readFileSync(answerCasesPath, "utf8"));
const wasteItems = JSON.parse(readFileSync(wasteItemsPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

async function mcpCorsPreflight(baseUrl) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: PLAYMCP_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,accept",
      Host: PLAYMCP_ENDPOINT_HOST,
    },
  });

  const body = await response.text();
  assert(response.status === 204, `MCP CORS preflight returned HTTP ${response.status}:\n${body}`);
  assert(
    response.headers.get("access-control-allow-origin") === PLAYMCP_ORIGIN,
    "MCP CORS preflight did not allow the PlayMCP origin",
  );
  assert(
    response.headers.get("access-control-allow-methods")?.includes("POST"),
    "MCP CORS preflight did not allow POST",
  );
  assert(
    response.headers.get("access-control-allow-headers")?.includes("content-type"),
    "MCP CORS preflight did not allow content-type",
  );
}

async function jsonOnlyMcpCorsRequest(baseUrl, method, params, id) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: PLAYMCP_ORIGIN,
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
    response.headers.get("access-control-allow-origin") === PLAYMCP_ORIGIN,
    "CORS JSON-only MCP response did not allow the PlayMCP origin",
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

function resultText(result) {
  return result.content?.find((entry) => entry.type === "text")?.text ?? "";
}

function structuredContentText(result) {
  return JSON.stringify(result.structuredContent ?? {});
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

    const toolsList = await mcpRequest(baseUrl, "tools/list", {}, 1);
    const toolNames = toolsList.tools.map((tool) => tool.name).sort();
    assert(toolNames.length === 5, `Expected 5 tools, got ${toolNames.length}`);
    for (const toolName of [
      "check_confusing_item",
      "classify_waste_item",
      "get_disposal_steps",
      "get_region_disposal_info",
      "make_cleanup_plan",
    ]) {
      assert(toolNames.includes(toolName), `Missing tool ${toolName}`);
    }

    const playMcpToolsList = await mcpRequest(baseUrl, "tools/list", {}, 2, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    const playMcpToolNames = playMcpToolsList.tools.map((tool) => tool.name).sort();
    assert(
      playMcpToolNames.length === 5,
      `Expected 5 tools with PlayMCP endpoint host, got ${playMcpToolNames.length}`,
    );
    assert(
      playMcpToolNames.join(",") === toolNames.join(","),
      "PlayMCP endpoint host returned a different tool list",
    );

    const jsonOnlyToolsList = await jsonOnlyMcpRequest(baseUrl, "tools/list", {}, 3, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    const jsonOnlyToolNames = jsonOnlyToolsList.tools.map((tool) => tool.name).sort();
    assert(
      jsonOnlyToolNames.join(",") === toolNames.join(","),
      "JSON-only discovery returned a different tool list",
    );

    const getDiscovery = await mcpGetDiscovery(baseUrl, {
      Host: PLAYMCP_ENDPOINT_HOST,
    });
    const getDiscoveryToolNames = getDiscovery.tools.map((tool) => tool.name).sort();
    assert(
      getDiscoveryToolNames.join(",") === toolNames.join(","),
      "GET discovery returned a different tool list",
    );

    await mcpCorsPreflight(baseUrl);

    const corsToolsList = await jsonOnlyMcpCorsRequest(baseUrl, "tools/list", {}, 4);
    const corsToolNames = corsToolsList.tools.map((tool) => tool.name).sort();
    assert(corsToolNames.join(",") === toolNames.join(","), "CORS discovery returned a different tool list");

    let requestId = 5;
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
