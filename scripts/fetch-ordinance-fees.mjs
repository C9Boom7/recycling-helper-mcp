/**
 * 자치법규 대형폐기물 수수료 별표 수집 (Phase 6 R1).
 *
 * 법제처 국가법령정보 공동활용 API에서 지자체 폐기물 관련 자치법규를 훑어
 * 대형폐기물 수수료표를 찾아 (품명, 규격, 금액) 행으로 뽑는다. 데모 계정
 * `OC=test`로 인증키 없이 호출된다.
 *
 * 런타임에서 호출하지 않는다. 조례는 몇 달 단위로 개정되고 본선 규격은
 * p99 3초를 요구하므로, 수집은 빌드타임 전용이고 결과만 커밋한다.
 *
 * 실행: node scripts/fetch-ordinance-fees.mjs [regionId...]
 *   인자가 없으면 Phase 6 대상 10곳을 전부 돈다.
 *   출력: data/ordinance-raw/<regionId>.json (gitignore 대상 — 검수용 중간 산출물)
 *
 * 설계상 지켜야 할 것이 넷 있다. R0 조사에서 전부 실제로 걸렸다.
 *   1. 조례명을 `폐기물 관리`로 좁히지 않는다. 성남시 수수료표는
 *      「생활폐기물의 배출방법 및 수수료 등의 부과·징수에 관한 조례」에 있다.
 *   2. 별표 제목으로 첨부를 고르지 않는다. 여러 별표를 하나의 HWP로 묶어
 *      올린 곳이 있고(종로·광진·은평·강동), 묶음 안에는 별표 번호 머리표시가
 *      없기도 하다. 첨부를 모두 열어 본문에서 표 머리글을 찾는다.
 *   3. 시행규칙도 본다. 노원구는 조례가 아니라 시행규칙에 표가 있다.
 *   4. 첨부 파싱 실패를 건너뛰지 않고 error로 보고한다. 조용한 실패는
 *      "그 지역엔 표가 없다"는 커버리지 착시를 만든다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractHwpText } from "./hwp-text.mjs";

const OC = process.env.LAW_GO_KR_OC ?? "test";
const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const OUTPUT_DIR = "data/ordinance-raw";

/** 데모 계정을 두드리는 속도를 낮춘다. R0 실측 건당 2.2초와 같은 수준이다. */
const REQUEST_DELAY_MS = 400;

/** 검색 페이지 상한(페이지당 100건). 데모 계정을 무한정 두드리지 않으려는 안전판. */
const MAX_SEARCH_PAGES = 20;

/**
 * Phase 6 조례 트랙 대상 10곳 + 마포. 용산·노원·강서·관악은 공공데이터포털 표준데이터
 * 트랙이 맡으므로 여기 없다(PRD "트랙 분담").
 *
 * `기관명`은 법제처 `지자체기관명`과 정확히 일치해야 한다 — 우리 지역명
 * ("서울 종로구")과 표기가 다르다.
 */
export const TARGETS = [
  { regionId: "seongnam_si", 기관명: "경기도 성남시" },
  { regionId: "jongno_gu", 기관명: "서울특별시 종로구" },
  { regionId: "gwangjin_gu", 기관명: "서울특별시 광진구" },
  { regionId: "gangbuk_gu", 기관명: "서울특별시 강북구" },
  { regionId: "dobong_gu", 기관명: "서울특별시 도봉구" },
  { regionId: "eunpyeong_gu", 기관명: "서울특별시 은평구" },
  { regionId: "geumcheon_gu", 기관명: "서울특별시 금천구" },
  { regionId: "yeongdeungpo_gu", 기관명: "서울특별시 영등포구" },
  { regionId: "dongjak_gu", 기관명: "서울특별시 동작구" },
  { regionId: "gangdong_gu", 기관명: "서울특별시 강동구" },
  // 성북·중랑·양천·서대문·성동·구로는 구청 수수료표 트랙(`fetch-district-fees.mjs`)이
  // 맡는다. 여기 두면 쓰지도 않을 별표를 6곳 더 내려받는다.
  // 중구·동대문구는 구청이 기계로 읽을 표를 안 내놔 조례가 유일한 경로다.
  { regionId: "jung_gu", 기관명: "서울특별시 중구" },
  { regionId: "dongdaemun_gu", 기관명: "서울특별시 동대문구" },
  // 마포는 골든셋에서 나와 조례 추출로 갈아탔으므로(아래 GOLDEN_TARGETS 주석) 수집
  // 대상은 여기다. 빠뜨리면 우리 데이터의 출처를 다시 만들 방법이 저장소에서 사라진다 —
  // `data/ordinance-raw/`는 gitignore라 덤프가 남지 않고, 골든셋에서도 빠져 있어
  // `fees:verify`도 안 받는다. 실제로 그 상태로 한 번 올라갔다.
  { regionId: "mapo_gu", 기관명: "서울특별시 마포구" },
];

