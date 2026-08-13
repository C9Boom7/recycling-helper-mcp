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

이 12개 id는 **재질 축의 독립 체계**다. `waste-items.json`의 `category` 필드(90여 종, 품목 분류 축)와 문자열이 일부 겹치더라도(`plastic_container`, `vinyl_film` 등) 서로 매핑하지 않는다. `inferMaterialCategories`의 반환값은 material-guidelines의 id만 가리킨다.

**질의 → 재질 추정**: 기존 `CONDITION_QUERY_SIGNALS`와 카테고리 키워드 정규식(`scoreQuerySemanticSignals`의 vinyl/paper/can 분기)을 일반화해서, 질의에서 재질 후보를 최대 2개 추정하는 `inferMaterialCategories(query)`를 [src/data.ts](../../src/data.ts)에 추가한다.

**폴백 응답 구성** (not_found일 때):
1. "정확한 품목은 초기 데이터에 없다"는 사실 명시 (기존 유지 — 신뢰성).
2. 재질 추정이 되면: 해당 재질의 quickRule + steps + whenGeneral을 "일반 원칙" 섹션으로 제공.
3. 재질 추정이 안 되면: 재질/오염 여부/크기를 되묻는 안내 + 주요 재질 4~5개의 quickRule 한 줄씩.
4. structuredContent: `{found:false, fallback:{materials:[...], askFor:["재질","오염 여부","크기","지역"]}}` — LLM이 되묻기와 원칙 안내를 조합할 수 있는 재료.
5. 기존 `candidates`(유사 품목 후보)는 유지.
6. **응답 크기 상한** (Phase 0 R5 다이어트 원칙 준수): 재질 최대 2개, 재질당 steps 2개 이내로 잘라 싣는다. text+structuredContent 합계가 대표 확정 매칭 응답(text 약 1.5~1.7KB + structured 약 0.5KB)과 같은 자릿수를 유지해야 하며, 원본 지침 덤프를 싣지 않는다.

수용 기준: 대표 미등재 질의(예: "실리콘 뒤집개 어떻게 버려?", "정수기 필터는 어떻게 버려?")에 대해 일반 원칙이 포함된 응답이 나온다. mcp-answer-cases에 폴백 케이스 5개 이상 추가.
(주의: "고무장갑"은 `rubber_gloves`로 이미 등재되어 있어 미등재 예시로 쓸 수 없다. 예시 질의는 착수 시점에 실제 not_found인지 확인하고 쓴다.)

### R2. 자모 기반 오타 허용

현재 `fuzzy_overlap`(글자 집합 겹침, ≤30점)은 한국어 정밀도가 낮다. 다음으로 교체한다.

