# Region Food Exception Review - 2026-07-02

범위: 새 구를 추가하지 않고 `gangnam_gu`, `seocho_gu`, `songpa_gu`의 음식물류 예외와 배출방식을 교차 검증했다. 품목 데이터와 대형폐기물 수수료 데이터는 수정하지 않았다. 후속 데이터 보정에서는 강남구 공식 첨부가 직접 뒷받침하는 음식물 예외 4개만 런타임 지역 데이터에 반영했다.

## Official Sources Checked

| Region | Official source | Confirmed points |
| --- | --- | --- |
| 서울 강남구 | https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109 | 음식물은 물기 제거 후 전용 종량제봉투와 수집용기 배출. 동물뼈, 조개껍데기, 한약재 찌꺼기, 달걀껍데기, 게 껍질, 밤·호두껍질, 파 뿌리 등은 일반 종량제봉투 대상. 공식 첨부 PDF에서 핵과류 씨(복숭아 씨 등), 생선뼈, 티백, 양파껍질도 직접 확인 |
| 서울 서초구 | https://www.seocho.go.kr/site/seocho/04/10413030600002020072410.jsp | 뿌리·껍질, 고추씨·고추대, 옥수수 껍질·옥수수대, 단단한 껍데기, 핵과류 씨, 육류 뼈, 패류·갑각류 껍데기, 생선뼈, 알껍데기, 차류·한약재 찌꺼기, 이물질은 일반 종량제봉투 대상 |
| 서울 송파구 | https://www.songpa.go.kr/www/contents.do?key=3161 | 일반주택 전용봉투+통합 전용용기, RFID, 소형음식점 납부필증 방식. 딱딱한 껍데기, 과일 씨, 육류 뼈, 패류·갑각류 껍데기, 티백, 한약재 찌꺼기, 마늘·양파껍질, 생선뼈, 파뿌리, 계란껍데기는 일반 생활쓰레기 대상 |

## Mode Differences

| Region | Mode in runtime data | QA result |
| --- | --- | --- |
| 서울 강남구 | 전용 종량제봉투 또는 RFID 공동주택 | 공식 문구와 일치. 음식물 예외 목록에 공식 페이지의 `한약재 찌꺼기`와 공식 첨부의 `핵과류 씨(복숭아 씨 등)`, `생선뼈`, `티백`, `양파껍질` 직접 근거를 반영 |
| 서울 서초구 | 전용봉투+수거용기, 토요일·공휴일 전날 배출금지, RFID 공동주택 상시 가능 | 배출방식은 일치. 음식물 예외는 기존 데이터가 가정용 배출 페이지 중심으로 좁아 공식 분리배출 요령 출처와 목록을 보강 |
| 서울 송파구 | 일반주택 전용봉투+통합 전용용기, RFID, 소형음식점 납부필증 | 공식 문구와 일치. 기존 `foodWaste.generalWasteExceptions`는 충분했으나 itemGuide가 일부 품목만 연결되어 보강 |

## Item Cross-Check

| Item ID | Gangnam | Seocho | Songpa | Decision |
| --- | --- | --- | --- | --- |
| `chicken_bone` | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 3개 구 모두 일반 종량제 계열 |
| `shellfish_shell` | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 3개 구 모두 일반 종량제 계열 |
| `egg_shell` | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 서초 itemGuide 연결 보강 |
| `fruit_seed` | 지역 본문 직접 예시 없음. 공식 첨부 PDF 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 강남·서초·송파 itemGuide 연결. 강남은 공식 첨부 근거로 후속 데이터 보정 반영 |
| `fish_bone` | 지역 본문 직접 예시 없음. 공식 첨부 PDF 직접 근거 있음 | 지역 본문 직접 근거 있음. 단, 페이지 원문은 `생성뼈`로 보이는 오탈자 포함 | 지역 본문 직접 근거 있음 | 강남·서초·송파 itemGuide 연결. 강남은 공식 첨부 근거로 후속 데이터 보정 반영 |
| `nut_shell` | 밤·호두껍질 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 3개 구 모두 일반 종량제 계열 |
| `corn_cob_husk` | 기존 itemGuide는 유지했지만 확인한 지역 본문 페이지에는 옥수수대·껍질 직접 문구 없음 | 지역 본문 직접 근거 있음 | 확인한 송파구 페이지에서 직접 문구 없음 | 서초 itemGuide 연결 보강. 송파 itemGuide에는 추가하지 않음 |
| `herbal_medicine_dregs` | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 강남 foodWaste 예외 누락 보정, 서초·송파 itemGuide 연결 보강 |
| `tea_bag` | 지역 본문 직접 예시 없음. 공식 첨부 PDF 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 강남·서초·송파 itemGuide 연결. 강남은 공식 첨부 근거로 후속 데이터 보정 반영 |
| `onion_peel` | 지역 본문 `마늘·양파·생강 껍질` 및 공식 첨부 PDF `양파껍질` 직접 근거 있음 | 지역 본문 직접 근거 있음 | 지역 본문 직접 근거 있음 | 강남·서초·송파 itemGuide 연결. 강남은 공식 본문과 첨부 근거로 후속 데이터 보정 반영 |
| `moldy_bread` | Food-waste positive item with Gangnam mode guide | Food-waste positive, no local exception found | Food-waste positive, no local exception found | 새 예외로 넣지 않음 |
| `tangerine_peel` | Food-waste positive, no local exception found | Food-waste positive, no local exception found | Food-waste positive, no local exception found | 새 예외로 넣지 않음 |

