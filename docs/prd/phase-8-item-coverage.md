# Phase 8 — 품목 커버리지 마감

## 목표

확장 발화 세트에서 아직 품목을 못 찾는 6건을 0으로 만든다. 기능 추가는 없고 데이터만 넣는다.

## 배경

2026-08-21 본선 심사기준 자체 평가에서 나온 유일한 정량 구멍이다.

- `pnpm measure:coverage`의 `coverage-expansion-utterances` 50개 중 **6개가 not_found**(12.0%)다.
  `플라스틱 양념통`, `변기솔`, `선크림 튜브`, `가죽 벨트`, `젖병`, `사료 포대`.
- 재질 폴백이 받아주긴 하지만 "내 물건을 아네"와 만족도가 다르다. 하필 여섯 개 다 흔한 생활용품이라
  본선 사용자 투표에서 그대로 드러난다.
- 같은 측정의 `question-backlog` 111개는 110개가 매칭된다(not_found 0.9%). 구멍은 확장 세트 쪽에만 있다.

**not_found보다 나쁜 게 하나 섞여 있다.** 2026-08-21 실측:

```
변기 솔    (띄어쓰기) => toilet_bowl (변기) / bulky_waste_or_construction_waste / 79점
변기솔     (붙여쓰기) => not_found
화장실 청소솔          => dish_brush (설거지 솔) / 91점
변기 청소솔            => dish_brush (설거지 솔) / 91점
```

솔 하나 버리려는 사람에게 **대형폐기물 신고 안내가 나간다.** 이건 커버리지 구멍이 아니라 오답이라
편의성이 아니라 안정성 쪽 문제다. `toilet_brush` 품목을 넣으면 네 갈래가 한곳으로 모인다.

## 범위

포함: `src/data/waste-items.json`, `src/data/evaluation-cases.json`, `src/data/mcp-answer-cases.json`, `docs/source-coverage.md`.

**제외: 런타임 코드.** `src/server.ts`와 `src/data.ts`는 건드리지 않는다. 매칭 규칙을 손대면 발화 3,240건과
품목 324건 회귀가 함께 흔들리고, 8/23 개발 완료까지 그 검증을 다시 돌릴 시간이 없다. Phase 6·7이 쓴 방식과 같다.

## 요구사항

### R1. 여섯 건의 성격 판정

기존 품목과 대조한 결과는 아래와 같다. 이건 출발점이고, 원문을 본 뒤 바뀔 수 있다.

| 질의 | 근접 품목 | 1차 판정 |
| --- | --- | --- |
| 플라스틱 양념통 | `plastic_food_container` (배달 플라스틱 용기) | 별칭 후보 |
| 사료 포대 | `rice_sack` (쌀포대) | 재질이 같으면 별칭 |
| 선크림 튜브 | `cosmetic_container` / `toothpaste_tube` 사이 | 신규 유력 |
| 젖병 | 없음 | 신규 |
| 변기솔 | 없음 (`toilet_bowl`·`dish_brush`는 다른 물건) | 신규 |
| 가죽 벨트 | 없음 (`handbag`·`wallet`이 가죽 계열) | 신규 |

판정 기준은 하나다. **배출 갈래(`disposalType`)와 단계가 기존 품목과 완전히 같을 때만 별칭으로 흡수하고,
하나라도 갈리면 신규 품목으로 만든다.**

별칭으로 대충 흡수하면 사고가 난다. 이 저장소에서 이미 두 번 겪었다 —
`분리수거함`·`방문`을 별칭으로 넣었다가 재활용 수거함 질의와 무상방문수거 질의가 엉뚱한 품목 카드로 확정됐고,
`복사기 토너 카트리지`가 토너 카트리지 대신 복사기 무상방문수거 안내를 내보냈다.

**별칭을 추가할 때는 반례 케이스를 같이 넣는다.** 한국어는 핵심어가 뒤에 오므로 앞자리에 붙은 이름은 수식어인데,
`query_contains_name`이 96~98점을 주기 때문에 앞자리에서 새는 경우를 놓치기 쉽다.
반례는 **새 이름이 앞에 오는 복합어로도** 짠다(`양념통 뚜껑`처럼).

선크림 튜브는 특히 조심한다. 치약 튜브와 화장품 용기가 잔여물 처리에서 갈리므로,
원문에서 같은 결론이 확인되지 않으면 별칭으로 묶지 않는다.