- 한글 음절을 호환 자모로 분해(초/중/종성)한 뒤, 질의·품목명 자모 시퀀스 간 유사도(레벤슈타인 / maxLen 정규화)를 계산.
- 새 matchKind `fuzzy_jamo`: 유사도 ≥ 0.85 → 70점(후보로 강하게), 0.7~0.85 → 40~55점(후보 목록에만). `generic_fragment`(82)나 `query_contains_name`(88+)보다 항상 낮게 유지해 기존 우선순위를 흔들지 않는다.
- **`fuzzy_jamo`에는 `semanticBonus`를 가산하지 않는다.** 현행 `scoreItem`은 88점 미만 매칭에 최대 18점을 가산하므로, 그대로 두면 70점짜리 fuzzy_jamo가 88점까지 올라 위 불변식이 깨진다.
- 짧은 이름(정규화 2자 이하)에는 적용하지 않는다 (오폭 방지).
- 토큰 단위 비교도 지원: 질의 토큰 중 하나가 품목명과 자모 유사하면 매칭 (예: "패트병 라벨 떼야 해?" → "페트병").
- **확신 매칭(88점 이상)이 하나라도 있으면 fuzzy_jamo 후보는 결과 목록에서 제외한다.** 이미 정확히 매칭된 질의에 자모 근사 후보를 섞으면 `check_confusing_item` 같은 목록형 출력이 잡음으로 오염된다 (예: "비닐봉지" exact 매칭 옆에 "코팅지" 0.7 근사가 끼는 문제).
- **약한 밴드(0.7~0.85)는 단어형 질의(토큰 2개 이하)에서만 발동한다.** 문장형 질의에서는 일반 명사 토큰이 무관 품목과 0.7 언저리로 걸리는 잡음이 생기고("포장지"↔"화장지" 0.71), 그런 질의는 not_found 폴백(R1)이 더 유용한 답을 준다. 강한 밴드(≥0.85)는 문장에서도 발동한다.
- `resolveWasteItem`에 fuzzy_jamo 분기를 신설한다(확정 스펙): best가 `fuzzy_jamo`이고 유사도 ≥ 0.85 단일 후보면 match 확정, 그 미만이면 후보가 1개여도 `ambiguous`(candidates)로 돌려 "이것을 찾으신 게 맞나요?" 성격을 드러낸다. 현재 `resolveWasteItem`은 후보 2개 이상일 때만 ambiguous를 반환하므로(`candidates.length > 1`), fuzzy_jamo 분기에서는 이 조건을 완화해야 한다. 40~55점도 `findWasteItems`의 35점 필터를 통과하므로 이 분기가 없으면 낮은 유사도 오타가 단독 최고점일 때 그대로 match로 확정되는 회귀가 생긴다.

수용 기준(신규 평가 케이스로 고정): `패트병→페트병`, `스치로폼→스티로폼`, `형광능→형광등`, `건전기→건전지` 급의 오타 4개 이상이 올바른 품목으로 이어진다. 기존 evaluation-cases 130 + region 35 + mcp-answer-cases 전체 무회귀.
(경계값 주의: "패트병→페트병"은 자모 7개 중 1개 차이로 유사도가 정확히 6/7≈0.857 — 0.85 문턱의 경계 케이스다. 자모 분해 방식이 달라지면 문턱 아래로 떨어질 수 있으니, 이 케이스가 확정 매칭되는지 반드시 평가 케이스로 고정한다.)

### R3. 별칭 일괄 보강

- 소스: `src/data/question-backlog.json`의 111개 질의, `docs/top-50-items.md`, 심사위원 실패 사례.
  - 심사위원 예시 대화: https://claude.ai/share/110dadc7-90ee-490f-a9ce-02667db18f8e — 접근 가능하면 WebFetch로 읽고 실패 질의를 회귀 케이스로 추가. 접근 불가면 건너뛴다.
- 보강 유형: 띄어쓰기 변형, 흔한 오타(자모 매칭으로 못 잡는 것), 구어체("페트", "박스"), 브랜드/통칭("햇반 용기", "즉석밥 용기").
- 품목당 별칭 상한을 두지 않되, 포괄어(단독 "컵", "통" 등)는 추가하지 않는다 — ambiguous 처리 체계를 흔들지 않기 위함.
- 각 별칭 그룹마다 **mcp-answer-cases** 케이스를 함께 추가한다. (evaluation-cases는 `evaluate-data.mjs`가 품목당 정확히 1케이스를 강제하므로 기존 품목의 별칭·오타 케이스를 받을 수 없다. 오타 케이스도 같은 이유로 mcp-answer-cases에 넣는다.)

### R4. 과매칭 방어

R2·R3은 매칭을 공격적으로 만들므로, 반대 방향 회귀를 함께 고정한다.

- 기존 ambiguous 케이스("컵", "통", "병", "용기")가 여전히 ambiguous인지 smoke로 확인.
- 서로 자모가 비슷한 품목 쌍(예: "약병"/"약봉투" 계열)이 오타 매칭으로 뒤바뀌지 않는지 케이스 추가.

## 파일별 작업 지점

