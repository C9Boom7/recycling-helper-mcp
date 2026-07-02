import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const itemsPath = new URL("../src/data/waste-items.json", import.meta.url);
const backlogPath = new URL("../src/data/question-backlog.json", import.meta.url);
const items = JSON.parse(readFileSync(itemsPath, "utf8"));
const backlog = JSON.parse(readFileSync(backlogPath, "utf8"));

const DEFAULT_MIN_SCORE = 70;
const MATCH_FLOOR = 35;
const HIGH_RISK_KEYWORDS = [
  "수은",
  "배터리",
  "보조배터리",
  "건전지",
  "가스",
  "부탄",
  "스프레이",
  "살충",
  "농약",
  "페인트",
  "형광등",
  "소화기",
  "깨진",
  "파손",
  "누출",
  "칼",
  "날카",
  "면도",
  "주사",
  "의약품",
  "라이터",
  "폭발",
];
const QUESTION_BACKLOG_TYPES = new Set([
  "new_item_candidate",
  "synonym_gap",
  "answer_gap",
  "region_gap",
  "source_gap",
  "condition_gap",
]);
const FEEDBACK_TYPE_BY_ANSWER = new Map([
  ["bad_match", "synonym_gap"],
  ["wrong_match", "synonym_gap"],
  ["unknown", "new_item_candidate"],
  ["no_answer", "new_item_candidate"],
  ["missing_item", "new_item_candidate"],
  ["unclear", "answer_gap"],
  ["incomplete", "answer_gap"],
  ["wrong", "answer_gap"],
  ["missing_condition", "condition_gap"],
  ["condition_gap", "condition_gap"],
  ["missing_region", "region_gap"],
  ["region_gap", "region_gap"],
  ["needs_source", "source_gap"],
  ["source_gap", "source_gap"],
  ["ok_but_low_confidence", "source_gap"],
]);
const PASSING_ANSWER_LABELS = new Set(["ok", "pass", "passed", "expected", "good"]);

function printHelp() {
  console.log(`Usage:
  pnpm backlog:auto -- --query "요가매트는 어떻게 버려?" [--region "서울 강남구"]
  pnpm backlog:auto -- --input logs/manual-queries.jsonl --write

Options:
  --query <text>                 Add one query to analyze. Can be repeated.
  --input <path>                 Read .txt, .json, or .jsonl query logs.
  --region <region>              Default region for entries without a region.
  --min-score <number>           Backlog matches below this score. Default: ${DEFAULT_MIN_SCORE}.
  --include-medium-confidence    Also backlog medium-confidence matched items.
  --write                        Append candidates to src/data/question-backlog.json.
  --source <label>               Source label stored in notes. Default: auto-backlog.
  --limit <number>               Maximum number of new backlog items to create.
  --help                         Show this help.

Input formats:
  - .txt: one question per line
  - .jsonl: one JSON object or plain question per line
  - .json: array of strings, array of objects, or { "queries": [...] }

Object fields accepted:
  query, itemName, text, message, question, region, answer, tool, notes, backlogType`);
}