/**
 * R2 골든셋. 이 둘은 이미 검증된 수기 데이터가 있어 파서를 대조할 기준이 된다.
 * 추출 대상이 아니라 검증 대상이므로 TARGETS와 분리해 둔다 —
 * `pnpm fees:fetch`가 실수로 골든셋을 덮어쓰지 않게 하려는 것이다.
 *
 * 2026-08-19에 넷에서 둘이 됐다.
 *
 * - **서초·송파만 독립 기준으로 남는다.** 수기 데이터를 그대로 들고 있어서, 여기
 *   불일치가 0으로 유지되는 동안만 조례 파서를 믿을 근거가 된다.
 * - **마포·강남은 목록에서 뺐다.** 둘 다 수기 14·19행이 Top 50 범위뿐이라 침대
 *   프레임조차 없어 다른 출처로 갈아탔는데, 빼는 이유는 서로 다르다.
 *   - 마포는 조례 추출로 갈아탔다. 우리 행이 이 검증이 다시 돌리는 그 파서에서 나온
 *     것이 되어, R2의 "파서가 골든셋을 읽는다" 하한선이 **자기 충족**이 된다 —
 *     195행 중 140행이 늘 맞아서 나머지가 0개 맞아도 하한선이 안 깨진다.
 *   - 강남은 구청 표로 갈아탔다. 조례와 **출처 자체가 달라** 대조가 개정 감지도 파서
 *     검증도 아니고, 구청 운영 표가 별표보다 최신이라 금액이 갈리는 것이 정상이다.
 *
 *   개정 감지가 필요하면 두 지역을 인자로 받는 별도 대조가 필요하다(지금은 없다).
 */
export const GOLDEN_TARGETS = [
  { regionId: "seocho_gu", 기관명: "서울특별시 서초구" },
  { regionId: "songpa_gu", 기관명: "서울특별시 송파구" },
];

/** 폐기물이 이름에 들어가도 대형폐기물 수수료와 무관한 법규들. */
const UNRELATED_LAW_PATTERNS = [
  /해양/,
  /음식물류/,
  /처리시설/,
  /특별회계/,
  /대행업체\s*평가/,
  /무단투기/,
  /신고포상금/,
  /종량제봉투/,
  /환경에너지/,
  /소각/,
  /매립/,
  /재활용센터/,
];

/** 본문이 아니라 신청서·연혁인 첨부. */
const NON_TABLE_ATTACHMENT = /별지|서식|연혁|신청서|양식/;

/**
 * 표 머리글. `수수료` 하나로 잡으면 안 된다 — 전국 스윕에서
 * `대형폐기물수집ㆍ운반ㆍ처리비부과기준`(충주시)처럼 `처리비` 계열이 나왔다.
 */
const TABLE_SUBJECT = /(대형|대형생활|대형폐|생활)?\s*폐기물/;
const TABLE_FEE_WORD = /(수수료|처리비|처리요금|부과\s*기준|부과기준)/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { asBuffer = false, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (recycling-helper-mcp ingest)", Referer: "https://www.law.go.kr/" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(REQUEST_DELAY_MS * attempt * 2);
    }
  }
  throw new Error(`${url} 요청 실패: ${lastError.message}`);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * 1단계 — 기관명이 정확히 일치하고 이름에 `폐기물`이 든 자치법규를 전부 모은다.
 *
 * 검색은 기관 한정이 아니라 전국 자치법규를 훑으므로 100건을 쉽게 넘긴다.
 * 한 페이지만 받고 말면 대상 조례가 101번째 뒤로 밀렸을 때 조용히 누락되고,
 * 결과는 "조례가 없다"와 구별되지 않는다. `totalCnt`를 보고 끝까지 넘긴다.
 */
