# Region Fee Coverage - 2026-07-02

현재 `src/data/bulky-waste-fees.json`에 구조화된 서울 강남구, 서초구, 송파구 대형폐기물 수수료 커버리지를 `docs/top-50-items.md`의 Top 50 및 사용자 질문 확장 품목과 대조한 문서다.

초기 분석 문서 작성 뒤 같은 날 후속 수집에서 `drying_rack`, `flower_pot`, `toy`, `stuffed_toy` 4개 후보를 공식 수수료표 기준으로 추가했다.

2026-07-03 마포구 수수료 일부 구조화 결과는 [Region Fee Coverage - 2026-07-03](region-fee-coverage-2026-07-03.md)에 별도 정리했다. 이 문서의 세부 표는 2026-07-02 기준 강남·서초·송파 3개 구 coverage를 보존한다.

## Scope

커버리지 표의 모수는 Top 50과 사용자 질문 확장 품목 중 "지역별 대형폐기물 수수료 후보로 연결될 가능성이 높은 itemId"로 한정했다.

- Top 50 직접 대형폐기물 후보: `mirror`, `chair`, `mattress`, `blanket`
- 사용자 질문 확장 중 현재 수수료가 구조화된 후보: `plastic_storage_box`, `yoga_mat`, `drying_rack`, `flower_pot`, `toy`, `stuffed_toy`
- 이번 coverage 후보 10개는 모두 3개 구에 구조화됐다.

아래 품목은 이번 대형폐기물 수수료 coverage count에서 제외했다.

- `small_electronics`, `mobile_phone`: 3개 구 모두 무상수거/소형가전 수거 안내 성격이 강하며, 수수료표 연결보다 수거 방식 안내가 우선이다.
- `clothing`, `shoes`: 의류수거함/상태별 일반쓰레기 안내 성격이 강하다.
- `ice_pack`: 전용수거함 또는 종량제봉투 안내 성격이며 대형폐기물 수수료 후보가 아니다.
- `plant_soil`, `broken_glass`, `flower_pot`의 작은 파편/흙 분기: 불연성 봉투/특수마대 안내 성격이 강하다. 단, `flower_pot`의 대형화분 분기는 다음 수수료 후보에 포함했다.

## Region Summary

| Region | Runtime ID | Structured fee rows | Structured itemIds |
| --- | --- | ---: | --- |
| 서울 강남구 | `gangnam_gu` | 19 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 서울 서초구 | `seocho_gu` | 18 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 서울 송파구 | `songpa_gu` | 18 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |

현재 구조화된 10개 coverage itemId는 세 구 모두에 존재한다. 일부 구에만 있는 itemId나 아직 없는 itemId는 없다.

## Coverage Counts

| Coverage group | Count | ItemIds |
| --- | ---: | --- |
| 모든 구에 이미 있음 | 10 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 일부 구만 있음 | 0 | - |
| 아직 없음 | 0 | - |

## Item Coverage

| Source bucket | ItemId | Label | Coverage | 강남구 | 서초구 | 송파구 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Top 50 | `mirror` | 거울 | 모든 구 | 1행, 2,000원 | 2행, 3,000~5,000원 | 2행, 1,000~2,000원 | Top 50 `거울`; 큰 거울/판유리 수수료 후보 |
| Top 50 | `chair` | 의자 | 모든 구 | 4행, 2,000~5,000원 | 4행, 2,000~5,000원 | 3행, 2,000~6,000원 | Top 50 `의자`; 1인용, 장의자, 바퀴/회전의자 분기 |
| Top 50 | `mattress` | 매트리스 | 모든 구 | 2행, 5,000~8,000원 | 2행, 5,000~8,000원 | 2행, 5,000~8,000원 | Top 50 `매트리스`; 1인용/2인용 매트리스 분기 |
| Top 50 | `blanket` | 이불 | 모든 구 | 1행, 2,000원 | 1행, 2,000원 | 1행, 2,000원 | Top 50 `이불`; 서초·송파는 겨울용 기준 |
| User extension | `plastic_storage_box` | 리빙박스·플라스틱 수납함 | 모든 구 | 3행, 2,000~5,000원 | 2행, 2,000~4,000원 | 2행, 3,000~5,000원 | 사용자 확장 `리빙박스·플라스틱 수납함`; 플라스틱류/서랍장 분기 |
| User extension | `yoga_mat` | 요가매트 | 모든 구 | 1행, 1,000원 | 1행, 2,000원 | 1행, 1,000원 | 사용자 확장 `요가매트`; 돗자리/대자리/놀이매트 표와 연결 |
| User extension | `drying_rack` | 빨래건조대 | 모든 구 | 1행, 2,000원 | 1행, 2,000원 | 2행, 1,000~2,000원 | 강남·서초는 모든 규격, 송파는 길이 1m 기준 |
| User extension | `flower_pot` | 화분 | 모든 구 | 2행, 1,000~2,000원 | 2행, 1,000~2,000원 | 2행, 1,000~2,000원 | 대형/소형 또는 지름·높이 기준. 작은 파편/흙은 불연성 봉투·마대 우선 |
| User extension | `toy` | 장난감 | 모든 구 | 2행, 1,000~2,000원 | 1행, 1,000원 | 2행, 1,000~2,000원 | 강남은 `인형/ 장난감류` 결합 행, 서초는 `장난감류`, 송파는 `장난감` 행 |
| User extension | `stuffed_toy` | 인형 | 모든 구 | 2행, 1,000~2,000원 | 2행, 1,000~2,000원 | 1행, 1,000원 | 강남은 `인형/ 장난감류` 결합 행을 인형 품목에도 연결 |

## Added Rows