### R2. 출처 조사

순서를 지킨다.

1. 생활폐기물 분리배출 누리집 품목사전에서 **단독 항목**을 찾는다.
   `https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=<검색어>`
2. 없으면 중앙정부·공공기관·지자체 페이지에서 같은 품목명의 직접 기준을 찾는다.
3. 그래도 없으면 [source-gap-policy.md](../source-gap-policy.md) 절차를 따른다 —
   보조 근거 + `재활용척척 예외 배출 정책` source + `review.status: "needs_source"` + 검색일을 `review.notes`에 남긴다.

**출처 없이 품목을 넣지 않는다.** `validate-data.mjs`가 `sources` 1건 이상을 강제하고,
근거 없는 안내는 본선 심사의 안정성 항목에서 가장 크게 깎이는 자리다.

`sources[].checkedAt`은 실제로 원문을 연 날짜를 쓴다. 추정하거나 다른 항목에서 복사하지 않는다.

#### 크롤링 도구

**Aside CLI를 1순위로 쓴다.** 구청·공공기관 페이지는 JS 렌더링과 팝업이 많아 `curl`로는 본문이 안 나오는 곳이 흔하다.

- 정확한 서브커맨드는 착수할 때 `aside --help`와 https://docs.aside.com/help/developers 로 확인한다.
  이 문서에 명령을 박아두지 않는 건, 문서를 쓴 세션이 그 문법을 직접 확인하지 못했기 때문이다.
- Aside는 **로그인된 실제 브라우저**를 몰고 다닌다. 공개 페이지만 연다. 로그인이 필요한 곳에는 들어가지 않고,
  자격 증명을 입력하거나 저장소·문서에 남기지 않는다.
- 뽑아온 원문은 그대로 쓰지 말고 `sources[].basis`에 **결론의 근거가 되는 문장만** 옮긴다. 인용은 원문 그대로 둔다.
- 페이지가 정적이면 `curl`이 더 빠르다. 도구를 고르는 기준은 "본문이 나오느냐"다.

### R3. 데이터 반영

`src/data/waste-items.json` — 기존 항목의 필드 구성을 그대로 따른다.
`id`, `name`, `aliases`, `category`, `disposalType`, `summary`, `steps`, `cautions`, `confidence`,
`needsRegionCheck`, `sourceRefs`, `conditions`, `regionPolicy`, `sources`, `review`.

`disposalType`은 `src/data/disposal-groups.json`에 있는 값만 쓴다. 새 갈래를 만들지 않는다 —
갈래가 늘면 런타임 문구 분기가 따라 늘고, 그건 이 Phase의 범위 밖이다.

`sourceRefs`도 빈 배열이면 validate가 막는다. `sources`와 같이 채운다.

`src/data/evaluation-cases.json` — 품목 수와 **1:1로 맞춘다**(현재 324/324).
품목마다 정확히 한 건인지는 `scripts/evaluate-data.ts`가 검사하고, 총계가 문서와 맞는지는 `validate-data.mjs`가 본다.
둘 다 `pnpm check`에 묶여 있지만 실패 메시지가 나오는 자리가 다르다.
```json
{ "query": "...", "expectedItemId": "...", "expectedDisposalType": "...", "notes": "..." }
```

`src/data/mcp-answer-cases.json` — **append-only**, id는 `p8_` prefix로 시작한다.
```json
{ "id": "p8_...", "tool": "get_disposal_steps", "arguments": { "itemName": "..." }, "expectedTextIncludes": ["..."] }
```
확정 케이스와 반례 케이스를 짝으로 넣는다.

`docs/source-coverage.md` — 카운트 7종을 갱신한다(총 품목, 평가 케이스, MCP 답변 회귀 케이스,
`verified`, `region_review_needed`, `needs_source`, `standard_import`). `validate-data.mjs`가 실제 데이터와 대조한다.

`docs/session-coordination.md`의 Current State Snapshot 카운트도 같은 값으로 맞춘다.

### R3b. 폴백을 기대하던 기존 회귀 케이스를 갱신한다

품목을 넣으면 지금 not_found 폴백을 기대하는 케이스 셋이 깨져 스모크가 멈춘다.