function parseArgs(argv) {
  const args = { query: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      args.query.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;

    if (key === "write" || key === "include-medium-confidence" || key === "help") {
      args[key] = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === "query") {
      args.query.push(value);
    } else {
      args[key] = value;
    }
  }

  return args;
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const SHORT_ALIAS_MAX_LENGTH = 2;
const SHORT_ALIAS_PARTICLE_SUFFIXES = ["으로", "은", "는", "이", "가", "을", "를", "에", "도", "만", "야", "요", "죠", "지", "로"];

function normalizedTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function stripShortAliasParticle(token) {
  for (const suffix of SHORT_ALIAS_PARTICLE_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

function hasStandaloneShortAliasMatch(queryTokens, normalizedName) {
  return queryTokens.some((token) => token === normalizedName || stripShortAliasParticle(token) === normalizedName);
}

function isLikelyDisposalTargetMention(query, normalizedQuery, normalizedName) {
  if (normalizedQuery.startsWith(normalizedName)) {
    return false;
  }

  const index = normalizedQuery.indexOf(normalizedName);
  if (index <= 0) {
    return false;
  }

  const before = normalizedQuery.slice(0, index);
  const after = normalizedQuery.slice(index + normalizedName.length);
  const hasTopicBefore = /[은는이가]$/u.test(before);
  const looksLikeTarget = after.startsWith("수거함") || after.startsWith("수거처") || after.startsWith("류") || after.startsWith("로") || after.startsWith("으로");

  return hasTopicBefore && looksLikeTarget && query.includes("?");
}

function normalizeLogEntry(value, fallbackRegion, source, index) {
  if (typeof value === "string") {
    return {
      query: value.trim(),
      region: fallbackRegion,
      source,
      sourceIndex: index,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const query = value.query ?? value.itemName ?? value.text ?? value.message ?? value.question;
  if (typeof query !== "string" || query.trim().length === 0) {
    return undefined;
  }
  const rawNotes = Array.isArray(value.notes) ? value.notes : value.note !== undefined ? [value.note] : [];
  const notes = rawNotes
    .filter((note) => typeof note === "string" && note.trim().length > 0)
    .map((note) => note.trim());
  const answer = typeof value.answer === "string" && value.answer.trim() ? value.answer.trim() : undefined;
  const tool = typeof value.tool === "string" && value.tool.trim() ? value.tool.trim() : undefined;
  const backlogType =
    typeof value.backlogType === "string" && QUESTION_BACKLOG_TYPES.has(value.backlogType.trim())
      ? value.backlogType.trim()
      : undefined;

  return {
    query: query.trim(),
    region: typeof value.region === "string" && value.region.trim() ? value.region.trim() : fallbackRegion,
    source: typeof value.source === "string" && value.source.trim() ? value.source.trim() : source,
    sourceIndex: index,
    ...(answer ? { answer } : {}),
    ...(tool ? { tool } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(backlogType ? { backlogType } : {}),
  };
}

function readInputFile(filePath, fallbackRegion, source) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Input file not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : parsed.queries ?? parsed.events ?? parsed.logs ?? [parsed];
    if (!Array.isArray(rows)) {
      throw new Error("JSON input must be an array, { queries: [...] }, { events: [...] }, or { logs: [...] }");
    }
    return rows
      .map((entry, index) => normalizeLogEntry(entry, fallbackRegion, source, index + 1))
      .filter(Boolean);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      if (extension === ".jsonl" && line.startsWith("{")) {
        return normalizeLogEntry(JSON.parse(line), fallbackRegion, source, index + 1);
      }
      return normalizeLogEntry(line, fallbackRegion, source, index + 1);
    })
    .filter(Boolean);
}

function scoreItem(query, item) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = normalizedTokens(query);
  const names = [item.name, ...(item.aliases ?? [])];
  let bestScore = 0;
  let matchedBy = item.name;

  for (const name of names) {
    const normalizedName = normalizeText(name);
    const isShortAlias = normalizedName.length <= SHORT_ALIAS_MAX_LENGTH;
    let score = 0;

    if (normalizedQuery === normalizedName) {
      score = 100;
    } else if (normalizedQuery.includes(normalizedName)) {
      if (isLikelyDisposalTargetMention(query, normalizedQuery, normalizedName)) {
        score = 20;
      } else if (isShortAlias) {
        score = hasStandaloneShortAliasMatch(queryTokens, normalizedName) ? 78 : 0;
      } else {
        const startsWithName = normalizedQuery.startsWith(normalizedName);
        const lengthBonus = Math.min(normalizedName.length, 5);
        score = Math.min(99, 88 + lengthBonus + (startsWithName ? 5 : 0));
      }
    } else if (normalizedName.includes(normalizedQuery)) {
      score = 82;
    } else {
      if (!isShortAlias) {
        const queryChars = Array.from(new Set(normalizedQuery.split("")));
        const nameChars = new Set(normalizedName.split(""));
        const overlap = queryChars.filter((char) => nameChars.has(char)).length;
        score = Math.round((overlap / Math.max(queryChars.length, 1)) * 30);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      matchedBy = name;
    }
  }

  return { item, score: bestScore, matchedBy };
}

function rankWasteItems(query, limit = 5) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return items
    .map((item) => scoreItem(query, item))
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "ko"))
    .slice(0, limit);
}

function isBroadPartialMatch(query, match) {
  const normalizedQuery = normalizeText(query);
  const normalizedMatchedBy = normalizeText(match.matchedBy);

  return (
    normalizedMatchedBy.length > 0 &&
    normalizedMatchedBy.length <= 3 &&
    normalizedQuery !== normalizedMatchedBy &&
    normalizedQuery.includes(normalizedMatchedBy) &&
    (normalizedMatchedBy.length === 1 || !normalizedQuery.startsWith(normalizedMatchedBy))
  );
}

