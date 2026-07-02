# Region Policy Comparison

확인일: 2026-07-02

`src/data/region-policies.json`의 지역별 런타임 데이터를 비교하기 위한 문서다. 강남구 기준만으로는 답변이 한 지역에 과적합될 수 있어, 인접 생활권인 서초구와 송파구를 추가해 배출 요일, 불연성 봉투/특수마대, 음식물 예외, 소형가전·수거함 안내 차이를 검증한다.

## Covered Regions

| Region | Runtime ID | Status |
| --- | --- | --- |
| 서울 강남구 | `gangnam_gu` | 기존 기준 지역 |
| 서울 서초구 | `seocho_gu` | 2026-07-02 추가 |
| 서울 송파구 | `songpa_gu` | 2026-07-02 추가 |

## Comparison

| 항목 | 서울 강남구 | 서울 서초구 | 서울 송파구 |
| --- | --- | --- | --- |
| 일반쓰레기 | 월~금 20:00~익일 05:00, 내 집/점포 앞 | 동별 일·화·목 또는 월·수·금 18:00~익일 01:00, 토요일·공휴일 전날 배출 금지 | 일반주택은 동별 지정요일 표 확인, 음식물은 지정요일 18:00~22:00, 내 집 대문 앞 또는 지정 장소 |
| 재활용품 요일 | 목요일은 비닐·투명페트병만, 월·화·수·금·일은 기타 재활용품 | 폐비닐·투명페트병은 동별 목요일 또는 금요일, 기타 재활용품은 동별 일·화 또는 월·수 | 동별 표 확인. 투명페트병은 목요일 배출 동과 금요일 배출 동으로 나뉘고 아파트는 자체 배출일 |
| 불연성 봉투/특수마대 | PP봉투(태워서는 안 되는 쓰레기용 봉투) 예시 안내 | 유리조각·도자기 등 타지 않는 쓰레기는 특수마대, 구입처는 수거업체 문의 | 불에 타지 않는 쓰레기는 특수규격봉투(마대) 20L 기준, 배출 후 동별 청소대행업체 신고 |
| 음식물 예외 | 동물뼈, 조개껍데기, 한약재 찌꺼기, 달걀껍데기, 게 껍질, 밤·호두껍질, 핵과류 씨, 생선뼈, 파뿌리, 양파껍질, 티백 등 | 뿌리·껍질, 고추씨·고추대, 옥수수 껍질·옥수수대, 딱딱한 껍데기, 핵과류 씨, 육류 뼈, 패류·갑각류 껍데기, 생선뼈, 알껍데기, 차류·한약재 찌꺼기, 이물질 | 딱딱한 껍데기, 과일 씨, 육류 털·뼈, 패류·갑각류 껍데기, 티백, 한약재 찌꺼기, 마늘·양파껍질, 생선뼈, 파뿌리, 계란껍데기 |
| 음식물 배출 방식 | 전용 종량제봉투 또는 RFID 공동주택 | 전용봉투에 담아 수거용기, RFID 공동주택 상시 가능 | 일반주택 전용봉투+통합 전용용기, RFID, 소형음식점 납부필증 |
| 폐건전지·폐형광등 | 주민센터·주택가·아파트 수거함 | 아파트 단지 내 수거함, 일반주택은 동 주민센터·주택가 수거함 | 아파트 또는 동주민센터 수거함 |
| 폐의약품 | 강남구 자원순환 종합포털 위치정보 기준 | 동주민센터·구청 전용수거함 또는 서울시 우체통, 물약은 수거함 | 구청·주민센터·국민건강보험공단 민원실 수거함 또는 서울시 우체통 |
| 폐식용유 | 강남구 자원순환 종합포털 위치정보 기준 | 아파트 수거함 상시, 단독주택은 동 주민센터 상시 | 동주민센터 또는 공동주택 수거장소·전용수거함 |
| 의류수거함 | 강남구 자원순환 종합포털 위치정보 기준 | 옷체통 245개, 헌옷·신발 등 가능, 걸레·수건은 종량제봉투 | 단독·다가구·다세대·연립·상가는 의류수거함 매일 상시, 구내 위치 목록 제공 |
| 소형가전 | 1~4개 강남구 신청, 5개 이상 또는 대형가전 포함은 e순환거버넌스 | 아파트는 수집용 거치대, 일반주택은 재활용 배출일에 수거업체 유선 연락 | 폐소형가전 처리수수료 무료, 거주지 관할 청소대행업체 신고 후 배출 |

