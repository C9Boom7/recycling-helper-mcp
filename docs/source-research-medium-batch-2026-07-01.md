# Medium Priority Source Research - 2026-07-01

대상: `logs/quality-seed-queries.example.jsonl`에서 자동 백로그화된 medium-priority 질문 중 공식 품목사전 근거가 확인되었거나 재활용척척 예외 배출 정책으로 일반쓰레기 고정 처리한 항목.

## Summary

| Backlog ID | Query | Official source | Data work |
| --- | --- | --- | --- |
| `auto_85eef994b5` | 에어프라이어 종이호일은 종이로 버려? | 종이호일, 유산지 | `parchment_paper` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_9913ee7e43` | 다 쓴 고체 방향제는 플라스틱 용기만 분리해? | 석고방향제 | `gypsum_air_freshener` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_076895a605` | 귤껍질은 음식물쓰레기로 버려? | 말린 귤껍질 | `mandarin_peel` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_ba7cee1f52` | 다 쓴 핫팩은 어디 버려? | 일회용 손난로, 전기 손난로 | `disposable_hand_warmer` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_7cfb9710dc` | 실리카겔 방습제는 일반쓰레기야? | 방습제 | `desiccant` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_c74e4b395f` | 휴대폰 액정 보호필름은 비닐류야? | 액정보호필름 | `screen_protector` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_72da62f1cd` | 부직포 장바구니는 의류수거함에 넣어도 돼? | 부직포 가방 | `nonwoven_bag` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_78a18690d9` | 빨래 먼지 거름망에서 나온 보풀은 음식물 아니지? | 화장지, 걸레, 물티슈, 테이프 클리너, 행주 + 예외 배출 정책 | `laundry_lint` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_d69d35f9ff` | 샴푸바 포장 없는 비누 조각은 어디 버려? | 가루세제, 샴푸, 핸드크림 + 예외 배출 정책 | `soap_bar_piece` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_77926a45de` | 곰팡이 핀 빵은 음식물쓰레기야? | 상한 음식, 음식물류폐기물 | `moldy_bread` 신규 품목, 강남구 지역 가이드, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_1a77a8fa24` | 배달 플라스틱 용기에 고추장 묻었는데 씻어서 재활용 가능해? | 고추장, 플라스틱 | `plastic_food_container` 조건 분기, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_8af3ae8fa8` | 물티슈 포장 캡은 플라스틱으로 따로 버려? | 물티슈, 플라스틱 | `wet_tissue` 조건 분기, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_a12fbc8ec3` | 드립백 커피 필터는 음식물쓰레기야? | 티백, 육수팩, 녹차잎 | `drip_bag_coffee_filter` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |

## Sources

### 종이호일

- Source: [생활폐기물 분리배출 누리집 - 종이호일](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=410)
- Source: [생활폐기물 분리배출 누리집 - 유산지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=442)
- Basis: 종이호일은 실리콘 코팅 때문에 재활용이 어려워 종량제봉투로 배출한다. 유산지도 코팅과 음식물·기름 오염 시 일반쓰레기로 배출한다.

### 일회용 손난로

- Source: [생활폐기물 분리배출 누리집 - 일회용 손난로](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=392)
- Source: [생활폐기물 분리배출 누리집 - 전기 손난로](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=293)
- Basis: 가루형·액체형 일회용 손난로는 재활용이 어려워 종량제봉투로 배출한다. 전기 손난로는 소형전기전자제품 전용수거함으로 분리 안내한다.

### 방습제

- Source: [생활폐기물 분리배출 누리집 - 방습제](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=457)
- Basis: 방습제는 실리카겔, 비닐, 부직포 등이 섞인 복합재질로 재활용이 어려워 종량제봉투로 배출한다.

### 액정보호필름

- Source: [생활폐기물 분리배출 누리집 - 액정보호필름](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=458)
- Basis: 액정보호필름은 유리·우레탄 재질로 재활용이 어려워 종량제봉투로 배출한다.

### 석고방향제

- Source: [생활폐기물 분리배출 누리집 - 석고방향제](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=435)
- Basis: 석고방향제는 종량제봉투로 배출하고, 다량 배출 시 불연성종량제폐기물로 배출한다.

### 귤껍질

- Source: [생활폐기물 분리배출 누리집 - 말린 귤껍질](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=160)
- Basis: 말린 귤껍질과 말린 과일껍질도 음식물류폐기물로 배출할 수 있다. 실제 배출 방식은 지자체 기준을 따른다.

### 부직포 가방

- Source: [생활폐기물 분리배출 누리집 - 부직포 가방](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=390)
- Basis: 합성섬유 부직포가방은 재활용이 어려워 종량제봉투로 배출하며, 의류수거함에 배출할 수 없다.

