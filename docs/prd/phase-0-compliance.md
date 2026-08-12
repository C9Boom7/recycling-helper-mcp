# Phase 0 — 본선 규격 정비

## 목표

본선(Kakao Tools) 환경에서 서버가 확실히 붙고, ChatGPT가 툴을 잘 고르고, 응답이 가이드 규격에 맞도록 서버 계층을 정비한다.
기능 추가는 없다. 이 Phase가 끝나면 곧바로 배포 가능한 상태여야 한다.

## 범위

포함: allowlist/CORS, 툴 description 전면 개편, 툴 정의 이원화 제거, structuredContent 다이어트, 툴 호출 로깅.
제외: 매칭 로직 변경(Phase 1), 데이터 추가(Phase 2), 위젯(Phase 3).

## 요구사항

### R1. Host allowlist 와일드카드

현재 [src/server.ts](../../src/server.ts)의 `DEFAULT_ALLOWED_HOSTS`는 예선 호스트만 하드코딩되어 있어, 신규 본선 서버의 endpoint 호스트가 거부될 수 있다.

- `*.playmcp-endpoint.kakaocloud.io` 형태의 **suffix 와일드카드**를 지원한다.
- SDK의 `createMcpExpressApp({ allowedHosts })`가 와일드카드를 지원하지 않으면, allowedHosts 옵션을 빼고 자체 host 검증 미들웨어로 대체한다 (suffix 매칭 + 기존 exact 항목).
- `ALLOWED_HOSTS` 환경변수 오버라이드는 유지한다.
- 수용 기준: `Host: anything.playmcp-endpoint.kakaocloud.io`로 보낸 `/mcp` 요청이 통과하고, localhost도 통과한다.

### R2. CORS origin 추가

`DEFAULT_ALLOWED_ORIGINS`에 다음을 추가한다 (기존 2개 유지):

- `https://preview-chatgpt.kakao.com` (Kakao Tools Preview — 브라우저 기반)
- `https://tools.kakao.com`

참고: 카카오 인프라의 서버 간 호출에는 Origin 헤더가 없어 CORS를 타지 않는다. 이 목록은 브라우저 기반 Preview 대비용이다.

### R3. 툴 description 전면 개편

목적: ChatGPT for Kakao는 툴 호출이 보장되지 않는다. description이 곧 툴 호출률이고 심사 기준이다.

원칙:
- 영문 기본 + **한국어 사용자 발화 예시** 포함 (ChatGPT가 한국어 발화와 매칭하기 쉽게).
- 서비스명 `RecyclingHelper(재활용척척)` 병기 유지.
- 각 1,024자 이내.
- 5개 툴 사이 역할 경계를 명시해 오라우팅을 줄인다. 특히 `get_disposal_steps`를 "버리는 법 질문의 기본 툴"로 명시하고, `classify_waste_item`에서 그리로 유도한다.

아래 초안을 적용한다 (구현 세션이 다듬어도 되지만 발화 예시·경계 문구는 유지):

- `classify_waste_item`:
  "Quickly classifies a Korean household waste item with RecyclingHelper(재활용척척): returns the disposal category (재활용/일반쓰레기/대형폐기물/특수폐기물), confidence, and whether local municipality rules matter. Use for quick yes/no judgment questions like '피자박스 재활용 돼?', '이거 분리수거 되나?', '스티로폼은 어디에 버려?'. For full step-by-step disposal instructions, prefer get_disposal_steps."
- `get_disposal_steps`:
  "Returns step-by-step disposal instructions for a Korean household waste item from RecyclingHelper(재활용척척): preparation steps, cautions, official sources, and region-specific notes when a region is given. This is the primary tool whenever a user asks how to throw away, discard, or recycle something — e.g. '기름 묻은 피자박스 어떻게 버려?', '깨진 유리컵 버리는 법', '폐건전지 어디다 버려?'. Accepts vague or partial item names; if ambiguous, the result lists candidates so you can ask the user which one they mean."
- `check_confusing_item`:
  "Explains commonly confused Korean waste-sorting cases with RecyclingHelper(재활용척척), comparing up to 3 similar items and their exceptions. Use when the user is unsure between categories or asks why — e.g. '영수증은 종이인데 왜 재활용 안 돼?', '컵라면 용기는 종이야 플라스틱이야?', '이것도 재활용 되는 거 맞아?'."
- `make_cleanup_plan`:
  "Groups multiple Korean household waste items into disposal buckets (재활용/일반쓰레기/대형폐기물/특수폐기물) with RecyclingHelper(재활용척척) and returns an organized disposal plan. Use when the user lists two or more items to throw away, or mentions moving out, decluttering, or a big cleanup — e.g. '이사 가는데 침대, 옷, 화분 버려야 해', '대청소했더니 버릴 게 한가득이야'."
- `get_region_disposal_info`:
  "Returns municipality-specific waste disposal information for a Korean region from RecyclingHelper(재활용척척): collection days, bulky-waste application links and fees, and official local sources. Use when the user names where they live or asks region-specific questions — e.g. '강남구 재활용 무슨 요일에 버려?', '성남시 대형폐기물 신고 어떻게 해?', '우리 동네 폐건전지 어디 버려?'. Optional itemName narrows the checklist to that item."

