# Session Coordination

이 문서는 `재활용척척` 고도화를 여러 Codex 세션에서 병렬로 진행할 때의 작업 분리 기준이다. 이 세션은 조율 세션으로 사용하고, 개별 작업 세션은 아래 소유 범위를 벗어나는 변경을 최소화한다.

## Active Threads

| Track | Codex thread | Current role | Primary files |
| --- | --- | --- | --- |
| Source Gap | `019f06b4-641c-7b92-b668-1ad70c6abed3` | 공식 근거 탐색, `needs_source` 해소, 출처 커버리지 문서 갱신 | `src/data/waste-items.json`, `docs/source-*`, `docs/source-coverage.md` |
| Region Data | `019f2292-2522-70c0-8e74-48aa4f37c968` | 지역 정책 데이터 확장, 지역별 답변 회귀 검증 | `src/data/region-policies.json`, `src/data/region-evaluation-cases.json`, `docs/*region*`, `src/server.ts`의 지역 문구 |
| Answer Quality | `019f2291-ccd0-70f0-95d0-fbe8d5d17ee8` | 질문 seed, 자동 백로그, MCP 답변 smoke 회귀셋, 매칭 방어 로직 | `logs/quality-seed-queries.example.jsonl`, `src/data/mcp-answer-cases.json`, `src/data/question-backlog.json`, `src/data.ts`, `scripts/auto-backlog-queries.mjs` |

## Separation Rules

- 한 세션은 자기 트랙의 primary files만 주도적으로 수정한다.
- 공유 파일은 변경 전후로 조율 세션에서 확인한다.
- `src/data/mcp-answer-cases.json`, `src/data/question-backlog.json`, `docs/question-backlog.md`는 여러 트랙이 만질 수 있으므로, 변경 이유와 카운트를 최종 답변에 반드시 남긴다.
- 애매한 데이터셋 모델링 결정은 즉시 사용자에게 묻지 않고 `docs/data-decision-backlog.md`의 `Open Decisions`에 쌓는다. 열린 결정이 10건 이상이면 조율 세션에서 사용자에게 묶어서 확인한다.
- `src/server.ts`, `src/data.ts`, `scripts/*.mjs`는 동작 변경이므로 다른 세션의 데이터 작업 중에는 최소 범위만 수정한다.
- 지역 데이터가 늘어난 뒤에는 unknown-region 기준 smoke 케이스가 실제 지역 기준과 충돌할 수 있으므로 Answer Quality 트랙에서 기대값을 재확인한다.
- 품목 데이터가 늘어난 뒤에는 Source Gap 트랙이 `source-coverage.md` 카운트, Answer Quality 트랙이 매칭/과매칭 회귀를 확인한다.
- 같은 체크아웃에서 작업하므로 세션 간 변경을 되돌리지 않는다. 충돌처럼 보이면 먼저 조율 세션에서 `git status`, 관련 diff, thread 상태를 확인한다.

## Coordination Loop

- 세 작업 세션을 전체 배치로 묶어 기다리지 않는다.
- 각 heartbeat마다 세션별 status를 확인하고, `active`인 세션은 그대로 둔다.
- `idle`인 세션은 해당 세션의 최신 final answer, 변경 파일, 검증 결과, 남은 리스크를 확인한 뒤 그 트랙의 다음 작업만 배정한다.
- 새 작업은 현재 `active` 세션의 primary files와 겹치지 않게 잡는다.
- 다음 자연스러운 작업이 없거나 사용자 판단이 필요한 비데이터 결정이면 배정하지 않고 조율 세션에 보고한다.
- 데이터셋 모델링 결정은 `docs/data-decision-backlog.md`에 누적하고, 열린 결정이 10건 이상일 때만 사용자에게 묶어서 확인한다.

## Handoff Checklist

각 작업 세션이 idle로 돌아오면 조율 세션은 해당 세션 단위로 아래 순서에 맞춰 상태를 확인한다.

1. `git status --short`로 변경 파일을 확인한다.
2. 변경 트랙과 무관한 파일이 섞였는지 확인한다.
3. 카운트 문서가 실제 데이터와 맞는지 확인한다.
4. 최소 검증을 실행한다.
   - 데이터/서버 변경: `pnpm check`
   - MCP 답변 케이스 변경: `pnpm smoke:mcp`
   - 백로그 변경: `pnpm backlog:questions` 또는 `pnpm backlog:auto:quality`