### 세탁 보풀

- Source: [생활폐기물 분리배출 누리집 - 화장지](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=492)
- Source: [생활폐기물 분리배출 누리집 - 걸레](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=342)
- Source: [생활폐기물 분리배출 누리집 - 물티슈](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=375)
- Source: [생활폐기물 분리배출 누리집 - 테이프 클리너](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%ED%85%8C%EC%9D%B4%ED%94%84%20%ED%81%B4%EB%A6%AC%EB%84%88)
- Source: [생활폐기물 분리배출 누리집 - 행주](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%ED%96%89%EC%A3%BC)
- Search gap: `보풀`, `세탁 보풀`, `세탁먼지`, `건조기 먼지`, `건조기 보풀`, `세탁기 거름망`, `섬유 먼지`, `천 조각`은 2026-07-01 기준 생활폐기물 분리배출 누리집에서 단독 항목이 확인되지 않았다.
- Basis: 세탁 보풀은 오염된 섬유성 생활 잔재물이며, 재활용척척 예외 배출 정책에 따라 일반쓰레기/종량제봉투 배출로 고정한다. 단독 공식 근거가 확인되기 전까지 `needs_source`로 유지한다.

### 비누 조각

- Source: [생활폐기물 분리배출 누리집 - 가루세제](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EA%B0%80%EB%A3%A8%EC%84%B8%EC%A0%9C)
- Source: [생활폐기물 분리배출 누리집 - 샴푸](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EC%83%B4%ED%91%B8)
- Source: [생활폐기물 분리배출 누리집 - 핸드크림](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%ED%95%B8%EB%93%9C%ED%81%AC%EB%A6%BC)
- Search gap: `샴푸바`, `비누 조각`, `고체비누`, `세안비누`, `액체세제`는 2026-07-01 기준 생활폐기물 분리배출 누리집에서 단독 항목이 확인되지 않았다.
- Basis: 비누 조각과 샴푸바는 하수구나 재활용품이 아니라 재활용척척 예외 배출 정책에 따라 일반쓰레기/종량제봉투 배출로 고정한다. 단독 공식 근거가 확인되기 전까지 `needs_source`로 유지한다.

### 곰팡이 핀 빵

- Source: [생활폐기물 분리배출 누리집 - 상한 음식](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EC%83%81%ED%95%9C%20%EC%9D%8C%EC%8B%9D)
- Source: [생활폐기물 분리배출 누리집 - 음식물류폐기물](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EC%9D%8C%EC%8B%9D%EB%AC%BC%EB%A5%98%ED%8F%90%EA%B8%B0%EB%AC%BC)
- Basis: 상한 음식은 음식물류폐기물로 배출하며, 음식물이 아닌 이물질을 제거한 후 음식물종량제 방식으로 배출한다.

### 고추장 묻은 배달 플라스틱 용기

- Source: [생활폐기물 분리배출 누리집 - 고추장](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=170)
- Source: [생활폐기물 분리배출 누리집 - 플라스틱](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=531)
- Basis: 고추장은 음식물류폐기물로 배출하고, 내용물 제거가 어려우면 제품 그대로 종량제봉투로 배출한다. 플라스틱은 내용물과 이물질을 제거하고 헹군 뒤 배출한다.

### 물티슈 포장 캡

- Source: [생활폐기물 분리배출 누리집 - 물티슈](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=375)
- Source: [생활폐기물 분리배출 누리집 - 플라스틱](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=531)
- Basis: 물티슈는 폴리에스터·부직포 등으로 재활용이 어려워 종량제봉투로 배출한다. 포장 캡은 접착제와 오염 제거 가능 여부에 따라 플라스틱류 또는 종량제봉투로 분기한다.

### 드립백 커피 필터

- Source: [생활폐기물 분리배출 누리집 - 티백](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=419)
- Source: [생활폐기물 분리배출 누리집 - 육수팩](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=744)
- Source: [생활폐기물 분리배출 누리집 - 녹차잎](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=420)
- Search gap: `드립백`, `커피 필터`, `커피찌꺼기`는 2026-07-01 기준 생활폐기물 분리배출 누리집에서 단독 항목이 확인되지 않았다.
- Basis: 티백은 차와 커피를 포함한 다공질 포장재로, 종이·PP·PET·PLA 등이 사용되어 재활용이 어렵고 음식물류폐기물로 배출할 수 없다. 육수팩처럼 필터와 내용물을 분리해 판단한다.

## Remaining Medium Todo

- 현재 열린 medium-priority 백로그 없음.
