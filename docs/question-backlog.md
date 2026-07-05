# Question Backlog

`src/data/question-backlog.json`은 실제 사용자 질문이나 수동 MCP 테스트에서 발견한 빈틈을 임시로 쌓는 곳이다.
공식 근거와 답변 정책이 정리되기 전까지는 품목 데이터에 바로 넣지 않고 이 백로그에서 관리한다.

## 언제 추가하나

- 현재 데이터에 없는 품목 질문을 발견했을 때
- 기존 품목으로 답은 가능하지만 별칭 매칭이 약할 때
- 상태에 따라 답이 달라지는데 현재 답변이 구분하지 못할 때
- 지역별 기준, 수거함, 신고 방식, 수수료가 필요할 때
- 공식 출처를 아직 찾지 못했지만 나중에 검토해야 할 때

## 필드

- `id`: lowercase snake_case 고유 ID
- `query`: 사용자가 실제로 물어볼 법한 질문
- `region`: 검토 기준 지역. 현재 1차 기준은 `서울 강남구`
- `type`: `new_item_candidate`, `synonym_gap`, `answer_gap`, `region_gap`, `source_gap`, `condition_gap`
- `status`: `todo`, `triaged`, `covered`, `wont_fix`
- `priority`: `high`, `medium`, `low`
- `observed`: 현재 발견한 문제
- `expectedAction`: 다음에 해야 할 데이터 작업
- `candidateItemIds`: 기존 품목과 연결될 수 있는 후보 ID
- `notes`: 검토 메모

## 처리 흐름

1. 로컬 MCP 테스트나 실제 사용 중 애매한 답변을 발견하면 백로그에 `todo`로 추가한다.
2. 공식 출처와 지역 기준을 확인하면 `triaged`로 바꾸고 작업 방향을 메모한다.
3. 품목 데이터, 평가 케이스, MCP 답변 케이스에 반영한 뒤 `covered`로 바꾼다.
4. 제품 범위에 넣지 않기로 한 질문은 이유를 남기고 `wont_fix`로 바꾼다.

품목으로 승격할 때는 다음을 함께 확인한다.

- `src/data/waste-items.json`에 품목 또는 별칭 반영
- `src/data/evaluation-cases.json`에 대표 질문 추가
- 실제 답변 문구를 보호해야 하면 `src/data/mcp-answer-cases.json`에 회귀 케이스 추가
- 공식 근거와 확인일을 `sources`에 기록

## 명령

```bash
pnpm log:query -- --query "요가매트는 어떻게 버려?" --region "서울 강남구"
pnpm backlog:questions
pnpm backlog:auto -- --query "요가매트는 어떻게 버려?"
pnpm backlog:auto -- --input logs/manual-queries.jsonl --write
pnpm backlog:auto:quality
pnpm validate:data
pnpm local:test
```

`pnpm backlog:questions`는 상태, 우선순위, 유형별 개수와 높은 우선순위의 미처리 질문을 출력한다.

`pnpm backlog:auto`는 실제 질문 로그에서 검색 실패, 낮은 매칭 점수, `needs_source`, 낮은 confidence 품목을 찾아 `todo` 후보로 만든다. 기본은 dry-run이며, 실제로 `src/data/question-backlog.json`에 추가하려면 `--write`를 붙인다.
`pnpm log:query`는 수동 테스트나 사용자 피드백에서 발견한 질문을 `logs/manual-queries.jsonl`에 남긴다. 실제 로그 파일은 Git에 커밋하지 않는다.
`pnpm backlog:auto:quality`는 개인정보가 없는 재현용 품질 seed인 `logs/quality-seed-queries.example.jsonl`을 dry-run으로 검사한다. 저장하려면 `pnpm backlog:auto:quality -- --write`를 사용한다.

예시:

```bash
pnpm backlog:auto -- --query "요가매트는 어떻게 버려?" --region "서울 강남구"
pnpm backlog:auto -- --input logs/manual-queries.jsonl --region "서울 강남구" --write
pnpm backlog:auto -- --input logs/manual-queries.json --include-medium-confidence --write
pnpm backlog:auto:quality
```

입력 형식:

