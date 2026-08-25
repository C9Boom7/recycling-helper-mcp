/**
 * 기후에너지환경부 분리배출 정보조회 서비스의 `getSpot` 클라이언트 (PRD phase-12 R1).
 *
 * 이 서버의 **유일한 외부 런타임 의존**이라, 이 파일이 하는 일의 절반은 조회가 아니라
 * "실패했을 때 조용히 물러나기"다. 어떤 실패든 던지지 않고 실패값으로 돌려주고,
 * 호출부(`find_disposal_spots` 핸들러)는 그걸 폴백으로 받는다. 실패 종류를 가르는 것은
 * `_log` 한 곳뿐이다(`SpotLookup` 주석 참고).
 *
 * 키를 다루는 곳도 여기 하나다. 키는 로그·오류·응답 어디에도 싣지 않는다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 실측 응답이 주는 필드는 이 셋뿐이다. 좌표도 종류 필드도 없다(docs/moe-recycling-api-2026-08-24.md 2장). */
export type SpotRow = {
  spotNm: string;
  addrBase: string;
  addrDtl: string;
};

export type SpotCategory = {
  id: string;
  label: string;
  patterns: string[];
  itemIds: string[];
  /** 업스트림이 죽었을 때 이 묶음이 스스로 내놓는 일반 안내 한 줄(PRD phase-12 R5). */
  fallbackLine: string;
  /**
   * 품목이 확정되지 않은 호출에서도 목록에 내보낼지. `종량제봉투 판매소`는 응답의 절반을
   * 차지해 크기 예산을 깨고, `기타`는 무엇인지 알 수 없는 이름이라 둘 다 false다.
   */
  defaultExposed: boolean;
};

type SpotCategoryEntry = {
  label: string;
  patterns: string[];
  itemIds: string[];
  fallbackLine: string;
  defaultExposed?: boolean;
};

const categoryPath = fileURLToPath(new URL("./data/spot-categories.json", import.meta.url));
const categoryFile = JSON.parse(readFileSync(categoryPath, "utf8")) as Record<string, SpotCategoryEntry>;

/**
 * **표 순서가 계약이다**(PRD phase-12 R3). `폐형광등∙폐건전지 전용 배출함`처럼 두 묶음
 * 표기를 겸하는 이름이 실제로 있어서, 먼저 걸리는 묶음이 이긴다. JSON의 키 순서를 그대로
 * 쓰고, 그 순서가 흐트러지지 않는지는 `scripts/validate-data.mjs`가 지킨다.
 *
 * 이 순서는 개수 상한에도 쓰인다 — 전체 12곳에 닿으면 앞쪽 묶음부터 채우고 뒤를 자른다.
 */
export const spotCategories: SpotCategory[] = Object.entries(categoryFile).map(([id, entry]) => ({
  id,
  label: entry.label,
  patterns: entry.patterns,
  itemIds: entry.itemIds,
  fallbackLine: entry.fallbackLine,
  defaultExposed: entry.defaultExposed !== false,
}));

/** 어느 패턴에도 안 걸린 이름이 떨어지는 자리. 표의 마지막 줄이고 patterns가 비어 있다. */
const CATCH_ALL_CATEGORY = spotCategories[spotCategories.length - 1];

/** 품목 → 묶음 역인덱스. 로드 시 한 번 만든다(PRD phase-12 R3). */
const categoryByItemId = new Map<string, SpotCategory>();
for (const category of spotCategories) {
  for (const itemId of category.itemIds) {
    if (!categoryByItemId.has(itemId)) categoryByItemId.set(itemId, category);
  }
}

/** 새 표기는 `etc`로 떨어질 뿐 답이 틀리지 않는다 — 노출되지 않을 뿐이다. */
export function categorizeSpotName(spotNm: string): SpotCategory {
  return spotCategories.find((category) => category.patterns.some((pattern) => spotNm.includes(pattern))) ?? CATCH_ALL_CATEGORY;
}

