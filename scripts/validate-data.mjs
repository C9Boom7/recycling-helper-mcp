import { readFileSync } from "node:fs";

const dataPath = new URL("../src/data/waste-items.json", import.meta.url);
const regionPolicyPath = new URL("../src/data/region-policies.json", import.meta.url);
const bulkyWasteFeesPath = new URL("../src/data/bulky-waste-fees.json", import.meta.url);
const evaluationCasesPath = new URL("../src/data/evaluation-cases.json", import.meta.url);
const mcpAnswerCasesPath = new URL("../src/data/mcp-answer-cases.json", import.meta.url);
const questionBacklogPath = new URL("../src/data/question-backlog.json", import.meta.url);
const materialGuidelinesPath = new URL("../src/data/material-guidelines.json", import.meta.url);
const sourceCoveragePath = new URL("../docs/source-coverage.md", import.meta.url);
const sessionCoordinationPath = new URL("../docs/session-coordination.md", import.meta.url);
const items = JSON.parse(readFileSync(dataPath, "utf8"));
const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8"));
const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeesPath, "utf8"));
const evaluationCases = JSON.parse(readFileSync(evaluationCasesPath, "utf8"));
const mcpAnswerCases = JSON.parse(readFileSync(mcpAnswerCasesPath, "utf8"));
const questionBacklog = JSON.parse(readFileSync(questionBacklogPath, "utf8"));
const materialGuidelines = JSON.parse(readFileSync(materialGuidelinesPath, "utf8"));
const sourceCoverage = readFileSync(sourceCoveragePath, "utf8");
const sessionCoordination = readFileSync(sessionCoordinationPath, "utf8");

const confidenceValues = new Set(["high", "medium", "low"]);
const sourceTypes = new Set(["official_guidance", "local_guidance", "law", "safety_guidance", "manual_review"]);
const reviewStatuses = new Set(["draft", "needs_source", "verified", "region_review_needed"]);
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
expectAllDocumentCounts("docs/session-coordination.md MCP answer cases", sessionCoordination, /MCP answer cases (\d+)개/g, mcpAnswerCases.length);
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
  }
}

const regionIds = new Set();
for (const [index, region] of regionalPolicies.entries()) {
  const prefix = `region[${index}]${region?.id ? `(${region.id})` : ""}`;
  if (!isNonEmptyString(region.id)) errors.push(`${prefix}.id must be a non-empty string`);
  if (!isNonEmptyString(region.name)) errors.push(`${prefix}.name must be a non-empty string`);
  if (!Array.isArray(region.aliases) || region.aliases.length === 0) errors.push(`${prefix}.aliases must not be empty`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(region.checkedAt ?? "")) errors.push(`${prefix}.checkedAt must be YYYY-MM-DD`);
  if (!isNonEmptyString(region.summary)) errors.push(`${prefix}.summary must be a non-empty string`);

  if (isNonEmptyString(region.id)) {
    if (!/^[a-z0-9_]+$/.test(region.id)) errors.push(`${prefix}.id must use lowercase snake_case`);
    if (regionIds.has(region.id)) errors.push(`${prefix}.id is duplicated`);
    regionIds.add(region.id);
  }

  if (!region.generalWaste || !isNonEmptyString(region.generalWaste.time) || !isNonEmptyString(region.generalWaste.place)) {
    errors.push(`${prefix}.generalWaste must include time and place`);
  }
  if (!region.recycling || !isNonEmptyString(region.recycling.vinylAndPetDay) || !isNonEmptyString(region.recycling.otherDays)) {
    errors.push(`${prefix}.recycling must include vinylAndPetDay and otherDays`);
  }
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
  if (!Array.isArray(region.itemGuides)) {
    errors.push(`${prefix}.itemGuides must be an array`);
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
  if (!Array.isArray(region.sources) || region.sources.length === 0) {
    errors.push(`${prefix}.sources must contain at least one source`);
  } else {
    for (const [sourceIndex, source] of region.sources.entries()) {
      const sourcePrefix = `${prefix}.sources[${sourceIndex}]`;
      if (!isNonEmptyString(source.title)) errors.push(`${sourcePrefix}.title must be a non-empty string`);
      if (!sourceTypes.has(source.sourceType)) errors.push(`${sourcePrefix}.sourceType must be one of ${Array.from(sourceTypes).join(", ")}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt ?? "")) errors.push(`${sourcePrefix}.checkedAt must be YYYY-MM-DD`);
      if (source.url !== undefined && !/^https?:\/\//.test(source.url)) errors.push(`${sourcePrefix}.url must start with http:// or https://`);
      if (!isNonEmptyString(source.basis)) warnings.push(`${sourcePrefix}.basis should explain what the source supports`);
    }
  }
}

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
    if (!isNonEmptyString(schedule.source.basis)) warnings.push(`${prefix}.source.basis should explain what the source supports`);
  }

  if (!Array.isArray(schedule.fees) || schedule.fees.length === 0) {
    errors.push(`${prefix}.fees must contain at least one fee`);
  } else {
    for (const [feeIndex, fee] of schedule.fees.entries()) {
      const feePrefix = `${prefix}.fees[${feeIndex}]`;
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