function isHighRisk(query) {
  return HIGH_RISK_KEYWORDS.some((keyword) => query.includes(keyword));
}

function inferPriority(query, decisionType) {
  if (isHighRisk(query)) return "high";
  if (decisionType === "new_item_candidate") return "medium";
  if (decisionType === "source_gap") return "medium";
  return "medium";
}

function normalizeAnswerLabel(answer) {
  return normalizeText(answer).replace(/_/g, "");
}

function explicitFeedbackType(entry) {
  if (entry.backlogType) {
    return {
      type: entry.backlogType,
      reason: "explicit_backlog_type",
    };
  }

  if (!entry.answer) return undefined;

  const rawAnswer = entry.answer.trim().toLowerCase();
  if (PASSING_ANSWER_LABELS.has(rawAnswer) || PASSING_ANSWER_LABELS.has(normalizeAnswerLabel(rawAnswer))) {
    return {
      shouldSkip: true,
      reason: `feedback_${rawAnswer}`,
    };
  }

  const exactType = FEEDBACK_TYPE_BY_ANSWER.get(rawAnswer);
  if (exactType) {
    return {
      type: exactType,
      reason: `feedback_${rawAnswer}`,
    };
  }

  const normalizedAnswer = normalizeAnswerLabel(rawAnswer);
  for (const [label, type] of FEEDBACK_TYPE_BY_ANSWER.entries()) {
    if (normalizeAnswerLabel(label) === normalizedAnswer) {
      return {
        type,
        reason: `feedback_${label}`,
      };
    }
  }

  return undefined;
}

function classifyEntry(entry, options) {
  const ranked = rankWasteItems(entry.query, 5);
  const best = ranked[0];
  const usableBest = best && best.score >= MATCH_FLOOR ? best : undefined;
  const feedback = explicitFeedbackType(entry);

  if (feedback?.shouldSkip) {
    return {
      shouldBacklog: false,
      reason: feedback.reason,
      candidates: usableBest ? [usableBest] : ranked.filter((match) => match.score > 0).slice(0, 3),
    };
  }

  if (feedback?.type) {
    const fallbackType = usableBest ? feedback.type : "new_item_candidate";
    return {
      shouldBacklog: true,
      type: fallbackType,
      reason: feedback.reason,
      priority: inferPriority(entry.query, fallbackType),
      candidates: usableBest ? [usableBest, ...ranked.filter((match) => match.item.id !== usableBest.item.id).slice(0, 2)] : ranked.filter((match) => match.score > 0).slice(0, 3),
    };
  }

  if (!usableBest) {
    return {
      shouldBacklog: true,
      type: "new_item_candidate",
      reason: "no_match",
      priority: inferPriority(entry.query, "new_item_candidate"),
      candidates: ranked.filter((match) => match.score > 0).slice(0, 3),
    };
  }

  if (isBroadPartialMatch(entry.query, usableBest)) {
    return {
      shouldBacklog: true,
      type: "synonym_gap",
      reason: "broad_partial_match",
      priority: inferPriority(entry.query, "synonym_gap"),
      candidates: [usableBest],
    };
  }

  if (usableBest.score < options.minScore) {
    return {
      shouldBacklog: true,
      type: "synonym_gap",
      reason: "low_match_score",
      priority: inferPriority(entry.query, "synonym_gap"),
      candidates: [usableBest],
    };
  }

  if (usableBest.item.review?.status === "needs_source") {
    return {
      shouldBacklog: true,
      type: "source_gap",
      reason: "needs_source",
      priority: inferPriority(entry.query, "source_gap"),
      candidates: [usableBest],
    };
  }

  if (usableBest.item.confidence === "low" || (options.includeMediumConfidence && usableBest.item.confidence === "medium")) {
    return {
      shouldBacklog: true,
      type: "source_gap",
      reason: `item_confidence_${usableBest.item.confidence}`,
      priority: inferPriority(entry.query, "source_gap"),
      candidates: [usableBest],
    };
  }

  return {
    shouldBacklog: false,
    reason: "confident_match",
    candidates: [usableBest],
  };
}

