# Source Top 50 Coverage Audit - 2026-07-02

목표: Top 50/사용자 빈도 품목 중 현재 `src/data/waste-items.json`의 공식 출처 커버리지가 약한 항목을 찾고, 다음 Source Gap 배치에서 보강할 공식 근거 후보를 정리한다.

이번 감사 원칙:

- `src/data/waste-items.json`, `src/data/evaluation-cases.json`은 후보 감사 라운드에서 읽기만 한다. `docs/data-decision-backlog.md`는 명확한 모델링 결정이 생긴 경우에만 Open Decisions를 최소 추가한다.
- 공식 근거 후보는 생활폐기물 분리배출 누리집 품목사전/검색 결과를 우선 확인했다.
- 후보 감사 라운드에서는 데이터 승격, 품목 추가, review 상태 변경을 하지 않는다.

## Summary

- 현재 데이터: `waste-items.json` 130개, `evaluation-cases.json` 130개
- review count: `verified 39 / region_review_needed 84 / needs_source 7`
- 감사 후보: 초기 10개, 후속 재감사 후보 5개
- 공통 결론: 대부분 `region_review_needed` 상태 유지가 맞지만, 현재 `sources`가 법령/지역 안내/루트 URL에 머물러 있어 품목사전 직접 URL과 `basis` 보강 가치가 크다.

## Progress

- 2026-07-02: 우선순위 1~5(`chair`, `mattress`, `pet_bottle`, `styrofoam`, `milk_carton`)는 `src/data/waste-items.json`에 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 모두 `region_review_needed`로 유지했다.
- 2026-07-02: 우선순위 6~10(`butane_can`, `used_cooking_oil`, `battery`, `mobile_phone`, `fruit_seed`)도 `src/data/waste-items.json`에 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 모두 `region_review_needed`로 유지했다.
- 2026-07-02: 추가 Top item 후보 `shoes`는 `구두`(niIdx=152)와 `운동화`(niIdx=153) 품목사전 직접 URL과 `basis`를 `src/data/waste-items.json`에 보강했다. review 상태는 `region_review_needed`로 유지했다.
- 2026-07-02: 다음 source 후보 재감사에서 `cat_litter`, `mirror`, `clothing`, `delivery_box`, `bubble_wrap` 5개를 새 보강 후보로 선정했다. 이번 라운드는 후보 감사만 수행했고 데이터 파일은 수정하지 않았다.
- 2026-07-02: 1차 보강으로 `cat_litter`, `delivery_box`, `bubble_wrap` 3개에 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 모두 유지했다.
- 2026-07-02: 2차 보강으로 `mirror`, `clothing` 2개에 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 모두 유지했다.
- 2026-07-02: 최근 후보 5개 반영 직후에는 다음 반영 후보를 없음으로 두고, 다음 Source Gap 배치에서 Top 50/사용자 빈도 품목을 재감사하기로 했다.
- 2026-07-02: source coverage 정합성 재점검 결과 `waste-items.json` 127개, `evaluation-cases.json` 127개, `mcp-answer-cases.json` 167개, review count `verified 39 / region_review_needed 81 / needs_source 7`로 확인했다. 최근 후보 5개(`cat_litter`, `delivery_box`, `bubble_wrap`, `mirror`, `clothing`)는 모두 직접 품목사전 URL이 반영되어 있다.
- 2026-07-02: `paper_cup`에 `음수대용 종이컵`(niIdx=41) 품목사전 직접 URL과 `basis`를 보강했다. `카페 일회용컵`(niIdx=111)은 합성수지 용기류/플라스틱 수거함 기준이라 기존 종이컵 중심 item에는 반영하지 않았다. review 상태는 `region_review_needed`로 유지했다.
- 2026-07-02: `paper_cup` 이후 Top 50/질문 백로그 기준으로 직접 URL 약한 품목을 재스캔했고, 데이터 변경 없이 다음 후보 `shipping_label`, `receipt`, `shampoo_bottle` 3개만 문서 후보로 선정했다.
- 2026-07-02: `shipping_label`, `receipt`, `shampoo_bottle` 3개에 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 모두 `verified`로 유지했다.
- 2026-07-02: 위 3개 반영 후 다음 후보를 다시 감사했고, 데이터 변경 없이 `pizza_box_oily` 1개만 다음 source 보강 후보로 선정했다.
- 2026-07-02: `pizza_box_oily`에 피자박스 품목사전 직접 URL과 `basis`를 보강했다. review 상태는 `verified`로 유지했다.
- 2026-07-02: `pizza_box_oily` 반영 후 다음 후보를 다시 감사했고, 데이터 변경 없이 `medicine` 1개만 다음 source 보강 후보로 선정했다. `cup_noodle_container`는 종이/스티로폼 컵라면 용기 모델링 결정이 먼저 필요해 데이터 결정 백로그로 보냈다.
- 2026-07-02: `medicine`에 알약, 물약, 한약, 연고 품목사전 직접 URL과 `basis`를 보강했다. 폐의약품 포장재 품목은 수정하지 않았고 review 상태는 `region_review_needed`로 유지했다.
- 2026-07-05: 사용자 결정 후 `비닐약봉지`는 `snack_bag` 별칭/source로 흡수했고, `비닐장판`(`vinyl_flooring`), `캔버스 액자`(`canvas_frame`), `스탠드형 행거`(`standing_clothes_hanger`)는 별도 품목과 평가 케이스로 추가했다. `cup_noodle_container`에는 `종이 컵라면`(niIdx=406) 공식 근거를 조건 보강으로 반영했다.

