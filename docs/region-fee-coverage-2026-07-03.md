# Region Fee Coverage - 2026-07-03

이 문서는 2026-07-02 수수료 coverage 문서 이후 마포구(`mapo_gu`)를 추가한 결과를 정리한다. 전체 수수료표 import는 계속 보류하고, 기존 coverage 10개 itemId 중 공식 마포구청 수수료표에서 직접 대응 가능한 품목 7개만 우선 구조화했다.

## Scope

- 기존 coverage 후보 10개: `chair`, `mattress`, `blanket`, `mirror`, `plastic_storage_box`, `yoga_mat`, `drying_rack`, `flower_pot`, `toy`, `stuffed_toy`
- 이번 마포구 입력 itemId 7개: `chair`, `mattress`, `blanket`, `mirror`, `yoga_mat`, `drying_rack`, `flower_pot`
- 이번 마포구 입력 행 수: 14행
- 제외: 전체 표 import, 새 itemId, 행거/가방류 등 Open Decision 후보, 나머지 coverage 3개 itemId

## Region Summary

| Region | Runtime ID | Structured fee rows | Structured itemIds |
| --- | --- | ---: | --- |
| 서울 강남구 | `gangnam_gu` | 19 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 서울 서초구 | `seocho_gu` | 18 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 서울 송파구 | `songpa_gu` | 18 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `plastic_storage_box`, `stuffed_toy`, `toy`, `yoga_mat` |
| 서울 마포구 | `mapo_gu` | 14 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `yoga_mat` |

## Coverage Counts

| Coverage group | Count | ItemIds |
| --- | ---: | --- |
| 4개 구에 있음 | 7 | `blanket`, `chair`, `drying_rack`, `flower_pot`, `mattress`, `mirror`, `yoga_mat` |
| 기존 3개 구만 있음 | 3 | `plastic_storage_box`, `stuffed_toy`, `toy` |
| 아직 없음 | 0 | - |

## Mapo Added Rows

| ItemId | Official row(s) mapped | Rows | Fee range | Notes |
| --- | --- | ---: | --- | --- |
| `chair` | `의자`, `의자(바퀴)`, `좌식의자, 접의자`, `쿠션 의자` | 6 | 2,000~7,000원 | 유아용 식탁의자·일반의자는 child-specific 행이라 이번 generic `chair` 매핑에서는 제외 |
| `mattress` | `침대`의 1인용/2인용 매트리스·라텍스 | 2 | 7,000~11,000원 | 침대틀·헤드·돌침대·의료기 침대 행은 제외 |
| `blanket` | `이불` | 1 | 2,000원 | 1채당 기준 |
| `mirror` | `거울(유리)` | 1 | 2,000원 | 1㎡당 기준 |
| `yoga_mat` | `돗자리` | 1 | 1,000원 | 1m²당 기준. `유아용 놀이매트`는 child-specific 행이라 이번 generic 요가매트 매핑에서는 제외 |
| `drying_rack` | `빨래건조대` | 1 | 1,000원 | 공식 행의 명칭·규격·금액이 기존 itemId와 직접 대응 |
| `flower_pot` | `화분` | 2 | 1,000~1,500원 | 50cm 이상/미만 기준. 공식 표의 흙·화초 제외 조건을 보존 |

## Held Out Candidates

| ItemId | Official signal | Hold reason |
| --- | --- | --- |
| `plastic_storage_box` | `서랍장`, `플라스틱류` 행 확인 | `서랍장`은 가구성 수납장 규격이고, `플라스틱류`는 재활용불가 1kg당 넓은 행이라 리빙박스·플라스틱 수납함 itemId에 바로 붙이지 않음 |
| `toy` | `기타 인형, 장난감류` 행 확인 | 공식 행은 있으나 `stuffed_toy`와 공유되는 결합 행이므로 분리 매핑 없이 보류 |
| `stuffed_toy` | `기타 인형, 장난감류` 행 확인 | 공식 행은 있으나 `toy`와 공유되는 결합 행이므로 분리 매핑 없이 보류 |

## Source

- 마포구청 대형폐기물배출안내: https://www.mapo.go.kr/site/main/content/mapo05060502
- 마포구청 대형폐기물 신청 메뉴: https://www.mapo.go.kr/site/main/content/mapo05060506
- 마포구청 안내 본문은 `smartclean.mapo.go.kr` 직접 신청 링크를 제공하지만, 2026-07-03 로컬 DNS 확인에서 해석되지 않아 런타임 `applicationUrl`은 마포구청 공식 신청 메뉴 URL을 사용했다.

## Follow-up

- 이번 라운드에서 새 Open Decision은 만들지 않았다.
- 마포구 `drying_rack`와 `flower_pot` 2차 수수료 반영분은 region evaluation case 3개로 고정했다.
- 다음 마포구 수수료 배치는 기존 10개 coverage 중 남은 3개 itemId만 검토하면 된다.
- 전체 수수료표 import는 여전히 별도 스크립트와 itemId 매핑 기준이 필요하다.
