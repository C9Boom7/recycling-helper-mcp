# High Priority Source Research - 2026-07-01

대상: `logs/quality-seed-queries.example.jsonl`에서 자동 백로그화된 high-priority 5개 질문.
기준 지역은 `서울 강남구`이지만, 이번 문서는 먼저 전국 공통 공식 근거를 찾는 데 초점을 둔다.

## Summary

| Backlog ID | Query | Result | Data work |
| --- | --- | --- | --- |
| `auto_ff59fb7faa` | 깨진 보조배터리는 폐건전지함에 그냥 넣어도 돼? | 보조배터리 공식 품목 근거 확보. 파손·팽창 특화 문구는 안전 보수 답변으로 분기 | `power_bank` 조건 답변, 비공식 블로그 참고 메모, MCP 답변 케이스 반영 완료 |
| `auto_188d2e7fe3` | 깨진 도자기 화분은 불연성 마대야? | 화분/불연성종량제폐기물 공식 근거 확보 | `flower_pot` 깨진 도자기 화분 답변과 MCP 답변 케이스 반영 완료 |
| `auto_cd3e095e55` | LED 전구 깨졌는데 형광등 수거함에 넣어도 돼? | LED/조명제품 공식 근거 확보 | `led_lamp` 파손 분기와 MCP 답변 케이스 반영 완료 |
| `auto_2e2e264c1e` | 토너 가루가 누출된 프린터 카트리지는 어디 버려? | 토너/카트리지 공식 근거 확보 | `toner_cartridge` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 완료 |
| `auto_ff4d239f68` | 배터리 들어있는 일회용 전자담배는 어떻게 버려? | 전자담배 공식 품목 근거 확보 | `electronic_cigarette` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 완료 |

## Sources

### 깨진 보조배터리

- Source: [생활폐기물 분리배출 누리집 - 보조배터리](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=125)
- Basis:
  - 보조배터리는 전지수거함으로 배출.
  - 전지를 재활용품으로 배출하면 화재 우려가 있으므로 재활용품 혼입 금지.
  - 전해질 등 유해 성분이 포함될 수 있어 주의 필요.
- Data implication:
  - `깨진/부푼/손상된` 보조배터리는 일반 재활용품으로 넣지 않도록 강하게 안내한다.
  - 전지수거함 배출을 기본으로 하되, 파손·누액·팽창 시에는 노출부를 보호하고 지자체/관리사무소 확인을 권장하는 보수 답변이 필요하다.

#### 비공식 참고

- Source: [네이버 블로그 - 부푼 보조배터리 폐기 경험](https://blog.naver.com/wa7454/224296718565)
- Status: 공식 기관 근거가 아니므로 `manual_review` 참고로만 기록.
- 적용:
  - 일반 재활용 분리수거 금지, 사용·충전 중지, 주민센터·마트 등 수거 경로 확인이라는 사용자 경험상 표현은 공식 근거와 충돌하지 않는 범위에서 안전 문구 보강에 참고했다.
  - 공식 근거 없는 자가 방전·분해·침수 같은 처리는 앱 답변에 넣지 않는다.

### 깨진 도자기 화분

- Source: [생활폐기물 분리배출 누리집 - 화분](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=511)
- Source: [생활폐기물 분리배출 누리집 - 불연성종량제폐기물](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=543)
- Basis:
  - 도자기·유리 화분은 불연성 종량제봉투, 즉 특수규격마대로 배출.
  - 플라스틱 화분은 흙 등 이물질 제거 후 플라스틱 수거함.
  - 불연성종량제폐기물은 유리, 내열식기류, 도자기 등 재활용이 어렵고 불에 타지 않는 폐기물.
- Data implication:
  - 깨진 도자기 화분은 파편 안전 포장과 특수규격마대 안내가 필요하다.
  - 대형 화분은 대형폐기물 가능성도 함께 안내한다.

### 깨진 LED 전구

- Source: [생활폐기물 분리배출 누리집 - LED](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=137)
- Source: [생활폐기물 분리배출 누리집 - 조명제품](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=538)
- Basis:
  - 전구형·직관형 LED 조명은 형광등 수거함.
  - 평판형·십자형·일자형·원반형 LED 조명은 불연성폐기물 또는 대형폐기물.
  - 조명이 깨진 경우 신문지와 테이프로 감싸 불연성종량제폐기물로 배출.
- Data implication:
  - `깨진 LED 전구`는 형광등 수거함 투입 대신 포장 후 불연성종량제폐기물로 안내한다.
  - 깨지지 않은 전구형·직관형 LED와 깨진 LED를 MCP 답변 케이스로 분리해야 한다.

### 토너 가루가 누출된 프린터 카트리지

- Source: [생활폐기물 분리배출 누리집 - 토너](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=742)
- Source: [생활폐기물 분리배출 누리집 - 카트리지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=412)
- Basis:
  - 토너는 카트리지에 들어있는 분말가루이며 종량제봉투로 배출.
  - 카트리지는 잉크나 토너가 깨끗하게 분리되면 플라스틱 수거함.
  - 분리가 어려우면 잉크나 토너가 흘러내리지 않도록 밀봉 후 종량제봉투.
  - 구입업체 또는 카트리지 재활용전문업체 배출도 안내.
- Data implication:
  - `토너 가루 누출`은 재활용 직행 금지, 밀봉 후 종량제봉투 또는 회수업체 확인으로 답변한다.
  - `toner_cartridge` 신규 품목이 적합하다.

### 배터리 들어있는 일회용 전자담배

- Source: [생활폐기물 분리배출 누리집 - 전자담배](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=298)
- Basis:
  - 전자담배는 소형전기전자제품 전용수거함으로 배출.
  - 인근 전용수거함이 없으면 지자체에 문의한 후 배출.
  - 일부 소형가전제품은 환경성보장제도 대상이 아니어도 무상방문수거 동시 배출 또는 소형전기전자제품 전용수거함 배출이 가능.
- Data implication:
  - 배터리 내장 전자담배를 일반쓰레기/라이터로 오분류하지 않도록 신규 품목 또는 소형가전 별칭 보강이 필요하다.
  - 일회용 전자담배는 배터리 내장 제품이라는 안전 주의 문구를 포함한다.

## Not Found / Still Needs Caution

- `깨진/부푼 보조배터리`만을 별도로 다룬 공식 분리배출 품목 문구는 이번 검색에서 확인하지 못했다.
- 따라서 직접 근거는 `보조배터리=전지수거함`, `재활용품 혼입 시 화재 우려`까지로 두고, 파손·팽창 상황은 안전 보수 문구로 다룬다.
- 2026-07-01 현재 위 5개 high-priority 항목은 모두 품목 데이터, 평가 케이스 또는 MCP 답변 회귀 케이스까지 반영해 `covered`로 전환했다.