export function spotCategoryForItemId(itemId: string): SpotCategory | undefined {
  return categoryByItemId.get(itemId);
}

const DEFAULT_BASE_URL = "https://apis.data.go.kr/1482000/WasteRecyclingService";
/**
 * 1차 안은 1,500ms였다. 연속 12회 표본에서 11회는 345~432ms인데 1회가 2,346ms라
 * (docs/moe-recycling-api-2026-08-24.md 2-2-1), 1.5초로 잡으면 정상 상태에서도 ~8%가
 * 폴백으로 떨어진다. 가이드 예산이 p99 3,000ms라 2.5초는 예산 안이다.
 * **재시도는 넣지 않는다** — 최악 지연을 배로 만든다.
 */
const TIMEOUT_MS = 2_500;
/** 쪽 넘김 없이 한 번에 받는다. 실측 최대는 상계동 524행이라 지금은 이 상한에 닿지 않는다. */
const NUM_OF_ROWS = 1_000;

export type SpotLookup =
  | {
      ok: true;
      /** 1,000행 상한에 잘렸으면 `truncated`. 0건이면 `empty`. */
      upstream: "ok" | "empty" | "truncated";
      rows: SpotRow[];
      truncated: boolean;
      ms: number;
    }
  | {
      /**
       * 실패 갈래. 값은 로그(`_log.upstream`)에만 실리고 사용자 응답은 어느 쪽이든 같은
       * 폴백이다. 한 낱말로 접어 두면 프리징 기간에 원인을 좁힐 수 없어 가른다 —
       * `http`는 HTTP 상태 오류, `body`는 본문 해석 실패(게이트웨이 XML = 키 오류·한도
       * 초과, 비정상 resultCode 포함), `network`는 fetch 자체가 던진 실패(DNS·연결 거부)다.
       * 키를 잘못 넣은 "툴은 등록됐는데 100% 폴백"은 body가 쌓이는 모양으로 나타난다.
       */
      ok: false;
      upstream: "timeout" | "http" | "body" | "network";
      ms: number;
    };

function serviceKey(): string {
  return (process.env.DATA_GO_KR_SERVICE_KEY ?? "").trim();
}

/**
 * 키가 없으면 툴을 아예 등록하지 않는다(PRD phase-12 D3). 등록해 놓고 매번 폴백으로
 * 내려앉는 것보다 호스트가 처음부터 다른 툴을 고르는 쪽이 낫고, 이 성질이 되돌리기
 * 스위치를 겸한다 — 키 env를 비우고 재배포하면 툴이 내려간다.
 */
export function hasSpotServiceKey(): boolean {
  return serviceKey().length > 0;
}

/**
 * 포털이 주는 키는 두 형태다. 디코딩 키는 인코딩해야 하고, 인코딩 키(`%`가 들어 있다)는
 * 그대로 써야 한다 — 두 번 인코딩하면 인증이 깨진다. 이걸 틀리면 증상이 "툴은 등록됐는데
 * 100% 폴백"이라 가장 늦게 발견된다(scripts/probe-moe-recycling-api.mjs가 겪은 그대로다).
 */
function serviceKeyParam(key: string): string {
  return key.includes("%") ? key : encodeURIComponent(key);
}