## Next Candidate Rescan - 2026-07-02

| Priority | itemId | 품목 | 현재 review | 현재 source 약점 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `cat_litter` | 고양이 모래 | `region_review_needed` | 2026-07-02 1차 보강 완료. 이전에는 품목사전 루트 URL + 지역 안내만 있어 두부모래/벤토나이트 모래 분기 근거가 약했음 | [벤토나이트 모래, niIdx=507](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=507), [고양이 두부모래, niIdx=423](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=423), 검색어 `고양이 모래` | `src/data/waste-items.json`에 두 직접 근거를 모두 추가했다. 벤토나이트는 불연성종량제봉투, 두부모래는 종량제봉투로 분기한다. 변기·하수구 배출 금지와 지역별 불연성봉투 기준 때문에 review 상태는 유지. |
| 2 | `mirror` | 거울 | `region_review_needed` | 2026-07-02 2차 보강 완료. 이전에는 법령의 유리병류 제외 근거와 URL 없는 지역 대형폐기물 안내만 있어 거울 직접 근거가 없었음 | [전신거울, niIdx=195](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=195), 검색어 `거울` | `src/data/waste-items.json`에 전신거울 직접 근거를 추가했다. 거울은 재활용이 어렵고 크기가 크면 대형폐기물로 배출한다는 basis를 보강했다. 지역별 수수료와 크기 기준 때문에 review 상태는 유지. |
| 3 | `clothing` | 옷 | `region_review_needed` | 2026-07-02 2차 보강 완료. 이전에는 법령 + 지역 안내만 있고 의류수거함 직접 품목사전 URL이 없었음 | [의류, 원단, niIdx=536](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=536), 검색어 `의류`, `옷` | `src/data/waste-items.json`에 의류·원단 직접 근거를 추가했다. 깨끗한 의류는 의류수거함, 세트 품목은 묶음 배출, 문전수거 지역은 젖지 않게 배출한다는 basis를 보강했다. 수거함 가능 품목과 위치 차이 때문에 review 상태는 유지. |
| 4 | `delivery_box` | 택배상자 | `verified` | 2026-07-02 1차 보강 완료. 이전에는 법령 + 환경부 요령만 있고 빈출 품목인 택배 상자 직접 URL이 없었음 | [택배 상자, niIdx=19](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=19), 검색어 `택배상자` | `src/data/waste-items.json`에 직접 근거를 추가했다. 골판지 상자는 일반 종이와 구분, 송장과 테이프 제거, 코팅재 최대 제거 후 접어 배출하는 basis를 보강했다. 기존 verified 상태는 유지. |
| 5 | `bubble_wrap` | 뽁뽁이 | `verified` | 2026-07-02 1차 보강 완료. 이전에는 법령의 필름·시트형 포장재 근거만 있고 에어캡 직접 URL이 없었음 | [에어캡, niIdx=106](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=106), 검색어 `뽁뽁이`, `에어캡` | `src/data/waste-items.json`에 에어캡 직접 근거를 추가했다. 이물질 제거 후 비닐류수거함 배출 basis를 보강했고 기존 verified 상태는 유지. |

