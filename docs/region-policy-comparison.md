# Region Policy Comparison

확인일: 2026-07-05

`src/data/region-policies.json`의 지역별 런타임 데이터를 비교하기 위한 문서다. 강남구 기준만으로는 답변이 한 지역에 과적합될 수 있어, 인접 생활권인 서초구와 송파구를 추가했고, 2026-07-03에는 공식 마포구청 출처로 확인 가능한 범위에서 마포구를 4번째 지역으로 추가했다. 2026-07-05에는 사용자 결정에 따라 부산 해운대구보다 경기도 성남시/판교를 먼저 검토했고, 공식 성남시 출처로 확인 가능한 기본 정책만 `seongnam_si`로 1차 반영했다.

## Covered Regions

2026-08-14 Phase 5에서 티어를 나눴다. 아래 비교표는 배출 요일까지 확인한 `full` 티어 5곳만 다룬다. `standard` 13곳과 `metro` 17곳은 담는 항목이 달라 같은 표로 비교하지 않는다.

| Region | Runtime ID | Tier | Status |
| --- | --- | --- | --- |
| 서울 강남구 | `gangnam_gu` | full | 기존 기준 지역 |
| 서울 서초구 | `seocho_gu` | full | 2026-07-02 추가 |
| 서울 송파구 | `songpa_gu` | full | 2026-07-02 추가 |
| 서울 마포구 | `mapo_gu` | full | 2026-07-03 추가 |
| 경기도 성남시 | `seongnam_si` | full | 2026-07-05 추가, 판교는 alias만 |

### Standard tier (2026-08-14 추가)

대형폐기물 인터넷 신청·수수료 조회 URL, 담당 직통번호, 폐의약품·폐건전지 수거함 안내까지 전부 확인된 서울 자치구 21곳이다. 배출 요일·시간은 담지 않는다.

`jongno_gu`, `yongsan_gu`, `gwangjin_gu`, `gangbuk_gu`, `dobong_gu`, `nowon_gu`, `eunpyeong_gu`, `gangseo_gu`, `geumcheon_gu`, `yeongdeungpo_gu`, `dongjak_gu`, `gwanak_gu`, `gangdong_gu`

2026-08-16에 여덟 곳을 더했다 — `jung_gu`, `seongdong_gu`, `dongdaemun_gu`, `jungnang_gu`, `seongbuk_gu`, `seodaemun_gu`, `yangcheon_gu`, `guro_gu`. **이로써 서울 25개 구가 full 4곳 + standard 21곳으로 모두 채워졌다.**

중구와 동대문구는 구 자체 신청 폼이 없어 `applicationUrl`이 구청 대형폐기물 안내 페이지를 가리키고, 수수료는 구 폐기물 관리 조례 별표(`law.go.kr`)를 건다. 두 곳만 다른 지역과 성격이 다르니 링크 점검 때 눈여겨본다. 근거와 결정은 [data-decision-backlog.md](data-decision-backlog.md)에 있다.

### Metro tier (2026-08-14 추가)

자치구 데이터가 없을 때 착지하는 광역시도 17곳이다. 대형폐기물 접수가 기초자치단체 소관이라 전화번호와 신청 URL을 두지 않고, 응답에서 시·군·구 확인이 더 필요하다는 사실을 밝힌다.

`seoul`, `busan`, `daegu`, `incheon`, `gwangju`, `daejeon`, `ulsan`, `sejong`, `gyeonggi`, `gangwon`, `chungbuk`, `chungnam`, `jeonbuk`, `jeonnam`, `gyeongbuk`, `gyeongnam`, `jeju`

조사 중 확인된 사항으로, 광주광역시와 전라남도 누리집 기관명이 각각 `전남광주통합특별시(구)광주광역시`, `전남광주통합특별시(구)전라남도청`으로 바뀌어 있다. 사용자가 부르는 이름은 그대로라 `name`은 기존 명칭을 유지하고, 통합 사실은 각 지역 `summary`에 적었다.

## Comparison

