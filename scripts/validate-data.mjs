import { readFileSync } from "node:fs";

const dataPath = new URL("../src/data/waste-items.json", import.meta.url);
const regionPolicyPath = new URL("../src/data/region-policies.json", import.meta.url);
const bulkyWasteFeesPath = new URL("../src/data/bulky-waste-fees.json", import.meta.url);
const evaluationCasesPath = new URL("../src/data/evaluation-cases.json", import.meta.url);
const regionEvaluationCasesPath = new URL("../src/data/region-evaluation-cases.json", import.meta.url);
const mcpAnswerCasesPath = new URL("../src/data/mcp-answer-cases.json", import.meta.url);
const questionBacklogPath = new URL("../src/data/question-backlog.json", import.meta.url);
const materialGuidelinesPath = new URL("../src/data/material-guidelines.json", import.meta.url);
const disposalGroupsPath = new URL("../src/data/disposal-groups.json", import.meta.url);
const conditionLabelsPath = new URL("../src/data/condition-labels.json", import.meta.url);
const partNounsPath = new URL("../src/data/compound-part-nouns.json", import.meta.url);
const spotCategoriesPath = new URL("../src/data/spot-categories.json", import.meta.url);
const sourceCoveragePath = new URL("../docs/source-coverage.md", import.meta.url);
const sessionCoordinationPath = new URL("../docs/session-coordination.md", import.meta.url);
const items = JSON.parse(readFileSync(dataPath, "utf8"));
const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8"));
const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeesPath, "utf8"));
const evaluationCases = JSON.parse(readFileSync(evaluationCasesPath, "utf8"));
const regionEvaluationCases = JSON.parse(readFileSync(regionEvaluationCasesPath, "utf8"));
const mcpAnswerCases = JSON.parse(readFileSync(mcpAnswerCasesPath, "utf8"));
const questionBacklog = JSON.parse(readFileSync(questionBacklogPath, "utf8"));
const materialGuidelines = JSON.parse(readFileSync(materialGuidelinesPath, "utf8"));
const disposalGroups = JSON.parse(readFileSync(disposalGroupsPath, "utf8"));
const conditionLabels = JSON.parse(readFileSync(conditionLabelsPath, "utf8"));
const compoundPartNouns = JSON.parse(readFileSync(partNounsPath, "utf8"));
const spotCategories = JSON.parse(readFileSync(spotCategoriesPath, "utf8"));
const sourceCoverage = readFileSync(sourceCoveragePath, "utf8");
const sessionCoordination = readFileSync(sessionCoordinationPath, "utf8");

const confidenceValues = new Set(["high", "medium", "low"]);
const sourceTypes = new Set(["official_guidance", "local_guidance", "law", "safety_guidance", "manual_review"]);
const reviewStatuses = new Set(["draft", "needs_source", "verified", "region_review_needed", "standard_import"]);
const regionScopes = new Set(["national_default", "region_specific", "local_collection_point", "bulky_waste"]);
const regionCheckLevels = new Set(["required", "advisory"]);
const questionBacklogTypes = new Set([
  "new_item_candidate",
  "synonym_gap",
  "answer_gap",
  "region_gap",
  "source_gap",
  "condition_gap",
]);
const questionBacklogStatuses = new Set(["todo", "triaged", "covered", "wont_fix"]);
const questionBacklogPriorities = new Set(["high", "medium", "low"]);
const mcpToolNames = new Set([
  "classify_waste_item",
  "get_disposal_steps",
  "check_confusing_item",
  "make_cleanup_plan",
  "get_region_disposal_info",
]);
const regionCheckLevelToExpectedPolicyLevel = {
  required: "필수",
  advisory: "참고",
};

const errors = [];
const warnings = [];
const ids = new Set();
const names = new Set();
const normalizedKeyOwners = new Map();

function normalizeMatchText(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function at(index, id, field) {
  return `item[${index}]${id ? `(${id})` : ""}.${field}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    if (typeof key !== "string") continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function expectDocumentCount(label, text, regex, expected) {
  const match = text.match(regex);
  if (!match) {
    errors.push(`${label} count is missing from docs`);
    return;
  }

  const actual = Number(match[1]);
  if (actual !== expected) {
    errors.push(`${label} count must be ${expected}, got ${actual}`);
  }
}

function expectAllDocumentCounts(label, text, regex, expected) {
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) {
    errors.push(`${label} count is missing from docs`);
    return;
  }

  for (const match of matches) {
    const actual = Number(match[1]);
    if (actual !== expected) {
      errors.push(`${label} count must be ${expected}, got ${actual}`);
    }
  }
}

function expectSessionSourceSnapshot(expected) {
  const match = sessionCoordination.match(
    /waste-items\.json` (\d+)개, `evaluation-cases\.json` (\d+)개, MCP answer cases (\d+)개, review count는 `verified (\d+) \/ region_review_needed (\d+) \/ needs_source (\d+)`/,
  );
  if (!match) {
    errors.push("docs/session-coordination.md source snapshot counts are missing");
    return;
  }

  const labels = ["wasteItems", "evaluationCases", "mcpAnswerCases", "verified", "regionReviewNeeded", "needsSource"];
  for (const [index, label] of labels.entries()) {
    const actual = Number(match[index + 1]);
    if (actual !== expected[label]) {
      errors.push(`docs/session-coordination.md ${label} count must be ${expected[label]}, got ${actual}`);
    }
  }
}

function expectSessionBacklogSnapshot(expected) {
  const match = sessionCoordination.match(/Backlog는 `covered (\d+) \/ wont_fix (\d+) \/ todo (\d+)`/);
  if (!match) {
    errors.push("docs/session-coordination.md backlog snapshot counts are missing");
    return;
  }

  const labels = ["covered", "wont_fix", "todo"];
  for (const [index, label] of labels.entries()) {
    const actual = Number(match[index + 1]);
    if (actual !== expected[label]) {
      errors.push(`docs/session-coordination.md backlog ${label} count must be ${expected[label]}, got ${actual}`);
    }
  }
}

function requireString(item, index, field) {
  if (!isNonEmptyString(item[field])) {
    errors.push(`${at(index, item.id, field)} must be a non-empty string`);
  }
}

function requireStringArray(item, index, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(item[field])) {
    errors.push(`${at(index, item.id, field)} must be an array`);
    return;
  }

  if (!allowEmpty && item[field].length === 0) {
    errors.push(`${at(index, item.id, field)} must not be empty`);
  }

  for (const [arrayIndex, value] of item[field].entries()) {
    if (!isNonEmptyString(value)) {
      errors.push(`${at(index, item.id, `${field}[${arrayIndex}]`)} must be a non-empty string`);
    }
  }
}

if (!Array.isArray(items)) {
  throw new Error("src/data/waste-items.json must contain an array");
}

if (!Array.isArray(regionalPolicies)) {
  throw new Error("src/data/region-policies.json must contain an array");
}

if (!Array.isArray(bulkyWasteFeeSchedules)) {
  throw new Error("src/data/bulky-waste-fees.json must contain an array");
}

if (!Array.isArray(evaluationCases)) {
  throw new Error("src/data/evaluation-cases.json must contain an array");
}

if (!Array.isArray(mcpAnswerCases)) {
  throw new Error("src/data/mcp-answer-cases.json must contain an array");
}

if (!Array.isArray(questionBacklog)) {
  throw new Error("src/data/question-backlog.json must contain an array");
}

if (!Array.isArray(materialGuidelines) || materialGuidelines.length === 0) {
  throw new Error("src/data/material-guidelines.json must contain a non-empty array");
}

if (!disposalGroups || typeof disposalGroups !== "object" || Array.isArray(disposalGroups)) {
  throw new Error("src/data/disposal-groups.json must contain an object map");
}

// disposalType -> 배출 그룹 라벨은 전수 대응이어야 한다. 빠지면 런타임이
// "확인 필요"로 답하는데, 그건 not_found/모호 항목의 라벨이라 매칭에 성공한
// 품목이 실패한 것처럼 보인다.
const usedDisposalTypes = new Set();
for (const [index, item] of items.entries()) {
  if (!isNonEmptyString(item.disposalType)) continue;
  usedDisposalTypes.add(item.disposalType);
  if (!isNonEmptyString(disposalGroups[item.disposalType])) {
    errors.push(`${at(index, item.id, "disposalType")} "${item.disposalType}" has no label in src/data/disposal-groups.json`);
  }
}

