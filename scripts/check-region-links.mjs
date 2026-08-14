import { readFileSync } from "node:fs";

/**
 * 지역 데이터에 등록된 신고·수수료·출처 URL이 아직 살아 있는지 확인한다.
 *
 * 지자체 신청 URL은 홈페이지·조직 개편 때 조용히 바뀌고, 코드 프리징 이후에는
 * 고칠 수 없다. 마감 직전 전수 점검을 한 번의 명령으로 끝내려고 분리한
 * 스크립트라 `pnpm check`에는 넣지 않는다 — 네트워크에 의존해 CI에서 불안정하다.
 */
const regionPolicyPath = new URL("../src/data/region-policies.json", import.meta.url);
const regionalPolicies = JSON.parse(readFileSync(regionPolicyPath, "utf8"));

// 다수 지자체 사이트가 기본 fetch UA를 막고 403이나 빈 응답을 준다. 브라우저
// UA를 쓰지 않으면 멀쩡한 링크가 전부 죽은 것으로 보고된다.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
// 지자체 사이트는 응답이 느리고 같은 호스트로 몰아치면 조용히 막는다. 여유 있는
// 타임아웃과 낮은 동시성, 같은 호스트 사이 간격이 오탐을 줄인다.
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 3;
const SAME_HOST_DELAY_MS = 700;

function collectTargets() {
  const targets = [];

  for (const region of regionalPolicies) {
    const { applicationUrl, feeUrl } = region.bulkyWaste ?? {};
    if (applicationUrl) targets.push({ regionId: region.id, field: "bulkyWaste.applicationUrl", url: applicationUrl });
    if (feeUrl) targets.push({ regionId: region.id, field: "bulkyWaste.feeUrl", url: feeUrl });

    for (const [index, source] of (region.sources ?? []).entries()) {
      if (source.url) targets.push({ regionId: region.id, field: `sources[${index}].url`, url: source.url });
    }
  }

  // 같은 URL이 여러 지역·필드에 걸리면 한 번만 두드린다.
  const seen = new Map();
  for (const target of targets) {
    if (!seen.has(target.url)) seen.set(target.url, target);
  }
  return Array.from(seen.values());
}

async function checkTarget(target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // redirect: "manual"이라야 조용한 도메인 변경을 잡는다. 자동 추적하면
    // 엉뚱한 곳으로 옮겨간 링크도 200으로 보인다.
    const response = await fetch(target.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ...target, level: "warn", detail: `${response.status} redirect without a Location header` };

      const redirectHost = new URL(location, target.url).host;
      const level = redirectHost === new URL(target.url).host ? "warn" : "error";
      return { ...target, level, detail: `${response.status} redirect to ${location}` };
    }

    if (response.status === 404 || response.status === 410) {
      return { ...target, level: "error", detail: `${response.status} the page is gone` };
    }

    if (!response.ok) {
      return { ...target, level: "warn", detail: `${response.status} ${response.statusText}` };
    }

    return { ...target, level: "ok", detail: `${response.status}` };
  } catch (error) {
    return { ...target, level: "warn", detail: `request failed: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPool(targets) {
  const results = [];
  const lastHitByHost = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      const host = new URL(target.url).host;
      const waitFor = (lastHitByHost.get(host) ?? 0) + SAME_HOST_DELAY_MS - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      lastHitByHost.set(host, Date.now());
      results.push(await checkTarget(target));
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return results;
}

const targets = collectTargets();
if (targets.length === 0) {
  console.log("No region links to check.");
  process.exit(0);
}

const results = await runPool(targets);
const errors = results.filter((result) => result.level === "error");
const warnings = results.filter((result) => result.level === "warn");

for (const result of [...errors, ...warnings]) {
  console.error(`- [${result.level}] ${result.regionId}.${result.field}: ${result.detail}\n  ${result.url}`);
}

console.log(`Checked ${results.length} region links: ${results.length - errors.length - warnings.length} ok, ${warnings.length} warning, ${errors.length} error`);

if (errors.length > 0) process.exit(1);
