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
- 크리티컬한 사용자 결정만 즉시 묻는다. 크리티컬 기준은 원격 push/PR/배포, 큰 리팩터링, 위험한 삭제, 보안/개인정보/운영 영향, 제품 범위·데이터 모델의 큰 변경, 또는 합리적인 기본값 없이 다음 작업이 막히는 경우다.
- 시급도가 낮거나 진행을 막지 않는 데이터셋 모델링 결정은 즉시 사용자에게 묻지 않고 `docs/data-decision-backlog.md`의 `Open Decisions`에 출처/후보/추천안과 함께 쌓는다. 열린 결정이 10건 이상이면 조율 세션에서 사용자에게 묶어서 확인한다.
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

- Source Gap 트랙: 현재 데이터 기준 `waste-items.json` 324개, `evaluation-cases.json` 324개, MCP answer cases 418개, review count는 `verified 39 / region_review_needed 84 / needs_source 7`이다. 표준 티어 `standard_import` 194개(Phase 2의 142개 + Phase 7의 52개)가 여기에 더해진다. 남은 `needs_source` 7개는 공식 단독 근거가 없어 `source-gap-policy.md` 기준의 보수 안내로 유지한다.
- Source Gap 조사: Top 50/사용자 빈도 출처 감사에서 초기 10개, `home_injection_needle`, `empty_medicine_bottle`, `pill_blister_packaging`, `small_electronics` 보강분, `shoes`, `cat_litter`, `delivery_box`, `bubble_wrap`, `mirror`, `clothing`, `paper_cup`, `shipping_label`, `receipt`, `shampoo_bottle`, `pizza_box_oily`, `medicine`, `spray_can` source/basis 보강과 문서 QA가 완료됐다. 2026-07-05 사용자 결정분으로 `비닐약봉지`는 `snack_bag` 별칭/source로 흡수했고, `비닐장판`(`vinyl_flooring`), `캔버스 액자`(`canvas_frame`), 스탠드형 행거(`standing_clothes_hanger`)는 별도 품목과 평가 케이스로 추가했다. `cup_noodle_container`는 `종이 컵라면` 공식 근거를 조건 보강으로 반영했다.
- Region Data 트랙: 현재 지역 정책 데이터 35개, 지역 평가 케이스 78개다. Phase 5에서 티어를 나눴다 — `full` 5개(`gangnam_gu`, `seocho_gu`, `songpa_gu`, `mapo_gu`, `seongnam_si`)는 배출 요일까지, `standard` 13개는 서울 자치구의 대형폐기물 신청·수수료 URL과 직통번호, 폐의약품·폐건전지 수거함 안내까지, `metro` 17개는 광역시도 폴백만 담는다. 강남 음식물 예외 4개(`fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`)는 공식 첨부 PDF 기반 전용 itemGuide와 회귀 케이스로 고정했고, 마포구와 성남시/판교는 공식 출처 기반 생활쓰레기/재활용/음식물/폐형광등·폐건전지/대형폐기물 기본 안내를 갖고 있다. 완결 조건 5종을 못 채운 서울 8개 구는 넣지 않고 `data-decision-backlog.md`에 사유와 함께 남겼다.
- Region Fees: 수수료 보유 지역은 18곳, 총 1,995행이다. 광역을 뺀 등록 지역이 전부 수수료표를 갖는다. 골든셋 4곳(강남 19, 서초 18, 송파 18, 마포 14)은 수기 데이터를 유지하고, Phase 7이 표준데이터에서 용산 229·노원 263·강서 147·관악 141행을 임포트했다(`pnpm import:fees`로 재현). 신규 품목 6개(화장대·간판·복사기·가스레인지·옥매트·세단기)를 추가한 뒤 같은 4곳만 다시 임포트해 26행이 늘었다. Phase 6은 자치법규 조례에서 나머지 10곳 1,146행을 뽑았다(성남 75·종로 64·광진 159·강북 102·도봉 140·은평 162·금천 105·영등포 148·동작 92·강동 99, `pnpm import:ordinance`로 재현). 조례 트랙은 `sourceType: "law"`로 조례 URL·별표 제목·시행일자를 근거에 함께 싣고, 표준데이터 규칙에 더해 무상수거 행 제외, 품명 상속 행 판정, 짧은 별칭 수식어 위치 검사, 매트리스와 침대 프레임 분리를 건다. 표준데이터 임포트는 오타 매칭·복수 품목 표기·수식어 위치 매칭·옵션 요금 행을 배제하는 보수 기준을 쓴다. 마포구는 7개 itemId(`chair`, `mattress`, `blanket`, `mirror`, `yoga_mat`, `drying_rack`, `flower_pot`)까지 구조화했고, `plastic_storage_box`, `toy`, `stuffed_toy`는 공식 행 매핑이 넓거나 결합돼 보류했다.
- Answer Quality 트랙: seed 116개, MCP answer cases 418개, Backlog는 `covered 110 / wont_fix 1 / todo 0`이다. Phase 1(2026-08-14)에서 자모 오타 매칭, not_found 재질 폴백, 별칭 보강(멜라민 스펀지·우유곽·밧데리·페트) smoke 15건을 추가했다. Phase 2(2026-08-14)에서 표준 티어 142개와 지역 확인 필수 품목 answer case 75건을 추가했고, 정수기 필터(auto_b6aece0913) todo는 `water_purifier_filter` 품목으로 커버됐다. Phase 1 코드 리뷰 후속(2026-08-14)으로 오타 매칭을 폴백 티어로 분리하고 첫 자모 일치를 요구하도록 좁혀 smoke 7건을 추가했다. 최근 source/region 보강 축과 `needs_source` 7개 보수 안내, `medicine`/폐의약품 포장재 분리, `spray_can` 찌그러짐 조건, 2026-07-05 source reflection smoke, 오피스텔 `get_disposal_steps` guard, Open Decision guard, 마포구 수수료 answer smoke, 지역 영향 분류/cleanup plan 라벨 smoke, cleanup plan 참고-only 과노출 guard, `빈 약통`/`토너 카트리지`/`석고방향제`/`비닐류 포장재`/`시든 꽃` 지역 참고 smoke, `check_confusing_item` 지역 영향 라벨 smoke, 조건형 비닐류/젖은 종이상자/스프레이캔 판단 범위 smoke, `get_region_disposal_info` 판단 범위 smoke, 포괄어 `컵`/`통`/`병`/`용기` 모호 응답 smoke까지 통과했다. Phase 4b 2라운드(2026-08-14)에서 카테고리어 과매칭·광역 지역 임의 확정 회귀 smoke 7건을 추가했다 — 카테고리어는 `findWasteItems` 단계에서 막아 `check_confusing_item`까지 함께 덮고, 시·도 이름은 확정하지 않되 `강남구` 축약은 그대로 확정되는지 함께 고정한다. Phase 5(2026-08-14)에서 지역 매칭을 티어·단계형으로 다시 짜면서 시·도 발화의 기대 동작을 "매칭 없음"에서 "광역 레이어 착지"로 옮겼다 — 한 자치구의 배출 요일·전화번호가 시·도 답변에 실리지 않는지는 그대로 회귀로 막고, 표준 티어 지역·광역 폴백·미등록 폴백 smoke 4건을 더했다. Phase 7 R1(2026-08-14)에서 복합명사의 수식어 자리에 걸리던 `generic_fragment` 오매칭을 막고 smoke 18건을 추가했다 — 수식어 배제 6건(`에어컨`→리모컨 등), 동의어·핵심어 반례 9건(`쇼파`→소파, `장판`→비닐장판 등), 역방향 3건(`리모컨`·`정수기 필터`·`온수매트` 자체 질의는 그대로 확정). 코드 리뷰 후속(2026-08-15)으로 되묻기 유지 2건을 더했다 — 수식어 후보를 후보 목록에서 통째로 지우면 남은 하나가 단독 확정돼 `컴퓨터`가 노트북으로, `유리`가 깨진 보온병으로 바뀌었다. 수식어 후보는 확정 후보에서만 빼고 "질의가 덜 특정됐다"는 신호로는 남긴다. PR #16 코드 리뷰 후속(2026-08-15)으로 신규 품목 데이터 결함 다섯 가지를 고치고 smoke 11건을 더했다 — 조사 자리표시자 `은(는)`/`을(를)` 70곳, 배출 경로어를 품목 별칭으로 쓴 `분리수거함`·`방문`(각각 재활용 수거함 질의와 무상방문수거 질의를 품목 카드로 확정시켰다), 무상방문수거 8품목의 `needsRegionCheck: false`(대형폐기물 폴백을 안내하면서 정작 지역 신청 경로를 통째로 감췄다), 욕조 근거에서 문짝·싱크대·물탱크로 번진 "세라믹·대리석" 주의, 짧은 품목명 `난로`에 닿지 못하던 `전기난로`. R4 임포트 리뷰(2026-08-15)에서는 수수료 쪽 결함 세 가지를 고치고 smoke 5건을 더했다 — 배출 경로가 무상인 품목에까지 금액이 붙던 것을 `findBulkyWasteFees`의 게이트로 막고(스티로폼 재활용 카드에 "수수료 1,000원"이 실렸다), 용산·관악의 매트리스 고시 행이 침대 프레임에 붙던 것을 임포터의 품목 재지정으로 돌려놓았으며, "수수료"라는 글자만 보던 기존 fee 케이스에 실제 금액을 박았다. (지역, 품목) 12행 상한도 임포터에만 있던 것을 validate로 옮겼다. Phase 7 R4(2026-08-15)에서 표준데이터 수수료를 임포트하며 4개 지역 수수료 노출 회귀 4건을 더했다. Phase 7 후속 배치(2026-08-15)에서는 품목이 없어 엉뚱한 후보로 되묻던 여섯 건을 품목으로 채우고 smoke 15건을 더했다 — 신규 품목 확정·수수료 노출 6건, 기존 품목을 뺏기지 않는 반례 7건(`화장대 거울`→거울, `복합기`→프린터, `가스오븐레인지`·`가스레인지 오븐`→가스오븐레인지, `전기매트`→전기장판, `옥침대`→돌침대, `세면대`→세면대), 포괄어 되묻기 유지 `상` 1건, `계란판` 역방향 1건. PR #22 코드 리뷰 후속(2026-08-15)으로 반례 3건을 더했다 — 반례를 새 품목명이 뒤에 오는 복합어로만 짜서 앞에 오는 쪽(`query_contains_name` 96~98점)을 놓쳤다. `복사기 토너 카트리지`가 토너 카트리지(종량제봉투·업체 회수) 대신 복사기 무상방문수거 안내를 내보내고 `화장대 의자`가 의자 대신 화장대 수수료를 붙이던 것을 별칭으로 되돌렸다. 대응 품목이 없어 별칭으로 못 막는 `가스레인지대`는 `data-decision-backlog.md` Open Decisions에 남겼다. Phase 6 R4(2026-08-15)에서 조례 수수료 10곳을 넣으며 3건을 더했다 — 신규 수수료 지역에서 금액 줄이 실리는지(종로구 소파), 수수료표는 있어도 그 품목 행이 없으면 금액 줄 없이 신청 경로만 나오는지(동작구 의자), 광역 폴백에 자치구 금액이 새지 않는지(서울 소파). 두 번째 케이스는 PRD가 "수수료가 없는 등록 지역"으로 적었는데, R3가 끝난 시점에는 비광역 등록 지역 18곳이 전부 수수료표를 갖게 돼 그런 지역이 남지 않았다. 지키려던 런타임 경로(`fees`가 비면 금액 블록을 만들지 않는다)는 같으므로 "그 품목의 행이 없는 지역"으로 옮겼다.
- Runtime Answer Policy: 2026-07-05 지역 확인 과노출 피드백 이후 `region_review_needed`를 답변 노출 강도와 분리했다. 런타임은 `지역 영향: 필수 / 참고 / 낮음`과 `판단 범위`/`regionGuidance`를 함께 사용하며, 전용 수거함·지정 수거처·대형폐기물·불연성/특수규격 봉투·가스/유해폐기물은 강한 `지역 확인 필요`를 유지하고, 우산 같은 일반 `region_specific` 품목은 짧은 `지역 참고`만 노출한다. 구조화 응답도 참고 품목의 지역 sources를 비워 모델이 지역 확인을 과하게 키우지 않도록 했다. `get_region_disposal_info`는 품목이 있으면 지역 전체 체크리스트 대신 품목별 checkItems/item guide/수수료 후보 중심으로 확인 항목을 좁힌다.
- PlayMCP Deploy: 최신 원격 배포는 `recycle-helper-mcp` 서버 ID `1498`, endpoint `https://recycle-helper-mcp.playmcp-endpoint.kakaocloud.io/mcp`다. 최종 반영 커밋은 `409555a Limit regional structured details`이며, `tools/list` 5개, `playmcp.kakaocloud.io`/`playmcp.kakao.com` CORS, 우산 `지역 참고`, 폐건전지 `지역 확인 필요` 샘플을 확인했다.
- User decisions: 폐의약품 포장재는 별도 품목으로 승격, `공유기`/`휴대용 선풍기`는 `small_electronics` 계열로 흡수, 서초/송파 대형폐기물 수수료는 Top 품목부터 구조화한다. `비닐약봉지`는 비닐류, `비닐장판`/장판류는 일반 비닐류로 분류하지 않고 조각 종량제봉투/큰 장판 대형폐기물로 안내, `캔버스 액자`는 천과 프레임을 분리해 일반쓰레기이되 큰 프레임은 대형생활폐기물, 스탠드형 옷걸이/행거는 대형폐기물로 결정됐다. 컵라면 용기는 재질/오염 조건을 나누며, 공식 `종이 컵라면` 근거상 깨끗하면 기타 종이류, 코팅·오염·재질 불명은 일반쓰레기로 보수 안내한다. 신규 지역은 `경기도 성남시/판교`를 먼저 보강했고, `부산 해운대구` 위치형 탐색은 진행하지 않는다. 오피스텔 같은 세부 건물유형은 별도 모델링하지 않으며, 대형폐기물 수수료 추가 구조화는 당분간 중단한다.
- Source Data Modeling: `empty_medicine_bottle`, `pill_blister_packaging` 추가, `small_electronics`에 공유기/휴대용 선풍기 보강. 약 자체 `medicine`은 알약·물약·한약·연고 공식 근거를 보강했고, 폐의약품 포장재와 분리된 상태를 유지한다. 2026-07-05에는 `vinyl_flooring`, `canvas_frame`, `standing_clothes_hanger`를 신규 추가하고 `snack_bag`, `cup_noodle_container` 조건/source를 보강했다.
- Data Decision Backlog: 2026-07-05 기준 열린 결정은 없다. `부산 해운대구` 위치형 탐색은 진행하지 않고, `강남구 오피스텔` 세부 모델링과 신규 대형폐기물 수수료 구조화도 당분간 진행하지 않는 것으로 결정됐다.

## Suggested Next Split

- Source Gap: 사용자 결정분 데이터 보강은 2026-07-05 현재 완료됐다. 다음 Source 작업은 새 사용자 질문 로그나 자동 백로그에서 직접 공식 근거 보강 후보가 명확할 때만 잡고, 억지 후보는 만들지 않는다.
- Region Data: 성남시/판교 기본 정책 보강은 완료됐고, 부산 해운대구 위치형 탐색과 오피스텔/건물유형 세분화는 진행하지 않는다. 신규 대형폐기물 수수료 금액 구조화는 **2026-08-15에 재개했다** — 자치법규 ETL은 [Phase 6](prd/phase-6-bulky-fee-etl.md)이 10곳, 공공데이터포털 표준데이터 트랙이 용산·노원·강서·관악 4곳을 맡는다. 다음 지역 작업은 새 사용자 결정이나 새 지역 질문 로그가 생길 때 잡는다.
- Answer Quality: Source Gap 2026-07-05 반영분 smoke 동기화와 백로그 위생 정리는 완료됐다. 다음 Answer 작업은 새 데이터 추가 후 회귀셋 동기화 또는 새 사용자 질문 로그가 생길 때 진행한다.
