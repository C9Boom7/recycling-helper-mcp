# Phase 2 — 품목 커버리지 확장 (표준 티어)

## 목표

실사용자 질의의 not_found 비율을 낮추기 위해 품목을 130개에서 400개 내외로 늘린다.
기존 130개 수준의 심층 검수(다중 출처, 조건 분기, 지역 정책)를 신규 품목 전체에 적용하기는 10일 안에 불가능하므로, **표준 티어**(얕지만 정확한 안내)를 신설한다.

## 범위

포함: 표준 티어 데이터 모델, 품목 리서치·벌크 추가, 검증 파이프라인 확장, 평가 케이스 샘플링.
제외: 매칭 로직 변경(Phase 1), 신규 지역 정책, 신규 대형폐기물 수수료 구조화(기존 사용자 결정으로 중단됨).

## 요구사항

### R1. 표준 티어 데이터 모델

- `ReviewStatus`에 `standard_import` 추가 ([src/data.ts](../../src/data.ts) 타입 + `scripts/validate-data.mjs` 허용값).
- 표준 티어 품목의 최소 요건: `id(snake_case), name, aliases(≥2), category, disposalType, summary, steps(1~3), cautions(≥1), sourceRefs(≥1), confidence, needsRegionCheck/regionPolicy, sources(≥1, url+checkedAt 필수), review.status="standard_import"`.
  - `sourceRefs`는 전 품목 공통 필수 필드다(validate가 비어 있지 않은 배열을 요구하고, 답변 하단 출처 표기에 그대로 쓰인다). 표준 티어도 예외 없음.
  - `source.url`은 기존 검증에서 optional이므로, `standard_import`에 한해 url 필수를 조건부로 검증한다.
- 기존 스키마를 그대로 쓰되 조건 분기(conditions)는 명확한 것만 넣는다. 애매하면 비운다.
- 답변 문구 톤은 기존 130개와 통일 (결론 우선, 보수적 안내).

### R2. 품목 선정과 리서치

우선순위 소스 (순서대로):

1. 질문 백로그의 미커버 질의와 그 인접 품목.
2. 생활폐기물 분리배출 누리집(분리배출.kr) 품목사전 — punycode: `https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do`. 기존 품목 데이터가 이미 이 사전을 출처로 쓰고 있으므로 검색 URL 패턴을 재사용한다.
3. `docs/source-*` 리서치 문서들에서 조사됐지만 품목으로 승격되지 않은 후보.
4. 생활 빈출 카테고리 체계 훑기: 주방(조리도구/용기), 욕실(위생/화장품), 의류/신발/잡화, 문구/완구, 소형가전/케이블, 인테리어 소품, 반려동물 용품, 계절용품(선풍기/히터/캠핑).

규칙:

- **웹에서 확인한 공식 근거가 있는 품목만** 추가한다. 근거를 못 찾으면 추가하지 않는다 (`docs/source-gap-policy.md`의 보수 안내 원칙 준수).
- 기존 130개와 중복 금지: `normalizeText` 기준으로 name/aliases 전수 대조. 수작업에 맡기지 말고 validate에 충돌 검사를 추가한다(R3 참고).
- 기존 품목의 별칭으로 흡수하는 게 맞으면 그렇게 한다 (Phase 1 R3와 동일 원칙). 단 **Phase 1이 병렬 진행 중이면** 기존 품목의 `aliases`를 직접 수정하지 않는다 — Phase 1 R3(별칭 일괄 보강)가 같은 필드를 만지므로 충돌한다. 흡수 후보는 `docs/data-decision-backlog.md`에 기록만 하고 Phase 1 머지 후 반영한다. 병렬 세션이 없으면 직접 수정해도 된다.
- 지역 의존이 강한 품목(전용 수거함/신고/수수료류)은 `regionPolicy.regionCheckLevel: "required"`로 표시하되, 지역별 세부 데이터는 만들지 않는다 — 런타임의 기존 "지역 확인 필요" 안내에 태운다.
- 목표 수량: +200 이상, 400개 도달 시 충분. 수량보다 "빈출인데 없는 품목" 우선.

