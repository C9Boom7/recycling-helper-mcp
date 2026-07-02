import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_LOG_PATH = "logs/manual-queries.jsonl";

function printHelp() {
  console.log(`Usage:
  pnpm log:query -- --query "요가매트는 어떻게 버려?" [--region "서울 강남구"]

Options:
  --query <text>       User question to append. Required.
  --region <region>    Optional region, e.g. "서울 강남구".
  --source <label>     Source label. Default: manual-test.
  --tool <name>        MCP tool used during the test, if known.
  --answer <label>     Short result label, e.g. "unknown", "bad_match", "unclear".
  --note <text>        Optional note. Can be repeated.
  --file <path>        Output JSONL path. Default: ${DEFAULT_LOG_PATH}.
  --help               Show this help.

The output file is intended for:
  pnpm backlog:auto -- --input logs/manual-queries.jsonl --region "서울 강남구"`);
}

function parseArgs(argv) {
  const args = { note: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;

    if (!token.startsWith("--")) {
      if (!args.query) args.query = token;
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;

    if (key === "help") {
      args.help = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === "note") {
      args.note.push(value);
    } else {
      args[key] = value;
    }
  }

  return args;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!isNonEmptyString(args.query)) {
    printHelp();
    throw new Error("Missing required --query");
  }

  const logPath = args.file ?? DEFAULT_LOG_PATH;
  const resolvedPath = path.resolve(process.cwd(), logPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const entry = {
    createdAt: new Date().toISOString(),
    query: args.query.trim(),
    ...(isNonEmptyString(args.region) ? { region: args.region.trim() } : {}),
    source: isNonEmptyString(args.source) ? args.source.trim() : "manual-test",
    ...(isNonEmptyString(args.tool) ? { tool: args.tool.trim() } : {}),
    ...(isNonEmptyString(args.answer) ? { answer: args.answer.trim() } : {}),
    ...(args.note.length > 0 ? { notes: args.note.map((note) => note.trim()).filter(Boolean) } : {}),
  };

  appendFileSync(resolvedPath, `${JSON.stringify(entry)}\n`);
  console.log(`Logged query to ${path.relative(process.cwd(), resolvedPath)}`);
  console.log(`- ${entry.query}${entry.region ? ` (${entry.region})` : ""}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