async function searchLaws(기관명) {
  const query = encodeURIComponent(`${기관명.split(" ").pop()} 폐기물`);
  const laws = [];
  let totalCount = 0;
  let page = 1;

  for (; page <= MAX_SEARCH_PAGES; page += 1) {
    if (page > 1) await sleep(REQUEST_DELAY_MS);
    const url = `${SEARCH_URL}?OC=${OC}&target=ordin&type=JSON&search=1&display=100&page=${page}&query=${query}`;
    const body = await fetchWithRetry(url);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`검색 응답이 JSON이 아니다 (${기관명}) — 데모 계정이 막혔을 수 있다`);
    }
    const search = parsed.OrdinSearch ?? {};
    if (page === 1) totalCount = Number(search.totalCnt ?? 0);
    const pageLaws = asArray(search.law);
    laws.push(...pageLaws);
    if (pageLaws.length === 0 || laws.length >= totalCount) break;
  }

  // 상한에 걸려 끊겼으면 알린다. 조용히 자르면 누락이 "조례 없음"으로 보인다.
  if (laws.length < totalCount) {
    console.error(`    ! ${기관명} 검색이 ${laws.length}/${totalCount}건에서 끊겼다 (상한 ${MAX_SEARCH_PAGES}페이지)`);
  }

  return laws
    .filter((law) => law.지자체기관명 === 기관명)
    .filter((law) => /폐기물/.test(law.자치법규명))
    .filter((law) => !UNRELATED_LAW_PATTERNS.some((pattern) => pattern.test(law.자치법규명)))
    .map((law) => ({
      name: law.자치법규명,
      kind: law.자치법규종류,
      effectiveDate: law.시행일자,
      mst: law.자치법규일련번호,
    }))
    // 2단계 — 조례를 먼저, 없으면 시행규칙. 같은 종류 안에서는 시행일자 최신순.
    .sort((a, b) => {
      const rank = (kind) => (kind === "조례" ? 0 : 1);
      if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
      return String(b.effectiveDate).localeCompare(String(a.effectiveDate));
    });
}

/** 3단계 — 본문 JSON에서 별표 첨부 목록을 뽑는다. */
async function fetchAttachments(mst) {
  const body = await fetchWithRetry(`${SERVICE_URL}?OC=${OC}&target=ordin&MST=${mst}&type=JSON`);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`본문 응답이 JSON이 아니다 (MST ${mst})`);
  }
  const service = parsed.LawService ?? {};
  return asArray(service.별표?.별표단위).map((item) => ({
    title: (item.별표제목 ?? "").trim(),
    kind: item.별표첨부파일구분 ?? "",
    url: (item.별표첨부파일명 ?? "").replace(/^http:/, "https:"),
  }));
}

/** 4단계 — 첨부를 텍스트로 바꾼다. 실패는 던진다(건너뛰지 않는다). */
async function attachmentText(attachment) {
  const data = await fetchWithRetry(attachment.url, { asBuffer: true });
  if (data.length === 0) throw new Error("빈 첨부");

  // zip 로컬 파일 헤더 시그니처. 리터럴에 raw 제어문자를 박으면 편집기·리뷰
  // 화면에서 안 보여 2바이트 "PK"로 오독되므로 hex로 적는다.
  if (data.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))) {
    throw new Error("hwpx(zip) 첨부는 아직 지원하지 않는다");
  }
  if (data.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
    return extractHwpText(data);
  }
  // txt 첨부는 대체로 EUC-KR이다. UTF-8로 먼저 읽고 깨지면 EUC-KR로 되읽는다.
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(data);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("euc-kr").decode(data);
  } catch {
    return utf8;
  }
}

/**
 * 표 머리글을 찾는다. 별표 번호 머리표시에 기대지 않는다 — 종로구는
 * 묶음 파일 안에서 번호 없이 제목 줄만 나온다.
 */
function findTableStart(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 80) continue;
    if (!TABLE_SUBJECT.test(line) || !TABLE_FEE_WORD.test(line)) continue;
    if (/별지|서식/.test(line)) continue;
    return i;
  }
  return -1;
}

const AMOUNT = /^[0-9][0-9,]*$/;
/** 폐가전 무상수거 대상은 금액 대신 `무상`으로 적힌다. 이것도 행의 끝이다. */
const FREE_WORD = /^(무상|무료|면제)$/;

function parseAmount(token) {
  if (FREE_WORD.test(token)) return { feeKrw: 0, free: true };
  if (!AMOUNT.test(token)) return null;
  const digits = token.replace(/,/g, "");
  if (digits.length > 8) return null;
  const value = Number(digits);
  // 규격에 섞인 낱개 숫자(단수, 인용 등)를 금액으로 오인하지 않도록 좁힌다.
  if (token.includes(",")) return { feeKrw: value, free: false };
  if (value === 0) return { feeKrw: 0, free: false };
  if (value >= 500) return { feeKrw: value, free: false };
  return null;
}

