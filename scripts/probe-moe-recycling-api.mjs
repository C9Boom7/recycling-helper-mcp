/**
 * 기후에너지환경부_분리배출 정보조회 서비스 탐침 (공공데이터포털 15156866).
 *
 * 두 오퍼레이션의 실제 응답을 받아 `logs/moe-api/` 아래 원문으로 남기고, 요약을 찍는다.
 * 본선 이후 과제 5번의 "키를 받으면 스키마와 커버리지를 확인해 기록한다"에 해당한다.
 * 런타임 코드와는 무관하다 — 연동 여부는 이 결과를 보고 정한다.
 *
 *   getItem  품목명 → 대표 배출방법 (itemNm, dschgMthd)
 *   getSpot  동/읍/면 또는 좌표 → 분리배출 장소 (spotNm, addrBase, addrDtl)
 *
 * 인증키는 `DATA_GO_KR_SERVICE_KEY` 환경변수로 받는다. 없으면 저장소 루트(워크트리면
 * 메인 저장소 루트까지)의 `.env`에서 같은 이름을 읽는다. 디코딩 키(`%`가 없는 쪽)를 넣는다 —
 * 인코딩 키를 넣어도 `%`가 보이면 그대로 쓴다.
 *
 * 실행:
 *   node scripts/probe-moe-recycling-api.mjs item 생수병 우유팩 매트리스
 *   node scripts/probe-moe-recycling-api.mjs item --catalogue        # waste-items.json 이름 전부
 *   node scripts/probe-moe-recycling-api.mjs item --catalogue --aliases  # 별칭까지
 *   node scripts/probe-moe-recycling-api.mjs item --enumerate   # 그쪽 사전 전수 수집 (음절 너비우선)
 *   node scripts/probe-moe-recycling-api.mjs spot --addr 문래동 --addr 역삼동
 *   node scripts/probe-moe-recycling-api.mjs spot --lat 37.5182 --lng 126.8959 --radius 1000
 *
 * 결과: logs/moe-api/<YYYYMMDD-HHMMSS>-<item|spot>.json (gitignore 대상), 요약은 stdout.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://apis.data.go.kr/1482000/WasteRecyclingService";
const REQUEST_DELAY_MS = 150;
const TIMEOUT_MS = 20_000;
const OUT_DIR = "logs/moe-api";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function readKey() {
  if (process.env.DATA_GO_KR_SERVICE_KEY) return process.env.DATA_GO_KR_SERVICE_KEY.trim();
  // 워크트리에서 돌리면 `.claude/worktrees/<name>`이 루트라, 그때만 메인 저장소 루트도 본다.
  // 워크트리가 아닐 때 세 단계 위로 올라가면 프로젝트 밖(`/Users/.env` 같은 곳)을 읽게 된다.
  const candidates = [resolve(repoRoot, ".env")];
  if (/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.test(repoRoot)) candidates.push(resolve(repoRoot, "../../..", ".env"));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    const named = lines.find((l) => l.replace(/^export\s+/, "").startsWith("DATA_GO_KR_SERVICE_KEY="));
    if (named) return named.replace(/^export\s+/, "").slice("DATA_GO_KR_SERVICE_KEY=".length).replace(/^["']|["']$/g, "").trim();
    // 이름 없이 키만 한 줄 적어 둔 파일도 받는다. 포털 키 모양(base64/URL 인코딩 문자만, 40자 이상)인
    // 줄만 본다 — 아무 긴 줄이나 키로 잡아 외부로 보내면 안 된다.
    // 디코딩 키는 base64 패딩 `=`로 끝날 수 있으니 "이름=값" 모양만 제외한다.
    const bare = lines.find((l) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(l) && /^[A-Za-z0-9+/%_-]{40,}={0,2}$/.test(l));
    if (bare) return bare;
  }
  return undefined;
}

const key = readKey();
if (!key) {
  console.error("DATA_GO_KR_SERVICE_KEY가 없다. 환경변수로 주거나 저장소 루트 .env에 `DATA_GO_KR_SERVICE_KEY=...`로 적는다.");
  process.exit(2);
}
// 디코딩 키는 URLSearchParams가 인코딩한다. 인코딩 키(`%`가 들어 있음)는 두 번 인코딩되지 않게 그대로 붙인다.
const keyParam = key.includes("%") ? key : encodeURIComponent(key);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function call(op, params, attempt = 1) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE}/${op}?serviceKey=${keyParam}&${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text.slice(0, 2000) };
    }
    return { http: res.status, ms: Date.now() - startedAt, body };
  } catch (error) {
    // 한 번은 다시 친다 — DNS 순간 장애나 끊긴 연결로 두 시간짜리 수집을 잃지 않게.
    if (attempt < 2) {
      await sleep(1000);
      return call(op, params, attempt + 1);
    }
    return { http: 0, ms: Date.now() - startedAt, body: { _error: String(error?.message ?? error) } };
  } finally {
    clearTimeout(timer);
  }
}

/** 호출이 성공했는지. 정상(00)과 결과 없음(03)만 성공이다 — 한도 초과(22)·키 오류도 실패로 센다. */
function callOk(http, resultCode) {
  return http === 200 && (resultCode === "00" || resultCode === "03" || resultCode === "0" || resultCode === "3");
}

