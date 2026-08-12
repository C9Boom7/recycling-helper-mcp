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
- 표준 티어 품목의 최소 요건: `name, aliases(≥2), category, disposalType, summary, steps(1~3), cautions(≥1), confidence, needsRegionCheck/regionPolicy, sources(≥1, url+checkedAt 필수), review.status="standard_import"`.
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
- 기존 130개와 중복 금지: `normalizeText` 기준으로 name/aliases 전수 대조. 기존 품목의 별칭으로 흡수하는 게 맞으면 그렇게 한다 (Phase 1 R3와 동일 원칙).
- 지역 의존이 강한 품목(전용 수거함/신고/수수료류)은 `regionPolicy.regionCheckLevel: "required"`로 표시하되, 지역별 세부 데이터는 만들지 않는다 — 런타임의 기존 "지역 확인 필요" 안내에 태운다.
- 목표 수량: +200 이상, 400개 도달 시 충분. 수량보다 "빈출인데 없는 품목" 우선.

### R3. 파이프라인·회귀

- `scripts/validate-data.mjs`: standard_import 허용 + 최소 요건 검증.
- 평가 케이스: 신규 품목 10개당 1개 이상 샘플링해 evaluation-cases에 추가 (대표 발화형 질의로).
- README·`docs/source-coverage.md`·`docs/data-quality.md`의 카운트 갱신.
- 대량 추가 후 과매칭 점검: 기존 evaluation-cases 130 + region 35 + mcp-answer-cases 전체 무회귀. 특히 신규 품목이 기존 품목의 exact/alias 매칭을 가로채지 않는지.

### R4. 효과 측정

- Phase 1과 동일한 측정: 질문 백로그 111개 질의 + 신규 수집한 빈출 발화 50개(리서치 중 함께 작성, `logs/`에 JSONL로 저장)에 대한 not_found 비율 before/after를 이 문서 하단에 기록.

## 진행 방식 제안

1. 후보 목록 먼저 만들기 (name + 예상 분류 + 출처 URL 후보) — 100~150개 단위 배치.
2. 배치별로 출처 확인 → JSON 작성 → validate/eval → 커밋. 한 번에 전부 하지 않는다.
3. 판단이 갈리는 품목(복합재질, 지자체 편차 큰 것)은 `docs/data-decision-backlog.md`에 쌓고 보수 안내로 우선 반영.

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과, 무회귀.
2. 신규 품목 전수: 출처 URL + checkedAt 존재, 중복 없음.
3. 카운트 문서 3곳 갱신.
4. R4 측정 기록.
5. 로컬 main 머지.

## 완료 체크리스트

- [ ] R1 표준 티어 모델 + validate 확장
- [ ] R2 품목 추가 (목표 +200)
- [ ] R3 평가 케이스 샘플링 + 카운트 갱신
- [ ] R4 효과 측정 기록