## Runtime Coverage

새로 추가한 서초구·송파구 `itemGuides`는 비교 목적에 맞춰 다음 품목군을 우선 포함한다.

- `pet_bottle`, `snack_bag`: 폐비닐·투명페트병 요일 차이
- `milk_carton`, `aseptic_pack`, `paper_cup`, `styrofoam`, `paper_core`: 기타 재활용품 요일 차이
- `plant_soil`, `broken_glass`, `flower_pot`: 불연성 봉투/특수마대 차이
- `chicken_bone`, `shellfish_shell`, `egg_shell`, `fruit_seed`, `onion_peel`, `nut_shell`, `corn_cob_husk`, `herbal_medicine_dregs`, `tea_bag`, `fish_bone`: 음식물 예외 비교. 서초구는 공식 분리배출 요령 기준으로 연결했고, 송파구는 확인한 본문 페이지에 직접 있는 품목만 연결했다. 강남구는 공식 본문과 첨부 PDF가 직접 뒷받침하는 `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`을 반영했으며, `corn_cob_husk`는 직접 근거가 없어 기존 보류 상태를 유지한다.
- `battery`, `fluorescent_lamp`, `led_lamp`, `medicine`, `used_cooking_oil`: 수거함·특수수거 안내
- `small_electronics`, `mobile_phone`, `electric_toothbrush`, `phone_charger_adapter`: 소형가전 배출 방식 차이
- `clothing`, `shoes`: 의류수거함 안내 차이

## Evaluation Case Coverage

`src/data/region-evaluation-cases.json`은 2026-07-02 기준 24개 케이스로, 3개 구의 투명페트병·재활용 요일, 수거함·특수수거, 불연성 봉투/특수마대, 음식물 예외, 소형가전, Top 대형폐기물 수수료 축을 고정한다.
24개 평가셋 위생 QA에서 중복 `region+query`와 stale 매칭은 없었고, 강남 `과일씨`·`생선뼈`·`티백`·`양파껍질` 케이스는 공식 첨부 PDF 기반 전용 itemGuide로 확인됐다. `corn_cob_husk`는 강남 직접 근거가 없어 평가 케이스로 고정하지 않고 보류한다.

## Bulky Waste Fee Data

| Region | Fee schedule status | Runtime behavior | Hold reason / next condition |
| --- | --- | --- | --- |
| 서울 강남구 | Top 일부 19행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 공식 수수료표 전체 import는 별도 스크립트와 itemId 매핑 기준이 필요 |
| 서울 서초구 | Top 일부 18행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 전체 표 import는 보류. 다음 확대는 사용자 질문 빈도나 Top 품목 추가 배치 기준으로 행 단위 수집 |
| 서울 송파구 | Top 일부 18행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 전체 표 import는 보류. 다음 확대는 사용자 질문 빈도나 Top 품목 추가 배치 기준으로 행 단위 수집 |

## Bulky Waste Top Fee Scope

| Region | Included rows | Source format | Explicitly excluded for now |
| --- | ---: | --- | --- |
| 서울 서초구 | 18 | 대형폐기물 배출안내 페이지의 부과기준표 PDF | 전체 표, 소파, 책상, 장롱, 침대틀, 가전, 여름용 이불, 파일캐비닛 등 미선정 행 |
| 서울 송파구 | 18 | 품목별수거기준 및 비용 HTML 표 | 전체 표, 소파, 책상, 장롱, 침대틀, 가전, 컬러박스, 전기담요, 유리·유모차 등 미선정 행 |