### R3. 파이프라인·회귀

- `scripts/validate-data.mjs`: standard_import 허용 + 최소 요건 검증(R1의 조건부 규칙 포함).
- `scripts/validate-data.mjs`: `normalizeText` 기준 name/alias 충돌 검사 추가 — 품목 간 별칭 중복은 error. 현재는 name 중복이 warning일 뿐이고 alias 간 충돌 검사가 없어, 벌크 추가 시 기존 품목의 exact/alias 매칭 가로채기를 자동으로 못 잡는다.
- 평가 케이스: `evaluate-data.mjs`가 **품목당 정확히 1개**의 평가 케이스를 강제하므로(0개도 2개도 실패), 샘플링이 아니라 신규 품목 전수에 케이스를 1개씩 추가한다. 질의는 품목명이 그대로 들어간 발화형으로 만들고, 평가 스크립트의 단순 매처(정확일치/포함/문자 겹침)에서도 해당 품목이 이기는지 확인한다.
- MCP answer case: `validate-data.mjs`가 `regionPolicy.regionCheckLevel`이 지정된 품목마다 해당 레벨(`required`→`필수`)의 `expectedRegionalPolicy`와 그 품목 id를 담은 `mcp-answer-cases` 케이스를 강제한다. 표준 티어에서 `required`로 표시한 품목 전수에 최소 케이스(get_disposal_steps + 지역 지정 + level 검증)를 함께 추가해야 `pnpm check`가 통과한다.
- 카운트 문서 갱신 — validate가 강제하는 곳 포함 **4곳**: README, `docs/source-coverage.md`, `docs/data-quality.md`, `docs/session-coordination.md`(스냅샷 라인의 waste-items/evaluation-cases/review count를 정규식으로 대조하므로 안 고치면 `pnpm check` 실패).
- `docs/source-coverage.md`의 review status별 카운트에 `standard_import` 라인을 추가하고, `validate-data.mjs`의 `expectDocumentCount` 호출부에도 대응 검증을 추가한다.
- 대량 추가 후 과매칭 점검: 기존 evaluation-cases 130 + region 35 + mcp-answer-cases 전체 무회귀. 특히 신규 품목이 기존 품목의 exact/alias 매칭을 가로채지 않는지.

### R4. 효과 측정

- Phase 1과 동일한 측정: 질문 백로그 111개 질의 + 신규 수집한 빈출 발화 50개에 대한 not_found 비율 before/after를 이 문서 하단에 기록.
- 빈출 발화 50개는 `logs/coverage-expansion-queries.example.jsonl`로 저장한다. `.gitignore`가 `logs/*`를 무시하고 `*.example.jsonl`만 추적하므로, 이 네이밍이 아니면 측정 데이터가 커밋되지 않는다. 합성·무PII 질의만 넣는다(logs/README.md 컨벤션).

## 진행 방식 제안

1. 후보 목록 먼저 만들기 (name + 예상 분류 + 출처 URL 후보) — 100~150개 단위 배치.
2. 배치별로 출처 확인 → JSON 작성 → validate/eval → 커밋. 한 번에 전부 하지 않는다.
3. 판단이 갈리는 품목(복합재질, 지자체 편차 큰 것)은 `docs/data-decision-backlog.md`에 쌓고 보수 안내로 우선 반영.

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과, 무회귀.
2. 신규 품목 전수: 출처 URL + checkedAt 존재, 중복 없음.
3. 카운트 문서 4곳 갱신 (README, source-coverage, data-quality, session-coordination).
4. R4 측정 기록.
5. 로컬 main 머지.

## 완료 체크리스트

