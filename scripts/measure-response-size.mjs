/**
 * 응답 크기 측정 — PRD phase-10 R0.
 *
 * `get_disposal_steps`(와 비교용 `classify_waste_item`) 응답이 두 렌더링 모드
 * (`WIDGET_ENABLED` true/false)에서 몇 바이트인지 고정 케이스로 찍는다.
 * PRD·백로그에 적는 크기 숫자는 전부 이 표에서 옮긴다 — 손으로 잰 값과 섞이면
 * 같은 자리에 "5.7KB"와 "6.2KB"가 공존한다(post-finals-backlog 1번이 그랬다).
 *
 * 서버 기동·호출은 `smoke-mcp.mjs`와 같은 방식이다(dist/server.js를 자식 프로세스로
 * 띄우고 /mcp에 SSE로 tools/call). 그쪽 헬퍼는 export하지 않아 여기 최소한만 옮겨
 * 적었다. 먼저 `pnpm build`가 필요하다 — `pnpm measure:size`가 그걸 묶는다.
 *
 * 측정 단위는 전부 UTF-8 바이트다. "합계"는 tools/call의 `result` 객체를
 * JSON.stringify한 길이로, 호스트가 실제로 받는 payload에 가장 가깝다.
 *
 *   pnpm measure:size            # 표 출력
 *   pnpm measure:size --json     # 기계가 읽는 JSON (스모크 상한 갱신 때 참고)
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 15_000;

// 고정 케이스. 순서와 인자를 바꾸면 이전 표와 비교가 안 되니 새 케이스는 뒤에 붙인다.
export const MEASURE_CASES = [
  { label: "노원구 매트리스", tool: "get_disposal_steps", args: { itemName: "매트리스", region: "서울 노원구" } },
  { label: "마포구 의자", tool: "get_disposal_steps", args: { itemName: "의자", region: "서울 마포구" } },
  { label: "강남구 기름 묻은 피자박스", tool: "get_disposal_steps", args: { itemName: "기름 묻은 피자박스", region: "서울 강남구" } },
  { label: "강남구 매트리스", tool: "get_disposal_steps", args: { itemName: "매트리스", region: "서울 강남구" } },
  { label: "부산 해운대구 소파", tool: "get_disposal_steps", args: { itemName: "소파", region: "부산 해운대구" } },
  { label: "지역 없음 매트리스", tool: "get_disposal_steps", args: { itemName: "매트리스" } },
  { label: "classify 노원구 매트리스", tool: "classify_waste_item", args: { itemName: "매트리스", region: "서울 노원구" } },
  // #69로 수수료가 생긴 광역 자치구. 자치구가 늘 때 크기가 어떻게 따라 오는지 본다.
  { label: "광주 북구 매트리스", tool: "get_disposal_steps", args: { itemName: "매트리스", region: "광주 북구" } },
  { label: "대구 달서구 소파", tool: "get_disposal_steps", args: { itemName: "소파", region: "대구 달서구" } },
  // PRD phase-11. 이 툴은 위젯 경로가 없어 두 모드가 같은 응답을 낸다 — 표에 두 줄로 찍히지만
  // 값이 같은 게 정상이다. 지역 툴이 응답 중 가장 크다는 걸 표에서 바로 보이게 넣는다.
  { label: "지역 노원구 매트리스", tool: "get_region_disposal_info", args: { region: "서울 노원구", itemName: "매트리스" } },
  { label: "지역 마포구 의자", tool: "get_region_disposal_info", args: { region: "서울 마포구", itemName: "의자" } },
  { label: "지역 광주 북구 매트리스", tool: "get_region_disposal_info", args: { region: "광주 북구", itemName: "매트리스" } },
  { label: "지역 강남구 (품목 없음)", tool: "get_region_disposal_info", args: { region: "서울 강남구" } },
];

function bytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function startServer(port, { widgets }) {
  const server = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      WIDGET_ENABLED: widgets ? "true" : "false",
      CALL_LOG_DETAILS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk.toString()));
  server.stderr.on("data", (chunk) => (output += chunk.toString()));
  return { server, getOutput: () => output };
}

async function waitForHealth(baseUrl, getOutput) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
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
  for (const dataLine of dataLines) {
    const message = JSON.parse(dataLine);
    if (message.error) throw new Error(`MCP error: ${JSON.stringify(message.error)}`);
    if (message.result) return message.result;
  }
  throw new Error(`MCP response did not contain a result:\n${body}`);
}

async function callTool(baseUrl, name, args, id) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`tools/call ${name} returned HTTP ${response.status}:\n${body}`);
  return parseSseJson(body);
}

/**
 * 텍스트 응답을 `## `·`### ` 제목 단위로 잘라 섹션별 바이트를 센다. 제목 앞 본문
 * (사진 확인 문구 등)은 `(머리)`로 묶는다. 위젯 모드의 content는 카드 JSON이라
 * 섹션이 없다 — 그때는 빈 객체다.
 */