/**
 * 열 이름 줄의 어휘. 지자체마다 다르다 — `종류`(금천·강동), `유형`(영등포),
 * `1차분류`~`4차분류`(도봉)는 R1 초안에 없어 그 지역 열 인식이 통째로 죽었다.
 * `별`은 붙기도 떼기도 해서(`유형`/`유형별`, `품목`/`품목별`) 선택으로 둔다.
 */
const COLUMN_WORDS =
  /^(분\s*류|[0-9]\s*차\s*분\s*류|대분류|소분류|종\s*별|종\s*류|유\s*형(\s*별)?|품\s*목(\s*별)?|품\s*명|규\s*격|가\s*격|금\s*액|수수료(\(안\))?|부과\s*금액|처리비|비\s*고|변경\s*사항|연\s*번|순\s*번|번\s*호)$/;
/** 금액 칸 뒤에 더 붙는 열. 있으면 "금액이 행의 마지막"이라는 전제가 깨진다. */
const TRAILING_COLUMN = /^(비\s*고|변경\s*사항)$/;
/**
 * `변경사항`·`비고` 칸에 실제로 적히는 값. 개정 이력을 표 안에 적어 둔 것이라
 * 어휘가 닫혀 있다 — 동작구 별표의 꼬리 칸 값 59개가 전부 이 여섯 개다
 * (품목추가 29, 항목추가 21, 변경 4, 규격변경 3, 품목세분화·세분화 각 2).
 *
 * 품명이 이 낱말과 겹칠 일은 없으므로, 꼬리 열을 선언한 표에서 금액 바로 뒤에
 * 이 값이 오면 다음 행의 품명이 아니라 같은 행의 꼬리로 보고 버린다. 이 어휘
 * 바깥의 값이 꼬리 자리를 채우고 있으면 그건 여전히 미지원 형태다.
 */
const TRAILING_VALUE = /^(품목|항목|규격|명칭|금액)?(추가|삭제|변경|세분화|신설)$|^(신규|삭제|변경)$/;
const FEE_COLUMN = /^(가\s*격|금\s*액|수수료(\(안\))?|부과\s*금액|처리비)$/;
/** 행 번호 열. 선언돼 있으면 행 머리의 일련번호를 금액과 구분해야 한다. */
const SEQUENCE_COLUMN = /^(연번|순번|번호)$/;

/** 단위 표기. 머리글과 열 이름 줄 사이에도, 열 이름 줄 안에도 낀다. */
const UNIT_NOTE = /^\(\s*(단위\s*[:：][^)]*|원)\s*\)$/;
/** 머리글 아래 따로 한 줄로 붙는 조문 참조. `(제29조제1항제2호 관련)` */
const ARTICLE_REF = /^\(.*관련\s*\)$/;
/** 머리글과 열 이름 줄 사이에 낀 잡음을 몇 줄까지 건너뛸지. 실측 최대는 광진구 3줄이다. */
const MAX_HEADER_GAP = 6;

/** 머리글과 열 이름 줄 사이에 끼는 줄인가. */
function isHeaderNoise(line) {
  if (UNIT_NOTE.test(line) || ARTICLE_REF.test(line)) return true;
  // 표제를 한 번 더 적어놓은 줄. 광진구는 그대로 반복하고, 강동구는
  // `1. 대형폐기물 수집·운반수수료 (단위 : 원)`처럼 번호와 단위를 달고 나온다.
  return TABLE_SUBJECT.test(line) && TABLE_FEE_WORD.test(line);
}

/**
 * 표 머리글 다음에 오는 열 이름 줄을 읽는다. 열 구성이 지자체마다 달라
 * 파서를 고를 근거가 되고, 금액 뒤에 열이 더 있으면 단순 규칙을 쓸 수 없다.
 *
 * 머리글과 열 이름 줄이 맞붙어 있는 곳은 오히려 드물다(10곳 중 도봉구뿐).
 * 조문 참조·단위 표기·표제 재기술이 사이에 끼고 몇 줄이 끼는지도 제각각이라,
 * 맞붙어 있다고 보고 읽던 R1 초안은 10곳 중 7곳에서 빈 배열을 냈다. 그러면
 * parseFeeRows의 안전장치 둘(declaresTrailing·hasSequence)이 통째로 죽는다.
 */