세 구 대형폐기물 수수료 itemId 커버리지는 [Region Fee Coverage - 2026-07-02](region-fee-coverage-2026-07-02.md)에 별도 정리했다. 현재 coverage 후보 10개 itemId는 모두 3개 구에 있고, 직전 후보 4개는 보류 없이 반영했다. 다음 수수료 확장 후보 감사에서는 5개 후보를 검토했지만, 서초 수수료 행 확인 또는 itemId 모델링 결정이 필요해 바로 입력 가능한 3~5개 안전 후보 묶음은 아직 없다.

세 구 음식물류 예외 교차 검증은 [Region Food Exception Review - 2026-07-02](region-food-exception-review-2026-07-02.md)에 별도 정리했다. 강남구 `한약재 찌꺼기` 누락과 서초구 공식 분리배출 요령 출처 누락을 보정했고, 후속 데이터 보정에서 강남구 공식 첨부가 직접 뒷받침하는 `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`을 반영했다.

## Source URL Availability QA

2026-07-02 URL QA에서 `src/data/region-policies.json`과 이 문서, [Gangnam Region Policy](gangnam-region-policy.md), [Region Fee Coverage](region-fee-coverage-2026-07-02.md)가 참조하는 지역 공식 URL을 GET 기준으로 확인했다. 확인한 공식 URL은 모두 HTTP 200으로 접근 가능했고, 제목 또는 본문 핵심 문구가 현재 문서의 정책 축과 일치했다. 명백히 깨진 공식 URL은 없어 정책 데이터 URL은 변경하지 않았다.

| Region | Checked URL count | Result | Notes |
| --- | ---: | --- | --- |
| 서울 강남구 | 5 | 접근 가능 | 강남구청 쓰레기배출안내, 자원순환 종합포털, 대형생활폐기물 안내, 대형생활폐기물 신청, 소형폐가전 무상수거 안내가 모두 접근 가능하다. 포털 메뉴의 배출 신청 링크 `USEBIWA02030000.do`는 최종적으로 기존 문서의 휴대폰 인증 화면 `USEBIWA02010000.do`로 이동하므로 기존 신청 URL을 유지한다. |
| 서울 서초구 | 10 | 접근 가능 | 쓰레기 배출안내, 대형폐기물 배출안내, 재활용분리배출요령, 음식물쓰레기, 폐가전/폐휴대폰, 폐형광등/폐건전지, 폐의약품, 폐식용유, 옷체통 안내가 모두 현재 페이지 제목과 일치한다. |
| 서울 송파구 | 9 | 접근 가능 | 쓰레기 배출, 특수규격봉투 판매소, 음식물쓰레기, 재활용품, 폐가전 무상수거, 의류수거함, 폐기물배출안내, 품목별수거기준 및 비용이 모두 현재 페이지 제목과 일치한다. |

## Current Region Queue

2026-07-02 현재 Region 데이터는 `gangnam_gu`, `seocho_gu`, `songpa_gu` 3개 지역, 지역 평가 케이스 24개, 대형폐기물 수수료 coverage itemId 10개와 수수료 행 강남 19/서초 18/송파 18 상태로 맞춰져 있다. 음식물 예외 QA, 기존 공식 URL 24개 가용성 QA, 강남 공식 첨부 PDF 직접 근거 확인도 반영됐다. 즉시 추가할 새 지역·수수료 큐는 없고, 다음 데이터 입력은 `docs/data-decision-backlog.md`의 Open Decisions 중 지역/수수료 모델링 결정이 풀린 뒤 진행한다.

## Notes

