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
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const httpsUrl = /^https:\/\//;

function collectionMethodIsFilled(collection) {
  return Array.isArray(collection?.method) && collection.method.some((method) => isNonEmptyString(method));
}

const regionIds = new Set();
for (const [index, region] of regionalPolicies.entries()) {
  const prefix = `region[${index}]${region?.id ? `(${region.id})` : ""}`;
  const tier = region.coverageTier;
  const isMetro = tier === "metro";

  if (!isNonEmptyString(region.id)) errors.push(`${prefix}.id must be a non-empty string`);
  if (!isNonEmptyString(region.name)) errors.push(`${prefix}.name must be a non-empty string`);
  if (!Array.isArray(region.aliases) || region.aliases.length === 0) errors.push(`${prefix}.aliases must not be empty`);
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
    if (!isNonEmptyString(region.metroId)) errors.push(`${prefix}.metroId is required for district-level regions`);
    else if (!metroRegionIds.has(region.metroId)) errors.push(`${prefix}.metroId references unknown metro region ${region.metroId}`);
  }

  if (tier === "full") {
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
      if (!httpsUrl.test(bulkyWaste.applicationUrl ?? "")) errors.push(`${prefix}.bulkyWaste.applicationUrl must be an https URL`);
      if (!httpsUrl.test(bulkyWaste.feeUrl ?? "")) errors.push(`${prefix}.bulkyWaste.feeUrl must be an https URL`);
      if (!isNonEmptyString(bulkyWaste.phone)) errors.push(`${prefix}.bulkyWaste.phone is required for standard tier`);
      if (!isoDate.test(bulkyWaste.contactCheckedAt ?? "")) errors.push(`${prefix}.bulkyWaste.contactCheckedAt must be YYYY-MM-DD`);
    }
    if (!collectionMethodIsFilled(region.specialCollections?.medicine)) {
      errors.push(`${prefix}.specialCollections.medicine.method is required for standard tier`);
    }
    if (!collectionMethodIsFilled(region.specialCollections?.batteryAndFluorescentLamp)) {
      errors.push(`${prefix}.specialCollections.batteryAndFluorescentLamp.method is required for standard tier`);
    }
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
// (`evaluate-data.mjs`의 alias self-resolution 검사). 포함 규칙은 정상 구성인
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