function readColumns(lines, startIndex) {
  // 잡음만 건너뛴다. 잡음도 열 이름도 아닌 줄을 만나면 포기하고 원래 자리를
  // 돌려준다 — 계속 훑어 내려가면 열 이름 줄이 없는 표에서 데이터 셀을 열로
  // 주워 담아, 열 인식 실패보다 나쁜 가짜 열 구성을 만든다.
  let i = startIndex + 1;
  for (; i < lines.length && i - startIndex <= MAX_HEADER_GAP; i += 1) {
    if (COLUMN_WORDS.test(lines[i])) break;
    if (!isHeaderNoise(lines[i])) return { columns: [], nextIndex: startIndex + 1 };
  }
  if (i >= lines.length || !COLUMN_WORDS.test(lines[i])) return { columns: [], nextIndex: startIndex + 1 };

  const columns = [];
  // 좌우 2단 조판은 같은 열 구성이 두 번 나온다(금천·강동 8열). 상한은 그 위.
  for (; i < lines.length && columns.length < 12; i += 1) {
    if (COLUMN_WORDS.test(lines[i])) {
      columns.push(lines[i].replace(/\s+/g, ""));
      continue;
    }
    // 단위 표기가 열 이름 줄 한가운데 끼기도 한다 — 은평구는 `부과금액`과
    // `비고` 사이에, 도봉구는 `수수료` 다음에 온다. 여기서 멈추면 뒤에 오는
    // 열을 통째로 놓쳐, 하필 꼬리 열 감지가 봐야 할 `비고`가 사라진다.
    if (UNIT_NOTE.test(lines[i])) continue;
    break;
  }
  return { columns, nextIndex: i };
}

/**
 * 좌우 2단 조판인지 본다. 열 구성이 통째로 한 번 더 반복되면 한 페이지에 표를
 * 두 벌 앉힌 것이다(강남·강동·금천의 `종류|품목|규격|수수료` ×2, 송파의
 * `품목별|규격|부과금액` ×2).
 *
 * 반복 여부만으로 판정하는 이유는 열 이름이 지자체마다 다르기 때문이다. 어차피
 * 같은 이름이 두 번 나오는 정상 단일 표는 없다.
 */
function laneCount(columns) {
  if (columns.length < 4 || columns.length % 2 !== 0) return 1;
  const half = columns.length / 2;
  return columns.slice(0, half).join("|") === columns.slice(half).join("|") ? 2 : 1;
}

/**
 * 5단계 — 표를 (품명, 규격, 금액) 행으로 만든다.
 *
 * 셀이 순차 텍스트로 나오므로, 금액 셀을 만날 때까지 쌓인 라벨을 보고
 * 마지막이 규격, 그 앞이 품명이라고 본다. 라벨이 하나뿐이면 규격만 바뀐
 * 연속 행이라 품명을 이어 쓴다. 종별 칸이 세로로 쪼개져 들어오는 것 같은
 * 잉여 라벨은 앞쪽에 쌓이므로 자연히 버려진다.
 *
 * 좌우 2단 조판에서는 그 "이어 쓰기"가 반대편 단의 품명을 물어온다. 텍스트는
 * 시각적 행 순서대로 왼쪽·오른쪽·왼쪽·오른쪽으로 나오므로, 품명 칸이 병합돼
 * 생략된 행은 두 칸 앞의 품명을 이어야 한다. R2 골든셋에서 강남구 "의자
 * 100cm미만 1쪽 10,000원"이 이 결함으로 나왔다 — 실제로는 장롱의 둘째 행이다.
 * 그래서 금액 순번의 홀짝으로 단을 갈라 품명을 단별로 이어 쓴다.
 *
 * 완벽하지 않다 — 셀 안에서 줄바꿈된 품명은 뒷줄만 남는다. 그래서 각 행에
 * `rawGroup`을 같이 저장해 검수 때 원본을 볼 수 있게 한다.
 */