| 항목 | 서울 강남구 | 서울 서초구 | 서울 송파구 | 서울 마포구 | 경기도 성남시 |
| --- | --- | --- | --- | --- | --- |
| 일반쓰레기 | 월~금 20:00~익일 05:00, 내 집/점포 앞 | 동별 일·화·목 또는 월·수·금 18:00~익일 01:00, 토요일·공휴일 전날 배출 금지 | 일반주택은 동별 지정요일 표 확인, 음식물은 지정요일 18:00~22:00, 내 집 대문 앞 또는 지정 장소 | 일·월·화·수·목 계절별 18:00 또는 19:00~24:00, 내 집/점포 앞 또는 건물 옆 | 수거 전날 일몰 후~익일 05:00, 월~금 정상수거, 토요일 부분수거, 일요일·공휴일 미수거 |
| 재활용품 요일 | 목요일은 비닐·투명페트병만, 월·화·수·금·일은 기타 재활용품 | 폐비닐·투명페트병은 동별 목요일 또는 금요일, 기타 재활용품은 동별 일·화 또는 월·수 | 동별 표 확인. 투명페트병은 목요일 배출 동과 금요일 배출 동으로 나뉘고 아파트는 자체 배출일 | 투명페트병·비닐류는 수요일, 그 외 재활용품은 일·월·화·목요일 | 요일 분리보다 품목별 분리배출 기준 중심, 투명페트병은 전용수거함 별도 배출 |
| 불연성 봉투/특수마대 | PP봉투(태워서는 안 되는 쓰레기용 봉투) 예시 안내 | 유리조각·도자기 등 타지 않는 쓰레기는 특수마대, 구입처는 수거업체 문의 | 불에 타지 않는 쓰레기는 특수규격봉투(마대) 20L 기준, 배출 후 동별 청소대행업체 신고 | 집수리 잔재물, 깨진 유리, 페인트통, 벽돌, 흙 등은 특수규격봉투(PP포대)와 수거업체 신고 기준 | 깨진 유리·형광등·도자기류, 화분 등은 불연성마대 배출 |
| 음식물 예외 | 동물뼈, 조개껍데기, 한약재 찌꺼기, 달걀껍데기, 게 껍질, 밤·호두껍질, 핵과류 씨, 생선뼈, 파뿌리, 양파껍질, 티백 등 | 뿌리·껍질, 고추씨·고추대, 옥수수 껍질·옥수수대, 딱딱한 껍데기, 핵과류 씨, 육류 뼈, 패류·갑각류 껍데기, 생선뼈, 알껍데기, 차류·한약재 찌꺼기, 이물질 | 딱딱한 껍데기, 과일 씨, 육류 털·뼈, 패류·갑각류 껍데기, 티백, 한약재 찌꺼기, 마늘·양파껍질, 생선뼈, 파뿌리, 계란껍데기 | 양파·마늘·옥수수 껍질과 옥수수대, 딱딱한 껍데기, 핵과류 씨, 육류 뼈다귀, 패류 껍데기, 차류·한약재 찌꺼기 등 | 패각류, 양파·마늘·옥수수껍질, 알껍질, 핵과류 씨앗, 육류·생선뼈, 단단한 껍데기, 차류 찌꺼기 |
| 음식물 배출 방식 | 전용 종량제봉투 또는 RFID 공동주택 | 전용봉투에 담아 수거용기, RFID 공동주택 상시 가능 | 일반주택 전용봉투+통합 전용용기, RFID, 소형음식점 납부필증 | 단독주택은 음식쓰레기 종량제봉투+문전수거통, 공동주택은 RFID 개별종량기 | 물기 제거 후 전용봉투 또는 수거용기, 판교 택지개발지구 자동크린넷은 별도 하위 정책으로 미모델링 |
| 폐건전지·폐형광등 | 주민센터·주택가·아파트 수거함 | 아파트 단지 내 수거함, 일반주택은 동 주민센터·주택가 수거함 | 아파트 또는 동주민센터 수거함 | 동별 폐형광등·폐건전지 수거함 배치 현황에서 주소·상세 위치 확인 | 폐건전지는 동 행정복지센터·학교 등 수거함, 폐형광등은 공동주택·동 행정복지센터 등 전용 수거함 |
| 폐의약품 | 강남구 자원순환 종합포털 위치정보 기준 | 동주민센터·구청 전용수거함 또는 서울시 우체통, 물약은 수거함 | 구청·주민센터·국민건강보험공단 민원실 수거함 또는 서울시 우체통 | 1차 확인 범위에서 전용 위치 미구조화, 마포구청·동주민센터 최신 안내 확인 | 1차 확인 범위에서 전용 위치 미구조화, 성남시·동 행정복지센터 최신 안내 확인 |
| 폐식용유 | 강남구 자원순환 종합포털 위치정보 기준 | 아파트 수거함 상시, 단독주택은 동 주민센터 상시 | 동주민센터 또는 공동주택 수거장소·전용수거함 | 1차 확인 범위에서 전용 위치 미구조화, 공동주택 수거장소 또는 자원순환과 확인 | 1차 확인 범위에서 전용 위치 미구조화, 공동주택 수거장소 또는 자원순환과 확인 |
| 의류수거함 | 강남구 자원순환 종합포털 위치정보 기준 | 옷체통 245개, 헌옷·신발 등 가능, 걸레·수건은 종량제봉투 | 단독·다가구·다세대·연립·상가는 의류수거함 매일 상시, 구내 위치 목록 제공 | 동별 의류수거함 배치 현황에서 주소·상세 위치 확인 | 의류 등은 젖지 않도록 투명비닐 배출, 수거함 위치는 1차 범위에서 미구조화 |
| 소형가전 | 1~4개 강남구 신청, 5개 이상 또는 대형가전 포함은 e순환거버넌스 | 아파트는 수집용 거치대, 일반주택은 재활용 배출일에 수거업체 유선 연락 | 폐소형가전 처리수수료 무료, 거주지 관할 청소대행업체 신고 후 배출 | 대형폐가전 무료 방문수거는 확인, 소형폐가전 전용 마포구 방식은 1차 범위에서 미구조화 | 대형가전 또는 소형가전 5품목 이상은 폐가전 무상방문수거 1599-0903 대상 여부 확인 |

