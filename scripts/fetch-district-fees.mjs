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
/** 덤프 형식. `warnings`(표가 바뀌었다)와 `notes`(늘 나오는 제외)를 가른 판이 2다. */
const DUMP_FORMAT = 2;
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
 * - `rowspan_table`: 광주 북구·대구 달서구. 서버가 그린 5열 표인데 앞 두 열이 `rowspan`으로 묶여 있다.
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
  // Phase 9(2026-08-23). 둘 다 서울 밖 광역시 자치구다.
  // 광주 북구는 표준데이터에 아예 없고, 달서구는 209행이 있지만 규격 칸이 전부 비어 있다.
  { regionId: "buk_gu_gwangju", name: "광주 북구", kind: "rowspan_table", url: "https://bukgu.gwangju.kr/menu.es?mid=a10406070000" },
  { regionId: "dalseo_gu", name: "대구 달서구", kind: "rowspan_table", url: "https://www.dalseo.daegu.kr/index.do?menu_id=00002025" },
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
 * `rowspan`으로 묶인 표. 광주 북구 「대형폐기물 품목 및 수수료 기준」이 이 꼴이다.
 *
 * `품목류 | 품목별 | 규격 | 부과금액(원) | 비고` 5열인데, 앞 두 열이 세로로 묶여 있다.
 * 냉장고는 `<td rowspan="4">`로 한 번만 나오고 다음 세 행에는 아예 셀이 없다.
 *
 * 그래서 `tableRows`를 그대로 쓰면 안 된다. 그쪽은 rowspan 정보를 버리고 셀만 세는데,
 * 이 표에서는 대부분의 행이 3칸(규격·금액·비고)으로 보여 품명 자리에 규격이, 규격
 * 자리에 금액이 들어온다 — 0행이 아니라 **한 칸씩 밀린 그럴듯한 오답**이 나온다.
 * `parseGangnamTable` 주석이 적어 둔 부분 누락과 같은 종류이되 더 나쁘다.
 *
 * 그래서 rowspan을 실제로 펴서 읽는다. 열마다 "앞 행에서 이어지는 값과 남은 횟수"를
 * 들고, 이어지는 값이 있으면 그 자리를 그것으로 채운 뒤 남은 셀을 왼쪽부터 밀어 넣는다.
 * HTML 표의 rowspan 복원 그대로다. `colspan`도 같이 편다 — 한 셀이 여러 열을 먹는데
 * 한 칸으로 세면 그 행부터 격자가 통째로 어긋난다.
 */