| Region | Added rows | Official source rows mapped |
| --- | ---: | --- |
| 서울 강남구 | 7 | `빨래건조대`, `화분`, `인형/ 장난감류` |
| 서울 서초구 | 6 | `빨래건조대`, `빈 화분`, `장난감류`, `인형류` |
| 서울 송파구 | 7 | `빨래건조대`, `화분`, `장난감`, `인형` |

보류한 후보는 없다. 네 후보 모두 세 구 공식 수수료표에서 직접 대응 가능한 행을 확인했다.

## Next Fee Expansion Candidates

2026-07-02 다음 후보 감사에서는 현재 coverage 10개(`blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat`)를 제외하고, `docs/top-50-items.md`, `docs/question-backlog.md`, 현재 수수료 JSON에 없는 Top/사용자 확장 품목을 공식 수수료표와 대조했다. 이번 라운드는 후보 감사만 수행했고 `src/data/bulky-waste-fees.json`은 변경하지 않았다.

결론: 이번 감사 기준으로 바로 구조화할 수 있는 3~5개 안전 후보 묶음은 아직 없다. 아래 5개는 다음 수수료 확장 후보로 검토할 가치가 있지만, 서초 수수료 행 직접 확인 또는 itemId 모델링 결정이 먼저 필요하다.

| Candidate | Source signal | Official fee row coverage | Hold risk / next condition |
| --- | --- | --- | --- |
| `fire_extinguisher` | Top 77, 기존 itemId 있음 | 강남: `소화기` 5행(3.3kg 이하 1,000원~15kg 이상 5,000원). 송파: `소화기` 3행(소형 1,000원, 중형 2,000원, 대형 3,000원). 서초: 안내 본문은 대형폐기물 예시에 `소화기`를 포함하지만, 2023 부과기준표 PDF 텍스트에서는 직접 수수료 행을 찾지 못함. | 2개 구는 명확하나 서초 수수료 직접 행이 빠져 있다. 다음 입력 전 서초 최신 표 또는 담당 부서 확인이 필요하다. |
| `clothes_hanger` | Top 84, 기존 itemId 있음 | 강남: `옷걸이` 모든 규격 2,000원. 서초: `옷걸이(스탠드형)` 2,000원, `옷걸이(행거)` 2,000원, `옷걸이(나무형)` 1,000원. 송파: `스탠드 옷걸이` 가정용(행거) 2,000원. | 세 구 행은 있으나 현재 itemId는 세탁소 철제 옷걸이/소형 옷걸이 의미가 강하다. 스탠드형 옷걸이·행거를 별도 itemId로 둘지 먼저 결정해야 한다. |
| `nonwoven_bag` 또는 별도 `bag` 후보 | Top 100, 기존 `nonwoven_bag` 있음 | 강남·서초·송파 모두 `가방류` 행이 있고, 크기 또는 골프가방 기준 2,000~3,000원 범위다. | 현재 `nonwoven_bag`은 부직포 장바구니를 종량제봉투로 안내하는 품목이라, 수수료표의 `가방류`와 의미가 다르다. 여행가방·일반 가방 itemId를 별도로 모델링할 때 후보로 둔다. |
| `vinyl_flooring` 후보 | question-backlog `비닐장판`, Open Decision 있음 | 강남·서초·송파 모두 `장판` 행이 있고 3.3㎡당 2,000원 계열로 확인된다. | `비닐장판`을 별도 품목으로 둘지 Open Decision에 이미 쌓여 있다. 품목 모델링 결정 전 수수료 행 입력은 보류한다. |
| `canvas_frame` 또는 `picture_frame` 후보 | question-backlog `캔버스 액자`, Open Decision 있음 | 강남·서초·송파 모두 `액자` 행이 있고 소형~대형 규격별 수수료가 확인된다. | `캔버스 액자`를 통합 itemId로 둘지, `캔버스`와 `액자`를 분리할지 Open Decision에 이미 쌓여 있다. itemId 결정 후 `액자` 수수료 매핑을 검토한다. |

이번 감사에서 `umbrella`는 Top 25이지만 송파의 `우산` 일반용 1,000원 행만 직접 확인되고 강남·서초 공식 수수료표에서는 직접 행을 찾지 못해 다음 확장 후보에서 보류했다. `paint_can`은 서초 `빈페인트통` 행만 확인되고 강남·송파에는 직접 행이 없어, 생활계 유해폐기물/빈 용기 지역 기준으로 남겨 둔다.

## Source Pages

- 강남구 자원순환 종합포털 대형생활폐기물 안내: https://clean.gangnam.go.kr/use/biwa/USEBIWA01000000.do
- 서초구청 대형폐기물 배출안내 및 부과기준표 PDF: https://www.seocho.go.kr/site/seocho/01/10103070301002018030701.jsp
- 송파구청 품목별수거기준 및 비용: https://www.songpa.go.kr/www/exhaustPrdlstList.do?key=2118&rep=1

## Follow-up Notes

- 후보 감사 세션에서는 `docs/data-decision-backlog.md`를 직접 수정하지 않았다. 후속 조율에서 `스탠드형 옷걸이/행거`와 `가방류` 수수료 모델링은 Open Decisions에 반영됐다.
- 즉시 사용자 결정이 필요한 항목은 없다. Open Decisions가 10건 미만인 동안은 사용자에게 묻지 않고 보류 상태를 유지한다.
- `vinyl_flooring`, `canvas_frame`/`picture_frame` 성격의 결정은 이미 `docs/data-decision-backlog.md` Open Decisions에 쌓여 있으므로 이번 문서에서는 수수료 행 후보만 연결했다.
- 후속 수집 시에는 "전체 표 import"가 아니라 조율 세션에서 정한 후보를 중심으로 3개 구의 행 단위 공식 출처와 itemId 매핑만 검토하는 것이 현재 정책과 맞다.