## Runtime Coverage

서초구·송파구·마포구·성남시 `itemGuides`는 비교 목적에 맞춰 다음 품목군을 우선 포함한다.

- `pet_bottle`, `snack_bag`: 폐비닐·투명페트병 요일 차이. 마포구는 두 품목 모두 수요일 배출로 고정하고, 성남시는 요일보다 품목별 분리배출 기준과 투명페트병 전용수거함 별도 배출을 고정한다.
- `milk_carton`, `aseptic_pack`, `paper_cup`, `styrofoam`, `paper_core`: 기타 재활용품 요일·분리배출 차이. 마포구는 일·월·화·목요일 배출로 고정하고, 성남시는 비우기·헹구기·분리 후 품목별 배출 원칙을 고정한다.
- `plant_soil`, `broken_glass`, `flower_pot`: 불연성 봉투/특수마대 차이. 마포구는 직접 확인된 `plant_soil`, `broken_glass`만 특수규격봉투(PP포대) 안내에 연결했고, 성남시는 직접 확인된 `broken_glass`, `flower_pot`을 불연성마대 안내에 연결했다.
- `chicken_bone`, `shellfish_shell`, `egg_shell`, `fruit_seed`, `onion_peel`, `nut_shell`, `corn_cob_husk`, `herbal_medicine_dregs`, `tea_bag`, `fish_bone`: 음식물 예외 비교. 서초구는 공식 분리배출 요령 기준으로 연결했고, 송파구는 확인한 본문 페이지에 직접 있는 품목만 연결했다. 강남구는 공식 본문과 첨부 PDF가 직접 뒷받침하는 `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`을 반영했으며, `corn_cob_husk`는 직접 근거가 없어 기존 보류 상태를 유지한다. 마포구는 공식 본문에 직접 있는 옥수수 껍질·옥수수대, 딱딱한 껍데기, 핵과류 씨, 육류 뼈다귀, 패류 껍데기, 차류·한약재 찌꺼기 중심으로 연결했고, 일반 생선뼈·달걀껍데기는 직접 문구 범위가 좁거나 없어 보류했다. 성남시는 공식 음식물 안내에 직접 있는 알껍질류, 핵과류 씨앗, 육류·생선뼈, 단단한 껍데기, 양파·마늘·옥수수껍질 중심으로 연결했고, `corn_cob_husk`는 현재 itemId가 옥수수대까지 포괄해 직접 연결하지 않았다.
- `battery`, `fluorescent_lamp`, `led_lamp`, `medicine`, `used_cooking_oil`: 수거함·특수수거 안내. 성남시는 `battery`, `fluorescent_lamp`만 전용 수거함 문구가 직접 확인되어 연결했다.
- `small_electronics`, `mobile_phone`, `electric_toothbrush`, `phone_charger_adapter`: 소형가전 배출 방식 차이. 성남시는 대형가전 또는 소형가전 5품목 이상 폐가전 무상방문수거 기준을 연결했다.
- `clothing`, `shoes`: 의류수거함·의류 배출 안내 차이. 성남시는 수거함 위치가 아니라 젖지 않도록 투명비닐 배출하는 기본 안내만 연결했다.

