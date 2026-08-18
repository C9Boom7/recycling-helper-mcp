/**
 * 구청 대형폐기물 수수료표 수집 (Phase 6 R3 후속).
 *
 * 조례 별표(`fetch-ordinance-fees.mjs`) 대신 **구청이 직접 띄운 수수료표**를 읽는다.
 * 조례 HWP는 여러 품목 사다리를 옆으로 늘어놓은 표라, 한 줄로 펴는 과정에서 규격과
 * 금액이 이웃 품목으로 넘어갔다 — 서대문 「세탁기 / 소형(60X100 미만) / 1,000원」은
 * 고무통 값이고, 성북 「1인용 매트리스 / 2인용(매트리스, 프레임) / 18,000원」은
 * 실제로 7,000원이다. 구청 표는 품목·규격·금액이 이미 갈려 있어 그 위험이 없다.
 *
 * 덤으로 조례에서 아예 못 뽑던 세 곳(성동·양천·구로)이 열린다.
 *
 * 출처도 이쪽이 낫다. 주민이 실제로 신청할 때 보는 운영 표라 조례 별표보다 최신이다.
 *
 * 실행: node scripts/fetch-district-fees.mjs [regionId...]
 *   인자가 없으면 아래 TARGETS를 전부 돈다.
 *   출력: data/district-fee-raw/<regionId>.json (gitignore 대상 — 검수용 중간 산출물)
 *
 * 전부 서버 응답만으로 읽힌다. 브라우저가 필요한 곳은 대상에 넣지 않았다 —
 * 재현할 수 없는 수집은 다음 사람이 못 돌린다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = "data/district-fee-raw";
const TIMEOUT_MS = 30_000;
const REQUEST_DELAY_MS = 400;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `kind`는 표가 실린 방식이다. 같은 방식이면 파서를 그대로 쓴다.
 *
 * - `smartclean`: 스마트클린 계열. 표가 인라인 스크립트 안 JSON 배열로 박혀 있다.
 * - `sdm_table`: 서대문 폐기물 규격 페이지. 서버가 그린 HTML 표.
 * - `sd_popup`: 성동 부과기준표 팝업. **금액이 행 머리**이고 품목이 그 아래 묶인다.
 * - `guro_list`: 구로 처리비용. 분류별로 페이지가 갈리고 서버가 그린 표다.
 * - `gn_table`: 강남 자원순환 종합포털. 서버가 그린 4열 표이고 셀에 열 이름 접두어가 붙는다.
 */
export const TARGETS = [
  { regionId: "seongbuk_gu", name: "서울 성북구", kind: "smartclean", url: "https://smartclean.sb.go.kr/online/bulky/item" },
  { regionId: "jungnang_gu", name: "서울 중랑구", kind: "smartclean", url: "https://www.smartclean-jungnang.kr/online/bulky/item" },
  { regionId: "yangcheon_gu", name: "서울 양천구", kind: "smartclean", url: "https://smartclean.yangcheon.go.kr/online/bulky/item" },
  { regionId: "seodaemun_gu", name: "서울 서대문구", kind: "sdm_table", url: "https://www.sdm.go.kr/civil/print/waste/standards.do" },
  { regionId: "seongdong_gu", name: "서울 성동구", kind: "sd_popup", url: "https://www.sd.go.kr/site/reserve/popup/cts2182_popup.html" },
  { regionId: "guro_gu", name: "서울 구로구", kind: "guro_list", url: "https://www.guro.go.kr/www/costList.do?key=3412" },
  // 강남구(2026-08-19). 골든셋 수기 19행을 이 표로 갈아탄다 — 조례 트랙은 좌우 2단
  // 조판에서 침대 규격을 TV에 붙여 놓고 침대 품목은 한 행도 못 잡았다. `parseGangnamTable`
  // 주석에 실제로 나온 오행을 적어 뒀다.
  { regionId: "gangnam_gu", name: "서울 강남구", kind: "gn_table", url: "https://clean.gangnam.go.kr/use/biwa/USEBIWA01000000.do" },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 지자체 페이지는 아직 EUC-KR로 나가는 곳이 있다 — 서대문 폐기물 규격 페이지가
 * 그렇다. `response.text()`는 UTF-8로 단정해서 품명이 통째로 깨지고, 그러면
 * 품명 판정이 전부 `not_found`로 떨어져 "그 지역엔 쓸 행이 없다"처럼 보인다.
 * 헤더의 charset을 먼저 보고, 없으면 meta 태그에서 찾는다.
 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const headerCharset = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  // meta 태그를 찾을 때는 ASCII로 한 번 훑는다. 한글이 깨져도 태그는 멀쩡하다.
  const metaCharset = /charset=["']?([\w-]+)/i.exec(buffer.toString("latin1").slice(0, 4096))?.[1];
  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();

  if (/^(utf-?8)$/.test(charset)) return buffer.toString("utf8");
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    throw new Error(`알 수 없는 인코딩: ${charset}`);
  }
}