- [src/data.ts](../../src/data.ts): `scoreItem`(fuzzy 교체), `resolveWasteItem`(fuzzy_jamo 분기 — 단독 후보 ambiguous 허용), `inferMaterialCategories` 신설, material-guidelines 로드.
- [src/server.ts](../../src/server.ts): `unknownItemResult` 확장 (Phase 0의 structuredContent 스펙 준수).
- `src/data/material-guidelines.json` 신설, `src/data/waste-items.json` 별칭 보강.
- `scripts/validate-data.mjs`: material-guidelines 스키마 검증 추가.
- `scripts/report-backlog-resolution.mjs` 신설: 백로그 전 질의를 dist의 `resolveWasteItem`으로 돌려 status 분포 출력.
- `src/data/evaluation-cases.json`, `src/data/mcp-answer-cases.json`: 케이스 추가 (append-only, Phase 2와 id 충돌 주의).

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과, 기존 케이스 전체 무회귀.
2. 오타 케이스 4+, 폴백 케이스 5+, 별칭 케이스 (보강 그룹당 1개) 추가.
3. 질문 백로그 111개 질의를 `resolveWasteItem`에 일괄 실행해 not_found 수 before/after를 이 문서 하단에 기록. 측정은 `scripts/report-backlog-resolution.mjs`(신설, `pnpm build` 후 dist의 실제 `resolveWasteItem` 사용)로 한다 — `evaluate-data.mjs`의 단순화된 자체 매칭 구현을 쓰면 안 된다.
4. 로컬 main 머지.

## 완료 체크리스트

- [x] R1 폴백 (데이터 + 추정 + 응답) — material-guidelines.json 12종, `inferMaterialCategories`, `unknownItemResult` 확장, validate-data 스키마 검증. 폴백 smoke 5건
- [x] R2 자모 매칭 — `fuzzy_jamo`(강 0.85→70점 / 약 0.7~0.85→40~55점, semanticBonus 미가산, 약한 밴드는 토큰 2개 이하 질의만), `resolveWasteItem` 단독 후보 확인 질문 분기. 오타 smoke 4건 + 약한 밴드 1건
- [x] R3 별칭 보강 — 수세미(멜라민 스펀지·매직 스펀지·매직블럭), 우유팩(우유곽·우유갑), 건전지(밧데리), 페트병(페트). 그룹당 smoke 1건. 랩탑·정수기 필터·햇반 용기는 신규 품목 판단이라 data-decision-backlog에 기록하고 Phase 2로 이관
- [x] R4 과매칭 방어 — 기존 "컵/통/병/용기" ambiguous smoke 무회귀 유지, "약봉투"(빈 약통·폐의약품 미매칭) / "약병"(exact 유지) smoke 추가
- [x] not_found 감소 측정 기록 (아래)

## not_found 감소 측정 (2026-08-14)

측정 방법: `pnpm build` 후 `pnpm backlog:resolution` (`scripts/report-backlog-resolution.mjs`, dist의 실제 `resolveWasteItem` 사용).

| 시점 | match | ambiguous | not_found |
| --- | --- | --- | --- |
| before (Phase 0 직후) | 107 | 0 | 4 |
| after (Phase 1 완료) | 108 | 0 | 3 |

- 해소: "멜라민 스펀지는 플라스틱으로 재활용 돼?" — 수세미 별칭 보강으로 match.
- 잔여 3건: "약과 포장지"(폐의약품 오매칭 방지를 위한 의도적 비매칭 — 이제 비닐·유해 재질 폴백 제공), "랩탑", "정수기 필터"(신규 품목 후보 — Phase 2 이관, 각각 폐가전 추정 폴백·재질 메뉴 폴백 제공).
- 폴백 응답 크기 실측: 재질 1개 추정 약 1.4KB, 2개 추정 약 2.4KB (text+structuredContent 합계) — 대표 확정 매칭 응답(약 2.0~2.2KB)과 같은 자릿수.
- 회귀: `pnpm local:test` 통과 — evaluation 130 + region 35 + MCP answer 211(기존 196 + 신규 15) 전체.
