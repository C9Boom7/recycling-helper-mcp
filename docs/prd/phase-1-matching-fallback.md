# Phase 1 — "못 찾는다" 해결: 폴백·오타 허용·별칭 보강

## 목표

예선 심사 피드백의 핵심("contain 방식이라 초기 데이터에서 못 찾는 케이스가 있다")을 해소한다.
방향은 원샷 강건성: **어떤 질의든 한 번의 툴 호출로 항상 쓸모 있는 응답**을 돌려준다.

## 범위

포함: not_found 폴백 응답, 자모 기반 오타 허용 매칭, 별칭 일괄 보강, 평가 케이스 확충.
제외: 신규 품목 대량 추가(Phase 2), 멀티스텝 탐색 툴 신설(하지 않기로 결정 — ChatGPT 환경에서 호출 누락 위험).

## 요구사항

### R1. not_found 폴백 — dead-end 제거

현재 `unknownItemResult()`는 "찾지 못했습니다 + 비슷한 후보"만 반환한다. 이를 다음 구조로 확장한다.

**새 데이터 파일 `src/data/material-guidelines.json`**: 재질/계열별 일반 배출 원칙. 카테고리 12개 내외:

`plastic_container, vinyl_film, paper_cardboard, can_metal, glass_bottle, styrofoam, textile, electronics_battery, hazardous_pressurized, bulky, food_waste, general_trash`

각 항목: `id, label(한국어), quickRule(한 줄 결론), steps(2~3), cautions(1~2), whenGeneral(재활용 불가 조건), source{title,url}`.
근거는 기존 품목 데이터가 쓰는 공식 출처(분리배출 지침 별표, 환경부 요령)를 재사용한다. 새 사실을 지어내지 않는다.

**질의 → 재질 추정**: 기존 `CONDITION_QUERY_SIGNALS`와 카테고리 키워드 정규식(`scoreQuerySemanticSignals`의 vinyl/paper/can 분기)을 일반화해서, 질의에서 재질 후보를 최대 2개 추정하는 `inferMaterialCategories(query)`를 [src/data.ts](../../src/data.ts)에 추가한다.

**폴백 응답 구성** (not_found일 때):
1. "정확한 품목은 초기 데이터에 없다"는 사실 명시 (기존 유지 — 신뢰성).
2. 재질 추정이 되면: 해당 재질의 quickRule + steps + whenGeneral을 "일반 원칙" 섹션으로 제공.
3. 재질 추정이 안 되면: 재질/오염 여부/크기를 되묻는 안내 + 주요 재질 4~5개의 quickRule 한 줄씩.
4. structuredContent: `{found:false, fallback:{materials:[...], askFor:["재질","오염 여부","크기","지역"]}}` — LLM이 되묻기와 원칙 안내를 조합할 수 있는 재료.
5. 기존 `candidates`(유사 품목 후보)는 유지.

수용 기준: 대표 미등재 질의(예: "실리콘 뒤집개 어떻게 버려?", "고무장갑 버리는 법")에 대해 일반 원칙이 포함된 응답이 나온다. mcp-answer-cases에 폴백 케이스 5개 이상 추가.

### R2. 자모 기반 오타 허용

현재 `fuzzy_overlap`(글자 집합 겹침, ≤30점)은 한국어 정밀도가 낮다. 다음으로 교체한다.

- 한글 음절을 호환 자모로 분해(초/중/종성)한 뒤, 질의·품목명 자모 시퀀스 간 유사도(레벤슈타인 / maxLen 정규화)를 계산.
- 새 matchKind `fuzzy_jamo`: 유사도 ≥ 0.85 → 70점(후보로 강하게), 0.7~0.85 → 40~55점(후보 목록에만). `generic_fragment`(82)나 `query_contains_name`(88+)보다 항상 낮게 유지해 기존 우선순위를 흔들지 않는다.
- 짧은 이름(정규화 2자 이하)에는 적용하지 않는다 (오폭 방지).
- 토큰 단위 비교도 지원: 질의 토큰 중 하나가 품목명과 자모 유사하면 매칭 (예: "패트병 라벨 떼야 해?" → "페트병").
- `resolveWasteItem`에서 `fuzzy_jamo` 단독 최고점일 때는 확정하지 말고 "이것을 찾으신 게 맞나요?" 성격이 드러나도록 ambiguous 후보(1개여도 candidates)로 처리할지 검토 — 유사도 ≥ 0.85 단일 후보면 match 확정, 그 미만이면 candidates로.

수용 기준(신규 평가 케이스로 고정): `패트병→페트병`, `스치로폼→스티로폼`, `형광능→형광등`, `건전기→건전지` 급의 오타 4개 이상이 올바른 품목으로 이어진다. 기존 evaluation-cases 130 + region 35 + mcp-answer-cases 전체 무회귀.

### R3. 별칭 일괄 보강

- 소스: `src/data/question-backlog.json`의 111개 질의, `docs/top-50-items.md`, 심사위원 실패 사례.
  - 심사위원 예시 대화: https://claude.ai/share/110dadc7-90ee-490f-a9ce-02667db18f8e — 접근 가능하면 WebFetch로 읽고 실패 질의를 회귀 케이스로 추가. 접근 불가면 건너뛴다.
- 보강 유형: 띄어쓰기 변형, 흔한 오타(자모 매칭으로 못 잡는 것), 구어체("페트", "박스"), 브랜드/통칭("햇반 용기", "즉석밥 용기").
- 품목당 별칭 상한을 두지 않되, 포괄어(단독 "컵", "통" 등)는 추가하지 않는다 — ambiguous 처리 체계를 흔들지 않기 위함.
- 각 별칭 그룹마다 evaluation-cases 케이스를 함께 추가한다.

### R4. 과매칭 방어

R2·R3은 매칭을 공격적으로 만들므로, 반대 방향 회귀를 함께 고정한다.

- 기존 ambiguous 케이스("컵", "통", "병", "용기")가 여전히 ambiguous인지 smoke로 확인.
- 서로 자모가 비슷한 품목 쌍(예: "약병"/"약봉투" 계열)이 오타 매칭으로 뒤바뀌지 않는지 케이스 추가.

## 파일별 작업 지점

- [src/data.ts](../../src/data.ts): `scoreItem`(fuzzy 교체), `inferMaterialCategories` 신설, material-guidelines 로드.
- [src/server.ts](../../src/server.ts): `unknownItemResult` 확장 (Phase 0의 structuredContent 스펙 준수).
- `src/data/material-guidelines.json` 신설, `src/data/waste-items.json` 별칭 보강.
- `scripts/validate-data.mjs`: material-guidelines 스키마 검증 추가.
- `src/data/evaluation-cases.json`, `src/data/mcp-answer-cases.json`: 케이스 추가 (append-only, Phase 2와 id 충돌 주의).

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과, 기존 케이스 전체 무회귀.
2. 오타 케이스 4+, 폴백 케이스 5+, 별칭 케이스 (보강 그룹당 1개) 추가.
3. 질문 백로그 111개 질의를 `resolveWasteItem`에 일괄 실행해 not_found 수 before/after를 이 문서 하단에 기록.
4. 로컬 main 머지.

## 완료 체크리스트

- [ ] R1 폴백 (데이터 + 추정 + 응답)
- [ ] R2 자모 매칭
- [ ] R3 별칭 보강
- [ ] R4 과매칭 방어 케이스
- [ ] not_found 감소 측정 기록