/** 태그를 지우고 엔티티를 편다. 표 칸 하나를 사람이 읽는 문자열로 만든다. */
function cellText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])),
  );
}

/**
 * "12,000", "12,000원", "12000" → 12000. 금액이 아니면 null.
 *
 * 숫자가 아닌 문자를 전부 지우고 이어붙이면 「1,000원 ~ 2,000원」이 10002000이 되고,
 * 「5,000원(2개 기준)」이 50002가 된다. 첫 숫자 뭉치만 읽고, 대형폐기물 수수료로
 * 말이 되는 범위 밖이면 버린다.
 */
function toKrw(text) {
  const match = /(\d[\d,]*)/.exec(String(text ?? ""));
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0 || value > 500_000) return null;
  return value;
}

/**
 * 스마트클린은 표를 그리기 전에 전체 품목을 인라인 스크립트에 JSON으로 심어 둔다.
 * 한글이 `\uXXXX`로 escape돼 있어 눈으로는 안 보이지만 구조는 온전하다.
 * `deleted`/`active`로 운영에서 내린 행을 가려낸다 — 화면에도 안 나오는 행이다.
 */
function parseSmartclean(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const biggest = scripts.sort((a, b) => b.length - a.length)[0] ?? "";
  const rows = [];
  // `"code":`가 붙은 품목 객체가 몇 개인지 먼저 센다. 아래 상세 패턴이 놓친 행을
  // 알아채려는 것이다 — 규격이 null이거나 금액이 숫자 리터럴이 아니면 조용히
  // 빠지고, 전부 빠졌을 때(0행)만 실패로 잡히면 부분 누락을 못 본다.
  const objectCount = (biggest.match(/\{"code":\d+,"name":/g) ?? []).length;
  const pattern =
    /\{"code":\d+,"name":"((?:[^"\\]|\\.)*)","standard":("((?:[^"\\]|\\.)*)"|null),"price":([\d.]+),"deleted":(true|false)[^}]*?"active":(true|false)/g;
  let dropped = 0;
  for (const match of biggest.matchAll(pattern)) {
    const unescape = (value) => JSON.parse(`"${value}"`);
    if (match[5] === "true" || match[6] === "false") {
      dropped += 1;
      continue;
    }
    rows.push({
      itemName: unescape(match[1]),
      spec: match[2] === "null" ? "" : unescape(match[3]),
      feeKrw: Number(match[4]),
    });
  }
  const unmatched = objectCount - rows.length - dropped;
  return { rows, warnings: unmatched > 0 ? [`품목 객체 ${objectCount}개 중 ${unmatched}개를 패턴이 못 읽었다`] : [] };
}

/** 서대문 「폐기물명 | 폐기물규격 | 부과금액(원)」. */
function parseSdmTable(html) {
  const rows = [];
  for (const cells of tableRows(html)) {
    if (cells.length < 3) continue;
    const fee = toKrw(cells[2]);
    if (fee === null || !cells[0]) continue;
    if (/폐기물명|부과금액/.test(cells[0])) continue;
    // 규격 칸에 마침표 하나만 적어 비워 둔 행이 있다.
    const spec = cells[1] === "." ? "" : cells[1];
    rows.push({ itemName: cells[0], spec, feeKrw: fee });
  }
  return { rows, warnings: [] };
}

/**
 * 강남구 자원순환 종합포털 수수료표. 서버가 그린 `종류|품목|규격|수수료(원)` 4열이다.
 *
 * 조례 트랙을 쓰지 않는 이유가 여기 있다. 강남 별표는 좌우 2단 조판이라 순차 텍스트로
 * 펴면 열이 어긋난다 — 침대 규격이 통째로 TV 품목에 붙어 「텔레비전 / 유아용 침대
 * 3,000원」·「TV받침일체형 / 2인용 돌침대 세트 30,000원」이 나왔고, 정작 침대 품목은
 * 한 행도 안 잡혔다. 이 표는 품목·규격이 이미 갈려 있어 그 갈래가 아예 없다.
 * 「침대 / 1인용(틀) / 5,000원」이 그대로 읽힌다.
 *
 * 셀 텍스트가 `품목: 침대`처럼 열 이름을 접두어로 달고 나온다(좁은 화면용 라벨이
 * 텍스트로 같이 들어온다). 접두어를 떼지 않으면 품명 판정이 통째로 `not_found`가 된다.
 */