5. 다음 병렬 작업은 primary files가 겹치지 않도록 다시 2~3개로만 쪼갠다.

## Current State Snapshot

- Source Gap 트랙: 현재 데이터 기준 `waste-items.json` 127개, `evaluation-cases.json` 127개, MCP answer cases 172개, review count는 `verified 39 / region_review_needed 81 / needs_source 7`이다. 남은 `needs_source` 7개는 공식 단독 근거가 없어 `source-gap-policy.md` 기준의 보수 안내로 유지한다.
- Source Gap 조사: Top 50/사용자 빈도 출처 감사에서 초기 10개, `home_injection_needle`, `empty_medicine_bottle`, `pill_blister_packaging`, `small_electronics` 보강분, `shoes`, `cat_litter`, `delivery_box`, `bubble_wrap`, `mirror`, `clothing`, `paper_cup`, `shipping_label`, `receipt`, `shampoo_bottle`, `pizza_box_oily`, `medicine` source/basis 보강과 문서 QA가 완료됐다. `cup_noodle_container`는 현재 item 범위와 공식 `종이 컵라면` 근거가 완전히 일치하지 않아 데이터 결정 백로그에 누적했다.
- Region Data 트랙: `gangnam_gu`, `seocho_gu`, `songpa_gu` 3개 구 QA 완료, 지역 평가 케이스는 24개다. 강남 음식물 예외 4개(`fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`)는 공식 첨부 PDF 기반 전용 itemGuide와 회귀 케이스로 고정했고, `corn_cob_husk`는 강남 직접 근거 확보 전 보류한다.
- Region Fees: 강남/서초/송파 모두 10개 itemId 기준 대형폐기물 수수료 coverage 완료. 현재 수수료 행은 강남 19개, 서초 18개, 송파 18개이고, coverage itemId 10개(`chair`, `mattress`, `blanket`, `mirror`, `plastic_storage_box`, `yoga_mat`, `drying_rack`, `flower_pot`, `toy`, `stuffed_toy`)가 세 구 모두에 있다.
- Answer Quality 트랙: seed 116개, MCP answer cases 172개, Backlog는 `covered 97 / todo 13`이다. 최근 source/region 보강 축과 `needs_source` 7개 보수 안내, `medicine`/폐의약품 포장재 분리, answer case 참조 정합성 QA까지 통과했다.
- User decisions: 폐의약품 포장재는 별도 품목으로 승격, `공유기`/`휴대용 선풍기`는 `small_electronics` 계열로 흡수, 서초/송파 대형폐기물 수수료는 Top 품목부터 구조화한다.
- Source Data Modeling: `empty_medicine_bottle`, `pill_blister_packaging` 추가, `small_electronics`에 공유기/휴대용 선풍기 보강. 약 자체 `medicine`은 알약·물약·한약·연고 공식 근거를 보강했고, 폐의약품 포장재와 분리된 상태를 유지한다.
- Data Decision Backlog: 열린 결정 8건(`비닐약봉지`, `비닐장판`, `캔버스 액자`, `부산 해운대구`, `강남구 오피스텔`, 스탠드형 옷걸이/행거, 일반 가방류 수수료, `cup_noodle_container` 모델링 방식). 10건 미만이므로 사용자 확인 없이 계속 누적한다.

## Suggested Next Split

- Source Gap: 즉시 보강 가능한 source 후보는 현재 소진된 상태다. 새 사용자 질문 로그, 낮은 confidence, 또는 Open Decisions 해소 후에만 다음 source 후보를 선정한다.
- Region Data: 즉시 입력 가능한 3~5개 안전 수수료 후보 묶음은 현재 없다. 다음 데이터 입력은 Open Decisions 중 지역/수수료 모델링 결정이 풀리거나 새 질문 빈도가 쌓인 뒤 진행한다.
- Answer Quality: 현재 answer smoke와 backlog 카운트는 최신 상태다. 새 로그나 데이터 결정 해소 전까지는 status 변경 없이 회귀셋/문서 정합성만 유지한다.