- `.txt`: 한 줄에 질문 하나
- `.jsonl`: 한 줄에 JSON 객체 또는 질문 문자열 하나
- `.json`: 문자열 배열, 객체 배열, 또는 `{ "queries": [...] }`

객체 로그는 `query`, `itemName`, `text`, `message`, `question`, `region`, `answer`, `tool`, `notes`, `backlogType` 필드를 인식한다.
`answer`가 `missing_item`, `bad_match`, `missing_condition`, `missing_region`, `needs_source` 같은 품질 판정이면 자동 백로그 유형에 반영한다.

## Current Seed Backlog

Top 50과 1차 사용자 질문 확장 품목을 처리한 뒤, 다음 데이터 보강 후보는 `src/data/question-backlog.json`의 `todo` 항목에서 고른다.

현재 상태:

- 전체 110개 중 `covered` 109개, `wont_fix` 1개, `todo` 0개
- 2026-07-01 처리 완료: 매니큐어, 향수병, 수은 체온계, 살충제 통, 소화기, 가스 남은 라이터, 부푼 보조배터리, 일회용 면도기, 티백, 시든 꽃, 향초, 콘택트렌즈, CD/DVD, 옷걸이, 수세미, 일회용 숟가락·포크, 실리콘 주걱, 청소기 먼지, 젤 아이스팩 수거함 위치 답변 정책, 큰 리빙박스·플라스틱 수납함, 강아지 배변패드, 요가매트 과매칭 방지, 깨진 보조배터리, 깨진 도자기 화분, 깨진 LED 전구, 누출된 프린터 토너 카트리지, 배터리 내장 일회용 전자담배, 종이호일, 고체 방향제, 귤껍질, 핫팩, 실리카겔 방습제, 액정보호필름, 부직포 장바구니
- 2026-07-01 추가 처리 완료: 세탁 보풀, 비누 조각, 곰팡이 핀 빵, 고추장 묻은 배달 플라스틱 용기, 물티슈 포장 캡, 드립백 커피 필터
- 2026-07-01 신규 자동 백로그화: `logs/quality-seed-queries.example.jsonl`에서 실제형 질문 18개를 `todo`로 추가
- 2026-07-01 high-priority 5개 공식 근거 확인 및 데이터 승격 완료: [source-research-high-priority-2026-07-01.md](source-research-high-priority-2026-07-01.md)
- 2026-07-01 질문 seed 확장: `logs/quality-seed-queries.example.jsonl`을 68개로 확장하고 `pnpm backlog:auto:quality -- --write`로 신규 후보 27개를 백로그에 저장
- 2026-07-01 quality seed high-risk 3개 공식·유사 근거 검토 및 데이터 승격 완료: [source-research-quality-high-risk-2026-07-01.md](source-research-quality-high-risk-2026-07-01.md)
- 2026-07-02 medium-priority 5개 공식 근거 확인 및 데이터 승격 완료: 샴푸 리필 파우치, 요거트 은박 뚜껑, 프링글스 통, 전동칫솔, 생선가시. 세부 근거는 [source-research-medium-batch-2026-07-02.md](source-research-medium-batch-2026-07-02.md)
- 2026-07-02 남은 medium-priority todo 19개 공식·유사 근거 확인 및 데이터 반영 완료: 간장 유리병, 소스 비닐팩, 젖은 우산, 부러진 우산살, 설거지 솔, 고무줄·머리끈, 면봉, 화장솜, 향수 샘플병, 금 간 머그컵, 충전 어댑터, 시너 묻은 걸레, 반려동물 배설물 묻은 휴지, 생선가시, 호두껍질, 옥수수대·옥수수껍질, 한약재 찌꺼기, 참치캔 기름, 컵라면 은박 뚜껑. 세부 근거는 [source-research-medium-todo-complete-2026-07-02.md](source-research-medium-todo-complete-2026-07-02.md)
- 2026-07-02 quality seed next 10개 공식·유사 근거 확인 및 데이터 반영 완료: 닭고기 포장 흡수패드, 쿠킹랩 심지, 스티커 붙은 유리병, 깨진 접시, 녹슨 칼, 부러진 가위, 물감 묻은 팔레트, 네일 리무버 솜, 샴푸 리필팩 뚜껑, 치실. 세부 근거는 [source-research-quality-seed-next-2026-07-02.md](source-research-quality-seed-next-2026-07-02.md)
- 2026-07-02 답변 품질 회귀 seed 12개 추가: 짧은 단어 과매칭(약, 랩, 캔, 기름), 상태 조건(빈 약통, 젖은 택배상자, 찌그러진 스프레이캔, 오염 비닐봉지), 지역 포함 질문(서초구 페트병, 부산 해운대구 폐건전지, 강남구 오피스텔 비닐봉지)을 `todo` 후보로 저장
- 2026-07-02 짧은 별칭 과매칭 방어 로직 추가 후 strict dry-run에서 새 후보 3개 추가: 알약 포장 은박지, 공유기, 휴대용 선풍기
- 2026-07-02 todo 15개 1차 분류 완료. 기존 데이터로 방어 가능한 4개(젖은 택배상자, 냉동식품 포장 비닐봉지, 서초구 투명 페트병 목요일 질문, 찌그러진 스프레이캔)는 MCP answer smoke 케이스로 고정
- 2026-07-02 새 데이터 동기화 완료: `빈 약통`, `알약 포장재`, `공유기`, `휴대용 선풍기` 4개 todo를 `covered`로 전환하고 MCP answer smoke 케이스를 추가
- 2026-07-02 Answer Quality 후속 확인: 과매칭/오답 방지 관찰 4개는 기존 MCP answer smoke 케이스로 이미 방어됨을 확인했고, 중복 케이스는 추가하지 않음
- 2026-07-02 seed-backlog 보강: 실제형 seed 16개를 추가해 총 116개를 스캔했고, 새 자동 후보 2개(`약 다 먹은 플라스틱 약병`, `송파구 거울 수수료`)를 `todo`로 추가한 뒤 기존 데이터 답변을 MCP answer smoke 케이스로 고정
- 2026-07-02 수수료 smoke 동기화: 새 수수료 itemId 4개(`drying_rack`, `flower_pot`, `toy`, `stuffed_toy`)가 MCP 지역 답변에 노출되는지 answer smoke 케이스로 고정. 기존 backlog todo 중 수수료 데이터만으로 명확히 해결되는 항목은 없어 status 변경 없음
- 2026-07-02 음식물 예외 smoke 동기화: 강남 `한약재 찌꺼기`, 서초 `생선뼈`, 송파 `티백` 지역 예외 안내가 MCP 답변에 노출되는지 answer smoke 케이스로 고정. 이번 라운드에서는 backlog status 변경 없음
- 2026-07-02 `needs_source` 보수 안내 smoke 동기화: 기존 smoke 중 3개(`vacuum_dust`, `solvent_contaminated_rag`, `paint_palette`)에 단독 근거 부재, 지자체 확인, 재활용 단정 방지 기대값을 보강. 새 smoke 중복 추가와 backlog status 변경은 없음
- 2026-07-02 `shoes` source 정책 smoke 동기화: 기존 `gangnam_shoes_reuse_or_pp` smoke에 재사용 가능/오염·훼손 상태 분기, 의류수거함/종량제봉투, 지역·수거함 운영 확인 기대값을 보강. 새 smoke 중복 추가와 backlog status 변경은 없음
- 2026-07-02 남은 todo 매칭 방어 smoke 위생 점검: `약과`, `랩탑`, `캔버스 액자`, `기름 묻은 피자박스` 4개 모두 기존 smoke로 방어됨을 확인. `약과`, `랩탑`, `피자박스`는 오답 품목 누수 방지 기대값만 보강했고, `캔버스 액자`는 기존 기대값으로 충분해 중복 추가 없음
- 2026-07-02 source 보강 3개 답변 smoke 동기화: `cat_litter`, `bubble_wrap`은 새 answer smoke로 고정하고, 기존 `delivery_box` wet/damp smoke 2개에는 운송장·테이프 제거 기대값을 보강. backlog status 변경은 없음
- 2026-07-02 `mirror`·`clothing` source 보강 답변 smoke 동기화: 기존 `gangnam_mirror_fee`, `gangnam_clothing_reuse` smoke에 대형폐기물/유리병류 오답 방지, 깨끗한 의류·오염/젖음 의류 분기, 지역·수거함 운영 확인 기대값을 보강. 새 smoke 중복 추가와 backlog status 변경은 없음
- 2026-07-02 `paper_cup` source 보강 답변 smoke 동기화: 기존 `gangnam_paper_cup_cream_condition` smoke에 내용물 비움·헹굼, 종이컵/종이류 전용 수거함, 오염 시 일반쓰레기, `plastic_cup` 오답 방지, `region_review_needed` 기대값을 보강. 새 smoke 중복 추가와 backlog status 변경은 없음
- 2026-07-02 source 보강 3개 답변 smoke 동기화: `shipping_label`, `shampoo_bottle`은 새 answer smoke로 고정하고, 기존 `receipt` smoke에는 감열지·종이류 오답 방지와 종량제봉투 기대값을 보강. backlog status 변경은 없음
- 2026-07-02 강남 음식물 예외 answer smoke 동기화: `fruit_seed`, `onion_peel`, `tea_bag`은 새 answer smoke로 고정하고, 기존 `fish_bone` smoke에는 강남 공식 첨부 기반 생선뼈·음식물 제외 기대값을 보강. backlog status 변경은 없음
- 2026-07-02 `pizza_box_oily` source 보강 답변 smoke 동기화: 기존 `oily_pizza_box_prefers_specific_item` smoke에 깨끗한 피자박스/오염된 피자박스 분기, 종이류 오답 방지, 종량제봉투 기대값을 보강. 새 smoke 중복 추가와 backlog status 변경은 없음
- 2026-07-02 answer smoke 회귀셋 위생 QA: 172개 기준 중복 id와 동일 tool/input 중복 없음. 최근 보강 축은 stale 기대값 없이 통과했고, 약한 text-only `pizza_box_oily_general` smoke만 공식 피자박스 근거와 structured 기대값으로 보강. 새 smoke 추가와 backlog status 변경은 없음
- 2026-07-02 `needs_source` 7개 보수 안내 smoke 감사: `vacuum_dust`, `laundry_lint`, `soap_bar_piece`, `cotton_swab`, `solvent_contaminated_rag`, `pet_waste_tissue`, `paint_palette` 모두 기존 answer smoke로 방어됨을 확인. 상대적으로 약한 `cotton_swab`, `pet_waste_tissue` smoke에는 단독 근거 부재와 `needs_source` structured 기대값을 보강. 새 smoke 추가와 backlog status 변경은 없음
- 2026-07-02 `medicine` source 보강 답변 smoke 동기화: 기존 `gangnam_medicine_collection` smoke에 알약·물약·한약·연고 직접 근거, 폐의약품 전용수거함, 우체통 배출 불가, `region_review_needed` 기대값을 보강. `빈 약통`·`알약 포장재` 분리 답변은 기존 smoke로 충분해 새 smoke 추가와 backlog status 변경은 없음
- 2026-07-03 남은 todo 기존 데이터·smoke 정리: 7개(`약과`, `랩탑`, `젖은 택배상자`, `냉동식품 포장 비닐봉지`, `서초구 투명 페트병`, `플라스틱 약병`, `송파구 거울 수수료`)를 기존 데이터와 MCP answer smoke 기준으로 `covered` 전환. `spray_can` 관련 항목과 당시 데이터 결정 보류 항목은 유지했고, 새 smoke 추가는 없음
- 2026-07-03 `spray_can` source 보강 동기화: 기존 `gangnam_dented_spray_can_empty_safe` smoke에 찌그러짐, 노즐 불확실, 캔류 단정 방지, 생활계 유해폐기물 전용수거함 기대값을 보강하고 `스프레이캔이 찌그러졌는데 남은 가스 없어도 캔류야?` todo를 `covered`로 전환. 새 smoke 추가는 없음
- 2026-07-03 `기름 묻은 피자박스` todo 정리: 기존 `oily_pizza_box_prefers_specific_item`, `pizza_box_oily_general` smoke가 폐식용유 과매칭 방지와 깨끗한 부분/오염 부분 분기를 충분히 고정해 `auto_177776ff7e`를 `covered`로 전환. 새 smoke 추가/보강은 없음
- 2026-07-03 데이터 결정 보류 todo 과매칭 guard 감사: `캔버스 액자`, `비닐장판`은 당시 매칭 후보가 없어 status를 유지하고, 기존 smoke 기대값만 금속캔류/비닐류 포장재 structured 과매칭 방어 중심으로 보강
- 2026-07-03 지역·건물유형 guard 감사: `부산 해운대구 폐건전지`는 미지원 지역에서 주소를 지어내지 않도록 기존 smoke를 보강하고, `강남구 오피스텔 비닐봉지`는 단독주택·빌라·소규모 상가 기준을 오피스텔에 확정 적용하지 않도록 직접 smoke를 추가. 두 항목 모두 status는 유지
- 2026-07-03 마포구 수수료 2차 answer smoke 동기화: `drying_rack`, `flower_pot` 마포구 대형생활폐기물 수수료가 MCP 답변에 노출되는지 `mapo_drying_rack_fee_coverage`, `mapo_flower_pot_fee_coverage`로 고정. 새 backlog/status 변경은 없음
- 2026-07-05 Source 반영 answer smoke 동기화: `비닐약봉지`는 `snack_bag` 별칭으로 약 자체/알약 포장재와 분리하고, `비닐장판`, `캔버스 액자`, `스탠드형 행거`, `cup_noodle_container` 조건 답변을 MCP answer smoke로 고정. `비닐장판`, `캔버스 액자` todo는 Source 승격과 smoke 보강 기준으로 `covered` 전환
- 2026-07-05 백로그 위생 정리: `부산 해운대구 폐건전지 수거함 위치`는 사용자 결정에 따라 탐색하지 않기로 해 `wont_fix`로 전환했고, `강남구 오피스텔 비닐봉지`는 오피스텔 전용 모델링 없이 보수 안내와 `gangnam_officetel_vinyl_building_type_guard` smoke로 방어되어 `covered`로 전환