## Next Immediate Candidate Recheck - 2026-07-02

| Priority | itemId | 품목 | 현재 review | 현재 source 약점 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `paper_cup` | 종이컵 | `region_review_needed` | 2026-07-02 보강 완료. 이전에는 법령 + 지역 안내만 있고 종이컵 직접 품목사전 URL이 없었음 | [음수대용 종이컵, niIdx=41](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=41), 보류 후보 [카페 일회용컵, niIdx=111](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=111), 검색어 `종이컵`, `일회용컵` | `src/data/waste-items.json`에 음수대용 종이컵 직접 근거만 추가했다. 카페 일회용컵은 합성수지 용기류로 플라스틱 수거함 배출을 안내하므로 종이컵 중심 `paper_cup`에는 반영하지 않았다. 종이컵 전용 수거함과 사업장 기준 때문에 review 상태는 유지. |

이 재점검에서는 위 1개 외에 즉시 보강 후보를 억지로 만들지 않았다. `blanket`은 `이불` 직접 항목 없이 침대커버·쿠션 등 유사품목만 확인되고, `medicine`은 당시 알약·물약·비닐약봉지·약통 용기 등 세부 모델링과 지역 수거함 위치가 얽혀 있어 보류했다. `onion_peel`, `coffee_ground`는 공식 품목사전 직접 검색 결과가 없어 지역 음식물류 예외 조사 또는 별도 근거가 필요하다. 이후 재스캔 결과는 아래 `Post Paper Cup Candidate Rescan`과 `Post Pizza Box Candidate Rescan`에 분리해 기록한다.

## Post Paper Cup Candidate Rescan - 2026-07-02

| Priority | itemId | 품목 | 현재 review | 현재 source 약점 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `shipping_label` | 송장스티커 | `verified` | 2026-07-02 보강 완료. 이전에는 법령 별표 근거만 있고, 품목사전의 택배 송장 직접 URL이 없었음 | [택배 송장, niIdx=718](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=718), 검색어 `택배 송장`, `운송장` | `src/data/waste-items.json`에 직접 URL과 basis를 추가했다. 품목사전은 감열지와 이형지, 접착제 때문에 재활용되지 않아 종량제봉투 배출한다고 안내하므로 기존 `shipping_label` 의미를 넓히지 않는다. review 상태는 `verified` 유지. |
| 2 | `receipt` | 영수증 | `verified` | 2026-07-02 보강 완료. 이전에는 법령 별표 근거만 있고, 품목사전의 영수증 직접 URL이 없었음 | [영수증, niIdx=730](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=730), 검색어 `영수증`, `감열지` | `src/data/waste-items.json`에 직접 URL과 basis를 추가했다. 품목사전은 감열지가 재활용 제품에 얼룩을 만들 수 있어 종량제봉투 배출한다고 안내하므로 기존 `receipt` 판단을 직접 뒷받침한다. review 상태는 `verified` 유지. |
| 3 | `shampoo_bottle` | 샴푸통 | `verified` | 2026-07-02 보강 완료. 이전에는 법령 + 환경부 보조 안내만 있고, 샴푸 용기 직접 품목사전 URL이 없었음 | [샴푸, niIdx=590](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=590), 검색어 `샴푸`, `샴푸통` | `src/data/waste-items.json`에 직접 URL과 basis를 추가했다. 품목사전은 내용물 비움, 라벨·펌프 제거, 용기 플라스틱 수거함 배출을 안내해 기존 `shampoo_bottle` 의미와 맞다. 다량의 내용물이 남아 제거하기 어려운 경우 종량제봉투 배출 조건도 함께 basis에 반영했다. review 상태는 `verified` 유지. |

