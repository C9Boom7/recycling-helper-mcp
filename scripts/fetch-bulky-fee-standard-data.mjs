/**
 * 전국대형폐기물수거수수료정보표준데이터(행정안전부, publicDataPk 15114146) 수집.
 *
 * 공공데이터포털 표준데이터 상세 페이지의 다운로드 경로를 그대로 쓴다.
 * 이 경로는 인증키 없이 열리므로 오픈API 서비스키가 없어도 동작한다.
 *   1. /download/columList.json — 컬럼 목록, 총 건수, 내부 테이블명
 *   2. /download/standard.json — 실제 행 (page는 1부터, perPage 최대 10000)
 *
 * 런타임에서 호출하지 않는다. 이 스크립트는 빌드타임 인제스트 전용이다 —
 * 응답속도 요구(평균 100ms)와 코드 프리징 이후 외부 API 장애 위험 때문이다.
 *
 * 실행: node scripts/fetch-bulky-fee-standard-data.mjs [출력경로]
 *   기본 출력: logs/bulky-fee-standard-data.json (gitignore 대상 — 원본은 커밋하지 않는다)
 */
import { writeFileSync } from "node:fs";

const PUBLIC_DATA_PK = "15114146";
const PER_PAGE = 10_000;
const BASE = "https://www.data.go.kr";
const REFERER = `${BASE}/data/${PUBLIC_DATA_PK}/standard.do`;
const outputPath = process.argv[2] ?? "logs/bulky-fee-standard-data.json";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Referer: REFERER } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

const header = await fetchJson(`${BASE}/download/columList.json?pk=${PUBLIC_DATA_PK}&ext=CSV`);
const columns = header.tableVO.colNmList;
const totalCount = header.totalCount;
const svcTableNm = header.tableVO.svcTableNm;
console.log(`${header.fileName}: ${totalCount}행, table=${svcTableNm}`);

const pages = Math.ceil(totalCount / PER_PAGE);
const rows = [];
for (let page = 1; page <= pages; page++) {
  const params = new URLSearchParams({ publicDataPk: PUBLIC_DATA_PK, totalCount: String(totalCount), svcTableNm, perPage: String(PER_PAGE), page: String(page) });
  for (const column of columns) params.append("colNmList", column);

  const pageRows = await fetchJson(`${BASE}/download/standard.json?${params}`);
  console.log(`  page ${page}/${pages}: ${pageRows.length}행`);
  rows.push(...pageRows);
}

if (rows.length !== totalCount) {
  console.warn(`경고: 수집 ${rows.length}행 ≠ 신고 ${totalCount}행. 페이지네이션을 확인하세요.`);
}

writeFileSync(outputPath, JSON.stringify(rows));
console.log(`저장: ${outputPath} (${rows.length}행)`);