function hashId(entry) {
  const seed = `${entry.region ?? ""}|${entry.query}`;
  return `auto_${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
}

function uniqueId(baseId, existingIds) {
  if (!existingIds.has(baseId)) {
    existingIds.add(baseId);
    return baseId;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseId}_${suffix}`;
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Could not generate unique id for ${baseId}`);
}

function duplicateKey(entry) {
  return `${normalizeText(entry.region ?? "")}|${normalizeText(entry.query)}`;
}

function formatCandidate(match) {
  return `${match.item.id}/${match.item.name} matchedBy=${match.matchedBy} score=${match.score}`;
}

function buildBacklogItem(entry, decision, options, id) {
  const best = decision.candidates[0];
  const candidateItemIds = Array.from(new Set(decision.candidates.filter((match) => match.score >= MATCH_FLOOR).map((match) => match.item.id)));
  const notes = [
    `autoSource: ${entry.source}`,
    `autoReason: ${decision.reason}`,
    `minScore: ${options.minScore}`,
  ];

  if (entry.sourceIndex !== undefined) notes.push(`sourceIndex: ${entry.sourceIndex}`);
  if (entry.tool) notes.push(`tool: ${entry.tool}`);
  if (entry.answer) notes.push(`feedback: ${entry.answer}`);
  if (entry.notes?.length > 0) {
    notes.push(...entry.notes.map((note) => `logNote: ${note}`));
  }

  if (best) {
    notes.push(`topCandidate: ${formatCandidate(best)}`);
    notes.push(`itemConfidence: ${best.item.confidence}`);
    notes.push(`reviewStatus: ${best.item.review?.status ?? "unknown"}`);
  }

  if (decision.candidates.length > 1) {
    notes.push(`otherCandidates: ${decision.candidates.slice(1).map(formatCandidate).join("; ")}`);
  }

  let observed;
  let expectedAction;
  const isFeedbackDriven = decision.reason === "explicit_backlog_type" || decision.reason.startsWith("feedback_");

  if (isFeedbackDriven) {
    const feedbackLabel = entry.answer ?? entry.backlogType ?? decision.reason;
    const candidateText = best ? ` 현재 자동 후보는 "${best.item.name}"(${best.item.id})입니다.` : "";

    if (decision.type === "new_item_candidate") {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 기존 품목만으로 답하기 어려운 신규 품목 후보입니다.${candidateText}`;
      expectedAction = "공식 출처를 확인해 신규 품목 추가 여부를 결정하고, 필요하면 평가 케이스와 MCP 답변 케이스를 추가합니다.";
    } else if (decision.type === "synonym_gap") {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 현재 매칭이 잘못되었거나 별칭 매칭이 약합니다.${candidateText}`;
      expectedAction = "사용자 표현을 기존 품목 별칭으로 추가할지, 별도 품목으로 분리할지, 과매칭 방지 규칙이 필요한지 검토합니다.";
    } else if (decision.type === "condition_gap") {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 상태·재질·오염·파손 여부에 따른 답변 분기가 부족합니다.${candidateText}`;
      expectedAction = "조건별 답변 문구를 보강하고, 조건을 고정할 MCP 답변 회귀 케이스를 추가합니다.";
    } else if (decision.type === "region_gap") {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 지역별 수거 방식, 수거함, 수수료, 신청 방식 확인이 필요합니다.${candidateText}`;
      expectedAction = "강남구 기준을 우선 확인하고 지역 가이드 또는 지역 회귀 케이스를 추가합니다.";
    } else if (decision.type === "source_gap") {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 공식 근거 또는 confidence 보강이 필요합니다.${candidateText}`;
      expectedAction = "공식 출처와 답변 품질을 재검토하고, 필요하면 품목 근거·평가 케이스·MCP 답변 케이스를 보강합니다.";
    } else {
      observed = `자동 백로그화: 테스트 판정(${feedbackLabel})상 현재 답변 품질을 재검토해야 합니다.${candidateText}`;
      expectedAction = "기존 품목 데이터, 공식 근거, MCP 답변 케이스 중 어떤 보강이 필요한지 검토합니다.";
    }
  } else if (decision.reason === "no_match") {
    observed = "자동 백로그화: 현재 품목 데이터에서 유의미한 후보를 찾지 못했습니다.";
    expectedAction = "공식 출처를 확인해 신규 품목 추가 여부를 결정하고, 필요하면 평가 케이스와 MCP 답변 케이스를 추가합니다.";
  } else if (decision.reason === "low_match_score") {
    observed = `자동 백로그화: "${best.item.name}" 후보가 있으나 매칭 점수 ${best.score}로 낮아 사용자 표현을 안정적으로 처리하지 못할 수 있습니다.`;
    expectedAction = "사용자 표현을 기존 품목 별칭으로 추가할지, 별도 품목으로 분리할지 검토합니다.";
  } else if (decision.reason === "broad_partial_match") {
    observed = `자동 백로그화: "${best.item.name}" 후보가 있으나 짧은 별칭 "${best.matchedBy}"의 부분 매칭이라 다른 품목을 잘못 가리킬 수 있습니다.`;
    expectedAction = "사용자 표현을 기존 품목 별칭으로 추가할지, 짧은 별칭 과매칭을 줄일지, 별도 품목으로 분리할지 검토합니다.";
  } else {
    observed = `자동 백로그화: "${best.item.name}"로 매칭됐지만 confidence=${best.item.confidence}, review.status=${best.item.review?.status ?? "unknown"}라 근거 보강 또는 답변 회귀 케이스 확인이 필요합니다.`;
    expectedAction = "공식 출처와 답변 품질을 재검토하고, 필요하면 품목 근거·평가 케이스·MCP 답변 케이스를 보강합니다.";
  }

  return {
    id,
    query: entry.query,
    ...(entry.region ? { region: entry.region } : {}),
    type: decision.type,
    status: "todo",
    priority: decision.priority,
    observed,
    expectedAction,
    candidateItemIds,
    notes,
  };
}