- `src/data/bulky-waste-fees.json`은 강남구 전체 수수료표가 아니라 Top 일부 행만 구조화한 상태였고, 서초구·송파구도 같은 방식으로 Top 일부만 우선 추가했다.
- 서초구·송파구 수수료는 지역별 공식 표의 표현을 보존하되, 기존 런타임 itemId에 맞춰 `chair`, `mattress`, `blanket`, `mirror`, `plastic_storage_box`, `yoga_mat`, `drying_rack`, `flower_pot`, `toy`, `stuffed_toy`에 연결한다.
- 송파구 일반주택 요일표는 동별로 열이 갈리는 구조라, 런타임 답변에서는 정확한 동명을 알기 전까지 “동별 표 확인”으로 안내한다.
- 음식물 예외는 각 지자체의 직접 문구가 있는 품목만 지역 itemGuide에 연결한다. 강남구 후속 첨부 감사에서 공식 `쓰레기줄이기 분리배출 안내.pdf`가 `핵과류 씨(복숭아 씨 등)`, `생선뼈`, `티백`, `양파껍질`을 직접 뒷받침함을 확인해 런타임 데이터에 반영했다. `옥수수대·옥수수껍질`은 강남 공식 페이지·자원순환 포털·확인한 첨부에서 직접 문구를 찾지 못해 계속 보류한다.

## Source Pages

- 강남구청 쓰레기배출안내: https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109
- 강남구청 쓰레기줄이기 분리배출 안내 PDF: https://www.gangnam.go.kr/file/10/get/8f726ace-f0ee-4408-99f7-c798d5089f66/download.do
- 강남구 자원순환 종합포털: https://clean.gangnam.go.kr/
- 강남구 자원순환 종합포털 대형생활폐기물 안내: https://clean.gangnam.go.kr/use/biwa/USEBIWA01000000.do
- 강남구 자원순환 종합포털 대형생활폐기물 신청: https://clean.gangnam.go.kr/use/biwa/USEBIWA02010000.do
- 서초구청 쓰레기 배출안내: https://www.seocho.go.kr/site/seocho/04/10411010600002018030711.jsp
- 서초구청 대형폐기물 배출안내: https://www.seocho.go.kr/site/seocho/01/10103070301002018030701.jsp
- 서초구청 재활용분리배출요령: https://www.seocho.go.kr/site/seocho/04/10408030301002015070706.jsp
- 서초구청 음식물쓰레기(가정): https://www.seocho.go.kr/site/seocho/04/10408030201002015070706.jsp
- 서초구청 음식물쓰레기 분리배출 요령: https://www.seocho.go.kr/site/seocho/04/10413030600002020072410.jsp
- 서초구청 폐가전/폐휴대폰 배출안내: https://www.seocho.go.kr/site/seocho/04/10408030305002015070706.jsp
- 서초구청 폐형광등/폐건전지 배출안내: https://www.seocho.go.kr/site/seocho/04/10408040311002016011501.jsp
- 서초구청 폐의약품 분리배출 안내: https://www.seocho.go.kr/site/seocho/04/10414020800002023100603.jsp
- 서초구청 폐식용유 배출안내: https://www.seocho.go.kr/site/seocho/04/10408030309002015070706.jsp
- 서초구청 옷체통 안내: https://www.seocho.go.kr/site/seocho/04/10413041300002020041010.jsp
- 송파구청 쓰레기 배출: https://www.songpa.go.kr/www/contents.do?key=3153
- 송파구청 특수규격봉투(마대) 판매소: https://www.songpa.go.kr/www/contents.do?key=5932
- 송파구청 음식물쓰레기 배출요령/수수료: https://www.songpa.go.kr/www/contents.do?key=3161
- 송파구청 재활용품 분리배출 방법: https://www.songpa.go.kr/www/contents.do?key=3164
- 송파구청 재활용품 분리수거함 안내: https://www.songpa.go.kr/www/contents.do?key=3165
- 송파구청 폐소형·대형 가전제품 무상수거: https://www.songpa.go.kr/www/contents.do?key=3171
- 송파구청 재활용 의류배출(의류수거함): https://www.songpa.go.kr/www/tourListMain.do?key=5915&resrceClssCd=LV0287
- 송파구청 폐기물배출안내: https://www.songpa.go.kr/www/contents.do?key=2117
- 송파구청 품목별수거기준 및 비용: https://www.songpa.go.kr/www/exhaustPrdlstList.do?key=2118&rep=1