남은 백로그 방향:

- 현재 열린 `todo`는 없다.
- 다음 데이터 보강 후보는 새 사용자 질문 로그, 자동 백로그 dry-run 결과, 또는 `needs_source` 항목 재검수에서 선별한다.
- 부산 해운대구 위치형 데이터와 오피스텔 같은 세부 건물유형 모델링은 현재 제품 범위에서 제외한다.

### 닫힌 Region Gap 2개 분류

새 데이터 승격과 smoke 동기화 정리로 `빈 약통`, `알약 포장재`, `공유기`, `휴대용 선풍기`, `약과`, `랩탑`, `젖은 택배상자`, `냉동식품 포장 비닐봉지`, `서초구 투명 페트병`, `플라스틱 약병`, `송파구 거울 수수료`, `찌그러진 스프레이캔`, `기름 묻은 피자박스`, `비닐장판`, `캔버스 액자`, `강남구 오피스텔 비닐봉지`는 `covered`로 전환했다. `부산 해운대구 폐건전지 수거함 위치`는 제품 범위 제외로 `wont_fix` 처리했다.

- `covered`: 강남구 오피스텔은 비닐봉지 목요일 배출 맞아?
- `wont_fix`: 부산 해운대구 폐건전지 수거함 위치 알려줘

### Closed Region Gap Smoke Coverage Index

이 인덱스는 닫힌 region gap 2개의 smoke coverage 추적성 메모다.

- 부산 해운대구 폐건전지 수거함 위치 알려줘: `region_info_unknown_battery_collection`으로 미지원 지역에서 수거함 주소를 지어내지 않도록 방어한다.
- 강남구 오피스텔은 비닐봉지 목요일 배출 맞아?: `gangnam_officetel_vinyl_building_type_guard`로 오피스텔 전용 목요일 배출 단정을 방지한다. 관련 기본 비닐/강남 요일 smoke는 `gangnam_parcel_plastic_bag_thursday`, `gangnam_food_contaminated_vinyl_region_phrase`다.

우선순위는 안전 리스크가 큰 품목을 `high`로 두고, 생활 빈출이지만 공식 근거 확인이 필요한 품목은 `medium`, 제품 범위 확장 성격이 강한 품목은 `low`로 둔다. 현재 high-priority 신규 위험 품목 8개, 음식물·식물 오인 2개, 복합재질 생활용품 8개는 데이터와 MCP 답변 회귀 케이스까지 승격했다.