function baseUrl(): string {
  // 값이 있되 비어 있으면(빈 문자열·공백) 없는 것으로 본다 — 그대로 쓰면 상대 URL이 되어
  // fetch가 던지고, 그 실패가 "http"로 접혀 영구 폴백이 되는데 런북의 http 행은 다른 원인을 가리킨다.
  const raw = process.env.MOE_API_BASE_URL;
  return (raw && raw.trim() ? raw.trim() : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function asRow(value: unknown): SpotRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const text = (field: string) => (typeof record[field] === "string" ? (record[field] as string).trim() : "");
  const spotNm = text("spotNm");
  const addrBase = text("addrBase");
  // 이름도 주소도 없는 행은 보여줄 게 없다. 주소가 답인 툴이라 addrBase가 없으면 버린다.
  if (!spotNm || !addrBase) return undefined;
  return { spotNm, addrBase, addrDtl: text("addrDtl") };
}

/** 정상(00)과 결과 없음(03)만 성공이다 — 한도 초과(22)·키 오류는 실패로 센다. */
function resultCodeOk(code: unknown): boolean {
  return code === "00" || code === "0" || code === "03" || code === "3";
}

type ParsedSpotBody = { rows: SpotRow[]; totalCount: number | undefined   /** 걸러내기 전(빈 행 제외 전) 행 수 — 절단 판정 기준. */
  rawCount: number;
};

/**
 * 응답 본문 파싱. 실패는 전부 `undefined` 하나로 접는다.
 *
 * 두 가지가 여기서 터졌다(실측 스크립트가 이미 겪은 것을 그대로 옮긴다).
 * 1. `items.item`은 **단건이면 배열이 아니라 객체로 온다.** 수거함이 한 곳뿐인 동에서만
 *    터지는 버그의 자리라 반드시 배열로 정규화한다.
 * 2. 게이트웨이 오류(키 오류·한도 초과)는 JSON이 아니라 **XML**로 온다. 그러면 JSON.parse가
 *    던지고, 그 예외가 곧 실패 신호다.
 */
function parseSpotBody(text: string): ParsedSpotBody | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }

  const root = (body as { response?: unknown })?.response ?? body;
  if (!root || typeof root !== "object") return undefined;
  const record = root as Record<string, unknown>;
  const header = (Array.isArray(record.header) ? record.header[0] : record.header) as Record<string, unknown> | undefined;
  if (!resultCodeOk(header?.resultCode)) return undefined;

  const responseBody = (Array.isArray(record.body) ? record.body[0] : record.body) as Record<string, unknown> | undefined;
  const items = (responseBody?.items as { item?: unknown } | unknown[] | undefined) ?? [];
  let rawRows = Array.isArray(items) ? items : Array.isArray((items as { item?: unknown }).item) ? ((items as { item: unknown[] }).item) : [(items as { item?: unknown }).item];
  // `items: [{ item: [...] }]` 이중 중첩도 온다 — 실측 스크립트가 실서버에서 이미 겪고
  // 정규화해 둔 모양이다. 안 풀면 행이 0개로 읽혀 "이 동에는 없다"는 거짓 답이 된다.
  if (rawRows.length === 1 && rawRows[0] !== null && typeof rawRows[0] === "object" && Array.isArray((rawRows[0] as { item?: unknown }).item)) {
    rawRows = (rawRows[0] as { item: unknown[] }).item;
  }

  const totalCountValue = responseBody?.totalCount;
  const totalCount =
    typeof totalCountValue === "number"
      ? totalCountValue
      : typeof totalCountValue === "string" && totalCountValue.trim() !== "" && Number.isFinite(Number(totalCountValue))
        ? Number(totalCountValue)
        : undefined;

  return {
    rows: rawRows.map(asRow).filter((row): row is SpotRow => row !== undefined),
    // 절단 판정은 걸러내기 **전** 행 수로 한다. `asRow`가 버린 빈 행 때문에 멀쩡한 응답이
    // "일부만 표시"로 읽히면 안 된다 — 절단은 업스트림이 덜 준 것이지 우리가 거른 게 아니다.
    rawCount: rawRows.filter((row) => row !== undefined && row !== null).length,
    totalCount,
  };
}