## Evaluation Case Coverage

`src/data/region-evaluation-cases.json`은 2026-07-05 기준 35개 케이스로, 5개 지역의 투명페트병·재활용 요일/분리배출, 수거함·특수수거, 불연성 봉투/특수마대, 음식물 예외, 소형가전, Top 대형폐기물 수수료 축을 고정한다.
마포구 추가분은 투명페트병 수요일 배출, 기타 재활용품 일·월·화·목요일 배출, 폐건전지 수거함 배치 현황, 옥수수대 음식물 예외와 `drying_rack`/`flower_pot` 수수료 2차 반영분을 고정한다. 성남시 추가분은 투명페트병 전용수거함, 판교 alias 폐건전지 수거함, 양파껍질 음식물 예외, 대형폐기물 전화·인터넷·모바일 신고 방식을 고정한다. 기존 24개 평가셋 위생 QA에서 중복 `region+query`와 stale 매칭은 없었고, 강남 `과일씨`·`생선뼈`·`티백`·`양파껍질` 케이스는 공식 첨부 PDF 기반 전용 itemGuide로 확인됐다. `corn_cob_husk`는 강남 직접 근거가 없어 평가 케이스로 고정하지 않고 보류한다.

## Bulky Waste Fee Data

| Region | Fee schedule status | Runtime behavior | Hold reason / next condition |
| --- | --- | --- | --- |
| 서울 강남구 | Top 일부 19행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 공식 수수료표 전체 import는 별도 스크립트와 itemId 매핑 기준이 필요 |
| 서울 서초구 | Top 일부 18행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 전체 표 import는 보류. 다음 확대는 사용자 질문 빈도나 Top 품목 추가 배치 기준으로 행 단위 수집 |
| 서울 송파구 | Top 일부 18행 구조화 | 지역 ID로 연결해 coverage 후보 10개 itemId 안내에 수수료 후보를 붙임 | 전체 표 import는 보류. 다음 확대는 사용자 질문 빈도나 Top 품목 추가 배치 기준으로 행 단위 수집 |
| 서울 마포구 | Top 일부 14행 구조화 | 지역 ID로 연결해 coverage 후보 중 7개 itemId 안내에 수수료 후보를 붙임 | 전체 표와 남은 coverage 3개 itemId는 보류 |
| 경기도 성남시 | 신규 구조화 없음 | 지역 정책은 대형폐기물 신청 방식만 안내하고 수수료 후보는 붙이지 않음 | 2026-07-05 결정으로 중단했으나 2026-08-15 재개 — 성남시는 Phase 6 대상 10곳에 포함된다 |

## Bulky Waste Top Fee Scope

