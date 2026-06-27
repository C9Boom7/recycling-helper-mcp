import type { Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  confidenceLabel,
  disposalGroupLabel,
  findBestWasteItem,
  findWasteItems,
  formatItemGuide,
  wasteItems,
} from "./data.js";

const SERVICE_NAME = "RecyclingHelper(재활용척척)";
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEFAULT_ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "recyling-helper-mcp.playmcp-endpoint.kakaocloud.io",
  "recycling-helper-mcp.playmcp-endpoint.kakaocloud.io",
];
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(","))
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

type ToolResult = Record<string, unknown>;

function textResult(text: string, structuredContent?: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function unknownItemResult(itemName: string): CallToolResult {
  const candidates = findWasteItems(itemName, 3).map((match) => match.item.name);
  const candidateText = candidates.length > 0 ? `\n\n비슷한 후보: ${candidates.join(", ")}` : "";

  return textResult(
    [
      `입력한 품목 "${itemName}"을(를) 초기 데이터에서 확실히 찾지 못했습니다.`,
      "품목의 재질, 오염 여부, 크기, 지역 정보를 함께 알려주면 더 정확히 판단할 수 있습니다.",
      candidateText,
    ]
      .filter(Boolean)
      .join("\n"),
    {
      found: false,
      itemName,
      candidates,
    },
  );
}

function registerTools(server: McpServer): void {
  server.registerTool(
    "classify_waste_item",
    {
      title: "Classify Waste Item",
      description:
        "Classifies a household waste item with RecyclingHelper(재활용척척), returning the likely disposal category, confidence, and whether local rules should be checked.",
      inputSchema: {
        itemName: z.string().min(1).max(80).describe("Household waste item name or short description in Korean."),
        region: z.string().max(80).optional().describe("Optional Korean city, district, or neighborhood."),
      },
      annotations: {
        title: "Classify Waste Item",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ itemName, region }): Promise<CallToolResult> => {
      const match = findBestWasteItem(itemName);
      if (!match) return unknownItemResult(itemName);

      const { item } = match;
      const text = [
        `분류 결과: ${item.name}`,
        `- 배출 그룹: ${disposalGroupLabel(item.disposalType)}`,
        `- 세부 판단: ${item.disposalType}`,
        `- 결론: ${item.summary}`,
        `- 확신도: ${confidenceLabel(item.confidence)}`,
        `- 지역 확인 필요: ${item.needsRegionCheck ? "예" : "아니오"}`,
        region && item.needsRegionCheck ? `- 입력 지역: ${region}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      return textResult(text, {
        found: true,
        matchedItem: item.name,
        matchedBy: match.matchedBy,
        score: match.score,
        disposalGroup: disposalGroupLabel(item.disposalType),
        disposalType: item.disposalType,
        confidence: item.confidence,
        needsRegionCheck: item.needsRegionCheck,
        region,
        sourceRefs: item.sourceRefs,
      });
    },
  );

  server.registerTool(
    "get_disposal_steps",
    {
      title: "Get Disposal Steps",
      description:
        "Returns practical step-by-step disposal instructions from RecyclingHelper(재활용척척), including cautions and source references for a household waste item.",
      inputSchema: {
        itemName: z.string().min(1).max(80).describe("Household waste item name or short description in Korean."),
        region: z.string().max(80).optional().describe("Optional Korean city, district, or neighborhood."),
      },
      annotations: {
        title: "Get Disposal Steps",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ itemName, region }): Promise<CallToolResult> => {
      const match = findBestWasteItem(itemName);
      if (!match) return unknownItemResult(itemName);

      const text = formatItemGuide(match.item, region);
      return textResult(text, {
        found: true,
        item: match.item,
        matchedBy: match.matchedBy,
        score: match.score,
        region,
      });
    },
  );

  server.registerTool(
    "check_confusing_item",
    {
      title: "Check Confusing Item",
      description:
        "Checks if a household waste item is commonly confused and explains the exception with RecyclingHelper(재활용척척).",
      inputSchema: {
        itemName: z.string().min(1).max(80).describe("Confusing household waste item name or situation in Korean."),
      },
      annotations: {
        title: "Check Confusing Item",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ itemName }): Promise<CallToolResult> => {
      const matches = findWasteItems(itemName, 3);
      if (matches.length === 0) return unknownItemResult(itemName);

      const lines = [
        `헷갈림 체크: "${itemName}"`,
        "",
        ...matches.flatMap((match, index) => [
          `${index + 1}. ${match.item.name}`,
          `   - 결론: ${match.item.summary}`,
          `   - 주의: ${match.item.cautions[0] ?? "지역별 기준을 확인하세요."}`,
          `   - 확신도: ${confidenceLabel(match.item.confidence)}`,
        ]),
      ];

      return textResult(lines.join("\n"), {
        found: true,
        matches: matches.map((match) => ({
          itemName: match.item.name,
          matchedBy: match.matchedBy,
          score: match.score,
          summary: match.item.summary,
          cautions: match.item.cautions,
          confidence: match.item.confidence,
          needsRegionCheck: match.item.needsRegionCheck,
        })),
      });
    },
  );

  server.registerTool(
    "make_cleanup_plan",
    {
      title: "Make Cleanup Plan",
      description:
        "Groups multiple household waste items into disposal buckets with RecyclingHelper(재활용척척), useful for moving, cleaning, or decluttering.",
      inputSchema: {
        items: z.array(z.string().min(1).max(80)).min(1).max(30).describe("List of household waste item names in Korean."),
        region: z.string().max(80).optional().describe("Optional Korean city, district, or neighborhood."),
      },
      annotations: {
        title: "Make Cleanup Plan",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ items, region }): Promise<CallToolResult> => {
      const planned = items.map((rawName) => {
        const match = findBestWasteItem(rawName);
        if (!match) {
          return {
            input: rawName,
            found: false as const,
            group: "확인 필요",
            summary: "초기 데이터에서 확실히 찾지 못했습니다.",
          };
        }

        return {
          input: rawName,
          found: true as const,
          itemName: match.item.name,
          matchedBy: match.matchedBy,
          score: match.score,
          group: disposalGroupLabel(match.item.disposalType),
          summary: match.item.summary,
          needsRegionCheck: match.item.needsRegionCheck,
        };
      });

      const groups = new Map<string, typeof planned>();
      for (const entry of planned) {
        const existing = groups.get(entry.group) ?? [];
        existing.push(entry);
        groups.set(entry.group, existing);
      }

      const lines = [
        "대청소 배출 계획",
        region ? `지역: ${region}` : undefined,
        "",
        ...Array.from(groups.entries()).flatMap(([group, entries]) => [
          `## ${group}`,
          ...entries.map((entry) => {
            const label = entry.found ? `${entry.input} -> ${entry.itemName}` : entry.input;
            return `- ${label}: ${entry.summary}`;
          }),
          "",
        ]),
        "지역 확인 필요 품목은 배출 요일, 수거함 위치, 대형폐기물 신고 수수료가 지역마다 다를 수 있습니다.",
      ].filter(Boolean);

      return textResult(lines.join("\n"), {
        region,
        items: planned,
        groups: Object.fromEntries(groups),
      });
    },
  );

  server.registerTool(
    "get_region_disposal_info",
    {
      title: "Get Region Disposal Info",
      description:
        "Explains what local disposal information should be checked for a Korean region using RecyclingHelper(재활용척척), with official regional data sources to verify.",
      inputSchema: {
        region: z.string().min(1).max(80).describe("Korean city, district, or neighborhood."),
        itemName: z.string().max(80).optional().describe("Optional household waste item name in Korean."),
      },
      annotations: {
        title: "Get Region Disposal Info",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ region, itemName }): Promise<CallToolResult> => {
      const match = itemName ? findBestWasteItem(itemName) : undefined;
      const checkList = [
        "재활용품 배출 요일과 시간",
        "품목별 전용 수거함 위치",
        "대형폐기물 신고 페이지와 수수료",
        "폐건전지, 폐형광등, 폐의약품 등 생활계 유해폐기물 수거 장소",
        "아파트, 단독주택, 상가 등 주택 유형별 배출 방식",
      ];

      const lines = [
        `${region} 지역 확인 안내`,
        "",
        match ? `품목: ${match.item.name}` : "품목을 함께 입력하면 확인해야 할 항목을 더 좁혀드릴 수 있습니다.",
        match ? `기본 판단: ${match.item.summary}` : undefined,
        "",
        "확인할 정보",
        ...checkList.map((item, index) => `${index + 1}. ${item}`),
        "",
        "공식 확인처",
        "- 생활폐기물 분리배출 누리집: https://www.분리배출.kr/front/region/region.do",
        "- 거주 지자체 청소/자원순환/환경 부서 안내 페이지",
        "- 대형폐기물은 지자체 대형폐기물 신고 페이지",
      ].filter(Boolean);

      return textResult(lines.join("\n"), {
        region,
        item: match?.item.name,
        defaultSummary: match?.item.summary,
        officialSources: [
          "https://www.분리배출.kr/front/region/region.do",
          "거주 지자체 청소/자원순환/환경 부서 안내 페이지",
        ],
        checkList,
      });
    },
  );
}

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "recycling-helper",
      version: "0.1.0",
    },
    {
      instructions:
        "Use RecyclingHelper(재활용척척) tools to answer Korean household waste disposal questions. Prefer concise, source-aware answers. If local rules may differ, say that regional verification is needed.",
    },
  );

  registerTools(server);
  return server;
}

const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: ALLOWED_HOSTS,
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: SERVICE_NAME,
    items: wasteItems.length,
  });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This stateless MCP server accepts POST requests at /mcp.",
    },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This MCP server is stateless.",
    },
    id: null,
  });
});

app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  console.log(`${SERVICE_NAME} MCP server listening at http://${HOST}:${PORT}`);
});