function summarizeSkip(entry, decision) {
  const best = decision.candidates[0];
  if (!best) return `${entry.query}: ${decision.reason}`;
  return `${entry.query}: ${decision.reason} (${best.item.id}, matchedBy=${best.matchedBy}, score=${best.score}, confidence=${best.item.confidence})`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const minScore = Number.parseInt(args["min-score"] ?? String(DEFAULT_MIN_SCORE), 10);
  if (!Number.isInteger(minScore) || minScore < MATCH_FLOOR || minScore > 100) {
    throw new Error(`--min-score must be an integer from ${MATCH_FLOOR} to 100`);
  }

  const limit = args.limit === undefined ? undefined : Number.parseInt(args.limit, 10);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  const source = args.source ?? "auto-backlog";
  const entries = [];
  for (const query of args.query ?? []) {
    const entry = normalizeLogEntry(query, args.region, source, entries.length + 1);
    if (entry) entries.push(entry);
  }

  if (args.input) {
    entries.push(...readInputFile(args.input, args.region, source));
  }

  if (entries.length === 0) {
    printHelp();
    throw new Error("No queries provided. Use --query or --input.");
  }

  const options = {
    minScore,
    includeMediumConfidence: Boolean(args["include-medium-confidence"]),
  };
  const existingIds = new Set(backlog.map((item) => item.id));
  const existingKeys = new Set(backlog.map((item) => duplicateKey(item)));
  const seenKeys = new Set();
  const candidates = [];
  const skipped = [];

  for (const entry of entries) {
    const key = duplicateKey(entry);
    if (seenKeys.has(key)) {
      skipped.push(`${entry.query}: duplicate_in_input`);
      continue;
    }
    seenKeys.add(key);

    if (existingKeys.has(key)) {
      skipped.push(`${entry.query}: already_in_backlog`);
      continue;
    }

    const decision = classifyEntry(entry, options);
    if (!decision.shouldBacklog) {
      skipped.push(summarizeSkip(entry, decision));
      continue;
    }

    const id = uniqueId(hashId(entry), existingIds);
    candidates.push(buildBacklogItem(entry, decision, options, id));

    if (limit !== undefined && candidates.length >= limit) {
      break;
    }
  }

  if (args.write && candidates.length > 0) {
    const nextBacklog = [...backlog, ...candidates];
    writeFileSync(backlogPath, `${JSON.stringify(nextBacklog, null, 2)}\n`);
  }

  const action = args.write ? "Added" : "Would add";
  console.log(`Auto backlog scanned ${entries.length} quer${entries.length === 1 ? "y" : "ies"}`);
  console.log(`${action} ${candidates.length} item${candidates.length === 1 ? "" : "s"}${args.write ? "" : " (dry-run; pass --write to save)"}`);
  console.log(`Skipped ${skipped.length} item${skipped.length === 1 ? "" : "s"}`);

  if (candidates.length > 0) {
    console.log("");
    console.log("Backlog candidates:");
    for (const item of candidates) {
      const region = item.region ? ` (${item.region})` : "";
      console.log(`- ${item.id}: ${item.query}${region} [${item.type}, ${item.priority}]`);
      console.log(`  ${item.observed}`);
    }
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped:");
    for (const item of skipped.slice(0, 20)) {
      console.log(`- ${item}`);
    }
    if (skipped.length > 20) {
      console.log(`- ... ${skipped.length - 20} more`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