export function textSectionBytes(text) {
  const sections = {};
  let current = "(머리)";
  for (const line of text.split("\n")) {
    const heading = /^#{2,3} (.+)$/.exec(line);
    if (heading) {
      // 같은 제목이 두 번 나오면 뒤엣것이 앞엣것을 지우던 자리다. 섹션 바이트는
      // 제목별 합계라야 하므로 리셋하지 않고 이어서 더한다.
      current = heading[1];
      sections[current] ??= 0;
    }
    sections[current] = (sections[current] ?? 0) + bytes(line) + 1;
  }
  return sections;
}

export function measureResult(result, { widgets }) {
  const text = result.content?.find((entry) => entry.type === "text")?.text ?? "";
  const structured = result.structuredContent ?? {};
  const regionNotes = structured.regionNotes;
  return {
    total: bytes(result),
    content: bytes(text),
    structuredContent: bytes(structured),
    regionNotes: regionNotes ? bytes(regionNotes) : 0,
    sections: widgets ? {} : textSectionBytes(text),
  };
}

/**
 * 한 모드의 서버를 띄워 고정 케이스를 전부 호출한다. 스모크가 상한 단언에 같은
 * 숫자를 쓰려면 여기 말고 `measureResult`를 쓰면 된다 — 서버는 그쪽이 이미 띄워 두니까.
 */
export async function measureMode({ widgets, cases = MEASURE_CASES }) {
  const port = await getFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const { server, getOutput } = startServer(port, { widgets });
  const stop = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.once("exit", stop);
  try {
    await waitForHealth(baseUrl, getOutput);
    const rows = [];
    let id = 1;
    for (const testCase of cases) {
      const result = await callTool(baseUrl, testCase.tool, testCase.args, id++);
      rows.push({ mode: widgets ? "widget" : "text", ...testCase, ...measureResult(result, { widgets }) });
    }
    return rows;
  } finally {
    stop();
  }
}

function pad(value, width, align = "right") {
  const text = String(value);
  // 한글은 터미널에서 두 칸을 차지한다. 표가 맞아 보이게만 대충 맞춘다.
  const displayWidth = [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  const fill = " ".repeat(Math.max(0, width - displayWidth));
  return align === "left" ? text + fill : fill + text;
}

function printTable(rows) {
  const header = ["모드", "툴", "케이스", "합계 B", "content B", "structured B", "regionNotes B"];
  const widths = [7, 20, 28, 8, 10, 13, 14];
  console.log(header.map((cell, index) => pad(cell, widths[index], index < 3 ? "left" : "right")).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(
      [row.mode, row.tool, row.label, row.total, row.content, row.structuredContent, row.regionNotes]
        .map((cell, index) => pad(cell, widths[index], index < 3 ? "left" : "right"))
        .join("  "),
    );
  }
}

function printSections(rows) {
  // 섹션 분해는 `##`·`###` 제목을 쓰는 `get_disposal_steps`에만 한다. 지역 툴은 블록 제목이
  // 맨 줄이라(`확인할 정보`) 같은 규칙으로 못 자른다 — 그쪽은 합계만 보고, 블록별 내역이
  // 필요하면 PRD phase-11의 표처럼 그때 따로 잰다.
  console.log("\n텍스트 모드 섹션별 바이트 (get_disposal_steps):");
  for (const row of rows) {
    if (row.mode !== "text" || row.tool !== "get_disposal_steps") continue;
    const parts = Object.entries(row.sections).map(([name, size]) => `${name} ${size}`);
    console.log(`- ${row.label}: ${parts.join(" · ")}`);
  }
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (isMain) {
  const asJson = process.argv.includes("--json");
  const textRows = await measureMode({ widgets: false });
  const widgetRows = await measureMode({ widgets: true });
  const rows = [...textRows, ...widgetRows];
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printTable(rows);
    printSections(rows);
  }
}