`SERVER_INSTRUCTIONS`도 갱신: get_disposal_steps 우선 사용, ambiguous면 후보를 보여주고 재질·용도를 되물을 것, 지역이 언급되면 region 파라미터로 전달할 것을 안내.

### R4. 툴 정의 이원화 제거

현재 [src/server.ts](../../src/server.ts)의 `COMPAT_TOOLS`(수기 JSON Schema)와 `registerTools()`(Zod)가 같은 내용을 두 벌 관리한다. description을 갈아엎는 시점이라 drift 사고 위험이 크다.

- 툴 메타데이터(name/title/description/annotations)와 Zod 입력 스키마를 **단일 소스 배열**로 정의한다.
- `registerTools()`와 `COMPAT_TOOLS`(JSON-only discovery 응답용)를 모두 그 배열에서 생성한다. JSON Schema 변환은 SDK가 쓰는 `zod-to-json-schema`를 사용한다 (이미 전이 의존성으로 존재하는지 확인 후, 없으면 devDependency가 아닌 dependency로 추가).
- 수용 기준: `tools/list`를 JSON-only 경로와 SSE 경로 양쪽으로 호출했을 때 name/description/inputSchema/annotations가 동일하다. 이 비교를 `scripts/smoke-mcp.mjs`에 케이스로 추가한다.

### R5. structuredContent 다이어트

가이드: "result의 크기는 최소한으로", "API 응답을 그대로 쓰지 말 것". 현재 `get_disposal_steps`는 품목 객체 전체를, `classify_waste_item`은 sources 배열 전체를 structuredContent에 싣는다.

툴별 허용 필드 (이 외 필드 제거):

- `classify_waste_item`: `found, matchedItem, matchedBy, disposalGroup, disposalType, summary, confidence, regionCheckLevel, regionGuidance, primarySource{title,url}`
- `get_disposal_steps`: `found, itemName, disposalGroup, summary, steps, cautions, regionCheckLevel, regionNotes(지역 안내 줄 배열, 있을 때만), sources(최대 2개 {title,url})`
- `check_confusing_item`: matches 배열 항목당 `itemName, summary, confidence, regionCheckLevel` + 첫 caution 1개
- `make_cleanup_plan`: items 항목당 `input, found, group, itemName?, summary, regionCheckLevel?` — `groups` 중복 맵 제거 (text에 이미 그룹핑이 있음)
- `get_region_disposal_info`: `region, matchedRegion, item, defaultSummary, checkList, officialSources(최대 3개)` — `regionalPolicy` 전체 객체 제거
- ambiguous/not_found 응답: 현행 유지 (이미 작음). `candidateDetails`의 `score`는 제거.

text 출력(마크다운)은 현행 유지 — 이미 정제된 형식이고 가이드 권장에 부합한다.
수용 기준: `pnpm smoke:mcp` 통과 (mcp-answer-cases의 structured 기대값은 이 스펙에 맞춰 갱신), 대표 응답의 JSON 크기가 기존 대비 절반 이하.

### R6. 툴 호출 로깅

QA 기간(8/24~26) 오류 대응과 발화 테스트 분석용. stdout에 한 줄 JSON으로 남긴다 (k8s/PlayMCP 로그로 수집됨).

- 필드: `ts, tool, input(itemName/region/items), status(match|ambiguous|not_found|ok), matchedId, score, ms`
- 구현: 툴 핸들러를 감싸는 `withCallLog(name, handler)` 헬퍼 하나로.
- 개인정보 유의: 입력은 품목명/지역명뿐이므로 문제없으나, 그 이상을 로깅하지 않는다.

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과 (check + smoke).
2. smoke에 R4 동등성 케이스 추가됨.
3. mcp-answer-cases의 structured 기대값이 R5 스펙으로 갱신됨.
4. 임의 Host 헤더(`x.playmcp-endpoint.kakaocloud.io`)로 initialize 요청이 성공하는 것을 curl로 확인.
5. README의 매칭/도구 설명이 변경 내용과 어긋나지 않는지 확인.
6. 로컬 main 머지. (origin push는 사용자 지시 대기)

## 리스크

- `createMcpExpressApp`의 allowedHosts 동작이 SDK 버전에 따라 다를 수 있음 → R1의 자체 미들웨어 대안 사용.
- description 개편이 기존 smoke 기대값과 충돌할 수 있음 → 기대값 갱신은 허용, 단 응답 텍스트 포맷 자체는 유지.

## 완료 체크리스트

- [ ] R1 allowlist 와일드카드
- [ ] R2 CORS origins
- [ ] R3 descriptions + SERVER_INSTRUCTIONS
- [ ] R4 단일 소스 툴 정의 + smoke 동등성 케이스
- [ ] R5 structuredContent 다이어트 + 케이스 갱신
- [ ] R6 호출 로깅
- [ ] DoD 전 항목