/** 응답 모양이 문서와 다를 수 있어 header/body를 넉넉하게 찾는다. */
function unpack(body) {
  // 게이트웨이 오류(키 누락·한도 초과 등)는 JSON이 아니라 XML로 온다. 그대로 두면 코드가 안 읽혀
  // 한도 초과(22)를 못 알아보고 죽은 한도에 계속 친다.
  if (typeof body?._raw === "string") {
    const code = body._raw.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/)?.[1];
    const msg = body._raw.match(/<errMsg>([^<]*)<\/errMsg>/)?.[1] ?? body._raw.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)?.[1];
    return { resultCode: code, resultMsg: msg ?? body._raw.slice(0, 200), totalCount: undefined, items: [] };
  }
  const root = body?.response ?? body;
  const header = Array.isArray(root?.header) ? root.header[0] : root?.header;
  const b = Array.isArray(root?.body) ? root.body[0] : root?.body;
  let items = b?.items?.item ?? b?.items ?? [];
  if (items && !Array.isArray(items)) items = [items];
  if (Array.isArray(items) && items.length === 1 && Array.isArray(items[0]?.item)) items = items[0].item;
  return {
    resultCode: header?.resultCode ?? body?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode,
    resultMsg: header?.resultMsg ?? body?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg,
    totalCount: b?.totalCount,
    items: Array.isArray(items) ? items : [],
  };
}

