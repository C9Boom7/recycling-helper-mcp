# Medium Todo Source Research Complete - 2026-07-02

대상: `src/data/question-backlog.json`에 남아 있던 medium-priority `todo` 19개.

## Summary

| Backlog ID | Query | Data work | Official source status |
| --- | --- | --- | --- |
| `auto_72a6d0127f` | 간장 유리병에 플라스틱 뚜껑 붙어있으면 어떻게 버려? | `glass_bottle` 별칭·근거·MCP 케이스 보강 | 유리병 직접 근거 |
| `auto_8891f66da5` | 배달 음식 소스 작은 비닐팩은 씻어서 비닐류야? | `snack_bag` 별칭·근거·MCP 케이스 보강 | 스틱봉지·스프봉지 유사 직접 근거 |
| `auto_88317c0599` | 젖은 우산은 그냥 일반쓰레기야 고철이야? | `umbrella` 별칭·직접 근거 보강 | 우산 직접 근거 |
| `auto_a159c4739f` | 부러진 우산살은 고철로 따로 버려도 돼? | `umbrella` 별칭·직접 근거 보강 | 우산 직접 근거 |
| `auto_7c98721c7c` | 설거지 솔은 플라스틱으로 버리면 되나? | `dish_brush` 신규 품목 | 수세미·칫솔 유사 근거, 단독 항목 없음 |
| `auto_476cc4e718` | 고무줄이랑 머리끈은 일반쓰레기 맞아? | `hair_tie_rubber_band` 신규 품목 | 머리끈 직접 근거 |
| `auto_c2b84cfdfa` | 면봉은 종이니까 종이류로 버려도 돼? | `cotton_swab` 신규 품목 | 화장솜·화장지 유사 근거, 단독 항목 없음 |
| `auto_273760eb9a` | 화장솜에 클렌징오일 묻었으면 어디 버려? | `cosmetic_cotton_pad` 신규 품목 | 화장솜 직접 근거 |
| `auto_6d37f99c22` | 향수 샘플 작은 유리병도 향수병이랑 똑같아? | `perfume_bottle` 별칭 보강 | 향수병 직접 근거 |
| `auto_9b48da424d` | 금 간 머그컵은 도자기니까 불연성 봉투야? | `ceramic_bowl` 불연성 기준 보강 | 머그잔 직접 근거 |
| `auto_0b8ec2075e` | 충전 어댑터는 케이블이랑 같이 버리면 돼? | `phone_charger_adapter` 신규 품목 | 핸드폰 충전기 직접 근거 |
| `auto_fd42b0d18a` | 시너 묻은 걸레는 일반쓰레기로 버리면 위험하지 않아? | `solvent_contaminated_rag` 신규 품목 | 걸레·페인트·인화성 잔여물 유사 근거, 단독 항목 없음 |
| `auto_5901c7e326` | 강아지 똥 묻은 휴지는 변기에 버려도 돼? | `pet_waste_tissue` 신규 품목 | 배변패드·화장지 유사 근거, 단독 항목 없음 |
| `auto_793bcfb5f6` | 생선가시는 음식물쓰레기야 일반쓰레기야? | 기존 `fish_bone` 반영 상태 백로그 동기화 | 생선가시 직접 근거 |
| `auto_e3c9129f15` | 호두껍질은 음식물쓰레기 아니지? | `nut_shell` 신규 품목 | 호두 껍데기 직접 근거 |
| `auto_e828e97870` | 옥수수대랑 옥수수껍질은 둘 다 일반쓰레기야? | `corn_cob_husk` 신규 품목 | 옥수수대·옥수수껍질 직접 근거 |
| `auto_ec2e524a1c` | 한약재 찌꺼기는 음식물쓰레기로 버려도 돼? | `herbal_medicine_dregs` 신규 품목 | 한약 찌꺼기 직접 근거 |
| `auto_64dc9ebe6d` | 참치캔 기름 남아있으면 캔류로 못 버려? | `can` 별칭·근거·MCP 케이스 보강 | 참치캔·식용유 직접 근거 |
| `auto_fa112693a7` | 컵라면 뚜껑 은박지는 어디 버려? | `aluminum_foil` 별칭·MCP 케이스 보강 | 알루미늄 호일·은박 접시 직접 근거 |