/**
 * 동 이름 캐시. 공공데이터포털 개발계정에는 일 호출 한도가 있고, 한도를 넘기면 그날
 * 남은 시간 내내 게이트웨이 오류(→ 100% 폴백)라 **한도 소진이 곧 툴의 수명**이다.
 * 같은 동을 몇 분 안에 다시 물으면 나가지 않게 막는다. 무상태 서버 원칙은 사용자
 * 상태에 대한 것이라 프로세스 내 응답 캐시는 어긋나지 않는다.
 *
 * 성공 응답만 담는다 — 실패를 담으면 일시 장애가 TTL 동안 고정된다. 상한을 넘으면
 * 가장 오래 담긴 것부터 지운다. `SPOT_CACHE_TTL_MS=0`으로 끌 수 있다(스모크가 목
 * 업스트림 시나리오를 동 이름별로 갈아 끼우기 위해 쓴다).
 */
const SPOT_CACHE_TTL_MS = (() => {
  const raw = (process.env.SPOT_CACHE_TTL_MS ?? "").trim();
  const parsed = Number(raw);
  return raw !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : 300_000;
})();
const SPOT_CACHE_MAX_ENTRIES = 500;
const spotCache = new Map<string, { expiresAt: number; result: SpotLookup }>();

/**
 * 동 이름 하나로 배출 장소를 한 번 조회한다. 쪽 넘김도 재시도도 없다.
 *
 * 키는 URL에만 실리고 반환값에는 어떤 형태로도 담기지 않는다 — 실패 이유조차 낱말 하나로만
 * 돌려주는 이유가 그것이다. 이 함수는 아무것도 로그로 찍지 않는다.
 *
 * 캐시에 걸리면 fetch 없이 그 결과를 그대로 돌려준다. `ms`도 원 조회의 값이다 —
 * 로그의 upstreamMs는 "업스트림이 얼마나 걸렸나"를 재는 자리라 0으로 덮지 않는다.
 */
export async function findSpotsByDong(dong: string): Promise<SpotLookup> {
  if (SPOT_CACHE_TTL_MS > 0) {
    const cached = spotCache.get(dong);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.result;
      spotCache.delete(dong);
    }
  }
  const result = await fetchSpotsByDong(dong);
  if (SPOT_CACHE_TTL_MS > 0 && result.ok) {
    if (spotCache.size >= SPOT_CACHE_MAX_ENTRIES) {
      const oldest = spotCache.keys().next().value;
      if (oldest !== undefined) spotCache.delete(oldest);
    }
    spotCache.set(dong, { expiresAt: Date.now() + SPOT_CACHE_TTL_MS, result });
  }
  return result;
}

async function fetchSpotsByDong(dong: string): Promise<SpotLookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    // URL 조립도 try 안이다 — 홀로 남은 서로게이트가 들어오면 `encodeURIComponent`가
    // URIError를 던지는데, 그게 밖으로 새면 "던지지 않는다"는 이 함수의 계약(D2)이 깨진다.
    const url = `${baseUrl()}/getSpot?serviceKey=${serviceKeyParam(serviceKey())}&pageNo=1&numOfRows=${NUM_OF_ROWS}&addr=${encodeURIComponent(dong)}`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await response.text();
    const ms = Date.now() - startedAt;
    if (!response.ok) return { ok: false, upstream: "http", ms };

    const parsed = parseSpotBody(text);
    if (!parsed) return { ok: false, upstream: "body", ms };

    /**
     * 절단은 오류가 아니라 **특정 묶음이 통째로 빠진 완전해 보이는 답**으로 나타난다.
     * 사용자가 눈치챌 수 없는 유일한 실패라, 응답에 표시를 올리고 로그에도 남긴다.
     */
    const truncated = parsed.totalCount !== undefined && parsed.totalCount > parsed.rawCount;
    return {
      ok: true,
      upstream: parsed.rows.length === 0 ? "empty" : truncated ? "truncated" : "ok",
      rows: parsed.rows,
      truncated,
      ms,
    };
  } catch (error) {
    const ms = Date.now() - startedAt;
    // 예외 메시지는 읽지 않는다 — 무엇이 담겨 있든 우리가 쓸 것은 "시간을 넘겼나"뿐이다.
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return { ok: false, upstream: timedOut ? "timeout" : "network", ms };
  } finally {
    clearTimeout(timer);
  }
}
