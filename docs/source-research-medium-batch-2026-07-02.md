# Medium Priority Source Research - 2026-07-02

대상: `src/data/question-backlog.json`의 medium-priority 질문 중 생활 빈도가 높고 오분류 위험이 있는 5개 항목.

## Summary

| Backlog ID | Query | Official source | Data work |
| --- | --- | --- | --- |
| `auto_d7aafbf93b` | 샴푸 리필 파우치는 비닐류로 버리면 돼? | 스파우트파우치, 스틱봉지, 비닐류 지침 | `snack_bag` 별칭·근거·MCP 답변 케이스 보강 |
| `auto_2dabb2122d` | 요거트 은박 뚜껑은 캔류야 일반쓰레기야? | 알루미늄 호일, 은박 접시 | `aluminum_foil` 별칭·판단 강화, MCP 과매칭 방지 케이스 반영 |
| `auto_82cd073f17` | 프링글스 통은 종이로 버리면 돼? | 감자칩 용기 | `potato_chip_canister` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_93ec27f838` | 전동칫솔 본체랑 칫솔모는 같이 버려? | 전동칫솔, 칫솔 | `electric_toothbrush` 신규 품목, 강남구 소형가전 가이드 연결, 평가 케이스, MCP 답변 케이스 반영 |
| `auto_793bcfb5f6` | 생선가시는 음식물쓰레기야 일반쓰레기야? | 생선가시 | `fish_bone` 신규 품목, 평가 케이스, MCP 답변 케이스 반영 |

## Sources

### 리필 파우치

- Source: [생활폐기물 분리배출 누리집 - 스파우트파우치](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=104)
- Source: [생활폐기물 분리배출 누리집 - 음료 파우치 팩](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=629)
- Source: [생활폐기물 분리배출 누리집 - 스틱봉지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=628)
- Basis: 파우치·작은 비닐봉지는 합성수지 비닐류로 분류된다. 몸체는 비닐류, 캡·뚜껑은 분리 가능한 경우 플라스틱류로 분리하며 내용물과 이물질을 제거한다.

### 요거트 은박 뚜껑

- Source: [생활폐기물 분리배출 누리집 - 알루미늄 호일](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=409)
- Source: [생활폐기물 분리배출 누리집 - 은박 접시](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=741)
- Basis: 알루미늄 호일과 은박 접시는 일반종량제폐기물로 분류되며 금속캔·고철류로 배출할 수 없다. 요거트 은박 뚜껑은 작은 은박류로 캔류 과매칭을 피한다.

### 프링글스 통

- Source: [생활폐기물 분리배출 누리집 - 감자칩 용기](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=346)
- Basis: 감자칩 용기는 종이, 고철 등이 혼합된 복합재질이라 재활용이 어렵고 종량제봉투로 배출한다. 원문은 프링글스 용기처럼 재질별 분리가 어려운 과자용기는 제품 그대로 종량제봉투로 배출한다고 안내한다.

### 전동칫솔

- Source: [생활폐기물 분리배출 누리집 - 전동칫솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=301)
- Source: [생활폐기물 분리배출 누리집 - 칫솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=334)
- Source: [강남구 자원순환 종합포털 소형폐가전 무상수거 안내](https://clean.gangnam.go.kr/use/biwa/USEBIWA03000000.do)
- Basis: 전동칫솔 본체는 전기전자 제품류로 소형전기전자제품 전용수거함 또는 지자체 기준을 확인한다. 칫솔모는 칫솔처럼 플라스틱·솔·고무가 섞인 복합재질이라 종량제봉투로 분리 안내한다.

### 생선가시

- Source: [생활폐기물 분리배출 누리집 - 생선가시](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=468)
- Source: [강남구청 쓰레기배출안내](https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109)
- Basis: 생선가시와 생선뼈는 동물 사료로 적합하지 않아 종량제봉투로 배출한다. 다만 품목사전은 소량 배출 시 음식물류폐기물과 함께 배출 가능하다고 안내하므로, 답변에는 원칙과 소량 예외를 함께 남긴다.

## Follow-up Complete

- 이 문서는 2026-07-02 첫 medium 배치 5개를 기록한다.
- 같은 날 남아 있던 medium-priority todo 19개도 모두 처리했다. 세부 근거와 처리 결과는 [source-research-medium-todo-complete-2026-07-02.md](source-research-medium-todo-complete-2026-07-02.md)에 기록한다.
- 전체 백로그 83개 중 2026-07-02 현재 `covered` 83개, `todo` 0개.
