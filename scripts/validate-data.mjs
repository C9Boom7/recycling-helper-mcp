import { readFileSync } from "node:fs";

const dataPath = new URL("../src/data/waste-items.json", import.meta.url);
const regionPolicyPath = new URL("../src/data/region-policies.json", import.meta.url);
const bulkyWasteFeesPath = new URL("../src/data/bulky-waste-fees.json", import.meta.url);
const items = JSON.parse(readFileSync(dataPath, "utf8"));
const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8"));
const bulkyWasteFeeSchedules = JSON.parse(readFileSync(bulkyWasteFeesPath, "utf8"));

const confidenceValues = new Set(["high", "medium", "low"]);
const sourceTypes = new Set(["official_guidance", "local_guidance", "law", "safety_guidance", "manual_review"]);
const reviewStatuses = new Set(["draft", "needs_source", "verified", "region_review_needed"]);
const regionScopes = new Set(["national_default", "region_specific", "local_collection_point", "bulky_waste"]);

const errors = [];
const warnings = [];
const ids = new Set();
const names = new Set();

function at(index, id, field) {
  return `item[${index}]${id ? `(${id})` : ""}.${field}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