function parseGangnamTable(html) {
  const rows = [];
  const warnings = [];
  // `품목: 침대` → `침대`. 콜론이 없는 표로 바뀌어도 그대로 통과한다.
  const strip = (text) => String(text ?? "").replace(/^[^:：]{1,10}[:：]\s*/, "").trim();
  for (const cells of tableRows(html)) {
    if (cells.length < 4) continue;
    const itemName = strip(cells[1]);
    const spec = strip(cells[2]);
    const fee = toKrw(strip(cells[3]));
    // 머리글 행. 접두어를 뗀 뒤에도 열 이름만 남는다.
    if (/^(품목|종류|규격|수수료)/.test(itemName) || !itemName) continue;
    if (fee === null) continue;
    rows.push({ itemName, spec, feeKrw: fee });
  }
  // 표가 JS 렌더링으로 바뀌면 0행이 되는데, 그걸 "그 지역엔 쓸 행이 없다"로 읽으면
  // 커버리지 착시가 된다. 수집 단계에서 경고로 남긴다.
  if (rows.length === 0) warnings.push("행을 하나도 뽑지 못했다 — 표가 서버 렌더링에서 바뀐 것으로 보인다");
  return { rows, warnings };
}

/**
 * 성동은 **금액이 행 머리**고 품목이 그 아래 `<ul class="bu"><li>`로 묶인다.
 * 「3,000원 | <li>난로</li><li>문짝</li>… 」 형태라, 금액을 이어받아 `li` 하나를
 * 한 행으로 편다. 태그를 먼저 지우면 품목이 전부 한 덩어리가 되므로 `li`를
 * 쪼갠 뒤에 텍스트를 뽑는다.
 *
 * 품목명이 규격을 괄호로 달고 있다 — 「거울(높이50cm 미만)」. 뒤쪽 괄호를 규격으로
 * 떼어내야 답변에 규격이 실리고, 품명 판정도 「거울」로 깔끔하게 붙는다.
 */
function parseSdPopup(html) {
  const rows = [];
  const warnings = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cell[1]);
    if (cells.length < 2) continue;
    const fee = toKrw(cellText(cells[0]));
    if (fee === null || !/원/.test(cellText(cells[0]))) continue;
    for (const cell of cells.slice(1)) {
      for (const listItem of cell.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
        const text = cellText(listItem[1]);
        if (text.length < 2) continue;
        const parsed = splitTrailingSpec(text);
        // 무상수거를 가리키는 안내가 붙은 행은 금액을 싣지 않는다.
        if (parsed.freePickupNotice) {
          warnings.push(`무상수거 안내가 붙어 제외: ${text.slice(0, 40)}`);
          continue;
        }
        rows.push({ itemName: parsed.itemName, spec: parsed.spec, feeKrw: fee });
      }
    }
  }
  return { rows, warnings };
}

/**
 * 「거울(높이50cm 미만)」 → 품명 `거울`, 규격 `높이50cm 미만`. 괄호가 없으면 규격은 빈칸이다.
 *
 * 괄호 안이 규격이 아니라 **안내문**인 칸이 있다 — 성동 「정수만 나오는 정수기(정수기는
 * 폐가전 무상수거 센터를 이용하여 주시기 바랍니다 ☎1599-0903)」. 그대로 규격으로 떼면
 * 답변에 "…바랍니다 ☎1599-0903: 1,000원"이 찍혀 무상 안내를 유상으로 읽게 된다.
 * 문장으로 끝나거나 전화번호가 든 괄호는 규격이 아니다.
 */
const NOTICE_LIKE = /☎|바랍니다|하십시오|하세요|주시기|문의|바로가기|\d{3,4}-\d{4}/;
/** 안내문이 "무상수거를 쓰라"고 말하는 경우. 금액을 실으면 안 되는 행이다. */
const FREE_PICKUP_NOTICE = /무상|무료/;

function splitTrailingSpec(text) {
  const match = text.match(/^(.*?)\s*[(（]([^)）]*)[)）]\s*$/);
  if (!match || !match[1].trim()) return { itemName: text, spec: "" };
  const spec = match[2].trim();
  if (!NOTICE_LIKE.test(spec)) return { itemName: match[1].trim(), spec };
  // 괄호를 그냥 버리면 규격이 비고, 인제스트가 그걸 「모든 규격」으로 채워 "모든
  // 규격 1,000원"이라 단정한다. 안내문이 무상수거를 가리키는 행은 **금액을 싣지
  // 않는 것**이 맞다 — "무료로 내면 되는 물건에 수수료를 답한다"가 이 트랙이
  // 막으려는 실패다.
  if (FREE_PICKUP_NOTICE.test(spec)) return { itemName: match[1].trim(), spec: "", freePickupNotice: true };
  return { itemName: match[1].trim(), spec: "" };
}

/** 구로 처리비용. 「번호 | 종류 | 품목 | 규격 | 부과금액」이고 분류별로 페이지가 갈린다. */
const GURO_PAGE_SIZE = 500;