## Held Items

- 강남구 확인 본문 페이지는 음식물 제외 품목을 `동물뼈, 조개껍데기, 한약재 찌꺼기, 달걀껍데기, 게 껍질, 밤·호두껍질, 파 뿌리 등`으로 안내한다. 후속 첨부 감사에서 같은 공식 페이지의 `쓰레기줄이기 분리배출 안내.pdf`에 `핵과류 씨(복숭아 씨 등)`, `생선뼈`, `티백`, `양파껍질` 직접 문구가 있음을 확인했고, 후속 데이터 보정에서 해당 4개 itemId만 반영했다.
- `corn_cob_husk` 계열은 강남구 확인 본문, 자원순환 포털, 확인한 공식 첨부 PDF에서 `옥수수대` 또는 `옥수수껍질` 직접 문구를 찾지 못했다. 전국 품목사전 근거는 있으나 강남 지역 직접 매핑은 계속 보류한다.
- 송파구 확인 본문 페이지에서 `corn_cob_husk` 직접 문구는 확인하지 못했다. 전국 품목사전 근거는 있으나 송파 itemGuide에는 이번 라운드에서 연결하지 않았다.
- `moldy_bread`, `tangerine_peel`은 이번 범위에서 음식물류 예외가 아니라 음식물류 배출방식 확인 항목으로만 관리한다.

## Gangnam Follow-up Evidence Audit

2026-07-02 후속 감사에서는 강남구 공식 페이지와 같은 페이지의 공식 첨부 PDF에서 기존 보류 품목의 직접 근거를 확인했다. 이어진 데이터 보정에서는 직접 근거가 있는 4개 itemId만 런타임 지역 데이터에 반영했다.

| Item ID | Gangnam direct evidence | Result |
| --- | --- | --- |
| `fruit_seed` | `쓰레기줄이기 분리배출 안내.pdf`의 `핵과류 씨(복숭아 씨 등)` | 데이터 반영 완료. 강남 본문에는 없지만 공식 첨부가 직접 뒷받침한다. |
| `fish_bone` | `쓰레기줄이기 분리배출 안내.pdf`의 `생선뼈` | 데이터 반영 완료. 강남 본문에는 없지만 공식 첨부가 직접 뒷받침한다. |
| `tea_bag` | `쓰레기줄이기 분리배출 안내.pdf`의 `티백` | 데이터 반영 완료. 강남 본문에는 없지만 공식 첨부가 직접 뒷받침한다. |
| `onion_peel` | 강남구청 본문 `마늘·양파·생강 껍질`, 첨부 PDF `양파껍질` | 데이터 반영 완료. 기존 데이터 의미와 충돌 없음. |
| `corn_cob_husk` | 직접 문구 찾지 못함 | 계속 보류. 강남 지역 itemGuide 후속 보정 전 별도 공식 근거가 필요하다. |

확인 출처: 강남구청 쓰레기배출안내 `https://www.gangnam.go.kr/board/waste/list.do?mid=ID02_011109`, 공식 첨부 `쓰레기줄이기 분리배출 안내.pdf` `https://www.gangnam.go.kr/file/10/get/8f726ace-f0ee-4408-99f7-c798d5089f66/download.do`.

## Data Changes

- `src/data/region-policies.json`
  - 강남구 `foodWaste.generalWasteExceptions`에 `한약재 찌꺼기` 추가.
  - 강남구 쓰레기배출안내 source 확인일과 basis를 음식물 예외까지 포함하도록 보정.
  - 서초구 음식물 예외 목록과 itemGuide를 공식 분리배출 요령 기준으로 확장하고 source를 추가.
  - 송파구 itemGuide에 공식 페이지가 직접 뒷받침하는 기존 음식물 예외 품목을 연결.
  - 후속 데이터 보정에서 강남구 공식 첨부 PDF source를 추가하고, `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel` 전용 itemGuide를 연결했다. `corn_cob_husk`는 강남 직접 근거가 없어 보류 상태를 유지했다.
- `src/data/region-evaluation-cases.json`
  - 후속 데이터 보정에서 강남구 `fruit_seed`, `fish_bone`, `tea_bag`, `onion_peel` 회귀 케이스 4개를 추가했다.

새로운 지역, 품목, 수수료 행은 추가하지 않았다.

## Evaluation Cases

2026-07-02 지역 평가 케이스 동기화에서 `src/data/region-evaluation-cases.json`에 음식물 예외 itemGuide 회귀 케이스 5개를 추가했고, 후속 강남 데이터 보정에서 4개를 더해 음식물 예외 회귀 케이스는 9개가 됐다.

| Region | Query | Expected itemId | Fixed guide text |
| --- | --- | --- | --- |
| 서울 강남구 | 한약재 찌꺼기 | `herbal_medicine_dregs` | `일반 종량제 봉투` |
| 서울 강남구 | 과일씨 | `fruit_seed` | `핵과류 씨` |
| 서울 강남구 | 생선뼈 | `fish_bone` | `생선뼈` |
| 서울 강남구 | 티백 | `tea_bag` | `티백, 양파껍질` |
| 서울 강남구 | 양파껍질 | `onion_peel` | `양파껍질` |
| 서울 서초구 | 과일씨 | `fruit_seed` | `핵과류 씨` |
| 서울 서초구 | 호두껍질 | `nut_shell` | `단단한 껍데기` |
| 서울 송파구 | 생선뼈 | `fish_bone` | `생선뼈` |
| 서울 송파구 | 티백 | `tea_bag` | `1회용 티백` |