| Region | Included rows | Source format | Explicitly excluded for now |
| --- | ---: | --- | --- |
| 서울 서초구 | 18 | 대형폐기물 배출안내 페이지의 부과기준표 PDF | 전체 표, 소파, 책상, 장롱, 침대틀, 가전, 여름용 이불, 파일캐비닛 등 미선정 행 |
| 서울 송파구 | 18 | 품목별수거기준 및 비용 HTML 표 | 전체 표, 소파, 책상, 장롱, 침대틀, 가전, 컬러박스, 전기담요, 유리·유모차 등 미선정 행 |
| 서울 마포구 | 14 | 대형폐기물배출안내 HTML 표 | 전체 표, 남은 coverage 3개 itemId(`plastic_storage_box`, `toy`, `stuffed_toy`), 유아용 의자·놀이매트 등 미선정 행 |

강남·서초·송파 3개 구 대형폐기물 수수료 itemId 커버리지는 [Region Fee Coverage - 2026-07-02](region-fee-coverage-2026-07-02.md)에 별도 정리했다. 마포구 수수료 일부 구조화 결과는 [Region Fee Coverage - 2026-07-03](region-fee-coverage-2026-07-03.md)에 별도 정리했다. 현재 기존 3개 구는 coverage 후보 10개 itemId를 모두 갖고, 마포구는 `chair`, `mattress`, `blanket`, `mirror`, `yoga_mat`, `drying_rack`, `flower_pot` 7개 itemId를 갖는다. `plastic_storage_box`, `toy`, `stuffed_toy`는 마포구 공식 표의 넓은 행 또는 결합 행 매핑 리스크로 보류한다. 성남시는 공식 대형폐기물 신청 안내만 지역 정책에 연결했고, 신규 금액 수수료 행은 추가하지 않았다.

기존 세 구 음식물류 예외 교차 검증은 [Region Food Exception Review - 2026-07-02](region-food-exception-review-2026-07-02.md)에 별도 정리했다. 강남구 `한약재 찌꺼기` 누락과 서초구 공식 분리배출 요령 출처 누락을 보정했고, 후속 데이터 보정에서 강남구 공식 첨부가 직접 뒷받침하는 `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel`을 반영했다. 마포구 음식물 예외 1차 반영 범위는 [Region Gap Research - 2026-07-03](region-gap-research-2026-07-03.md)에, 성남시/판교 1차 반영 범위는 [Region Gap Research - 2026-07-05](region-gap-research-2026-07-05.md)에 정리했다.

## Source URL Availability QA

2026-07-02 URL QA에서 기존 3개 구의 지역 공식 URL을 GET 기준으로 확인했다. 2026-07-03 마포구 1차 추가 때도 마포구청 공식 URL 5개가 접근 가능하고 본문 핵심 문구가 현재 문서의 정책 축과 일치함을 확인했다. 2026-07-05 성남시/판교 1차 추가 때는 성남시 자원순환 통합 플랫폼 SPA 경로 4개와 성남시 대형폐기물 인터넷 배출신고 신청안내 1개가 접근 가능하고, 플랫폼 번들의 현재 본문 문구가 데이터 축과 일치함을 확인했다. 명백히 깨진 공식 URL은 없어 기존 정책 데이터 URL은 변경하지 않았다.

| Region | Checked URL count | Result | Notes |
| --- | ---: | --- | --- |
| 서울 강남구 | 5 | 접근 가능 | 강남구청 쓰레기배출안내, 자원순환 종합포털, 대형생활폐기물 안내, 대형생활폐기물 신청, 소형폐가전 무상수거 안내가 모두 접근 가능하다. 포털 메뉴의 배출 신청 링크 `USEBIWA02030000.do`는 최종적으로 기존 문서의 휴대폰 인증 화면 `USEBIWA02010000.do`로 이동하므로 기존 신청 URL을 유지한다. |
| 서울 서초구 | 10 | 접근 가능 | 쓰레기 배출안내, 대형폐기물 배출안내, 재활용분리배출요령, 음식물쓰레기, 폐가전/폐휴대폰, 폐형광등/폐건전지, 폐의약품, 폐식용유, 옷체통 안내가 모두 현재 페이지 제목과 일치한다. |
| 서울 송파구 | 9 | 접근 가능 | 쓰레기 배출, 특수규격봉투 판매소, 음식물쓰레기, 재활용품, 폐가전 무상수거, 의류수거함, 폐기물배출안내, 품목별수거기준 및 비용이 모두 현재 페이지 제목과 일치한다. |
| 서울 마포구 | 5 | 접근 가능 | 쓰레기배출안내, 대형폐기물배출안내, 의류수거함 배치 현황, 폐형광등·폐건전지 수거함 배치 현황, 투명페트병 무인회수기 설치 현황이 모두 현재 페이지 제목과 본문 핵심 문구와 일치한다. |
| 경기도 성남시 | 5 | 접근 가능 | 성남시 자원순환 통합 플랫폼의 생활 쓰레기, 재활용품, 종량제봉투, 음식물쓰레기 안내 SPA 경로와 성남시 대형폐기물 인터넷 배출신고 신청안내가 접근 가능하다. |