for (const [disposalType, label] of Object.entries(disposalGroups)) {
  if (!isNonEmptyString(label)) {
    errors.push(`disposalGroups["${disposalType}"] must be a non-empty string`);
  } else if (label === "확인 필요") {
    errors.push(`disposalGroups["${disposalType}"] must not be "확인 필요" — that label is reserved for unmatched items`);
  }
  if (!usedDisposalTypes.has(disposalType)) {
    warnings.push(`disposalGroups["${disposalType}"] is not used by any waste item`);
  }
}

if (!conditionLabels || typeof conditionLabels !== "object" || Array.isArray(conditionLabels)) {
  throw new Error("src/data/condition-labels.json must contain an object map");
}

// condition -> 한국어 라벨도 전수 대응이어야 한다. 빠지면 `conditionLabel`이 밑줄만 떼고
// 영문 키를 그대로 내보내, 카드의 "판단 조건" 줄이 "오염 여부 확인, 위생용품, pet waste"
// 처럼 반쪽만 한국어로 나간다. 폴백이라 조용히 새는 게 문제라 검사로 못 박는다.
const usedConditions = new Set();
for (const [index, item] of items.entries()) {
  for (const condition of item.conditions ?? []) {
    if (!isNonEmptyString(condition)) continue;
    usedConditions.add(condition);
    if (!isNonEmptyString(conditionLabels[condition])) {
      errors.push(`${at(index, item.id, "conditions")} "${condition}" has no label in src/data/condition-labels.json`);
    }
  }
}

for (const [condition, label] of Object.entries(conditionLabels)) {
  if (!isNonEmptyString(label)) {
    errors.push(`conditionLabels["${condition}"] must be a non-empty string`);
  } else if (!/[가-힣]/.test(label)) {
    // 한글이 한 글자도 없으면 사용자가 보는 줄은 영문 키가 새던 때와 다를 게 없다.
    // 폴백 문자열("pet waste")을 그대로 옮겨 적는 것도, 새 영문 라벨을 짓는 것도
    // 여기서 함께 걸린다. `PVC 재질`처럼 로마자를 섞는 라벨은 한글이 있어 통과한다.
    errors.push(`conditionLabels["${condition}"] must be a Korean label, got "${label}"`);
  }
  if (!usedConditions.has(condition)) {
    warnings.push(`conditionLabels["${condition}"] is not used by any waste item`);
  }
}

// 부품어가 품목명이기도 한 건 막지 않는다. 오히려 그때가 제일 잘 맞는다 — `믹서기 칼날`
// 에서 믹서기가 빠지면 칼날(knife_blade)이 그대로 답이 되고, `에어컨 리모컨`도 같은
// 식으로 리모컨 쪽으로 간다.
//
// 1글자 금지는 실측으로 정한 것이라 검사로 못 박는다. `살`·`줄`은 용언 활용형과 겹쳐서
// `소파 살 거예요`·`이불 줄 거예요` 같은 멀쩡한 발화를 not_found로 떨어뜨린다. 목록이
// 늘 때 이걸 모르는 사람이 한 글자를 넣는 게 이 검사가 막으려는 사고다.
if (!compoundPartNouns || typeof compoundPartNouns !== "object" || Array.isArray(compoundPartNouns)) {
  errors.push("compound-part-nouns.json must be an object of part noun -> reason");
} else {
  const seenPartNouns = new Set();
  const normalizedPartNouns = [];
  for (const [word, reason] of Object.entries(compoundPartNouns)) {
    const normalized = normalizeMatchText(word);
    if (normalized.length < 2) {
      errors.push(`compoundPartNouns["${word}"] must be at least 2 characters — one-syllable part nouns collide with verb stems`);
    }
    if (seenPartNouns.has(normalized)) {
      errors.push(`compoundPartNouns["${word}"] duplicates another entry once normalized`);
    }
    seenPartNouns.add(normalized);
    normalizedPartNouns.push([word, normalized]);
    if (!isNonEmptyString(reason)) {
      errors.push(`compoundPartNouns["${word}"] must carry a reason string`);
    }
  }

  // 정규화 동일성만 보면 죽은 항목을 못 잡는다. `endsWithPartNoun`이 접미 일치라서
  // `호스`가 이미 `배수호스`를 덮고 있었는데, 그 줄은 빼도 동작이 한 글자도 안 바뀌면서
  // 읽는 사람에게는 "이건 따로 필요하다"는 잘못된 신호를 준다. 중복과 같은 사고라
  // 같은 등급(error)으로 막는다.
  for (const [word, normalized] of normalizedPartNouns) {
    const covering = normalizedPartNouns.find(([, other]) => other.length < normalized.length && normalized.endsWith(other));
    if (covering) {
      errors.push(
        `compoundPartNouns["${word}"] is already covered by "${covering[0]}" — matching is suffix-based, so this entry never changes behavior`,
      );
    }
  }
}

const reviewCounts = countBy(items, (item) => item?.review?.status);
const questionBacklogCounts = countBy(questionBacklog, (question) => question?.status);
expectDocumentCount("docs/source-coverage.md total waste items", sourceCoverage, /- 총 품목: (\d+)/, items.length);
expectDocumentCount("docs/source-coverage.md evaluation cases", sourceCoverage, /- 평가 케이스: (\d+)/, evaluationCases.length);
expectDocumentCount("docs/source-coverage.md MCP answer cases", sourceCoverage, /- MCP 답변 회귀 케이스: (\d+)/, mcpAnswerCases.length);
expectDocumentCount("docs/source-coverage.md verified items", sourceCoverage, /- `verified`: (\d+)/, reviewCounts.verified ?? 0);
expectDocumentCount(
  "docs/source-coverage.md region_review_needed items",
  sourceCoverage,
  /- `region_review_needed`: (\d+)/,
  reviewCounts.region_review_needed ?? 0,
);
expectDocumentCount("docs/source-coverage.md needs_source items", sourceCoverage, /- `needs_source`: (\d+)/, reviewCounts.needs_source ?? 0);
expectDocumentCount(
  "docs/source-coverage.md standard_import items",
  sourceCoverage,
  /- `standard_import`: (\d+)/,
  reviewCounts.standard_import ?? 0,
);
expectAllDocumentCounts("docs/session-coordination.md MCP answer cases", sessionCoordination, /MCP answer cases (\d+)개/g, mcpAnswerCases.length);
// 지역 카운트는 그동안 어느 정규식에도 안 걸려서 문서가 조용히 어긋났다.
// 지역이 늘 때마다 문서 갱신을 강제하도록 여기서 대조한다.
expectDocumentCount("docs/session-coordination.md region policies", sessionCoordination, /지역 정책 데이터 (\d+)개/, regionalPolicies.length);
expectDocumentCount(
  "docs/session-coordination.md region evaluation cases",
  sessionCoordination,
  /지역 평가 케이스 (\d+)개/,
  regionEvaluationCases.length,
);
expectSessionSourceSnapshot({
  wasteItems: items.length,
  evaluationCases: evaluationCases.length,
  mcpAnswerCases: mcpAnswerCases.length,
  verified: reviewCounts.verified ?? 0,
  regionReviewNeeded: reviewCounts.region_review_needed ?? 0,
  needsSource: reviewCounts.needs_source ?? 0,
});
expectSessionBacklogSnapshot({
  covered: questionBacklogCounts.covered ?? 0,
  wont_fix: questionBacklogCounts.wont_fix ?? 0,
  todo: questionBacklogCounts.todo ?? 0,
});