이번 3개 보강에서는 새 품목, 별칭, 조건, 매칭 로직을 추가하지 않았다. 후보에서 제외한 항목은 다음 기준으로 보류했다. `cup_noodle_container`는 `종이 컵라면`(niIdx=406)이 확인되지만 당시에는 현재 item이 종이/스티로폼 용기와 오염 조건을 함께 다루므로 단일 종이 용기 근거만 바로 추가하면 기준이 좁아질 수 있다고 판단했다. 이후 2026-07-05 사용자 결정 후 공식 `종이 컵라면` 근거를 조건 보강으로 반영했다. `blanket`, `onion_peel`, `coffee_ground`는 각각 유사 침구류와 지역 음식물류 예외 기준이 얽혀 있어 단순 직접 URL 보강 후보로 보류한다. `medicine`은 이후 post-pizza 재감사에서 약 자체 하위 품목만 보강하는 후보로 재분류했고, 2026-07-02 보강에서 반영 완료했다.

## Post 3 Source Completion Rescan - 2026-07-02

| Priority | itemId | 품목 | 현재 review | 현재 source 약점 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pizza_box_oily` | 기름 묻은 피자박스 | `verified` | 2026-07-02 보강 완료. 이전에는 법령 별표 + 환경부 보조 안내만 있고, 피자박스 품목사전 상세 근거가 없었음 | [피자박스 검색 상세](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%ED%94%BC%EC%9E%90%EB%B0%95%EC%8A%A4), 검색어 `피자박스` | `src/data/waste-items.json`에 직접 URL과 basis를 추가했다. 품목사전은 깨끗한 피자박스는 종이류로 배출하고 이물질이 묻은 경우 종량제봉투로 배출한다고 안내하므로, 기존 `pizza_box_oily`의 오염 조건을 넓히지 않는다. review 상태는 `verified` 유지. |

이번 1개 보강에서는 새 품목, 별칭, 조건, 매칭 로직을 추가하지 않았다. `pet_pad`와 `moldy_bread`는 기계적 스캔에서 직접 `niIdx` URL이 없어 약한 후보처럼 보였지만, 이미 공식 상세 화면 URL과 `basis`가 저장되어 있어 추가 후보로 잡지 않았다. `cup_noodle_container`는 당시 `종이 컵라면` 근거만으로는 현재 `styrofoam_or_paper` item 전체를 충분히 뒷받침하지 못한다고 보고 보류했으나, 2026-07-05에 기존 item의 재질 조건 보강으로 반영했다. `coffee_capsule`은 공공 품목사전 단독 항목이 없고 제조사 회수 프로그램 의존도가 높아 단순 source 보강 후보가 아니다.

## Post Pizza Box Candidate Rescan - 2026-07-02

| Priority | itemId | 품목 | 현재 review | 현재 source 약점 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `medicine` | 폐의약품 | `region_review_needed` | 2026-07-02 보강 완료. 이전에는 품목사전 루트 URL과 지역 정보 URL만 있고, 실제 폐의약품 하위 품목의 직접 URL/basis가 없었음 | [알약, niIdx=147](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=147), [물약, niIdx=149](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=149), [한약, niIdx=148](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=148), [연고, niIdx=146](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=146), 검색어 `폐의약품`, `알약`, `물약`, `한약`, `연고` | `src/data/waste-items.json`에 약 자체 하위 품목의 직접 URL과 basis를 추가했다. 품목사전은 알약·물약·한약·연고를 폐의약품 수거함 배출로 안내하므로 기존 `medicine` 의미를 넓히지 않는다. `empty_medicine_bottle`, `pill_blister_packaging`은 별도 품목으로 유지한다. 수거함 위치와 우체통 가능 여부가 지역별로 달라 review 상태는 유지. |

이번 1개 보강에서는 새 품목, 별칭, 조건, 매칭 로직을 추가하지 않았다. `cup_noodle_container`는 공식 품목사전에서 `종이 컵라면` 직접 근거가 확인되지만, 당시에는 현재 item이 `styrofoam_or_paper` 재질을 함께 다루므로 종이 용기 근거만 바로 추가하면 item 범위를 좁게 뒷받침할 수 있다고 보고 `docs/data-decision-backlog.md`에 Open Decision으로 누적했다. 이후 2026-07-05 사용자 결정 후 기존 item의 조건/source 보강으로 반영 완료했다. `blanket`은 `이불` 직접 검색 결과가 없고 `침대커버`, `쿠션` 유사 항목만 확인되어 즉시 source 보강 후보에서 제외했다. `onion_peel`, `coffee_ground`는 품목사전 직접 검색 결과가 없어 지역 음식물류 예외 또는 별도 공공 근거 조사가 필요하다.

## Candidate Table

| Priority | itemId | 품목 | 현재 review | 현재 source 상태 | 공식 근거 후보 URL/검색어 | 추천 액션 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `chair` | 의자 | `region_review_needed` | `local_guidance` 1개, URL 없음 | [품목사전 검색 - 의자, niIdx=687](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=687), 검색어 `의자` | 대형폐기물 직접 근거와 보행 불편 주의/재활용센터 문구를 `sources`에 추가. 지역별 수수료 때문에 review 상태는 유지. |
| 2 | `mattress` | 매트리스 | `region_review_needed` | `local_guidance` 1개, URL 없음 | [품목사전 검색 - 매트리스, niIdx=183](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=183), 검색어 `매트리스` | 대형폐기물 직접 근거와 재활용 어려움/소각 설명을 `sources`에 추가. 지역별 수수료 때문에 review 상태는 유지. |
| 3 | `pet_bottle` | 페트병 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 무색페트병, niIdx=530](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=530), 검색어 `페트병`; 보조 후보 `음료 페트병` niIdx=123, `무색페트병(물병)` niIdx=122 | 직접 품목사전 근거를 추가하고, 무색 PET/유색 PET 분기 기준을 `basis`에 명확히 남김. 배출요일/분리배출 방식 때문에 review 상태는 유지. |
| 4 | `styrofoam` | 스티로폼 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 발포합성수지, niIdx=533](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=533), 검색어 `스티로폼` | 발포합성수지 직접 근거를 추가하고, 깨끗한 포장용기/전자제품 포장재 반납/테이프 제거 조건을 보강. 지역 수거함 기준 때문에 review 상태는 유지. |
| 5 | `milk_carton` | 우유팩 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 우유팩, niIdx=16](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=16), 검색어 `우유팩`; 보조 후보 `종이팩` niIdx=529, `뚜껑이 달린 우유팩` niIdx=18 | 종이팩 직접 근거를 추가하고, 일반팩/멸균팩 구분 없이 종이팩 수거함 우선이라는 기준을 `basis`에 반영. 지역 수거함 때문에 review 상태는 유지. |
| 6 | `butane_can` | 부탄가스 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 부탄가스, niIdx=78](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=78), 검색어 `부탄가스` | 직접 근거를 추가하고, 가스 완전 제거/환기 장소/금속캔 수거함 기준을 `spray_can`과 같은 안전 톤으로 맞춤. 지역 수거함 때문에 review 상태는 유지. |
| 7 | `used_cooking_oil` | 폐식용유 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 식용유, niIdx=178](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=178), 검색어 `폐식용유`, `식용유`; 보조 후보 `들기름` niIdx=640 | `폐식용유` 검색은 직접 결과가 없고 `식용유`가 대표 근거로 잡힘. 폐식용유 수거함 배출 기준과 수거함 위치 지역 확인을 함께 `basis`에 정리. |
| 8 | `battery` | 건전지 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 전지, niIdx=537](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=537), 검색어 `건전지`; 보조 후보 `AA 건전지` niIdx=124, `AAA건전지` niIdx=634, `CR 건전지` niIdx=635 | 대표 `전지`와 건전지 세부 후보를 추가해 폐건전지 수거함 기준을 명시. 정확한 수거함 위치 때문에 review 상태는 유지. |
| 9 | `mobile_phone` | 휴대폰 | `region_review_needed` | 법령 + 지역 안내, 품목사전 직접 URL 없음 | [품목사전 검색 - 핸드폰, niIdx=274](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=274), 검색어 `휴대폰`, `핸드폰` | 핸드폰 직접 근거를 추가하고, 소형전기전자제품 전용수거함/5개 이상 무상방문수거서비스/나눔폰 보조 설명을 정리. 지역 수거함 때문에 review 상태는 유지. |
| 10 | `fruit_seed` | 과일씨 | `region_review_needed` | 품목사전 루트 URL + 지역 안내, 직접 URL 없음 | [품목사전 검색 - 복숭아 씨, niIdx=455](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?niIdx=455), 검색어 `과일씨`, `복숭아씨`; 보조 후보 `아보카도씨` niIdx=753 | 직접 대표 근거를 추가해 단단한 씨앗은 분쇄시설 고장 우려로 종량제봉투 배출한다는 기준을 명확화. 음식물류 지역 예외 때문에 review 상태는 유지. |

## Not Selected But Observed

- `shoes`: 후속 Top item 감사에서 `구두` niIdx=152, `운동화` niIdx=153 품목사전 직접 URL과 `basis`를 반영했다. 두 품목 모두 상태가 좋은 신발류는 의류수거함, 해지거나 오염되어 재사용이 어려운 신발류는 종량제봉투 배출로 안내하며, 수거함 위치·수거 가능 상태는 지역/운영 주체별 확인이 필요해 `region_review_needed`를 유지했다.
- `medicine`: `폐의약품` 검색은 직접 항목보다 `알약`, `물약`, `한약`, `약통 용기`, `비닐약봉지` 등 세부 항목 후보가 많이 잡힌다. 포장재 계열은 이미 별도 품목/decision backlog와 연결되어 있고, 약 자체 계열은 post-pizza 재감사에서 `medicine`의 source 보강 후보로 재분류한 뒤 2026-07-02 보강에서 반영 완료했다.
- `coffee_ground`, `onion_peel`: 검색어 `커피찌꺼기`, `원두`, `양파껍질`은 직접 품목 결과가 확인되지 않았다. 보강하려면 공식 유사 근거나 지역 음식물류 예외 기준 중심의 별도 조사가 필요하다.

## Suggested Next Source Batch

1. `cat_litter`, `delivery_box`, `bubble_wrap`: 2026-07-02 1차 보강에서 직접 URL과 `basis`를 반영했다.
2. `mirror`, `clothing`: 2026-07-02 2차 보강에서 직접 URL과 `basis`를 반영했다.
3. 이번 재감사 후보 5개, `paper_cup`, `shipping_label`, `receipt`, `shampoo_bottle`, `pizza_box_oily`는 모두 반영 완료했다.
4. `medicine`은 2026-07-02 보강에서 약 자체 하위 품목 직접 URL과 `basis`를 반영했다.
5. 2026-07-05 사용자 결정분으로 `비닐약봉지`, `비닐장판`, `캔버스 액자`, `스탠드형 행거`, `cup_noodle_container` 조건 보강을 반영했다. 새 사용자 질문 로그나 자동 백로그 결과에서 추가 후보가 명확해지기 전까지는 억지 후보를 더 만들지 않는다.

## Follow-up Notes

- `cup_noodle_container`의 종이/스티로폼 컵라면 용기 모델링 결정은 2026-07-05 조건 보강으로 해소했다. 공식 `종이 컵라면` 근거는 깨끗한 경우 기타 종이류 배출을 안내하므로, 코팅·오염·재질 불명 조건은 일반쓰레기로 보수 안내한다.
- 이번 Source 반영 뒤 Answer Quality 트랙에서 비닐약봉지, 비닐장판, 캔버스 액자, 스탠드형 행거, 컵라면 재질 분기 smoke를 동기화해야 한다.