async function fetchGuro(baseUrl) {
  const rows = [];
  const warnings = [];
  // category_code는 화면의 분류 탭이다. 1~7 밖은 빈 표가 온다.
  for (const category of [1, 2, 3, 4, 5, 6, 7]) {
    const url = `${baseUrl}&currentPage=0&seq_no=0&menu_code=notice&category_code=${category}&search_input=&pageSize=${GURO_PAGE_SIZE}`;
    // 한 분류라도 실패하면 세운다. 앞 분류에서 모은 행만 남겨 "수집 성공"으로
    // 넘기면 그 지역 데이터가 조용히 반쪽이 된다.
    const html = await fetchText(url);
    const before = rows.length;
    for (const cells of tableRows(html)) {
      if (cells.length < 5) continue;
      const fee = toKrw(cells[4]);
      if (fee === null || !cells[2]) continue;
      if (/품목|부과금액/.test(cells[2])) continue;
      rows.push({ itemName: cells[2], spec: cells[3] === "전체" ? "" : cells[3], feeKrw: fee });
    }
    // 한 페이지에 상한만큼 꽉 찼다면 뒤가 잘렸을 수 있다.
    if (rows.length - before >= GURO_PAGE_SIZE) {
      warnings.push(`분류 ${category}가 ${GURO_PAGE_SIZE}행으로 꽉 찼다 — 뒤가 잘렸을 수 있다`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  // 분류 탭이 겹쳐 같은 행이 두 번 오는 경우가 있다.
  const unique = [...new Map(rows.map((row) => [`${row.itemName}|${row.spec}|${row.feeKrw}`, row])).values()];
  return { rows: unique, warnings };
}

async function collect(target) {
  if (target.kind === "guro_list") return fetchGuro(target.url);
  const html = await fetchText(target.url);
  if (target.kind === "smartclean") return parseSmartclean(html);
  if (target.kind === "sdm_table") return parseSdmTable(html);
  if (target.kind === "gn_table") return parseGangnamTable(html);
  if (target.kind === "sd_popup") return parseSdPopup(html);
  throw new Error(`모르는 kind: ${target.kind}`);
}

async function main() {
  const requested = process.argv.slice(2);
  const known = new Set(TARGETS.map((target) => target.regionId));
  const unknown = requested.filter((regionId) => !known.has(regionId));
  if (unknown.length > 0) {
    console.error(`모르는 regionId: ${unknown.join(", ")}`);
    console.error(`사용 가능한 regionId: ${TARGETS.map((target) => target.regionId).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const targets = requested.length > 0 ? TARGETS.filter((target) => requested.includes(target.regionId)) : TARGETS;
  const failures = [];

  for (const target of targets) {
    process.stdout.write(`${target.regionId} (${target.name}) ... `);
    try {
      const { rows, warnings } = await collect(target);
      // 빈 결과를 성공으로 넘기지 않는다. 조용한 실패는 "그 지역엔 표가 없다"는
      // 커버리지 착시를 만든다 — 조례 트랙에서 실제로 겪었다.
      if (rows.length === 0) throw new Error("행을 하나도 못 뽑았다 (페이지 구조가 바뀌었을 수 있다)");
      const result = {
        regionId: target.regionId,
        name: target.name,
        kind: target.kind,
        url: target.url,
        // 인제스트가 `checkedAt`에 쓸 값이다. 임포트 시각을 쓰면 몇 주 전에 받아 둔
        // 표에 오늘 날짜가 붙어, 확인한 적 없는 확인일이 데이터에 남는다.
        collectedAt: new Date().toISOString().slice(0, 10),
        rows,
        warnings,
        errors: [],
      };
      writeFileSync(`${OUTPUT_DIR}/${target.regionId}.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      const items = new Set(rows.map((row) => row.itemName)).size;
      console.log(`${rows.length}행 / 품명 ${items}종${warnings.length ? ` (경고 ${warnings.length}건)` : ""}`);
      for (const warning of warnings) console.log(`    ! ${warning}`);
    } catch (error) {
      // **실패한 덤프를 쓰지 않는다.** 예전엔 rows: []로 덮어써서, 일시적인 5xx 한 번에
      // 멀쩡히 받아 둔 표가 빈 파일이 됐다. 인제스트가 그걸 "행이 없다"로 읽는다.
      console.log(`실패 — ${error.message} (기존 덤프를 그대로 둔다)`);
      failures.push(target.regionId);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n완료 — ${targets.length - failures.length}/${targets.length}. 결과는 ${OUTPUT_DIR}/ 에 있다.`);
  if (failures.length > 0) {
    // 실패를 종료 코드로 알린다. `fees:fetch:district && import:district`로 이어 붙였을 때
    // 조용히 다음 단계로 넘어가면 낡은 덤프가 새 데이터인 척한다.
    console.error(`수집 실패: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