## Official Sources

- [생활폐기물 분리배출 누리집 - 유리병](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=534): 깨끗한 유리병은 유리병 수거함, 깨진 유리병은 불연성종량제봉투 기준.
- [생활폐기물 분리배출 누리집 - 스틱봉지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=628), [스프봉지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=102): 작은 비닐 봉지류는 내용물과 이물질 제거 후 비닐류.
- [생활폐기물 분리배출 누리집 - 우산](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=303): 분리 가능하면 재질별, 분리 어려우면 종량제봉투. 우산 뼈대는 고철 재활용 가능.
- [생활폐기물 분리배출 누리집 - 수세미](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=485), [칫솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=334): 복합재질 세척·브러시류의 종량제봉투 보조 근거.
- [생활폐기물 분리배출 누리집 - 머리끈](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=370): 섬유와 고무 혼합 복합재질로 종량제봉투.
- [생활폐기물 분리배출 누리집 - 화장솜](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=733), [화장지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=492): 위생·오염 소모품의 종량제봉투 근거.
- [생활폐기물 분리배출 누리집 - 향수병](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=134): 내용물 비움, 잔여물 흡수, 뚜껑·펌프 분리 후 유리병류.
- [생활폐기물 분리배출 누리집 - 머그잔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=502), [강남구청 쓰레기배출안내](https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109): 도자기 머그잔은 불연성종량제폐기물, 강남구는 PP봉투 기준 확인.
- [생활폐기물 분리배출 누리집 - 핸드폰 충전기](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=275), [강남구 소형폐가전 무상수거 안내](https://clean.gangnam.go.kr/use/biwa/USEBIWA03000000.do): 충전기는 소형전기전자제품 기준.
- [생활폐기물 분리배출 누리집 - 걸레](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=342), [페인트](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=140), [분리수거 지침](https://www.xn--oy2b29bd3a601b.kr/front/bbsList.do?bbsId=BBS_0003): 오염 걸레와 인화성·유해 잔여물 보수 안내.
- [생활폐기물 분리배출 누리집 - 배변패드](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=380): 반려동물 배설물이 묻은 위생 폐기물의 종량제봉투 보조 근거.
- [생활폐기물 분리배출 누리집 - 생선가시](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=468): 생선가시는 원칙적으로 종량제봉투, 소량 음식물류폐기물 예외 보존.
- [생활폐기물 분리배출 누리집 - 호두 껍데기](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=456): 단단한 견과류 껍데기는 종량제봉투.
- [생활폐기물 분리배출 누리집 - 옥수수대](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=422), [옥수수껍질](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=747): 둘 다 일반종량제폐기물.
- [생활폐기물 분리배출 누리집 - 한약 찌꺼기](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=745): 사료·퇴비 가치가 낮아 종량제봉투.
- [생활폐기물 분리배출 누리집 - 참치캔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=84), [식용유](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=178): 참치캔은 내용물 비움·헹굼 후 캔류, 남은 기름은 별도 처리.
- [생활폐기물 분리배출 누리집 - 알루미늄 호일](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=409), [은박 접시](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=741): 얇은 은박류는 금속캔·고철류가 아니라 종량제봉투.

## Source Gaps Kept Open

다음 항목은 공식 유사 근거로 답변은 제공하지만, 단독 품목 원문은 확인하지 못해 `needs_source`로 유지한다.

- `dish_brush`: 설거지 솔, 설거지솔, 주방 솔 단독 항목 없음.
- `cotton_swab`: 면봉 단독 항목 없음.
- `solvent_contaminated_rag`: 시너 묻은 걸레, 신나 묻은 걸레 단독 항목 없음.
- `pet_waste_tissue`: 반려동물 배설물 묻은 휴지 단독 항목 없음.

## Result

- `src/data/question-backlog.json`: 전체 83개 중 `covered` 83개, 열린 medium todo 0개.
- `src/data/waste-items.json`: 10개 신규 품목 추가, 기존 8개 품목 별칭·근거 보강, 생선가시 백로그 상태 동기화.
- `src/data/evaluation-cases.json`: 신규 품목 10개 평가 케이스 추가.
- `src/data/mcp-answer-cases.json`: 19개 질문을 보호하는 MCP 답변 회귀 케이스 추가.