- [x] R1 표준 티어 모델 + validate 확장
- [x] R2 품목 추가 (130 → 272, +142)
- [x] R3 평가 케이스 전수 추가 + 카운트 갱신
- [x] R4 효과 측정 기록

## R4 효과 측정 결과 (2026-08-14)

측정 명령: `pnpm measure:coverage` ([scripts/measure-coverage.ts](../../scripts/measure-coverage.ts)).
런타임의 `resolveWasteItem`을 그대로 호출해 상태 분포를 집계한다.

before는 Phase 1이 이미 들어간 main(`a696026`) 기준이다. Phase 1도 not_found를 줄이므로,
Phase 2 단독 효과를 보려면 Phase 0 시점이 아니라 이 기준과 비교해야 한다.

| 질의 세트 | before (main `a696026`) | after (Phase 2) |
| --- | --- | --- |
| 질문 백로그 111개 | 3건 (2.7%) | 1건 (0.9%) |
| 신규 빈출 발화 50개 | 40건 (80.0%) | 6건 (12.0%) |

참고로 Phase 0 시점(Phase 1 이전) 백로그 not_found는 4건(3.6%)이었다. 즉 백로그 3.6% → 2.7%가
Phase 1 몫, 2.7% → 0.9%가 Phase 2 몫이다. 빈출 발화 50개는 Phase 1 전후 모두 80.0%로 같았다 —
이 세트는 미커버 품목 위주라 매칭 개선이 아니라 품목 추가로만 해결되는 성격이다.

빈출 발화 50개는 [logs/coverage-expansion-queries.example.jsonl](../../logs/coverage-expansion-queries.example.jsonl)에 있다.

남은 not_found와 사유:

- 백로그 1건 — "약과 포장지는 폐의약품 수거함에 넣어?": 약과(과자)와 약을 혼동한 질의로, 품목 추가가 아니라 Phase 1 폴백에서 다룰 영역이다.
- 발화 6건 — 플라스틱 양념통, 변기솔, 선크림 튜브, 가죽 벨트, 젖병, 사료 포대: 리서치에서 공식 근거를 찾지 못해 추측 배출법을 만들지 않고 제외했다. `docs/data-decision-backlog.md` 후보다.

## 실제 반영 내역

- 신규 품목 142개 (`review.status="standard_import"`), 평가 케이스 142개, MCP answer case 78개(지역 확인 필수 품목 전수 75건 + 폴백 보충 3건) 추가.
- Phase 1과의 통합에서 정리한 것: 멜라민 스펀지는 Phase 1이 이미 `수세미` 별칭으로 흡수해 중복 품목을 뺐고, 폴백 smoke 4건(뒤집개·정수기 필터·노트북·지갑)은 품목이 생겨 정상 매칭 기대로 갱신했다. Phase 1이 짚어준 오타 질의 4건(패트병·스치로폼·형광능·건전기)은 신규 품목이 끼어들지 않아 그대로 유지된다.
- 리서치 후보 약 220개 중 근거를 확인하지 못했거나 기존 품목에 흡수되는 67개는 추가하지 않았다. 목표치(+200)에는 못 미치지만, "공식 근거 있는 품목만" 원칙(R2)을 수량보다 우선했다.
- 과매칭 방어로 제거한 별칭: `크리스마스트리`의 "트리"(프린터 카트리지 질의를 가로챔), `멜라민 그릇`의 "멜라민 컵"(포괄어 "컵" 후보 목록에서 기존 머그컵을 밀어냄), `스마트워치`의 "전자시계", `전기포트`의 "티포트".
- 기존 데이터에서 발견해 정리한 별칭 충돌 1건: "커피 티백"이 `tea_bag`과 `drip_bag_coffee_filter` 양쪽에 있어 배출법이 맞는 후자만 남겼다.
- 백로그 todo 1건(`정수기 필터`)이 `water_purifier_filter` 품목으로 커버되어 `covered`로 전환했다.