| 케이스 id | 질의 | 지금 기대값 |
| --- | --- | --- |
| `steps_fallback_toilet_brush` | `변기솔 버리는 법` | `초기 데이터에서 확실히 찾지 못했습니다` |
| `steps_fallback_leather_belt` | `가죽 벨트 어떻게 버려?` | `초기 데이터에서 확실히 찾지 못했습니다` |
| `classify_fallback_pet_food_bag` | `사료 포대 버리기` | `주요 재질별 한 줄 원칙` |

셋 다 **지우지 말고 기대값을 확정 응답으로 바꾼다.** 그 질의가 어디로 가는지를 고정하는 자리는 그대로 있어야 한다.
`classify_waste_item` 케이스는 structured 필드가 `id`가 아니라 `matchedItem`이다.

### R4. 검증

```bash
pnpm measure:utterances   # 추가 전에 한 번 (기준값 3,240/3,240)
# ... 데이터 반영 ...
pnpm local:test
pnpm measure:coverage
pnpm measure:utterances   # 추가 후에 다시 (건수는 늘고, 100%는 그대로여야 한다)
```

`measure:utterances`를 앞뒤로 두 번 돌리는 게 이 Phase의 유일한 안전망이다.
신규 별칭이 기존 품목의 확정을 뺏는 게 이 저장소의 단골 사고고, 다른 검증은 그걸 못 잡는다.

발화 세트는 품목마다 10개를 자동으로 만들어 쓴다. 품목을 다섯 개 넣으면 3,240이 3,290이 되는 게 정상이고,
봐야 할 건 늘어난 건수가 아니라 **wrong·ambiguous가 0에서 안 움직였는지**다.

## 완료 기준 (DoD)

- [ ] `pnpm measure:coverage`의 `coverage-expansion-utterances` **not_found 0/50**
- [ ] `pnpm measure:utterances` **전건 100%, wrong 0, ambiguous 0** 유지
      (건수는 `품목 수 × 10`이라 품목을 넣으면 3,240에서 함께 늘어난다. 고정할 값은 비율이지 건수가 아니다)
- [ ] `pnpm local:test` 통과
- [ ] 신규·수정 품목 전부 `sources` 1건 이상, `checkedAt`은 실제 확인일
- [ ] 별칭을 추가한 품목마다 반례 케이스가 `mcp-answer-cases.json`에 있다
- [ ] `변기 솔`·`화장실 청소솔`·`변기 청소솔`이 전부 `toilet_brush`로 모인다
- [ ] 폴백을 기대하던 기존 케이스 3건을 지우지 않고 기대값만 갱신했다
- [ ] `docs/source-coverage.md`와 `docs/session-coordination.md` 카운트가 데이터와 일치

## Phase 9와 병렬로 돌 때

같은 시기에 [phase-9-metro-districts.md](phase-9-metro-districts.md)가 지역 데이터를 넣는다. 겹치는 파일이 둘이다.

| 파일 | 규칙 |
| --- | --- |
| `src/data/mcp-answer-cases.json` | append-only. Phase 8은 `p8_`, Phase 9는 `p9_` prefix |
| `docs/session-coordination.md` | 나중에 머지되는 쪽이 최종 카운트로 맞춘다 |

`docs/source-coverage.md`는 Phase 8 전담이다. 다만 MCP 답변 케이스 총계는 Phase 9도 늘리므로,
**Phase 9가 나중에 머지되면 그 PR이 이 파일의 케이스 수까지 맞춰야 한다.**

**머지 순서는 Phase 8이 먼저다.** 카운트 문서를 더 많이 건드리는 쪽을 먼저 넣는다.
Phase 9는 머지 전에 최신 main을 브랜치에 반영하고 카운트만 다시 맞춘 뒤 `pnpm local:test`를 한 번 더 통과시킨다.

## 작업 규칙

- 브랜치 `claude/phase8-item-coverage`에서 작업하고 PR을 연다. **main에 직접 커밋하거나 push하지 않는다.**
- 커밋 author는 저장소 주인(c9boom7), 에이전트 기여는 `Co-Authored-By`로 남긴다.
- 머지는 저장소 주인이 지시할 때만 한다. 머지가 곧 본선 서버 재배포 게이트다.

## 체크리스트

- [ ] R1 판정 (별칭 / 신규)
- [ ] R2 출처 조사
- [ ] R3 데이터 반영
- [ ] R3b 기존 케이스 갱신
- [ ] R4 검증
- [ ] PR 생성