function parseRowspanTable(html) {
  const rows = [];
  const warnings = [];

  // 가장 큰 표 하나만 본다. 페이지에 안내용 작은 표가 함께 있어 섞이면 잡음이 된다.
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[0]);
  const table = tables.sort((a, b) => b.length - a.length)[0];
  if (!table) return { rows, warnings: ["표를 찾지 못했다"] };

  const COLUMNS = 5;
  /** 열별로 앞 행에서 이어지는 값. `{ text, left }`이고 `left`가 0이 되면 비운다. */
  const carry = new Array(COLUMNS).fill(null);
  let candidates = 0;
  /** 선언된 rowspan이 실제보다 커서 강제로 끊은 횟수. 조용히 넘기지 않고 보고한다. */
  let staleCarries = 0;
  /** 데이터 영역에서 `colspan`을 만난 행 수. 지금 두 페이지에는 하나도 없다. */
  let spannedRows = 0;

  // 행은 `</tr>`가 아니라 **다음 `<tr>`**에서 끊는다. 닫는 태그를 빠뜨린 표가 있다 —
  // 광주 북구는 화장대 둘째 행에 `</tr>`가 없어서, `</tr>`로 끊으면 그 행이 다음
  // 거실장 행까지 통째로 삼킨다. 브라우저는 `<tr>`를 만나면 앞 행을 자동으로 닫으므로
  // 화면과 우리가 읽는 것이 갈린다. 실제로 그 자리부터 열이 어긋났다.
  for (const chunk of table.split(/<tr[^>]*>/i).slice(1)) {
    const body = chunk.split(/<\/tr>/i)[0];
    const cells = [...body.matchAll(/<(t[dh])([^>]*)>([\s\S]*?)<\/\1>/gi)].map((cell) => ({
      text: cellText(cell[3]),
      span: Math.max(1, Number(/rowspan\s*=\s*["']?(\d+)/i.exec(cell[2])?.[1] ?? 1)),
      cols: Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(cell[2])?.[1] ?? 1)),
      header: cell[1].toLowerCase() === "th" && !/rowspan/i.test(cell[2]),
    }));
    if (cells.length === 0) {
      // 셀이 하나도 없는 행도 격자에서는 한 행이다. 여백 `<tr></tr>`이나 `</td>`를
      // 빠뜨린 조판에서 나온다. 그냥 넘기면 열린 묶음이 한 행 더 이어져 다음 묶음
      // 머리부터 열이 통째로 밀리고, 이 경로에서는 경고도 안 뜬다. 광주 북구는 이미
      // `</tr>`를 빠뜨린 표라 남 얘기가 아니다.
      for (let column = 0; column < COLUMNS; column += 1) {
        if (!carry[column]) continue;
        carry[column].left -= 1;
        if (carry[column].left <= 0) carry[column] = null;
      }
      continue;
    }
    // 열 이름 줄. rowspan 없는 th만 골라내므로 `품목류` 묶음 머리(th + rowspan)는 안 걸린다.
    // 머리글은 여기서 빠지므로 아래 colspan 집계에도 안 잡힌다 — `<th colspan="5">`는
    // 표 제목일 뿐이고, 우리가 알고 싶은 건 데이터 영역에 낀 안내 행이다.
    // 머리글도 격자에서는 한 행이라 carry를 줄인다. 표 중간에 머리글이 다시 찍히는
    // 조판에서 그냥 넘기면 열린 묶음이 한 행 더 살아남아 다음 묶음부터 열이 밀린다.
    if (cells.every((cell) => cell.header)) {
      for (let column = 0; column < COLUMNS; column += 1) {
        if (!carry[column]) continue;
        carry[column].left -= 1;
        if (carry[column].left <= 0) carry[column] = null;
      }
      continue;
    }
    if (cells.some((cell) => cell.cols > 1)) spannedRows += 1;

    /** 이 행이 격자에서 실제로 먹는 칸 수. colspan을 한 칸으로 세면 아래 계산이 어긋난다. */
    const cellWidth = cells.reduce((sum, cell) => sum + cell.cols, 0);

    // 선언된 rowspan이 실제 행수보다 큰 표가 있다 — 광주 북구 `가구류`는 46이라고
    // 적혀 있는데 행은 45개다. 그대로 믿으면 묶음이 끝난 뒤에도 값이 하나 더 이어져
    // 다음 묶음의 머리가 한 칸 오른쪽으로 밀린다. 실제로 `생활용품`(품목류)이 품목별
    // 자리에 들어와 옷걸이부터 재봉틀까지 17개 품명이 통째로 어긋났다.
    //
    // 이 행이 먹는 칸이 빈 자리보다 많으면 앞선 묶음이 이미 끝난 것이다. 선언값보다
    // 이 행이 실제로 들고 온 셀을 믿는 쪽이 맞다. 개수가 아니라 `cellWidth`로 재는
    // 이유는 colspan 하나가 여러 칸을 먹기 때문이다.
    //
    // 끊는 순서는 **오른쪽(안쪽 열)부터**다. 안쪽이 과다 선언된 쪽이 흔한데, 왼쪽부터
    // 끊으면 멀쩡한 바깥 열(품목류) carry가 날아가고 새 묶음 머리가 0열로 밀린다 —
    // 1열에는 직전 품명이 그대로 남아 금액은 맞고 품명만 틀린 행이 묶음 끝까지 이어진다.
    // 반대로 바깥 열이 과다 선언된 경우에는 그 행이 묶음 머리라 안쪽 carry가 이미
    // 비어 있어서, 오른쪽부터 훑어도 결국 같은 자리를 끊는다. 양쪽 모두 안전한 순서다.
    let freeColumns = COLUMNS - carry.filter(Boolean).length;
    for (let column = COLUMNS - 1; column >= 0 && cellWidth > freeColumns; column -= 1) {
      if (!carry[column]) continue;
      carry[column] = null;
      freeColumns += 1;
      staleCarries += 1;
    }

    const line = new Array(COLUMNS).fill("");
    let next = 0;
    let column = 0;
    while (column < COLUMNS) {
      if (carry[column]) {
        line[column] = carry[column].text;
        carry[column].left -= 1;
        if (carry[column].left <= 0) carry[column] = null;
        column += 1;
        continue;
      }
      const cell = cells[next];
      next += 1;
      if (!cell) {
        column += 1;
        continue;
      }
      // colspan은 오른쪽 열까지 같은 값으로 채운다. 표 끝을 넘기면 거기서 자른다.
      const width = Math.min(cell.cols, COLUMNS - column);
      for (let offset = 0; offset < width; offset += 1) {
        line[column + offset] = cell.text;
        if (cell.span > 1) carry[column + offset] = { text: cell.text, left: cell.span - 1 };
      }
      column += width;
    }

    candidates += 1;
    // 규격과 금액을 한 칸에 몰아넣은 표가 있다 — 달서구 문갑은 규격 칸에 `원목`만 두고
    // 금액 칸에 「100cm이상: 3,000」을 적는다. `toKrw`는 첫 숫자 뭉치를 읽으므로 그대로
    // 두면 3,000원이 아니라 **100원**이 된다. 실제로 그 값이 데이터에 실려 있었다.
    // 콜론 뒤가 금액이고 앞은 규격이라, 갈라서 규격 쪽에 이어 붙인다. 콜론이 없는
    // 보통 행은 이 갈래를 타지 않는다.
    let spec = line[2];
    let feeCell = line[3];
    const packed = /^(.*\S)\s*[:：]\s*([\d,]+)\s*$/.exec(feeCell);
    if (packed) {
      spec = [spec, packed[1].trim()].filter(Boolean).join(" ");
      feeCell = packed[2];
    }
    const fee = toKrw(feeCell);
    const itemName = line[1];
    if (fee === null || !itemName) continue;
    // 규격 칸이 비면 품명만 있는 행이다. 그대로 둔다 — 임포터가 품명으로 규격을 채운다.
    rows.push({ itemName, spec, feeKrw: fee });
  }

  // 부분 누락을 잡는다. 0행일 때만 우는 가드로는 rowspan 복원이 어긋나 대부분이
  // 조용히 빠지는 경우를 못 본다 — `parseGangnamTable`이 같은 이유로 후보를 먼저 센다.
  if (candidates > 0 && rows.length < candidates * 0.8) {
    warnings.push(`데이터 행 ${candidates}개 중 ${rows.length}개만 읽었다 — rowspan 복원을 확인할 것`);
  }
  if (staleCarries > 0) {
    warnings.push(`선언된 rowspan이 실제 행수보다 큰 자리 ${staleCarries}곳을 끊었다 (원문 표의 오기)`);
  }
  // 격자는 위에서 폈으니 금액이 비고 칸으로 밀리지는 않는다. 그래도 경고는 남긴다 —
  // 두 페이지 모두 데이터 영역에 colspan이 하나도 없어서, 하나라도 생겼다는 건 표
  // 구조가 바뀌었다는 뜻이다. 전체 너비 안내 행이 늘었는지, 열이 통합됐는지는
  // 원문을 봐야 갈린다. 임포터가 이 경고를 받으면 그 지역을 건너뛴다.
  if (spannedRows > 0) {
    warnings.push(`데이터 영역에 colspan이 든 행이 ${spannedRows}개 있다 — 표 구조가 바뀌었는지 원문을 확인해라`);
  }

  return { rows, warnings };
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
  // 셀이 하나라도 있는 행을 먼저 센다. 아래에서 버리는 행이 몇인지 알아야
  // **부분** 누락을 잡을 수 있다 — 0행일 때만 실패로 잡히면 종류 열에 rowspan이
  // 붙어 대부분이 3칸이 되는 순간 136행이 조용히 한 줌으로 줄어든다. 그때도 0은
  // 아니라서 `main()`의 빈 결과 가드도, 임포터의 `rows.length === 0` 가드도 안 운다.
  // `parseSmartclean`이 같은 이유로 후보를 먼저 센다.
  let candidates = 0;
  for (const cells of tableRows(html)) {
    if (cells.length === 0) continue;
    const itemName = strip(cells[1] ?? "");
    // 머리글 행. 접두어를 뗀 뒤에도 열 이름만 남는다. 후보로도 세지 않는다.
    if (/^(품목|종류|규격|수수료)/.test(itemName)) continue;
    candidates += 1;
    if (cells.length < 4) continue;
    if (!itemName) continue;
    const spec = strip(cells[2]);
    const fee = toKrw(strip(cells[3]));
    if (fee === null) continue;
    rows.push({ itemName, spec, feeKrw: fee });
  }
  // 0행일 때는 경고를 남기지 않는다 — `main()`이 그 전에 "표 없음"으로 세우고
  // 덤프를 아예 안 써서 warnings가 버려지기 때문이다(도달 불가 코드였다). 실패는
  // 그쪽에서 이미 시끄럽게 드러나므로, 여기서 조용히 0행을 돌려주면 된다.
  //
  // 채택률에 바닥을 두는 건 다르다. 실측은 213행 중 136행(64%)인데, 그 격차는
  // 무상수거·안내 행이라 정상이다. 절반 아래로 떨어지면 표 구조가 바뀐 쪽을 먼저
  // 의심해야 한다 — 이건 덤프를 쓰고 나서도 남는 경고라 다음 사람이 본다.
  if (rows.length > 0 && rows.length * 2 < candidates) {
    warnings.push(`후보 ${candidates}행 중 ${rows.length}행만 읽었다 — 열 구조가 바뀌었는지 확인해라`);
  }
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
  // 무상수거 안내 행은 **경고가 아니라 기록**이다. 성동 표에는 늘 몇 줄씩 있어서,
  // 이걸 `warnings`에 넣으면 임포터가 성동을 영영 건너뛴다 — 임포터는 경고가 붙은
  // 지역을 건너뛰기 때문이다. 늘 나오는 정상 제외와, 표가 바뀌었다는 신호는 갈라 둔다.
  const notes = [];
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
          notes.push(`무상수거 안내가 붙어 제외: ${text.slice(0, 40)}`);
          continue;
        }
        rows.push({ itemName: parsed.itemName, spec: parsed.spec, feeKrw: fee });
      }
    }
  }
  return { rows, warnings: [], notes };
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