## Current Region Queue

2026-07-05 현재 Region 데이터는 `gangnam_gu`, `seocho_gu`, `songpa_gu`, `mapo_gu`, `seongnam_si` 5개 지역, 지역 평가 케이스 35개다. 기존 3개 구의 대형폐기물 수수료 coverage itemId 10개와 수수료 행 강남 19/서초 18/송파 18 상태는 유지했고, 마포구는 Top 일부 14행(`chair`, `mattress`, `blanket`, `mirror`, `yoga_mat`, `drying_rack`, `flower_pot`)을 추가했다. 성남시는 공식 출처로 확인 가능한 생활폐기물, 재활용품, 음식물류, 폐형광등·폐건전지, 대형폐기물 신청 방식까지만 반영했고, 대형폐기물 수수료 금액은 신규 구조화하지 않았다.

## Notes

- `src/data/bulky-waste-fees.json`은 강남구 전체 수수료표가 아니라 Top 일부 행만 구조화한 상태였고, 서초구·송파구도 같은 방식으로 Top 일부만 우선 추가했다.
- 서초구·송파구 수수료는 지역별 공식 표의 표현을 보존하되, 기존 런타임 itemId에 맞춰 `chair`, `mattress`, `blanket`, `mirror`, `plastic_storage_box`, `yoga_mat`, `drying_rack`, `flower_pot`, `toy`, `stuffed_toy`에 연결한다.
- 마포구는 대형생활폐기물 수수료표 전체가 아니라 기존 coverage 후보 중 7개 itemId만 우선 입력했다. 남은 3개 coverage itemId는 공식 행 매핑 리스크가 풀릴 때 검토한다.
- 성남시는 대형생활폐기물 신청 방식만 지역 정책에 연결했다. 2026-07-05 사용자 결정에 따라 성남시 대형폐기물 수수료 금액은 새로 구조화하지 않는다.
- 성남시/판교는 `seongnam_si` 단일 정책으로 처리한다. 판교 택지개발지구 자동크린넷 문구는 조사 문서에 남겼지만, 동 단위·건물유형별 정책은 모델링하지 않는다.
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
- 마포구청 쓰레기배출안내: https://www.mapo.go.kr/site/main/content/mapo05060501
- 마포구청 대형폐기물배출안내: https://www.mapo.go.kr/site/main/content/mapo05060502
- 마포구청 의류수거함 배치 현황: https://www.mapo.go.kr/site/main/content/mapo05060505
- 마포구청 폐형광등·폐건전지 수거함 배치 현황: https://www.mapo.go.kr/site/main/content/mapo05060507
- 마포구청 투명페트병 무인회수기 설치 현황: https://www.mapo.go.kr/site/main/content/mapo05060508
- 성남시 자원순환 통합 플랫폼 생활 쓰레기 분리배출 안내: https://recycle.seongnam.go.kr/platforminfo/trash
- 성남시 자원순환 통합 플랫폼 재활용품 분리배출 안내: https://recycle.seongnam.go.kr/platforminfo/recycle/method
- 성남시 자원순환 통합 플랫폼 종량제봉투 이용 안내: https://recycle.seongnam.go.kr/platforminfo/garbagebag
- 성남시 자원순환 통합 플랫폼 음식물쓰레기 분리배출 안내: https://recycle.seongnam.go.kr/platforminfo/foodwaste
- 성남시 대형폐기물 인터넷 배출신고 신청안내: https://waste.isdc.co.kr/contents/content.php?cIdx=3