function parseArgs(argv) {
  const mode = argv[0];
  const flags = { positional: [], addr: [], aliases: false, catalogue: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--catalogue") flags.catalogue = true;
    else if (a === "--enumerate") flags.enumerate = true;
    else if (a === "--aliases") flags.aliases = true;
    else if (a === "--addr") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        console.error("--addr 뒤에 동 이름이 없다.");
        process.exit(2);
      }
      flags.addr.push(value);
    }
    else if (a === "--lat") flags.lat = argv[++i];
    else if (a === "--lng") flags.lng = argv[++i];
    else if (a === "--radius") flags.radius = argv[++i];
    else if (a === "--rows") flags.rows = Number(argv[++i]);
    else flags.positional.push(a);
  }
  return { mode, flags };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function save(kind, payload) {
  mkdirSync(resolve(repoRoot, OUT_DIR), { recursive: true });
  const path = resolve(repoRoot, OUT_DIR, `${stamp()}-${kind}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

async function probeItems(names, rows) {
  const results = [];
  let hit = 0;
  const failures = [];
  for (const name of names) {
    const r = await call("getItem", { pageNo: 1, numOfRows: rows ?? 20, itemNm: name });
    const u = unpack(r.body);
    if (!callOk(r.http, u.resultCode)) failures.push(`${name}: http=${r.http} code=${u.resultCode ?? "?"} ${u.resultMsg ?? r.body?._error ?? ""}`);
    const ok = u.resultCode === "00" || u.resultCode === "0";
    if (ok && u.items.length > 0) hit++;
    results.push({ query: name, http: r.http, ms: r.ms, resultCode: u.resultCode, resultMsg: u.resultMsg, totalCount: u.totalCount, items: u.items, raw: ok ? undefined : r.body });
    const first = u.items[0];
    console.log(
      `${name.padEnd(14)} ${String(r.http)} ${String(r.ms).padStart(5)}ms code=${u.resultCode ?? "?"} total=${u.totalCount ?? "?"}` +
        (first ? ` | ${first.itemNm ?? ""} — ${String(first.dschgMthd ?? "").slice(0, 70)}` : u.resultMsg ? ` | ${u.resultMsg}` : ""),
    );
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`\n적중 ${hit}/${names.length}${failures.length ? ` · 실패 ${failures.length}건` : ""}`);
  return { results, failures };
}

async function probeSpots(flags) {
  const results = [];
  const failures = [];
  const queries = flags.addr.length > 0 ? flags.addr.map((addr) => ({ addr })) : [{}];
  for (const q of queries) {
    const params = { pageNo: 1, numOfRows: flags.rows ?? 50, addr: q.addr, latitude: flags.lat, longitude: flags.lng, radius: flags.radius };
    const r = await call("getSpot", params);
    const u = unpack(r.body);
    if (!callOk(r.http, u.resultCode)) failures.push(`${JSON.stringify(params)}: http=${r.http} code=${u.resultCode ?? "?"} ${u.resultMsg ?? r.body?._error ?? ""}`);
    results.push({ params, http: r.http, ms: r.ms, resultCode: u.resultCode, resultMsg: u.resultMsg, totalCount: u.totalCount, items: u.items, raw: u.items.length === 0 ? r.body : undefined });
    console.log(`${JSON.stringify(params)} → ${r.http} ${r.ms}ms code=${u.resultCode ?? "?"} total=${u.totalCount ?? "?"} rows=${u.items.length}`);
    for (const s of u.items.slice(0, 8)) console.log(`   - ${s.spotNm ?? "?"} | ${s.addrBase ?? ""} ${s.addrDtl ?? ""} ${Object.keys(s).filter((k) => !["spotNm", "addrBase", "addrDtl"].includes(k)).map((k) => `${k}=${s[k]}`).join(" ")}`);
    await sleep(REQUEST_DELAY_MS);
  }
  return { results, failures };
}

/**
 * getItem은 품목명 부분일치 검색이라, 음절 하나로 치면 그 음절이 든 품목이 전부 온다.
 * 우리 품목명·별칭의 음절에서 출발해 새로 본 품목명의 음절로 넓혀 가면 그쪽 사전이
 * 거의 닫힌다. 목록 전체를 주는 오퍼레이션이 없어 이 방법뿐이다.
 */
async function enumerateCatalogue() {
  const items = JSON.parse(readFileSync(resolve(repoRoot, "src/data/waste-items.json"), "utf8"));
  const seed = new Set();
  // 한글 음절에 라틴 대문자와 숫자도 넣는다 — 「CD」·「VR 게임기」처럼 한글이 없는 품목명은 음절로는
  // 못 닿는다. 대소문자는 서버가 구분하지 않는 것으로 보여(「D」로 「CD」가 온다) 대문자만 친다.
  const SEARCHABLE = /[가-힣A-Z0-9]/;
  const addSyllables = (text) => {
    for (const ch of String(text ?? "").toUpperCase()) if (SEARCHABLE.test(ch)) seed.add(ch);
  };
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") seed.add(ch);
  for (const item of items) {
    addSyllables(item.name);
    for (const alias of item.aliases ?? []) addSyllables(alias);
  }
  const queried = new Set();
  const found = new Map(); // itemNm -> dschgMthd
  let queue = [...seed];
  let round = 0;
  let calls = 0;
  const failures = [];
  const persist = () => {
    const catalogue = [...found.entries()].map(([itemNm, dschgMthd]) => ({ itemNm, dschgMthd })).sort((a, b) => a.itemNm.localeCompare(b.itemNm, "ko"));
    const path = resolve(repoRoot, OUT_DIR, "catalogue.json");
    mkdirSync(resolve(repoRoot, OUT_DIR), { recursive: true });
    writeFileSync(path, JSON.stringify({ op: "getItem", at: new Date().toISOString(), calls, syllables: queried.size, failures, complete: failures.length === 0 && queue.length === 0, items: catalogue }, null, 2));
    return { path, catalogue };
  };
  while (queue.length > 0) {
    round += 1;
    const next = new Set();
    console.log(`라운드 ${round}: 음절 ${queue.length}개`);
    for (const ch of queue) {
      if (queried.has(ch)) continue;
      queried.add(ch);
      const r = await call("getItem", { pageNo: 1, numOfRows: 1000, itemNm: ch });
      calls += 1;
      const u = unpack(r.body);
      // 한 쪽(1,000행)을 넘는 검색 문자는 다음 쪽도 받는다. 안 받으면 빠진 행의 음절이 탐색에 못 들어가는데
      // complete는 true로 남는다.
      const total = Number(u.totalCount ?? 0);
      for (let page = 2; callOk(r.http, u.resultCode) && u.items.length < total && page <= 20; page += 1) {
        const more = await call("getItem", { pageNo: page, numOfRows: 1000, itemNm: ch });
        calls += 1;
        const mu = unpack(more.body);
        if (!callOk(more.http, mu.resultCode) || mu.items.length === 0) {
          failures.push(`${ch} p${page}: http=${more.http} code=${mu.resultCode ?? "?"} ${mu.resultMsg ?? ""}`);
          break;
        }
        u.items.push(...mu.items);
        await sleep(REQUEST_DELAY_MS);
      }
      if (!callOk(r.http, u.resultCode)) {
        // 실패한 음절은 다음 라운드에 다시 넣는다. 한도 초과(22)면 더 쳐 봐야 소용없으니 거기서 멈춘다.
        failures.push(`${ch}: http=${r.http} code=${u.resultCode ?? "?"} ${u.resultMsg ?? r.body?._error ?? ""}`);
        console.log(`  ${ch}: 실패 — http=${r.http} code=${u.resultCode ?? "?"} ${u.resultMsg ?? r.body?._error ?? ""}`);
        if (u.resultCode === "22") {
          console.error("일일 호출량을 넘었다. 지금까지 모은 것만 저장하고 멈춘다 — 이 파일은 불완전하다(complete=false).");
          queue = [];
          break;
        }
        queried.delete(ch);
        next.add(ch);
      }
      for (const it of u.items) {
        const name = typeof it?.itemNm === "string" ? it.itemNm.trim() : "";
        if (!name) {
          failures.push(`${ch}: itemNm 없는 행 ${JSON.stringify(it).slice(0, 120)}`);
          continue;
        }
        if (!found.has(name)) {
          found.set(name, typeof it.dschgMthd === "string" ? it.dschgMthd : "");
          for (const c of name.toUpperCase()) if (SEARCHABLE.test(c) && !queried.has(c)) next.add(c);
        }
      }
      // 중간 저장 — 도중에 죽어도 지금까지 모은 것은 남는다(complete=false로 표시된다).
      if (calls % 50 === 0) persist();
      await sleep(REQUEST_DELAY_MS);
    }
    console.log(`  누적 품목 ${found.size}개, 호출 ${calls}회${failures.length ? `, 실패 ${failures.length}건` : ""}`);
    // 같은 음절이 계속 실패하면 무한히 돌 수 있다. 라운드가 실패 재시도로만 채워지면 끝낸다.
    const retryOnly = [...next].every((c) => failures.some((f) => f.startsWith(`${c}:`)));
    queue = retryOnly && round > 3 ? [] : [...next];
  }
  const { path, catalogue } = persist();
  console.log(`그쪽 사전 ${catalogue.length}개 품목, 검색 문자 ${queried.size}개 조회, 실패 ${failures.length}건. 저장: ${path}`);
  if (failures.length > 0) {
    console.error(`실패한 검색 문자가 있어 사전이 불완전할 수 있다 — catalogue.json의 failures를 보고 다시 돌린다.`);
    process.exitCode = 1;
  }
}

const { mode, flags } = parseArgs(process.argv.slice(2));
if (mode === "item" && flags.enumerate) {
  await enumerateCatalogue();
} else if (mode === "item") {
  let names = flags.positional;
  if (flags.catalogue) {
    const items = JSON.parse(readFileSync(resolve(repoRoot, "src/data/waste-items.json"), "utf8"));
    const list = Array.isArray(items) ? items : items.items;
    const seen = new Set();
    for (const item of list) {
      seen.add(item.name);
      if (flags.aliases) for (const alias of item.aliases ?? []) seen.add(alias);
    }
    names = [...seen];
  }
  if (names.length === 0) {
    console.error("품목명을 주거나 --catalogue를 쓴다.");
    process.exit(2);
  }
  const { results, failures } = await probeItems(names, flags.rows);
  console.log(`저장: ${save("item", { op: "getItem", at: new Date().toISOString(), failures, results })}`);
  if (failures.length > 0) process.exitCode = 1;
} else if (mode === "spot") {
  if (flags.addr.length === 0 && !(flags.lat && flags.lng)) {
    console.error("--addr 동이름 또는 --lat/--lng를 준다.");
    process.exit(2);
  }
  const { results, failures } = await probeSpots(flags);
  console.log(`저장: ${save("spot", { op: "getSpot", at: new Date().toISOString(), failures, results })}`);
  if (failures.length > 0) process.exitCode = 1;
} else {
  console.error("사용법: item <품목명...>|--catalogue [--aliases]  |  spot --addr <동> [--addr ...] | --lat --lng [--radius]");
  process.exit(2);
}