/**
 * 파서가 돌려주는 것은 두 갈래다.
 *
 * - `warnings`: **표가 우리가 아는 모양이 아니다.** 부분 누락, rowspan 오기, 예상 못 한
 *   colspan, 잘린 페이지가 여기 든다. 임포터가 이걸 보면 그 지역을 통째로 건너뛴다.
 * - `notes`: 늘 나오는 정상 제외. 성동의 무상수거 안내 행 같은 것이라 사람이 볼 필요가 없다.
 *
 * 둘을 한 배열에 섞으면 상시 발생하는 제외 때문에 임포터가 멀쩡한 지역을 영영 건너뛴다.
 */
async function collect(target) {
  const result = await collectRaw(target);
  return { rows: result.rows, warnings: result.warnings ?? [], notes: result.notes ?? [] };
}

async function collectRaw(target) {
  if (target.kind === "guro_list") return fetchGuro(target.url);
  const html = await fetchText(target.url);
  if (target.kind === "smartclean") return parseSmartclean(html);
  if (target.kind === "sdm_table") return parseSdmTable(html);
  if (target.kind === "gn_table") return parseGangnamTable(html);
  if (target.kind === "sd_popup") return parseSdPopup(html);
  if (target.kind === "rowspan_table") return parseRowspanTable(html);
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
  const warned = [];

  for (const target of targets) {
    process.stdout.write(`${target.regionId} (${target.name}) ... `);
    try {
      const { rows, warnings, notes } = await collect(target);
      // 빈 결과를 성공으로 넘기지 않는다. 조용한 실패는 "그 지역엔 표가 없다"는
      // 커버리지 착시를 만든다 — 조례 트랙에서 실제로 겪었다.
      if (rows.length === 0) throw new Error("행을 하나도 못 뽑았다 (페이지 구조가 바뀌었을 수 있다)");
      const result = {
        regionId: target.regionId,
        // 수집 형식. `warnings`/`notes`를 가른 뒤로 의미가 달라져, 임포터가 옛 덤프를
        // 조용히 잘못 읽지 않도록 표시를 남긴다.
        format: DUMP_FORMAT,
        name: target.name,
        kind: target.kind,
        url: target.url,
        // 인제스트가 `checkedAt`에 쓸 값이다. 임포트 시각을 쓰면 몇 주 전에 받아 둔
        // 표에 오늘 날짜가 붙어, 확인한 적 없는 확인일이 데이터에 남는다.
        collectedAt: new Date().toISOString().slice(0, 10),
        rows,
        warnings,
        notes,
        errors: [],
      };
      writeFileSync(`${OUTPUT_DIR}/${target.regionId}.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      const items = new Set(rows.map((row) => row.itemName)).size;
      console.log(`${rows.length}행 / 품명 ${items}종${warnings.length ? ` (경고 ${warnings.length}건)` : ""}`);
      // 경고는 stderr로 보낸다. 임포터가 그 지역을 건너뛰게 만드는 신호라, 성공 로그
      // 사이에 파묻히면 안 된다. 상시 제외(`notes`)는 stdout에 그대로 둔다.
      for (const warning of warnings) console.error(`    ! ${warning}`);
      for (const note of notes) console.log(`    · ${note}`);
      if (warnings.length > 0) warned.push(target.regionId);
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
  if (warned.length > 0) {
    // 경고도 종료 코드에 싣는다. 덤프는 썼지만 임포터가 그 지역을 건너뛰므로,
    // 여기서 0을 돌려주면 "받았고 넣었다"로 읽힌다. `&&`로 이어 붙였을 때 임포트가
    // 멈추는 편이 낫다 — 원문이 바뀐 상태로 넣는 것보다 안 넣는 쪽이 안전하다.
    // 확인이 끝났으면 `import:district`를 따로 돌리면 된다(경고 없는 지역만 들어간다).
    console.error(`경고가 붙어 임포트가 건너뛸 지역: ${warned.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
