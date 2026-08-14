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
import { dirname } from "node:path";

import { extractHwpText } from "./hwp-text.mjs";

const OC = process.env.LAW_GO_KR_OC ?? "test";
const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const OUTPUT_DIR = "data/ordinance-raw";

/** 데모 계정을 두드리는 속도를 낮춘다. R0 실측 건당 2.2초와 같은 수준이다. */
const REQUEST_DELAY_MS = 400;

/**
 * Phase 6 대상 10곳. 용산·노원·강서·관악은 공공데이터포털 표준데이터
 * 트랙이 맡으므로 여기 없다(PRD "트랙 분담").
 *
 * `기관명`은 법제처 `지자체기관명`과 정확히 일치해야 한다 — 우리 지역명
 * ("서울 종로구")과 표기가 다르다.
 */
const TARGETS = [
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

/** 1단계 — 기관명이 정확히 일치하고 이름에 `폐기물`이 든 자치법규를 전부 모은다. */
async function searchLaws(기관명) {
  const query = encodeURIComponent(`${기관명.split(" ").pop()} 폐기물`);
  const url = `${SEARCH_URL}?OC=${OC}&target=ordin&type=JSON&search=1&display=100&query=${query}`;
  const body = await fetchWithRetry(url);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`검색 응답이 JSON이 아니다 (${기관명}) — 데모 계정이 막혔을 수 있다`);
  }
  const laws = asArray(parsed.OrdinSearch?.law);

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

  if (data.subarray(0, 4).equals(Buffer.from("PK", "latin1"))) {
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

/** 표 머리글 바로 아래 열 이름 줄. 지자체마다 어휘가 다르다. */
const COLUMN_WORDS =
  /^(분\s*류|대분류|소분류|종\s*별|유형\s*별|품\s*목|품\s*명|품목\s*별|규\s*격|가\s*격|금\s*액|수수료(\(안\))?|부과\s*금액|처리비|비\s*고|변경\s*사항|연\s*번|순\s*번|번\s*호)$/;
/** 금액 칸 뒤에 더 붙는 열. 있으면 "금액이 행의 마지막"이라는 전제가 깨진다. */
const TRAILING_COLUMN = /^(비\s*고|변경\s*사항)$/;
const FEE_COLUMN = /^(가\s*격|금\s*액|수수료(\(안\))?|부과\s*금액|처리비)$/;

/**
 * 표 머리글 다음에 오는 열 이름 줄을 읽는다. 열 구성이 지자체마다 달라
 * 파서를 고를 근거가 되고, 금액 뒤에 열이 더 있으면 단순 규칙을 쓸 수 없다.
 */
function readColumns(lines, startIndex) {
  const columns = [];
  let i = startIndex + 1;
  for (; i < lines.length && columns.length < 10; i += 1) {
    if (!COLUMN_WORDS.test(lines[i])) break;
    columns.push(lines[i].replace(/\s+/g, ""));
  }
  return { columns, nextIndex: i };
}

/**
 * 5단계 — 표를 (품명, 규격, 금액) 행으로 만든다.
 *
 * 셀이 순차 텍스트로 나오므로, 금액 셀을 만날 때까지 쌓인 라벨을 보고
 * 마지막이 규격, 그 앞이 품명이라고 본다. 라벨이 하나뿐이면 규격만 바뀐
 * 연속 행이라 품명을 이어 쓴다. 종별 칸이 세로로 쪼개져 들어오는 것 같은
 * 잉여 라벨은 앞쪽에 쌓이므로 자연히 버려진다.
 *
 * 완벽하지 않다 — 셀 안에서 줄바꿈된 품명은 뒷줄만 남는다. 그래서 각 행에
 * `rawGroup`을 같이 저장해 검수 때 원본을 볼 수 있게 한다.
 */
function parseFeeRows(lines, startIndex) {
  const { columns, nextIndex } = readColumns(lines, startIndex);

  // 금액 뒤에 `비고`·`변경사항` 열이 더 있으면 금액 다음 토큰이 다음 행의
  // 품명이 아니라 같은 행의 꼬리다. 이 형태를 단순 규칙으로 밀면 품명과
  // 규격이 한 칸씩 밀린 그럴듯한 오답이 나온다 — 내지 않는 편이 낫다.
  //
  // 다만 열 이름만 보고 막으면 안 된다. 성남시처럼 `비고`를 선언해놓고 실제로는
  // 전부 비워둔 표가 있고, 그건 단순 규칙으로 정확히 읽힌다. 그래서 헤더 선언과
  // 데이터 증거를 모두 요구한다 — 금액 바로 뒤 토큰이 특정 값으로 반복되면
  // (동작구 `품목추가` 29회) 꼬리 열이 실제로 채워져 있다는 뜻이다.
  const feeIndex = columns.findIndex((column) => FEE_COLUMN.test(column));
  const declaresTrailing = feeIndex >= 0 && columns.slice(feeIndex + 1).some((column) => TRAILING_COLUMN.test(column));
  if (declaresTrailing) {
    const counts = new Map();
    let samples = 0;
    for (let i = nextIndex; i < lines.length - 1; i += 1) {
      if (parseAmount(lines[i]) === null || parseAmount(lines[i + 1]) !== null) continue;
      const next = lines[i + 1];
      counts.set(next, (counts.get(next) ?? 0) + 1);
      samples += 1;
    }
    const [topToken, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    if (samples > 0 && topCount >= 5 && topCount / samples >= 0.05) {
      const trailingNames = columns.slice(feeIndex + 1).join("·");
      return {
        rows: [],
        columns,
        unsupportedForm: `금액 뒤 ${trailingNames} 열이 채워져 있다 (예: "${topToken}" ${topCount}회)`,
      };
    }
  }

  const rows = [];
  let pending = [];
  let currentItem = null;

  for (let i = nextIndex; i < lines.length; i += 1) {
    const token = lines[i];
    const amount = parseAmount(token);
    if (amount === null) {
      pending.push(token);
      // 라벨만 40줄 넘게 이어지면 표가 끝나고 부칙·설명문으로 넘어간 것이다.
      if (pending.length > 40) break;
      continue;
    }

    // 연번 열이 있는 표(영등포구)에서는 행 번호가 품명 자리로 밀려든다.
    // 품명이 맨숫자인 경우는 없으므로 후보에서 뺀다.
    const labels = pending.filter((token) => !/^\d{1,4}$/.test(token));

    let itemName = currentItem;
    let spec = "";
    if (labels.length >= 2) {
      itemName = labels[labels.length - 2];
      spec = labels[labels.length - 1];
    } else if (labels.length === 1) {
      spec = labels[0];
    }

    if (itemName) {
      rows.push({ itemName, spec, feeKrw: amount.feeKrw, free: amount.free, rawGroup: [...pending] });
      currentItem = itemName;
    }
    pending = [];
  }

  return { rows, columns, unsupportedForm: null };
}

function normalizeLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

async function collectRegion(target) {
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

      const { rows, columns, unsupportedForm } = parseFeeRows(lines, start);
      if (unsupportedForm) {
        // 표는 찾았는데 파서가 못 다루는 형태다. 원문은 남기고 사유를 보고한다 —
        // 그냥 넘기면 "표 없음"과 구별되지 않아 커버리지 착시가 생긴다.
        result.law = law;
        result.attachment = { ...attachment, header: lines[start], columns };
        result.rawText = text;
        result.errors.push(`[${law.name}] ${attachment.title}: 열 구성 미지원 — ${unsupportedForm}`);
        return result;
      }
      if (rows.length === 0) continue;

      result.law = law;
      result.attachment = { ...attachment, header: lines[start], columns };
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
  const targets = requested.length > 0 ? TARGETS.filter((t) => requested.includes(t.regionId)) : TARGETS;

  if (targets.length === 0) {
    console.error(`대상이 없다. 사용 가능한 regionId: ${TARGETS.map((t) => t.regionId).join(", ")}`);
    process.exitCode = 1;
    return;
  }

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
      console.log(`${result.rows.length}행 / 품명 ${items}종 — ${result.law.kind} 「${result.law.name}」 시행 ${result.law.effectiveDate}`);
    } else {
      console.log("표 없음");
      failed += 1;
    }
    for (const error of result.errors) console.log(`    ! ${error}`);
  }

  console.log(`\n완료 — ${targets.length - failed}/${targets.length}. 결과는 ${OUTPUT_DIR}/ 에 있다.`);
  if (failed > 0) process.exitCode = 1;
}

await main();