function parseFeeRows(lines, startIndex) {
  const { columns, nextIndex } = readColumns(lines, startIndex);
  const feeIndex = columns.findIndex((column) => FEE_COLUMN.test(column));
  const sequenceIndex = columns.findIndex((column) => SEQUENCE_COLUMN.test(column));
  const hasSequence = sequenceIndex >= 0;
  const lanes = laneCount(columns);

  const rows = [];
  let pending = [];
  const currentItems = new Array(lanes).fill(null);
  let amountIndex = 0;
  // 연번으로 걸러낸 값의 최대치. 아래 가드가 실제로 어디까지 버텼는지 본다.
  let maxSequence = 0;
  // 금액 바로 뒤 토큰의 분포. 꼬리 열 판정에 쓰며, 표를 실제로 훑는 이 루프
  // 안에서 모아야 표 바깥(부칙·묶음 파일의 다른 별표) 토큰이 섞이지 않는다.
  const trailingCounts = new Map();
  let trailingSamples = 0;
  // 꼬리 열을 선언했는가. 선언만으로는 막지 않고(성남시는 `비고`를 통째로 비워뒀다)
  // 아래에서 실제로 채워져 있는지 함께 본다.
  const declaresTrailing = feeIndex >= 0 && columns.slice(feeIndex + 1).some((column) => TRAILING_COLUMN.test(column));
  // 꼬리 칸을 몇 개나 걷어냈는지. 판정이 실제로 일을 했는지 보고에 쓴다.
  let trailingConsumed = 0;
  let afterAmount = false;

  for (let i = nextIndex; i < lines.length; i += 1) {
    const token = lines[i];

    // 금액 바로 뒤에 개정 이력 낱말이 오면 같은 행의 `변경사항`·`비고` 칸이다.
    // 다음 행의 품명으로 쌓으면 그 뒤가 통째로 한 칸씩 밀린다. 칸이 둘일 수
    // 있으므로(동작구 `품목추가` + `신규`) 연달아 걷어낸다.
    if (declaresTrailing && afterAmount && TRAILING_VALUE.test(token)) {
      trailingConsumed += 1;
      continue;
    }
    afterAmount = false;

    // 연번 열이 있는 표(종로·강북·은평·영등포)에서는 행 머리의 일련번호가
    // 금액 자리로 끼어든다. parseAmount는 콤마 없는 맨숫자도 500 이상이면
    // 금액으로 보므로, 500행을 넘는 표에서는 501·502…가 금액으로 소비돼
    // 가짜 행이 생기고 그 뒤 행의 품명·규격이 한 칸씩 밀린다. 이 넷은 연번이
    // 324를 넘지 않아 아직 드러나지 않았을 뿐이다(가장 큰 도봉구 713행은
    // 연번 열이 없어 해당 없다).
    //
    // 순번 카운터로 맞춰보는 방법은 병합 셀 하나에 어긋나면 복구되지 않는다.
    // 위치를 쓴다 — 직전 금액에서 pending을 비운 직후 자리에는 금액이 올 수
    // 없다(금액은 행의 마지막이다). 그래서 그 자리의 맨숫자는 연번으로 본다.
    //
    // 다만 이 자리 판정이 성립하려면 연번이 행의 첫 칸이어야 한다. 종로·강북은
    // 그렇지만(`연번`·`순번`이 0번 열) 은평·영등포는 그 앞에 `유형별`이 있어
    // 연번이 1번 열이다. 저 둘은 유형이 병합돼 안 나오는 대다수 행에서만
    // 맞고, 새 유형 그룹이 열리는 행은 pending에 유형명이 이미 쌓여 있어
    // 가드를 빠져나간다. 루프 뒤에서 그 구멍을 따로 막는다.
    if (hasSequence && pending.length === 0 && /^\d{1,4}$/.test(token)) {
      maxSequence = Math.max(maxSequence, Number(token));
      pending.push(token); // rawGroup에는 남긴다. 아래 labels 필터가 후보에서 뺀다.
      continue;
    }

    const amount = parseAmount(token);
    if (amount === null) {
      pending.push(token);
      // 라벨만 40줄 넘게 이어지면 표가 끝나고 부칙·설명문으로 넘어간 것이다.
      if (pending.length > 40) break;
      continue;
    }

    // 걷어낸 꼬리 칸 다음 토큰을 본다. 걷어낸 값 자체를 표본에 넣으면 판정이
    // 스스로를 근거로 삼는 꼴이라, 이미 해결한 형태를 계속 미지원으로 막는다.
    let followerIndex = i + 1;
    while (declaresTrailing && lines[followerIndex] !== undefined && TRAILING_VALUE.test(lines[followerIndex])) {
      followerIndex += 1;
    }
    const follower = lines[followerIndex];
    // 연번은 행마다 값이 달라 분포가 퍼지므로 표본에서 뺀다. 남겨두면
    // 표본만 부풀려 꼬리 열 판정의 비율을 희석한다.
    const followerIsSequence = hasSequence && follower !== undefined && /^\d{1,4}$/.test(follower);
    // 열 이름은 쪽이 넘어갈 때 표 머리가 다시 찍힌 것이지 꼬리 열의 값이 아니다.
    // 빼지 않으면 마포구가 `비고`를 채워둔 표로 잘못 판정된다 — 실제 꼬리 값은
    // 하나도 없고 반복된 머리글 `유형별`이 6회 잡혔을 뿐이었다.
    const followerIsHeader = follower !== undefined && COLUMN_WORDS.test(follower);
    if (follower !== undefined && !followerIsSequence && !followerIsHeader && parseAmount(follower) === null) {
      trailingCounts.set(follower, (trailingCounts.get(follower) ?? 0) + 1);
      trailingSamples += 1;
    }

    // 품명이 맨숫자인 경우는 없으므로 후보에서 뺀다.
    const labels = pending.filter((token) => !/^\d{1,4}$/.test(token));
    const lane = amountIndex % lanes;
    amountIndex += 1;

    let itemName = currentItems[lane];
    let spec = "";
    if (labels.length >= 2) {
      itemName = labels[labels.length - 2];
      spec = labels[labels.length - 1];
    } else if (labels.length === 1) {
      spec = labels[0];
    }

    if (itemName) {
      rows.push({
        itemName,
        spec,
        feeKrw: amount.feeKrw,
        free: amount.free,
        lane,
        // 품명 칸이 이 행에 직접 나왔는지. 아니면 병합 셀이라 보고 앞 행에서
        // 이어 쓴 것이다. 이어 쓴 품명은 좌우 2단 조판에서 단이 한 번 어긋나면
        // 그때부터 통째로 반대편 품명을 물어오므로, R3 임포터가 출처 신뢰도를
        // 가릴 수 있도록 표시해 둔다.
        nameInherited: labels.length < 2,
        rawGroup: [...pending],
      });
      currentItems[lane] = itemName;
    }
    pending = [];
    afterAmount = true;
  }

  // 연번이 첫 칸이 아닌 표(은평 `유형별`, 영등포 `유형` 다음에 온다)에서는 위
  // 가드가 새 그룹이 열리는 행을 놓친다. 연번이 500을 넘기 전까지는 parseAmount가
  // 걸러주니 새어 나가도 무해하지만, 넘는 순간부터는 가짜 행과 한 칸씩 밀린
  // 품명·규격이 섞인 그럴듯한 오답이 된다. 조용히 내보내느니 형태 미지원으로
  // 보고한다 — 지금 대상 중 연번 열이 있는 넷은 최대 324라 걸리지 않는다.
  if (sequenceIndex > 0 && maxSequence >= 500) {
    return {
      rows: [],
      columns,
      trailingConsumed,
      unsupportedForm: `연번이 첫 칸이 아닌데(${sequenceIndex}번 열) ${maxSequence}까지 올라간다 — 금액과 구분되지 않는다`,
    };
  }

  // 금액 뒤에 `비고`·`변경사항` 열이 더 있으면 금액 다음 토큰이 다음 행의
  // 품명이 아니라 같은 행의 꼬리다. 개정 이력 어휘로 적힌 꼬리는 위에서 걷어냈고,
  // 여기서는 그러고도 남은 값이 있는지 본다. 남아 있다면 어휘를 벗어난 자유 서술이
  // 채워져 있다는 뜻이라, 단순 규칙으로 밀면 품명과 규격이 한 칸씩 밀린 그럴듯한
  // 오답이 나온다 — 내지 않는 편이 낫다.
  //
  // 열 이름만 보고 막으면 안 된다는 것도 그대로다. 성남시는 `비고`를 선언해놓고
  // 전 행을 비워뒀고, 그 표는 단순 규칙으로 정확히 읽힌다. 그래서 헤더 선언과
  // 데이터 증거를 모두 요구한다.
  if (declaresTrailing) {
    const [topToken, topCount] = [...trailingCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    if (trailingSamples > 0 && topCount >= 5 && topCount / trailingSamples >= 0.05) {
      const trailingNames = columns.slice(feeIndex + 1).join("·");
      return {
        rows: [],
        columns,
        trailingConsumed,
        unsupportedForm: `금액 뒤 ${trailingNames} 열에 개정 이력 어휘 밖의 값이 채워져 있다 (예: "${topToken}" ${topCount}회)`,
      };
    }
  }

  return { rows, columns, trailingConsumed, unsupportedForm: null };
}

function normalizeLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

export async function collectRegion(target) {
  const result = {
    regionId: target.regionId,
    기관명: target.기관명,
    collectedAt: new Date().toISOString().slice(0, 10),
    law: null,
    attachment: null,
    rows: [],
    rawText: "",
    errors: [],
    inspected: [],
  };

  const laws = await searchLaws(target.기관명);
  if (laws.length === 0) {
    result.errors.push("폐기물 관련 자치법규를 찾지 못했다");
    return result;
  }

  for (const law of laws) {
    await sleep(REQUEST_DELAY_MS);
    let attachments;
    try {
      attachments = await fetchAttachments(law.mst);
    } catch (error) {
      result.errors.push(`[${law.name}] 본문 조회 실패: ${error.message}`);
      continue;
    }

    const candidates = attachments.filter((item) => !NON_TABLE_ATTACHMENT.test(item.title));
    for (const attachment of candidates) {
      await sleep(REQUEST_DELAY_MS);
      let text;
      try {
        text = await attachmentText(attachment);
      } catch (error) {
        // 조용히 넘기지 않는다. R0에서 강북구가 이것 때문에 "표 없음"으로
        // 잘못 판정될 뻔했다.
        result.errors.push(`[${law.name}] ${attachment.title || "(제목 없음)"} 파싱 실패: ${error.message}`);
        continue;
      }

      const lines = normalizeLines(text);
      const start = findTableStart(lines);
      result.inspected.push({
        law: law.name,
        attachment: attachment.title || "(제목 없음)",
        kind: attachment.kind,
        lines: lines.length,
        headerFound: start >= 0,
      });
      if (start < 0) continue;

      const { rows, columns, trailingConsumed, unsupportedForm } = parseFeeRows(lines, start);
      if (unsupportedForm) {
        // 표는 찾았는데 파서가 못 다루는 형태다. 원문은 남기고 사유를 보고한다 —
        // 그냥 넘기면 "표 없음"과 구별되지 않아 커버리지 착시가 생긴다.
        result.law = law;
        result.attachment = { ...attachment, header: lines[start], columns, trailingConsumed };
        result.rawText = text;
        result.errors.push(`[${law.name}] ${attachment.title || "(제목 없음)"}: 열 구성 미지원 — ${unsupportedForm}`);
        return result;
      }
      if (rows.length === 0) {
        // 머리글은 찾았는데 행이 0개다. 사유 없이 넘기면 최종 메시지가
        // "수수료표를 찾지 못했다"뿐이라 머리글조차 없던 경우와 구별되지 않는다.
        result.errors.push(
          `[${law.name}] ${attachment.title || "(제목 없음)"}: 표 머리글은 찾았으나 행을 하나도 뽑지 못했다 (머리글: "${lines[start]}")`,
        );
        continue;
      }

      result.law = law;
      result.attachment = { ...attachment, header: lines[start], columns, trailingConsumed };
      result.rows = rows;
      result.rawText = text;
      return result;
    }
  }

  if (result.rows.length === 0) result.errors.push("수수료표를 찾지 못했다");
  return result;
}

async function main() {
  const requested = process.argv.slice(2);

  // 모르는 regionId를 조용히 버리면 안 된다. 유효한 것과 섞여 들어오면
  // 오타 하나로 그 지역이 빠진 채 "완료 — 1/1"이 찍혀 성공으로 보인다.
  const known = new Set(TARGETS.map((t) => t.regionId));
  const unknown = requested.filter((regionId) => !known.has(regionId));
  if (unknown.length > 0) {
    console.error(`모르는 regionId: ${unknown.join(", ")}`);
    console.error(`사용 가능한 regionId: ${TARGETS.map((t) => t.regionId).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const targets = requested.length > 0 ? TARGETS.filter((t) => requested.includes(t.regionId)) : TARGETS;

  mkdirSync(OUTPUT_DIR, { recursive: true });
  let failed = 0;

  for (const target of targets) {
    process.stdout.write(`${target.regionId} (${target.기관명}) ... `);
    let result;
    try {
      result = await collectRegion(target);
    } catch (error) {
      console.log(`실패 — ${error.message}`);
      failed += 1;
      continue;
    }

    const outputPath = `${OUTPUT_DIR}/${target.regionId}.json`;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

    if (result.rows.length > 0) {
      const items = new Set(result.rows.map((row) => row.itemName)).size;
      const trailing = result.attachment?.trailingConsumed ?? 0;
      console.log(
        `${result.rows.length}행 / 품명 ${items}종 — ${result.law.kind} 「${result.law.name}」 시행 ${result.law.effectiveDate}` +
          (trailing > 0 ? ` (꼬리 칸 ${trailing}개 걷어냄)` : ""),
      );
    } else {
      console.log("표 없음");
      failed += 1;
    }
    for (const error of result.errors) console.log(`    ! ${error}`);
  }

  console.log(`\n완료 — ${targets.length - failed}/${targets.length}. 결과는 ${OUTPUT_DIR}/ 에 있다.`);
  if (failed > 0) process.exitCode = 1;
}

// R2 검증 스크립트가 이 파일의 수집·파싱을 그대로 재사용한다. import될 때까지
// main()이 돌면 골든셋 검증이 추출을 한 번 더 돌리는 꼴이 되므로 직접 실행일 때만 돈다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