for (const [index, item] of items.entries()) {
  requireString(item, index, "id");
  requireString(item, index, "name");
  requireString(item, index, "category");
  requireString(item, index, "disposalType");
  requireString(item, index, "summary");
  requireStringArray(item, index, "aliases");
  requireStringArray(item, index, "steps");
  requireStringArray(item, index, "cautions", { allowEmpty: true });
  requireStringArray(item, index, "sourceRefs");
  requireStringArray(item, index, "conditions", { allowEmpty: true });

  if (isNonEmptyString(item.id)) {
    if (!/^[a-z0-9_]+$/.test(item.id)) {
      errors.push(`${at(index, item.id, "id")} must use lowercase snake_case`);
    }
    if (ids.has(item.id)) {
      errors.push(`${at(index, item.id, "id")} is duplicated`);
    }
    ids.add(item.id);
  }

  if (isNonEmptyString(item.name)) {
    if (names.has(item.name)) {
      warnings.push(`${at(index, item.id, "name")} is duplicated`);
    }
    names.add(item.name);
  }

  const normalizedKeys = new Set();
  if (isNonEmptyString(item.name)) normalizedKeys.add(normalizeMatchText(item.name));
  if (Array.isArray(item.aliases)) {
    for (const alias of item.aliases) {
      if (isNonEmptyString(alias)) normalizedKeys.add(normalizeMatchText(alias));
    }
  }
  for (const key of normalizedKeys) {
    if (!key) continue;
    const owner = normalizedKeyOwners.get(key);
    if (owner !== undefined && owner !== item.id) {
      errors.push(`${at(index, item.id, "name/aliases")} normalized key "${key}" collides with item ${owner}`);
    } else {
      normalizedKeyOwners.set(key, item.id);
    }
  }

  if (!confidenceValues.has(item.confidence)) {
    errors.push(`${at(index, item.id, "confidence")} must be one of ${Array.from(confidenceValues).join(", ")}`);
  }

  if (typeof item.needsRegionCheck !== "boolean") {
    errors.push(`${at(index, item.id, "needsRegionCheck")} must be a boolean`);
  }

  for (const [conditionIndex, condition] of (item.conditions ?? []).entries()) {
    if (!/^[a-z0-9_]+$/.test(condition)) {
      errors.push(`${at(index, item.id, `conditions[${conditionIndex}]`)} must use lowercase snake_case`);
    }
  }

  if (!item.regionPolicy || typeof item.regionPolicy !== "object") {
    errors.push(`${at(index, item.id, "regionPolicy")} is required`);
  } else {
    if (!regionScopes.has(item.regionPolicy.scope)) {
      errors.push(`${at(index, item.id, "regionPolicy.scope")} must be one of ${Array.from(regionScopes).join(", ")}`);
    }
    if (typeof item.regionPolicy.needsRegionCheck !== "boolean") {
      errors.push(`${at(index, item.id, "regionPolicy.needsRegionCheck")} must be a boolean`);
    }
    if (item.regionPolicy.needsRegionCheck !== item.needsRegionCheck) {
      errors.push(`${at(index, item.id, "regionPolicy.needsRegionCheck")} must match needsRegionCheck`);
    }
    if (item.regionPolicy.needsRegionCheck && !isNonEmptyString(item.regionPolicy.reason)) {
      warnings.push(`${at(index, item.id, "regionPolicy.reason")} should explain why region verification is needed`);
    }
    if (item.regionPolicy.regionCheckLevel !== undefined && !regionCheckLevels.has(item.regionPolicy.regionCheckLevel)) {
      errors.push(`${at(index, item.id, "regionPolicy.regionCheckLevel")} must be one of ${Array.from(regionCheckLevels).join(", ")}`);
    }
    if (item.regionPolicy.regionCheckLevel !== undefined && !item.regionPolicy.needsRegionCheck) {
      errors.push(`${at(index, item.id, "regionPolicy.regionCheckLevel")} can only be set when needsRegionCheck is true`);
    }
    if (item.regionPolicy.regionCheckLevel === "advisory" && item.regionPolicy.scope !== "region_specific") {
      errors.push(`${at(index, item.id, "regionPolicy.regionCheckLevel")} advisory overrides are only allowed for region_specific items`);
    }
    if (item.regionPolicy.checkItems !== undefined && !Array.isArray(item.regionPolicy.checkItems)) {
      errors.push(`${at(index, item.id, "regionPolicy.checkItems")} must be an array when present`);
    }
  }

  if (!Array.isArray(item.sources) || item.sources.length === 0) {
    errors.push(`${at(index, item.id, "sources")} must contain at least one source`);
  } else {
    for (const [sourceIndex, source] of item.sources.entries()) {
      const prefix = at(index, item.id, `sources[${sourceIndex}]`);
      if (!isNonEmptyString(source.title)) errors.push(`${prefix}.title must be a non-empty string`);
      if (!sourceTypes.has(source.sourceType)) errors.push(`${prefix}.sourceType must be one of ${Array.from(sourceTypes).join(", ")}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt ?? "")) errors.push(`${prefix}.checkedAt must be YYYY-MM-DD`);
      if (source.url !== undefined && !/^https?:\/\//.test(source.url)) errors.push(`${prefix}.url must start with http:// or https://`);
      if (source.basis !== undefined && !isNonEmptyString(source.basis)) errors.push(`${prefix}.basis must be a non-empty string when present`);
    }
  }

  if (!item.review || typeof item.review !== "object") {
    errors.push(`${at(index, item.id, "review")} is required`);
  } else {
    if (!reviewStatuses.has(item.review.status)) {
      errors.push(`${at(index, item.id, "review.status")} must be one of ${Array.from(reviewStatuses).join(", ")}`);
    }
    if (item.needsRegionCheck && item.review.status === "verified") {
      warnings.push(`${at(index, item.id, "review.status")} is verified but still needs region checks`);
    }
    if (item.review.status === "verified" && !item.sources?.some((source) => isNonEmptyString(source.basis))) {
      errors.push(`${at(index, item.id, "review.status")} is verified but no source has a basis`);
    }
    if (item.review.lastReviewedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(item.review.lastReviewedAt)) {
      errors.push(`${at(index, item.id, "review.lastReviewedAt")} must be YYYY-MM-DD when present`);
    }
    if (item.review.status === "standard_import") {
      if (!Array.isArray(item.aliases) || item.aliases.length < 2) {
        errors.push(`${at(index, item.id, "aliases")} standard_import items must have at least 2 aliases`);
      }
      if (!Array.isArray(item.steps) || item.steps.length < 1 || item.steps.length > 3) {
        errors.push(`${at(index, item.id, "steps")} standard_import items must have 1 to 3 steps`);
      }
      if (!Array.isArray(item.cautions) || item.cautions.length < 1) {
        errors.push(`${at(index, item.id, "cautions")} standard_import items must have at least 1 caution`);
      }
      if (Array.isArray(item.sources)) {
        for (const [sourceIndex, source] of item.sources.entries()) {
          if (!isNonEmptyString(source.url)) {
            errors.push(`${at(index, item.id, `sources[${sourceIndex}].url`)} is required for standard_import items`);
          }
        }
      }
    }
  }
}

const regionCoverageTiers = new Set(["full", "standard", "metro"]);
const metroRegionIds = new Set(regionalPolicies.filter((region) => region?.coverageTier === "metro").map((region) => region.id));
// 대표 민원번호는 "지역번호+120" 형태다. "120으로 끝나면 error" 같은 느슨한 규칙은
// 031-729-3120 같은 정상 직통번호를 오탐하므로 쓰지 않는다.
const representativeComplaintPhone = /^\d{2,3}-120$/;
const regionPhoneFormat = /^(\d{2,4}-\d{3,4}-\d{4}|\d{4}-\d{4})$/;
// `scripts/import-bulky-fees.ts`의 MAX_FEE_ROWS와 같은 값이어야 한다.
const MAX_FEE_ROWS_PER_ITEM = 12;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const httpsUrl = /^https:\/\//;
const prePostingKinds = new Set(["receipt", "sticker", "none"]);

function collectionMethodIsFilled(collection) {
  return Array.isArray(collection?.method) && collection.method.some((method) => isNonEmptyString(method));
}

// `prefixOnlyDistrictAliases` 대조는 앞뒤 순서를 안 타야 해서 미리 모아 둔다.
const allDistrictAliases = new Set(
  regionalPolicies.flatMap((region) => (Array.isArray(region?.districtAliases) ? region.districtAliases : [])),
);

// `sharedAliases`가 진짜로 "나눠 쓰는 표기"인지 보려면 다른 지역이 그 표기를
// 확정에 쓰고 있는지 알아야 한다. 이것도 앞뒤 순서를 안 타야 해서 미리 모은다.
const exclusiveNameOwners = new Map();
for (const region of regionalPolicies) {
  for (const name of [region?.name, ...(Array.isArray(region?.aliases) ? region.aliases : [])]) {
    if (isNonEmptyString(name) && !exclusiveNameOwners.has(name)) exclusiveNameOwners.set(name, region.id);
  }
}

const regionIds = new Set();
const districtAliasOwners = new Map();
for (const [index, region] of regionalPolicies.entries()) {
  const prefix = `region[${index}]${region?.id ? `(${region.id})` : ""}`;
  const tier = region.coverageTier;
  const isMetro = tier === "metro";

  if (!isNonEmptyString(region.id)) errors.push(`${prefix}.id must be a non-empty string`);
  if (!isNonEmptyString(region.name)) errors.push(`${prefix}.name must be a non-empty string`);
  if (!Array.isArray(region.aliases) || region.aliases.length === 0) errors.push(`${prefix}.aliases must not be empty`);

  // 광역이 대신 받는 시·군·구 이름. `aliases`와 갈라 두는 게 요점이라, 다시 섞이면
  // 응답이 그 이름을 부를 근거를 잃는다 — 겹치는 순간 에러로 잡는다.
  if (region.districtAliases !== undefined) {
    if (!Array.isArray(region.districtAliases) || region.districtAliases.length === 0) {
      errors.push(`${prefix}.districtAliases must be a non-empty array when present`);
    } else {
      const ownNames = new Set([region.name, ...(Array.isArray(region.aliases) ? region.aliases : [])]);
      const seen = new Set();
      for (const [aliasIndex, alias] of region.districtAliases.entries()) {
        const aliasPrefix = `${prefix}.districtAliases[${aliasIndex}]`;
        if (!isNonEmptyString(alias)) {
          errors.push(`${aliasPrefix} must be a non-empty string`);
          continue;
        }
        if (ownNames.has(alias)) errors.push(`${aliasPrefix} "${alias}" also appears in name/aliases; keep the two lists apart`);
        if (seen.has(alias)) errors.push(`${aliasPrefix} "${alias}" is duplicated`);
        seen.add(alias);
        const owner = districtAliasOwners.get(alias);
        if (owner) {
          errors.push(`${aliasPrefix} "${alias}" is already a district alias of ${owner}; a name in two metros must not resolve to either`);
        } else {
          districtAliasOwners.set(alias, region.id);
        }
      }
    }
  }

  // 이름만으로는 광역이 안 정해져 매칭에서 뺀 시·군·구. 광역 접두어가 붙었을 때만
  // 응답이 이 이름을 부른다. 두 목록이 겹치면 한쪽 규칙이 거짓말이 되므로 막는다 —
  // `districtAliases`에 있다는 건 이름만으로 광역이 정해진다는 뜻이고, 이쪽에 있다는
  // 건 정반대다.
  if (region.prefixOnlyDistrictAliases !== undefined) {
    if (!Array.isArray(region.prefixOnlyDistrictAliases) || region.prefixOnlyDistrictAliases.length === 0) {
      errors.push(`${prefix}.prefixOnlyDistrictAliases must be a non-empty array when present`);
    } else {
      const ownNames = new Set([region.name, ...(Array.isArray(region.aliases) ? region.aliases : [])]);
      const seen = new Set();
      for (const [aliasIndex, alias] of region.prefixOnlyDistrictAliases.entries()) {
        const aliasPrefix = `${prefix}.prefixOnlyDistrictAliases[${aliasIndex}]`;
        if (!isNonEmptyString(alias)) {
          errors.push(`${aliasPrefix} must be a non-empty string`);
          continue;
        }
        if (ownNames.has(alias)) errors.push(`${aliasPrefix} "${alias}" also appears in name/aliases; keep the two lists apart`);
        if (seen.has(alias)) errors.push(`${aliasPrefix} "${alias}" is duplicated`);
        seen.add(alias);
        if (allDistrictAliases.has(alias)) {
          errors.push(
            `${aliasPrefix} "${alias}" is also a districtAlias somewhere; a name is either metro-unique on its own or it is not`,
          );
        }
      }
    }
  }

  // 다른 광역과 나눠 쓰는 표기. 이 목록에 있다는 건 "이 표기만으로는 우리 쪽으로
  // 확정하지 않는다"는 뜻이라, 확정에 쓰는 쪽이 반드시 따로 있어야 한다 — 아무도
  // 안 쓰는 이름을 여기 적으면 그 표기는 어디로도 못 가고 조용히 사라진다.
  if (region.sharedAliases !== undefined) {
    if (!Array.isArray(region.sharedAliases) || region.sharedAliases.length === 0) {
      errors.push(`${prefix}.sharedAliases must be a non-empty array when present`);
    } else {
      const ownNames = new Set([region.name, ...(Array.isArray(region.aliases) ? region.aliases : [])]);
      const seen = new Set();
      for (const [aliasIndex, alias] of region.sharedAliases.entries()) {
        const aliasPrefix = `${prefix}.sharedAliases[${aliasIndex}]`;
        if (!isNonEmptyString(alias)) {
          errors.push(`${aliasPrefix} must be a non-empty string`);
          continue;
        }
        if (ownNames.has(alias)) {
          errors.push(`${aliasPrefix} "${alias}" also appears in name/aliases; a name is either exclusive or shared`);
        }
        if (seen.has(alias)) errors.push(`${aliasPrefix} "${alias}" is duplicated`);
        seen.add(alias);
        // 나눠 쓰는 이름은 **답하는 광역이 전부 이 목록에 적어야** 한다. 한쪽만 적고
        // 다른 쪽이 `aliases`로 들고 있으면, 표기만 들어온 질의가 완전 일치에서 양쪽에
        // 걸리는데 되묻기 가드는 선언한 곳만 세어 발동하지 않는다 — 배열 순서가 답을
        // 정하는 상태가 된다. 혼자 적어 두면 그 이름은 아무 데도 닿지 않는다.
        const exclusiveOwner = exclusiveNameOwners.get(alias);
        const alsoShared = regionalPolicies.some(
          (other) => other.id !== region.id && (other.sharedAliases ?? []).includes(alias),
        );
        if (exclusiveOwner === region.id) {
          errors.push(`${aliasPrefix} "${alias}" is already this region's own alias`);
        } else if (exclusiveOwner) {
          errors.push(
            `${aliasPrefix} "${alias}" is region ${exclusiveOwner}'s exclusive alias; every region that answers to a shared name must declare it in sharedAliases`,
          );
        } else if (!alsoShared) {
          errors.push(
            `${aliasPrefix} "${alias}" is not held by any other region; a shared name needs another region that answers to it`,
          );
        }
      }
    }
  }

  if (!isoDate.test(region.checkedAt ?? "")) errors.push(`${prefix}.checkedAt must be YYYY-MM-DD`);
  if (!isNonEmptyString(region.summary)) errors.push(`${prefix}.summary must be a non-empty string`);
  if (!regionCoverageTiers.has(tier)) {
    errors.push(`${prefix}.coverageTier must be one of ${Array.from(regionCoverageTiers).join(", ")}`);
  }

  if (isNonEmptyString(region.id)) {
    if (!/^[a-z0-9_]+$/.test(region.id)) errors.push(`${prefix}.id must use lowercase snake_case`);
    if (regionIds.has(region.id)) errors.push(`${prefix}.id is duplicated`);
    regionIds.add(region.id);
  }

  // 광역시도 레이어는 전화번호도 신고 경로도 갖지 않는다. 대형폐기물 접수는
  // 기초자치단체 소관이라 광역 단위에 대응하는 직통번호가 없고, 억지로 시청
  // 대표번호를 채우면 R4-1 기준이 조용히 무너진다.
  if (isMetro) {
    if (region.metroId !== undefined) errors.push(`${prefix}.metroId must not be set on a metro region`);
    if (region.bulkyWaste !== undefined) {
      errors.push(`${prefix}.bulkyWaste must not be set on a metro region; bulky waste intake belongs to the district level`);
    }
  } else {
    if (region.districtAliases !== undefined) {
      errors.push(`${prefix}.districtAliases must not be set on a district-level region; it lists 시·군·구 that fall back to a metro`);
    }
    if (region.prefixOnlyDistrictAliases !== undefined) {
      errors.push(
        `${prefix}.prefixOnlyDistrictAliases must not be set on a district-level region; it lists 시·군·구 that fall back to a metro`,
      );
    }
    if (region.sharedAliases !== undefined) {
      errors.push(`${prefix}.sharedAliases must not be set on a district-level region; 표기를 나눠 쓰는 건 광역 통합에서만 생긴다`);
    }
    if (!isNonEmptyString(region.metroId)) errors.push(`${prefix}.metroId is required for district-level regions`);
    else if (!metroRegionIds.has(region.metroId)) errors.push(`${prefix}.metroId references unknown metro region ${region.metroId}`);
  }

  if (tier === "full") {
    // 배출 요일·시간 요구(generalWaste/recycling)는 2026-08-19에 걷어냈다. 구 대표값
    // 하나로 동·주택 유형별 차이를 덮을 수 없어 그 데이터를 아예 두지 않는다.
    if (!region.foodWaste || !Array.isArray(region.foodWaste.generalWasteExceptions)) {
      errors.push(`${prefix}.foodWaste.generalWasteExceptions must be an array`);
    }
    if (
      !region.bulkyWaste ||
      !isNonEmptyString(region.bulkyWaste.definition) ||
      !Array.isArray(region.bulkyWaste.place) ||
      !Array.isArray(region.bulkyWaste.collection) ||
      !isNonEmptyString(region.bulkyWaste.phone)
    ) {
      errors.push(`${prefix}.bulkyWaste must include definition, place, collection, and phone`);
    }
    if (!Array.isArray(region.itemGuides)) errors.push(`${prefix}.itemGuides must be an array`);
  }

  // R4 완결 조건 5종. "반쯤 채운 지역을 넣지 않는다"를 사람 의지가 아니라
  // 파이프라인으로 보장하는 지점이라 전부 error다.
  if (tier === "standard") {
    if (Array.isArray(region.aliases) && region.aliases.length < 2) {
      errors.push(`${prefix}.aliases must include at least 2 entries for standard tier`);
    }
    const bulkyWaste = region.bulkyWaste;
    if (!bulkyWaste) {
      errors.push(`${prefix}.bulkyWaste is required for standard tier`);
    } else {
      // 여기는 "있어야 한다"만 본다. 형식은 아래 티어 무관 블록이 검사한다.
      if (!isNonEmptyString(bulkyWaste.applicationUrl)) errors.push(`${prefix}.bulkyWaste.applicationUrl is required for standard tier`);
      if (!isNonEmptyString(bulkyWaste.feeUrl)) errors.push(`${prefix}.bulkyWaste.feeUrl is required for standard tier`);
      if (!isNonEmptyString(bulkyWaste.phone)) errors.push(`${prefix}.bulkyWaste.phone is required for standard tier`);
      if (!isNonEmptyString(bulkyWaste.contactCheckedAt)) errors.push(`${prefix}.bulkyWaste.contactCheckedAt is required for standard tier`);
    }
    if (!collectionMethodIsFilled(region.specialCollections?.medicine)) {
      errors.push(`${prefix}.specialCollections.medicine.method is required for standard tier`);
    }
    if (!collectionMethodIsFilled(region.specialCollections?.batteryAndFluorescentLamp)) {
      errors.push(`${prefix}.specialCollections.batteryAndFluorescentLamp.method is required for standard tier`);
    }
  }

  // 형식 검사는 티어를 보지 않고 "값이 있으면" 건다. `standard`의 필수 여섯 항목
  // 밖에서도 이 필드들을 담을 수 있고(성남시는 `full`인데 두 URL을 갖는다),
  // `formatRegionBulkyContactLines`는 티어와 무관하게 값이 있으면 그대로 답변에
  // 실어 보낸다 — standard 블록 안에만 두면 오타난 URL이 검사 없이 사용자에게 나간다.
  if (region.bulkyWaste?.applicationUrl !== undefined && !httpsUrl.test(region.bulkyWaste.applicationUrl)) {
    errors.push(`${prefix}.bulkyWaste.applicationUrl must be an https URL`);
  }
  if (region.bulkyWaste?.feeUrl !== undefined && !httpsUrl.test(region.bulkyWaste.feeUrl)) {
    errors.push(`${prefix}.bulkyWaste.feeUrl must be an https URL`);
  }
  if (region.bulkyWaste?.contactCheckedAt !== undefined && !isoDate.test(region.bulkyWaste.contactCheckedAt)) {
    errors.push(`${prefix}.bulkyWaste.contactCheckedAt must be YYYY-MM-DD`);
  }

  // 배출 전 부착물은 확인한 지역만 채운다. 값이 있으면 세 값 중 하나여야 하고,
  // metro에는 애초에 `bulkyWaste`가 없으므로 자연히 걸리지 않는다.
  if (region.bulkyWaste?.prePosting !== undefined && !prePostingKinds.has(region.bulkyWaste.prePosting)) {
    errors.push(
      `${prefix}.bulkyWaste.prePosting must be one of ${Array.from(prePostingKinds).join(", ")}`,
    );
  }

  if (region.bulkyWaste?.phone !== undefined) {
    const phone = region.bulkyWaste.phone;
    if (representativeComplaintPhone.test(phone)) {
      errors.push(`${prefix}.bulkyWaste.phone "${phone}" is a representative complaint line; use the desk's direct number`);
    } else if (!regionPhoneFormat.test(phone)) {
      errors.push(`${prefix}.bulkyWaste.phone "${phone}" must look like 02-1234-5678 or 1522-3833`);
    }
  }

  if (region.itemGuides !== undefined) {
    if (!Array.isArray(region.itemGuides)) {
      errors.push(`${prefix}.itemGuides must be an array when present`);
    } else {
      for (const [guideIndex, guide] of region.itemGuides.entries()) {
        const guidePrefix = `${prefix}.itemGuides[${guideIndex}]`;
        if (!Array.isArray(guide.itemIds) || guide.itemIds.length === 0) errors.push(`${guidePrefix}.itemIds must not be empty`);
        if (!isNonEmptyString(guide.summary)) errors.push(`${guidePrefix}.summary must be a non-empty string`);
        if (!Array.isArray(guide.steps) || guide.steps.length === 0) errors.push(`${guidePrefix}.steps must not be empty`);
        for (const itemId of guide.itemIds ?? []) {
          if (!ids.has(itemId)) warnings.push(`${guidePrefix}.itemIds includes unknown item id ${itemId}`);
        }
      }
    }
  }

  if (!Array.isArray(region.sources) || region.sources.length === 0) {
    errors.push(`${prefix}.sources must contain at least one source`);
  } else {
    for (const [sourceIndex, source] of region.sources.entries()) {
      const sourcePrefix = `${prefix}.sources[${sourceIndex}]`;
      if (!isNonEmptyString(source.title)) errors.push(`${sourcePrefix}.title must be a non-empty string`);
      if (!sourceTypes.has(source.sourceType)) errors.push(`${sourcePrefix}.sourceType must be one of ${Array.from(sourceTypes).join(", ")}`);
      if (!isoDate.test(source.checkedAt ?? "")) errors.push(`${sourcePrefix}.checkedAt must be YYYY-MM-DD`);
      if (source.url !== undefined && !/^https?:\/\//.test(source.url)) errors.push(`${sourcePrefix}.url must start with http:// or https://`);
      if (!isNonEmptyString(source.basis)) warnings.push(`${sourcePrefix}.basis should explain what the source supports`);
    }
    // 얕은 티어는 출처 URL이 유일한 검증 수단이라 제목만 있는 출처를 허용하지 않는다.
    if ((tier === "standard" || isMetro) && !region.sources.some((source) => httpsUrl.test(source.url ?? ""))) {
      errors.push(`${prefix}.sources must include at least one https URL for ${tier} tier`);
    }
  }
}

// 지역 별칭 충돌은 문자열 포함 여부가 아니라 실제 매칭 결과로 잡는다
// (`test-region-matching.ts`의 alias self-resolution 검사). 포함 규칙은 정상 구성인
// 동명 자치구의 대칭 별칭까지 error로 막아버려서 쓰지 못한다 — "중구"를 서울과
// 부산 양쪽에 다는 건 되묻기를 만드는 올바른 구성이지 충돌이 아니다.

for (const [index, schedule] of bulkyWasteFeeSchedules.entries()) {
  const prefix = `bulkyWasteFeeSchedule[${index}]${schedule?.regionId ? `(${schedule.regionId})` : ""}`;
  if (!isNonEmptyString(schedule.regionId)) errors.push(`${prefix}.regionId must be a non-empty string`);
  if (isNonEmptyString(schedule.regionId) && !regionIds.has(schedule.regionId)) {
    errors.push(`${prefix}.regionId references unknown region ${schedule.regionId}`);
  }
  if (!isNonEmptyString(schedule.regionName)) errors.push(`${prefix}.regionName must be a non-empty string`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.checkedAt ?? "")) errors.push(`${prefix}.checkedAt must be YYYY-MM-DD`);
  if (!/^https?:\/\//.test(schedule.applicationUrl ?? "")) errors.push(`${prefix}.applicationUrl must start with http:// or https://`);
  if (!/^https?:\/\//.test(schedule.feeUrl ?? "")) errors.push(`${prefix}.feeUrl must start with http:// or https://`);
  if (!isNonEmptyString(schedule.phone)) errors.push(`${prefix}.phone must be a non-empty string`);

  if (!schedule.source || typeof schedule.source !== "object") {
    errors.push(`${prefix}.source is required`);
  } else {
    if (!isNonEmptyString(schedule.source.title)) errors.push(`${prefix}.source.title must be a non-empty string`);
    if (!sourceTypes.has(schedule.source.sourceType)) {
      errors.push(`${prefix}.source.sourceType must be one of ${Array.from(sourceTypes).join(", ")}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.source.checkedAt ?? "")) {
      errors.push(`${prefix}.source.checkedAt must be YYYY-MM-DD`);
    }
    if (schedule.source.url !== undefined && !/^https?:\/\//.test(schedule.source.url)) {
      errors.push(`${prefix}.source.url must start with http:// or https://`);
    }
    // 조례를 근거로 든 수수료표는 조례 링크가 있어야 한다. 링크가 없으면 금액을
    // 되짚을 방법이 없고, 개정 여부도 확인할 수 없다. 자치법규 ETL로 들어오는
    // 행이라 사람이 손으로 채울 일이 없으므로 error로 막는다.
    if (schedule.source.sourceType === "law" && !isNonEmptyString(schedule.source.url)) {
      errors.push(`${prefix}.source.url is required when sourceType is law`);
    }
    if (!isNonEmptyString(schedule.source.basis)) warnings.push(`${prefix}.source.basis should explain what the source supports`);
  }

  // `feeUrl`은 region-policies와 이 파일에 같은 값으로 복제돼 있다. 사용자에게
  // 수수료 출처로 나가는 건 이쪽 값이고, `check:links`는 region-policies만 읽는다.
  // 그래서 한쪽만 고치면 링크 점검은 초록인데 답변에는 옛 주소가 나가는 상태가
  // 조용히 만들어진다(2026-08-15 성남시가 실제로 그랬다).
  const policyBulkyWaste = regionalPolicies.find((region) => region?.id === schedule.regionId)?.bulkyWaste;
  for (const field of ["applicationUrl", "feeUrl"]) {
    const scheduleUrl = schedule[field];
    const policyUrl = policyBulkyWaste?.[field];
    if (isNonEmptyString(scheduleUrl) && isNonEmptyString(policyUrl) && scheduleUrl !== policyUrl) {
      errors.push(`${prefix}.${field} must match region-policies ${schedule.regionId}.bulkyWaste.${field} (${policyUrl})`);
    }
  }

  if (!Array.isArray(schedule.fees) || schedule.fees.length === 0) {
    errors.push(`${prefix}.fees must contain at least one fee`);
  } else {
    // (regionId, itemId)당 행 상한. 근거는 출처가 아니라 응답 크기다 —
    // `formatBulkyWasteFeeLines`가 해당 품목 행을 전부 나열한다. 임포터에도 같은
    // 상한이 있지만 손으로 넣은 행은 그쪽을 거치지 않아 여기서도 막는다.
    const feeRowsByItemId = countBy(schedule.fees, (fee) => fee.itemId);
    for (const [itemId, count] of Object.entries(feeRowsByItemId)) {
      if (count > MAX_FEE_ROWS_PER_ITEM) {
        errors.push(`${prefix}.fees has ${count} rows for item ${itemId}; the cap is ${MAX_FEE_ROWS_PER_ITEM}`);
      }
    }

    // 상한에 걸린 품목은 잘리기 전 행 수를 함께 싣는다. 이 숫자는 그대로 사용자에게
    // "확인된 N개 규격 중 대표 12개"로 나가므로, 행을 손으로 지우면 남은 행보다 큰
    // 값만 덩그러니 남아 없는 규격을 있다고 말하게 된다. 임포터를 안 거치는 수정을
    // 여기서 잡는다.
    const preCapCounts = schedule.preCapFeeRowCountByItemId;
    if (preCapCounts !== undefined) {
      if (typeof preCapCounts !== "object" || preCapCounts === null || Array.isArray(preCapCounts)) {
        errors.push(`${prefix}.preCapFeeRowCountByItemId must be an object keyed by item id`);
      } else {
        for (const [itemId, total] of Object.entries(preCapCounts)) {
          const entryPrefix = `${prefix}.preCapFeeRowCountByItemId.${itemId}`;
          const rows = feeRowsByItemId[itemId] ?? 0;
          if (!ids.has(itemId)) {
            errors.push(`${entryPrefix} references unknown item ${itemId}`);
          } else if (rows === 0) {
            errors.push(`${entryPrefix} has no matching row in ${prefix}.fees`);
          } else if (!Number.isInteger(total) || total <= rows) {
            errors.push(`${entryPrefix} must be an integer greater than the ${rows} loaded rows (got ${JSON.stringify(total)})`);
          } else if (rows < MAX_FEE_ROWS_PER_ITEM) {
            errors.push(`${entryPrefix} claims a trim to ${rows} rows, below the ${MAX_FEE_ROWS_PER_ITEM} cap; drop the entry or restore the rows`);
          }
        }
      }
    }

    // 반대쪽 — 상한에 걸렸는데 행 수를 안 남긴 품목. 답변에는 12개가 전부인 것처럼
    // 나간다. 임포터를 다시 돌리면 채워지므로 error가 아니라 warning으로 남긴다.
    for (const [itemId, count] of Object.entries(feeRowsByItemId)) {
      if (count === MAX_FEE_ROWS_PER_ITEM && preCapCounts?.[itemId] === undefined) {
        warnings.push(
          `${prefix}.fees sits at the ${MAX_FEE_ROWS_PER_ITEM}-row cap for item ${itemId} without preCapFeeRowCountByItemId; re-run the importer so the answer can disclose the trim`,
        );
      }
    }
  }

  if (Array.isArray(schedule.fees) && schedule.fees.length > 0) {
    // 같은 (itemId, itemName, spec)이 두 번 나오면 한 규격에 금액이 둘 붙는다는
    // 뜻이라 답변에 같은 줄이 값만 다르게 두 번 찍힌다.
    //
    // 키에서 itemName을 빼면 안 된다. 조례·고시의 서로 다른 품목이 우리 itemId
    // 하나로 모이면서 spec 문구까지 같아지는 경우가 실제로 있다 — 마포구 chair
    // `1인당`(의자(바퀴) 4,000원 / 좌식의자·접의자 2,000원 / 쿠션 의자 2,000원),
    // 관악구 bed_frame `1인용`(접이식 침대 7,000원 / 돌+옥+황토 침대 20,000원).
    // `formatBulkyWasteFeeLines`가 찍는 줄이 `{itemName} {spec}: {금액}`이라
    // 이런 행은 화면에서 서로 다른 줄로 보인다 — 중복이 아니다.
    const seenFeeKeys = new Map();
    for (const [feeIndex, fee] of schedule.fees.entries()) {
      const feePrefix = `${prefix}.fees[${feeIndex}]`;
      const feeKey = `${fee.itemId}|${fee.itemName}|${fee.spec}`;
      const firstIndex = seenFeeKeys.get(feeKey);
      if (firstIndex !== undefined) {
        errors.push(`${feePrefix} duplicates fees[${firstIndex}] (${fee.itemId} / ${fee.itemName} / ${fee.spec})`);
      } else {
        seenFeeKeys.set(feeKey, feeIndex);
      }
      if (!isNonEmptyString(fee.itemId)) errors.push(`${feePrefix}.itemId must be a non-empty string`);
      if (isNonEmptyString(fee.itemId) && !ids.has(fee.itemId)) errors.push(`${feePrefix}.itemId references unknown item ${fee.itemId}`);
      if (!isNonEmptyString(fee.category)) errors.push(`${feePrefix}.category must be a non-empty string`);
      if (!isNonEmptyString(fee.itemName)) errors.push(`${feePrefix}.itemName must be a non-empty string`);
      if (!isNonEmptyString(fee.spec)) errors.push(`${feePrefix}.spec must be a non-empty string`);
      if (!Number.isInteger(fee.feeKrw) || fee.feeKrw < 0) errors.push(`${feePrefix}.feeKrw must be a non-negative integer`);
    }
  }
}

const answerCaseIds = new Set();
const answerCaseToolInputs = new Map();
for (const [index, testCase] of mcpAnswerCases.entries()) {
  const prefix = `mcpAnswerCase[${index}]${testCase?.id ? `(${testCase.id})` : ""}`;
  if (!isNonEmptyString(testCase.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  } else {
    if (!/^[a-z0-9_]+$/.test(testCase.id)) errors.push(`${prefix}.id must use lowercase snake_case`);
    if (answerCaseIds.has(testCase.id)) errors.push(`${prefix}.id is duplicated`);
    answerCaseIds.add(testCase.id);
  }

  if (!mcpToolNames.has(testCase.tool)) {
    errors.push(`${prefix}.tool must be one of ${Array.from(mcpToolNames).join(", ")}`);
  }

  if (!testCase.arguments || typeof testCase.arguments !== "object" || Array.isArray(testCase.arguments)) {
    errors.push(`${prefix}.arguments must be an object`);
  } else if (mcpToolNames.has(testCase.tool)) {
    const toolInputKey = `${testCase.tool}:${stableJsonStringify(testCase.arguments)}`;
    const existingId = answerCaseToolInputs.get(toolInputKey);
    if (existingId) {
      errors.push(`${prefix} duplicates tool/input already covered by ${existingId}`);
    } else if (isNonEmptyString(testCase.id)) {
      answerCaseToolInputs.set(toolInputKey, testCase.id);
    }
  }

  for (const field of [
    "expectedTextIncludes",
    "expectedTextExcludes",
    "expectedStructuredIncludes",
    "expectedStructuredExcludes",
  ]) {
    if (testCase[field] === undefined) continue;
    if (!Array.isArray(testCase[field])) {
      errors.push(`${prefix}.${field} must be an array when present`);
      continue;
    }
    const expectationValues = new Set();
    for (const [valueIndex, value] of testCase[field].entries()) {
      if (!isNonEmptyString(value)) errors.push(`${prefix}.${field}[${valueIndex}] must be a non-empty string`);
      if (expectationValues.has(value)) {
        errors.push(`${prefix}.${field}[${valueIndex}] duplicates an earlier expectation`);
      }
      expectationValues.add(value);
    }
  }

  for (const [includeField, excludeField] of [
    ["expectedTextIncludes", "expectedTextExcludes"],
    ["expectedStructuredIncludes", "expectedStructuredExcludes"],
  ]) {
    const excludedValues = new Set(testCase[excludeField] ?? []);
    for (const value of testCase[includeField] ?? []) {
      if (excludedValues.has(value)) {
        errors.push(`${prefix}.${includeField} conflicts with ${excludeField} for "${value}"`);
      }
    }
  }

  if (testCase.expectedRegionNotes !== undefined) {
    const expectation = testCase.expectedRegionNotes;
    if (!expectation || typeof expectation !== "object" || Array.isArray(expectation)) {
      errors.push(`${prefix}.expectedRegionNotes must be an object when present`);
    } else {
      if (typeof expectation.present !== "boolean") {
        errors.push(`${prefix}.expectedRegionNotes.present must be a boolean`);
      }
      if (expectation.includes !== undefined) {
        if (!Array.isArray(expectation.includes) || expectation.includes.some((value) => !isNonEmptyString(value))) {
          errors.push(`${prefix}.expectedRegionNotes.includes must be an array of non-empty strings when present`);
        }
        if (expectation.present === false) {
          errors.push(`${prefix}.expectedRegionNotes.includes cannot be combined with present=false`);
        }
      }
      if (testCase.tool !== "get_disposal_steps") {
        errors.push(`${prefix}.expectedRegionNotes is only valid for get_disposal_steps cases`);
      }
    }
  }

  const hasExpectation = [
    "expectedTextIncludes",
    "expectedTextExcludes",
    "expectedStructuredIncludes",
    "expectedStructuredExcludes",
  ].some((field) => Array.isArray(testCase[field]) && testCase[field].length > 0) || testCase.expectedRegionNotes !== undefined;
  if (!hasExpectation) {
    errors.push(`${prefix} must include at least one expectation`);
  }
}

for (const item of items) {
  const regionCheckLevel = item.regionPolicy?.regionCheckLevel;
  if (regionCheckLevel === undefined) continue;

  const expectedLevel = regionCheckLevelToExpectedPolicyLevel[regionCheckLevel];
  const expectedItemId = `"id":"${item.id}"`;
  const expectedLevelAssertion = `"regionCheckLevel":"${expectedLevel}"`;
  const hasAnswerCoverage = mcpAnswerCases.some(
    (testCase) =>
      Array.isArray(testCase.expectedStructuredIncludes) &&
      testCase.expectedStructuredIncludes.includes(expectedItemId) &&
      testCase.expectedStructuredIncludes.includes(expectedLevelAssertion),
  );

  if (!hasAnswerCoverage) {
    errors.push(
      `item(${item.id}).regionPolicy.regionCheckLevel must have an MCP answer case asserting ${expectedLevelAssertion}`,
    );
  }
}

const materialGuidelineIds = new Set();
for (const [index, guideline] of materialGuidelines.entries()) {
  const prefix = `materialGuideline[${index}]${guideline?.id ? `(${guideline.id})` : ""}`;

  if (!guideline || typeof guideline !== "object" || Array.isArray(guideline)) {
    errors.push(`${prefix} must be an object`);
    continue;
  }

  if (!isNonEmptyString(guideline.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  } else {
    if (!/^[a-z0-9_]+$/.test(guideline.id)) errors.push(`${prefix}.id must use lowercase snake_case`);
    if (materialGuidelineIds.has(guideline.id)) errors.push(`${prefix}.id is duplicated`);
    materialGuidelineIds.add(guideline.id);
  }

  for (const field of ["label", "quickRule", "whenGeneral"]) {
    if (!isNonEmptyString(guideline[field])) errors.push(`${prefix}.${field} must be a non-empty string`);
  }

  if (!Array.isArray(guideline.steps) || guideline.steps.length < 2 || guideline.steps.length > 3) {
    errors.push(`${prefix}.steps must contain 2 to 3 entries`);
  } else {
    for (const [stepIndex, step] of guideline.steps.entries()) {
      if (!isNonEmptyString(step)) errors.push(`${prefix}.steps[${stepIndex}] must be a non-empty string`);
    }
  }

  if (!Array.isArray(guideline.cautions) || guideline.cautions.length < 1 || guideline.cautions.length > 2) {
    errors.push(`${prefix}.cautions must contain 1 to 2 entries`);
  } else {
    for (const [cautionIndex, caution] of guideline.cautions.entries()) {
      if (!isNonEmptyString(caution)) errors.push(`${prefix}.cautions[${cautionIndex}] must be a non-empty string`);
    }
  }

  if (!guideline.source || typeof guideline.source !== "object") {
    errors.push(`${prefix}.source is required`);
  } else {
    if (!isNonEmptyString(guideline.source.title)) errors.push(`${prefix}.source.title must be a non-empty string`);
    if (guideline.source.url !== undefined && !/^https?:\/\//.test(guideline.source.url)) {
      errors.push(`${prefix}.source.url must start with http:// or https://`);
    }
  }
}

const questionBacklogIds = new Set();
for (const [index, question] of questionBacklog.entries()) {
  const prefix = `questionBacklog[${index}]${question?.id ? `(${question.id})` : ""}`;

  if (!isNonEmptyString(question.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  } else {
    if (!/^[a-z0-9_]+$/.test(question.id)) errors.push(`${prefix}.id must use lowercase snake_case`);
    if (questionBacklogIds.has(question.id)) errors.push(`${prefix}.id is duplicated`);
    questionBacklogIds.add(question.id);
  }

  for (const field of ["query", "type", "status", "priority", "observed", "expectedAction"]) {
    if (!isNonEmptyString(question[field])) errors.push(`${prefix}.${field} must be a non-empty string`);
  }

  if (question.region !== undefined && !isNonEmptyString(question.region)) {
    errors.push(`${prefix}.region must be a non-empty string when present`);
  }

  if (!questionBacklogTypes.has(question.type)) {
    errors.push(`${prefix}.type must be one of ${Array.from(questionBacklogTypes).join(", ")}`);
  }

  if (!questionBacklogStatuses.has(question.status)) {
    errors.push(`${prefix}.status must be one of ${Array.from(questionBacklogStatuses).join(", ")}`);
  }

  if (!questionBacklogPriorities.has(question.priority)) {
    errors.push(`${prefix}.priority must be one of ${Array.from(questionBacklogPriorities).join(", ")}`);
  }

  if (!Array.isArray(question.candidateItemIds)) {
    errors.push(`${prefix}.candidateItemIds must be an array`);
  } else {
    for (const [candidateIndex, itemId] of question.candidateItemIds.entries()) {
      if (!isNonEmptyString(itemId)) {
        errors.push(`${prefix}.candidateItemIds[${candidateIndex}] must be a non-empty string`);
      } else if (!ids.has(itemId)) {
        warnings.push(`${prefix}.candidateItemIds[${candidateIndex}] references unknown item ${itemId}`);
      }
    }
  }

  if (question.notes !== undefined) {
    if (!Array.isArray(question.notes)) {
      errors.push(`${prefix}.notes must be an array when present`);
    } else {
      for (const [noteIndex, note] of question.notes.entries()) {
        if (!isNonEmptyString(note)) errors.push(`${prefix}.notes[${noteIndex}] must be a non-empty string`);
      }
    }
  }
}

/**
 * PRD phase-12 R3 — `spotNm` 정규화 묶음표.
 *
 * **키 순서가 계약이다.** `폐형광등∙폐건전지 전용 배출함`처럼 두 묶음 표기를 겸하는 이름이
 * 실제로 있어서 먼저 걸리는 묶음이 이기고, 전체 12곳 상한도 이 순서로 채운다. 순서가 바뀌면
 * 응답이 조용히 달라지는데 스키마 검사만으로는 안 걸리므로 목록을 그대로 박아 둔다.
 * 묶음을 더하거나 순서를 바꿀 때는 PRD 표와 이 배열을 함께 고친다.
 */
const spotCategoryOrder = [
  "medicine",
  "battery_lamp",
  "clothing",
  "electronics",
  "pet_bottle",
  "food",
  "cooking_oil",
  "trash_bag",
  "etc",
];

if (!spotCategories || typeof spotCategories !== "object" || Array.isArray(spotCategories)) {
  throw new Error("src/data/spot-categories.json must contain an object map");
}

const spotCategoryIds = Object.keys(spotCategories);
if (spotCategoryIds.join(",") !== spotCategoryOrder.join(",")) {
  errors.push(
    `spot-categories.json 키 순서가 계약과 다르다 — 기대: ${spotCategoryOrder.join(", ")} / 실제: ${spotCategoryIds.join(", ")}`,
  );
}

const spotCategoryItemOwner = new Map();
for (const [index, [id, category]] of Object.entries(spotCategories).entries()) {
  const prefix = `spotCategories["${id}"]`;
  const isCatchAll = index === spotCategoryIds.length - 1;

  if (!isNonEmptyString(category.label)) {
    errors.push(`${prefix}.label must be a non-empty string`);
  } else if (!/[가-힣]/.test(category.label)) {
    errors.push(`${prefix}.label must be a Korean label, got "${category.label}"`);
  }

  // 폴백 문장은 묶음표가 스스로 들고 있어야 한다. 지역 함수는 폐의약품·전지만 다뤄서,
  // 의류·페트병·소형가전은 이 줄이 없으면 폴백에서 할 말이 사라진다(PRD phase-12 R5).
  if (!isNonEmptyString(category.fallbackLine)) {
    errors.push(`${prefix}.fallbackLine must be a non-empty string`);
  } else if (!/[가-힣]/.test(category.fallbackLine)) {
    errors.push(`${prefix}.fallbackLine must be a Korean sentence`);
  }

  if (!Array.isArray(category.patterns)) {
    errors.push(`${prefix}.patterns must be an array`);
  } else {
    for (const [patternIndex, pattern] of category.patterns.entries()) {
      if (!isNonEmptyString(pattern)) errors.push(`${prefix}.patterns[${patternIndex}] must be a non-empty string`);
    }
    // 마지막 묶음은 나머지를 전부 받는 자리라 패턴이 없어야 하고, 그 앞은 반드시 있어야 한다.
    // 앞 묶음의 패턴이 비면 어떤 이름도 안 걸려 그 묶음이 통째로 죽는다.
    if (isCatchAll && category.patterns.length > 0) {
      errors.push(`${prefix}는 마지막 묶음(나머지 전부)이라 patterns가 비어 있어야 한다`);
    }
    if (!isCatchAll && category.patterns.length === 0) {
      errors.push(`${prefix}.patterns가 비어 있어 이 묶음에는 어떤 장소도 걸리지 않는다`);
    }
  }

  if (!Array.isArray(category.itemIds)) {
    errors.push(`${prefix}.itemIds must be an array`);
  } else {
    for (const [itemIndex, itemId] of category.itemIds.entries()) {
      if (!isNonEmptyString(itemId)) {
        errors.push(`${prefix}.itemIds[${itemIndex}] must be a non-empty string`);
      } else if (!ids.has(itemId)) {
        errors.push(`${prefix}.itemIds[${itemIndex}] references unknown item ${itemId}`);
      } else if (spotCategoryItemOwner.has(itemId)) {
        // 품목 → 묶음 역인덱스는 먼저 나온 묶음이 이긴다. 같은 품목을 두 묶음이 적으면
        // 뒤쪽은 조용히 지므로, 의도인지 실수인지 여기서 못 박는다.
        errors.push(`${prefix}.itemIds[${itemIndex}] ${itemId}는 이미 ${spotCategoryItemOwner.get(itemId)}에 있다`);
      } else {
        spotCategoryItemOwner.set(itemId, id);
      }
    }
  }

  if (category.defaultExposed !== undefined && typeof category.defaultExposed !== "boolean") {
    errors.push(`${prefix}.defaultExposed must be a boolean when present`);
  }
}

if (warnings.length > 0) {
  console.warn(`Data validation warnings (${warnings.length}):`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length > 0) {
  console.error(`Data validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Data validation passed: ${items.length} waste items, ${regionalPolicies.length} regional policies`);
