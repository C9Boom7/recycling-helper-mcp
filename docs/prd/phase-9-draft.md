# Phase 9 초안 — 광역시 자치구 확장

[phase-9-metro-districts.md](phase-9-metro-districts.md)의 R1·R4를 먼저 끝내 놓고, R2(지역 데이터 수집)와
R3(수수료 임포트)를 이어받을 세션이 URL·전화·확인일만 채우면 바로 `src/data/`에 붙일 수 있게 만든 문서다.

> **2026-08-21 갱신.** 이 문서를 쓴 세션은 이그레스가 막혀 URL·전화번호를 한 글자도 못 적었다.
> 이어받은 세션은 망이 열려 있어 **8곳 중 5곳을 실제로 넣었다.** 아래 0절이 결과이고,
> 1~4절은 넣기 전 기준값과 설계 검증 기록이라 그대로 둔다 — 회귀를 판단하려면 넣기 전 값이 남아 있어야 한다.
> 8곳을 전제로 쓴 문장(2-1 표, 2-4 정리 목록, 4-4의 47.3%)은 5곳 기준으로 다시 읽어야 한다.

---

## 0. 구현 결과 (2026-08-21)

### 0-1. 넣은 5곳

| 지역 | `id` | 신청 경로 | 직통 전화 |
| --- | --- | --- | --- |
| 부산 해운대구 | `haeundae_gu` | 대행업체 전화 접수(구청 안내 페이지) | 051-749-4462 |
| 부산 부산진구 | `busanjin_gu` | 대행업체 네이버 스마트스토어(구청 안내 페이지) | 051-605-4462 |
| 대구 북구 | `buk_gu_daegu` | 구청 통합예약 자체 신청 | 053-665-2727 |
| 인천 남동구 | `namdong_gu` | 구 누리집 스티커 구입 | 032-453-2560 |
| 인천 부평구 | `bupyeong_gu` | 구 폐기물배출신고 시스템 | 032-509-6610 |

값은 전부 **실제로 연 페이지에서만** 옮겼다. 해운대구와 부산진구는 구청에 자체 신청 화면이 없고
신청 안내와 품목별 수수료표가 한 페이지에 같이 있어 `applicationUrl`과 `feeUrl`이 같은 주소다.
그 사정은 두 지역 `summary`에 적어 두었다.

### 0-2. 미룬 3곳과 이유

| 지역 | 막힌 곳 |
| --- | --- |
| 대구 달서구 | 신청·수수료·전화·폐건전지까지 다 모았는데 **구 단위 폐의약품 안내가 없다.** 구청 청소 페이지·재활용 페이지·대구시 환경 페이지를 다 열었지만 폐의약품 배출 방법이 실린 곳이 없었다. `specialCollections.medicine.method`가 standard 티어 필수라 지역째 미뤘다. |
| 대전 서구 | 신청 시스템(`seogu.go.kr/waste`)과 품목별 수수료 조회, 폐형광등·폐전지, 자원순환과 042-288-3584까지 확인했다. **폐의약품 안내가 구 사이트 어디에도 없다** — 환경청소 메뉴 전체와 재활용품분리배출 본문을 확인했다. |
| 광주 북구 | 대형폐기물은 ㈜녹색환경(062-572-1336) 전화 접수뿐이고 **품목별 수수료 URL이 없다.** 게다가 구 사이트가 스스로를 `전남광주통합특별시 북구`로 표기한다 — 저장소의 `gwangju`(광주광역시) 모델과 어긋나서, 광역 항목까지 함께 볼 문제라 이 PR에서 손대지 않았다. |

미룬 3곳은 광역 티어 별칭을 건드리지 않았다. `daegu.districtAliases`의 `달서구`,
`daejeon.prefixOnlyDistrictAliases`의 `서구`, `gwangju.prefixOnlyDistrictAliases`의 `북구`가
그대로 남아 있어야 하고, 실제로 남겨 두었다.

### 0-3. 지표

`pnpm measure:region` 기준 **자치구 확정 30/79(38.0%) → 40/88(45.5%)**, 오매칭 0, 되묻기 0이다.
입력이 79줄에서 88줄로 늘었다(기존 4줄 수정 + 9줄 추가).

`pnpm local:test` 통과 — 324 품목 / **54 지역** / **103 지역 케이스** / **498 answer case**.
warning 9건은 기존부터 있던 임포터 재실행 안내다.

### 0-4. 실제로 바뀐 파일

- `src/data/region-policies.json` — 자치구 5곳 추가, `busan`·`incheon`의 `districtAliases`에서
  해운대구·부산진구·남동구·부평구 제거, `daegu.prefixOnlyDistrictAliases`에서 `북구` 제거
- `logs/region-expansion-queries.example.jsonl` — 4줄 수정 + 9줄 추가(반례 `북구`는 `expectRefusal`)
- `src/data/region-evaluation-cases.json` — 기존 3건 승격, 확정 4건·반례 5건 추가
- `src/data/mcp-answer-cases.json` — `region_info_metro_fallback_battery_collection`을
  `부산 사하구`로 옮기고(구 이름이 박힌 기대 문자열 넷을 함께 교체), `p9_` 11건 추가.
  `부산` 광역 케이스는 새로 만들지 않고 기존 `region_metro_fallback_busan`의
  `expectedTextExcludes`에 자치구 직통번호를 박았다 — 같은 tool/input 케이스는 validate가 막는다.
- `docs/session-coordination.md`·`docs/source-coverage.md`·`docs/qa-runbook.md` — 카운트와 티어 집계

### 0-5. R3(수수료 임포트)는 안 했다

5곳 모두 `bulky-waste-fees.json` 행이 없다. 그래서 `get_disposal_steps`는 신청 경로와 전화까지만
싣고 금액 줄은 안 붙는다. 광역 폴백보다는 훨씬 낫지만 관악구 수준은 아니다. 5-2가 그대로 남은 일이다.

---

## 1. 기준값 (`pnpm measure:region`, 2026-08-21)

```
before (Phase 5 직전 = PR #9 기준: 시·도 미확정 + full 티어 5개 지역) (n=79)
- 자치구 확정: 7 (8.9%)
- 광역시도 폴백: 0 (0.0%)
- 전국 폴백: 72 (91.1%)
- 되묻기: 0 (0.0%)
- 오매칭: 0 (0.0%)

after (Phase 5: 단계형 매칭 + 35개 지역) (n=79)
- 자치구 확정: 30 (38.0%)
- 광역시도 폴백: 48 (60.8%)
- 전국 폴백: 1 (1.3%)
- 되묻기: 0 (0.0%)
- 오매칭: 0 (0.0%)
```

`pnpm local:test`도 이 시점에 통과한다 (324 품목 / 49 지역 / 94 지역 케이스 / 487 answer case,
warning 9건은 임포터 재실행 안내로 기존부터 있던 것이다).

### 지표의 함정 하나

측정 입력은 `logs/region-expansion-queries.example.jsonl` 79줄이고, **기대 착지가 줄마다 박혀 있다.**
지금 이 파일에는 이런 줄들이 있다.

| 줄 | 내용 |
| --- | --- |
| 47 | `{"query": "부산 해운대구", "expectedRegionId": "busan", "expectedLevel": "metro"}` |
| 50 | `{"query": "인천 남동구", "expectedRegionId": "incheon", "expectedLevel": "metro"}` |
| 74 | `{"query": "해운대구", "expectedRegionId": "busan", "expectedLevel": "metro"}` |
| 76 | `{"query": "부평구", "expectedRegionId": "incheon", "expectedLevel": "metro"}` |

해운대구·남동구·부평구를 자치구로 등록하는 순간 이 네 줄은 **오매칭으로 집계되고
`measure-region-resolution.ts`가 exit 1로 죽는다.** 지역을 넣으면서 이 파일을 같이 고쳐야 한다.
"오매칭 0"은 개선 지표가 아니라 지키는 조건이라, 여기서 걸리면 DoD 자체가 막힌다.

---

## 2. 대상 확정과 id 충돌 검사 (R1)

### 2-1. 확정한 8곳

`src/data/region-policies.json`의 기존 49개 id와 전부 대조했고 **충돌 없음**을 확인했다.
`metroId`로 쓸 광역 티어 id 다섯 개(`busan`, `daegu`, `incheon`, `daejeon`, `gwangju`)도 전부 데이터에 있다.

| 지역 | `id` | `metroId` | 맨 이름 별칭 | 이유 |
| --- | --- | --- | --- | --- |
| 부산 해운대구 | `haeundae_gu` | `busan` | 단다 | 전국 유일 |
| 부산 부산진구 | `busanjin_gu` | `busan` | 단다 | 전국 유일 |
| 대구 달서구 | `dalseo_gu` | `daegu` | 단다 | 전국 유일 |
| 대구 북구 | `buk_gu_daegu` | `daegu` | **안 단다** | 북구는 광역시 네 곳에 있다 |
| 인천 남동구 | `namdong_gu` | `incheon` | 단다 | 전국 유일 |
| 인천 부평구 | `bupyeong_gu` | `incheon` | 단다 | 전국 유일 |
| 대전 서구 | `seo_gu_daejeon` | `daejeon` | **안 단다** | 서구는 광역시 다섯 곳에 있다 |
| 광주 북구 | `buk_gu_gwangju` | `gwangju` | **안 단다** | 위와 같다 |

id는 PRD R1 표를 그대로 따랐다. 다만 `scripts/test-region-matching.ts`의 픽스처는
`busan_jung_gu`처럼 **광역을 앞에** 붙이는 반대 순서를 쓴다. 실데이터에는 아직 동명 자치구가 하나도 없어
어느 쪽도 선례가 없고, 순서를 맞춰봐야 이미 들어와 있는 `jung_gu`(서울 중구)와는 어차피 어긋난다.
검사에 영향을 주는 값이 아니므로 PRD 표대로 간다.

**시간이 모자라면 4곳으로 줄인다.** 우선순위는 `haeundae_gu` → `namdong_gu` → `dalseo_gu` → `bupyeong_gu`다.
맨 이름 별칭을 달 수 있는 쪽이라 `해운대구` 한 마디만 해도 자치구로 착지하고, 동명 반례를 새로 짤 필요도 없다.
동명인 셋(`buk_gu_daegu`, `seo_gu_daejeon`, `buk_gu_gwangju`)은 반례까지 함께 짜야 해서 손이 더 든다.

### 2-2. 동명 자치구 전수 조사 — 이 Phase의 가장 큰 사고 위험

| 이름 | 있는 광역시 | 이미 등록됨 | Phase 9에서 넣는 곳 | 맨 이름으로 부르면 |
| --- | --- | --- | --- | --- |
| 중구 | 서울·부산·대구·인천·대전·울산 (6) | 서울 중구(`jung_gu`) | 없음 | 전국 폴백 (유지) |
| 동구 | 부산·대구·인천·광주·대전·울산 (6) | 없음 | 없음 | 전국 폴백 (유지) |
| 서구 | 부산·대구·인천·광주·대전 (5) | 없음 | **대전 서구** | 전국 폴백 (유지) |
| 남구 | 부산·대구·광주·울산 (4) | 없음 | 없음 | 전국 폴백 (유지) |
| 북구 | 부산·대구·광주·울산 (4) | 없음 | **대구 북구·광주 북구** | 전국 폴백 (유지) |
| 강서구 | 서울·부산 (2) | 서울 강서구(`gangseo_gu`) | 없음 | 전국 폴백 (유지) |

읽는 법 몇 가지.

- **인천 남구는 2018년에 미추홀구로 바뀌었다.** 그래서 남구는 4곳이고, 인천 몫은
  `incheon.districtAliases`에 `미추홀구`로 들어가 있다. 데이터가 이미 맞게 잡고 있다.
- 포항시에도 남구·북구가 있지만 자치구가 아니라 시 산하 일반구다. `gyeongbuk.districtAliases`에는
  `포항시`만 있고 그 아래 구는 없다. 이 표에서도 뺐다.
- **울산 북구·부산 북구는 이번에 안 넣는다.** 대구·광주만 넣으므로 `울산 북구`·`부산 북구` 질의는
  지금처럼 광역 폴백에 머물러야 한다. 이게 반례의 핵심이다.
- 등록 여부와 무관하게, 맨 `중구`·`동구`·`서구`·`남구`·`북구`·`강서구`는 **여섯 개 전부 확정되면 안 된다.**
  `scripts/test-region-matching.ts`가 `nationallyAmbiguousDistrictQueries`로 이걸 직접 막고 있고,
  로마자 표기(`jung-gu`, `buk-gu`, `seo-gu` …)까지 같은 목록에 있다.

### 2-3. 별칭 설계

기존 항목의 형태를 그대로 따른다. `[맨 이름, "광역 X구", "광역시 X구", "광역광역시 X구", 로마자]` 순이고,
동명이면 맨 이름과 맨 로마자를 뺀다. 서울 중구(`jung_gu`)·서울 강서구(`gangseo_gu`)가 정확히 그렇게 돼 있다.

```
haeundae_gu     ["해운대구", "부산 해운대구", "부산시 해운대구", "부산광역시 해운대구", "haeundae-gu"]
busanjin_gu     ["부산진구", "부산 부산진구", "부산시 부산진구", "부산광역시 부산진구", "busanjin-gu"]
dalseo_gu       ["달서구", "대구 달서구", "대구시 달서구", "대구광역시 달서구", "dalseo-gu"]
buk_gu_daegu    ["대구 북구", "대구시 북구", "대구광역시 북구", "daegu-buk-gu"]
namdong_gu      ["남동구", "인천 남동구", "인천시 남동구", "인천광역시 남동구", "namdong-gu"]
bupyeong_gu     ["부평구", "인천 부평구", "인천시 부평구", "인천광역시 부평구", "bupyeong-gu"]
seo_gu_daejeon  ["대전 서구", "대전시 서구", "대전광역시 서구", "daejeon-seo-gu"]
buk_gu_gwangju  ["광주 북구", "광주시 북구", "광주광역시 북구", "gwangju-buk-gu"]
```

광역 표기 세 가지를 다 적어야 하는 이유가 있다. `splitLeadingMetro`가 앞의 광역명을 떼고 다시 찾긴 하지만,
그 재시도는 광역 소속 자치구의 **이름·별칭에 남은 조각이 걸릴 때만** 통한다. 동명이라 맨 이름을 못 다는
`buk_gu_daegu`는 `대구광역시` 를 뗀 `북구`가 어디에도 안 걸려 재시도가 빈손으로 끝난다.
Phase 5 회고에도 같은 구멍이 적혀 있다 — 서울이 멀쩡해 보였던 건 자치구마다 표기 세 벌을 다 달아둔 덕이다.

### 2-4. 광역 티어 목록에서 빼야 하는 이름 — PRD에 없지만 반드시 해야 한다

지금 이 여덟 곳의 이름은 광역 항목 안에 들어 있다. 자치구로 승격하면서 **원래 자리에서 빼지 않으면
`pnpm check`가 깨진다.**

| 광역 | 필드 | 빼는 이름 |
| --- | --- | --- |
| `busan` | `districtAliases` | `해운대구`, `부산진구` |
| `daegu` | `districtAliases` | `달서구` |
| `incheon` | `districtAliases` | `남동구`, `부평구` |
| `daegu` | `prefixOnlyDistrictAliases` | `북구` |
| `gwangju` | `prefixOnlyDistrictAliases` | `북구` |
| `daejeon` | `prefixOnlyDistrictAliases` | `서구` |

`prefixOnlyDistrictAliases`까지 손대야 하는 게 놓치기 쉽다. `test-region-matching.ts`의 naming sweep은
`[...districtAliases, ...prefixOnlyDistrictAliases]`를 돌며 `"대구광역시 북구"`가 **daegu에 metro 레벨로
착지하고 daegu가 그 이름을 지목하는지**를 단언한다. 자치구로 등록되는 순간 이 단언이 통째로 뒤집힌다.

빼고 남는 값은 이렇다. 빈 배열은 허용되지 않으므로(`validate-data.mjs`) 필드째 지울 일은 없지만,
혹시 다 비면 키를 지운다.

```
busan.districtAliases            → ["영도구","동래구","사하구","금정구","연제구","수영구","사상구","기장군"]
daegu.districtAliases            → ["수성구","달성군","군위군"]
incheon.districtAliases          → ["미추홀구","연수구","계양구","강화군","옹진군"]
daegu.prefixOnlyDistrictAliases  → ["중구","동구","서구","남구"]
gwangju.prefixOnlyDistrictAliases→ ["동구","서구","남구"]
daejeon.prefixOnlyDistrictAliases→ ["동구","중구"]
```

### 2-5. 설계 검증 — 리졸버에 직접 태워 봤다

`src/data/`는 그대로 두고, 메모리에서만 위 구성을 적용해 `resolveRegionalPolicyIn`·`findNamedSubRegion`을
돌렸다. `test-region-matching.ts`의 세 검사(alias self-resolution, naming sweep, 전국 동명 확정 금지)를
같은 코드로 재현한 결과다.

| 구성 | 실패 |
| --- | --- |
| 8곳만 추가하고 광역 목록은 그대로 | **47건** |
| 2-4의 광역 목록 정리까지 함께 | **0건** |

47건의 얼굴은 이렇다. 정리를 빼먹으면 이 형태로 터진다는 뜻이다.

```
[alias self-resolution] region busan alias "해운대구" -> haeundae_gu
[naming sweep standalone] "부평구" -> bupyeong_gu/district; expected incheon/metro
[naming sweep prefixed] "대구광역시 북구" -> buk_gu_daegu/district; expected daegu/metro
```

착지 시뮬레이션 결과 중 눈여겨볼 줄만 뽑았다. 왼쪽이 지금, 오른쪽이 제안 구성이다.

```
"해운대구"        busan (metro) / 지목=해운대구   →  haeundae_gu (district)
"해운대"          busan (metro) / 지목=해운대구   →  haeundae_gu (district)
"부산진"          busan (metro) / 지목=부산진구   →  busanjin_gu (district)
"대구광역시 북구"  daegu (metro) / 지목=북구       →  buk_gu_daegu (district)
"광주시 북구"      gwangju (metro) / 지목=북구     →  buk_gu_gwangju (district)

"북구"·"서구"·"중구"·"동구"·"남구"·"강서구"   전국 폴백  →  전국 폴백 (그대로)
"부산 중구"·"대구 동구"·"울산 북구"·"부산 북구"·"광주 서구"·"인천 서구"·"대전 동구"
                                          광역 폴백 + 이름 지목  →  그대로
"부산"·"대구"·"인천"·"대전"·"광주"·"광주시"    광역 확정   →  그대로
"강남구"·"서울 중구"·"성남시"·"판교"·"수원시"   자치구 확정  →  그대로
"청주시"·"안산시"                             광역 폴백 + 이름 지목  →  그대로
"부산 어쩌구"·"부산 강남구"                    광역 확정, 지목 없음   →  그대로
```

`해운대`·`부산진` 같은 접두 조각까지 자치구로 붙는 건 의도한 동작이다(`강남` → 강남구와 같은 규칙).
`광주시 북구`가 광주광역시 북구로 가는 것도 확인했다 — 경기도 광주시에는 북구가 없고,
맨 `광주시`는 여전히 `gwangju`로 간다(이건 `test-region-matching.ts`가 따로 못 박고 있는 케이스다).

---

## 3. 현재 동작 실측 (2026-08-21)

`pnpm build` 후 `PORT=3999 WIDGET_ENABLED=true node dist/server.js`를 띄우고 `POST /mcp`로 직접 호출했다.
지역을 넣은 뒤 **무엇이 바뀌어야 하고 무엇이 그대로여야 하는지**의 기준선이다.

### 3-1. `get_region_disposal_info`

| 질의 | `regionStatus` | 착지 | 응답 둘째 줄 |
| --- | --- | --- | --- |
| `부산 해운대구` | `unregistered_district` | 부산광역시 (metro) | 해운대구 상세 데이터는 아직 없어 부산광역시 광역 기준으로… |
| `해운대구` | `unregistered_district` | 부산광역시 (metro) | 위와 같다 |
| `부산 부산진구` / `부산진구` | `unregistered_district` | 부산광역시 (metro) | 부산진구 상세 데이터는 아직 없어… |
| `대구 북구` | `unregistered_district` | 대구광역시 (metro) | 북구 상세 데이터는 아직 없어… |
| `대구 달서구` / `달서구` | `unregistered_district` | 대구광역시 (metro) | 달서구 상세 데이터는 아직 없어… |
| `인천 남동구` / `남동구` | `unregistered_district` | 인천광역시 (metro) | 남동구 상세 데이터는 아직 없어… |
| `인천 부평구` / `부평구` | `unregistered_district` | 인천광역시 (metro) | 부평구 상세 데이터는 아직 없어… |
| `대전 서구` | `unregistered_district` | 대전광역시 (metro) | 서구 상세 데이터는 아직 없어… |
| `광주 북구` | `unregistered_district` | 광주광역시 (metro) | 북구 상세 데이터는 아직 없어… |
| `부산 중구` | `unregistered_district` | 부산광역시 (metro) | 중구 상세 데이터는 아직 없어… |
| `대구 동구` | `unregistered_district` | 대구광역시 (metro) | 동구 상세 데이터는 아직 없어… |
| `울산 북구` | `unregistered_district` | 울산광역시 (metro) | 북구 상세 데이터는 아직 없어… |
| `북구` | `unknown` | 없음 (전국 폴백) | "북구"은(는) 아직 상세 지역 데이터가 없습니다 |
| `중구` / `서구` / `동구` / `남구` | `unknown` | 없음 (전국 폴백) | 위와 같다 |

광역 폴백 응답의 문구는 두 문장이 붙어 나온다.

```
{구 이름} 상세 데이터는 아직 없어 {광역} 광역 기준으로 안내합니다.
대형폐기물 신청 경로와 수수료는 {구 이름} 소관이니 아래 공식 확인처에서 확인해 주세요.
```

전국 폴백 응답에는 지역 요약도 광역 링크도 없고, 분리배출.kr과 정부24 두 줄만 남는다.
`되묻기`(ambiguous)는 **이 질의들 중 어디에서도 안 나왔다.** 맨 `북구`가 되묻지 않고 전국 폴백으로 가는 건
확정 후보가 하나도 없어서지, 후보가 여럿이라 미룬 게 아니다.

### 3-2. `get_disposal_steps`

미등록 자치구는 광역 안내 두 줄만 붙고 **전화번호도 신청 URL도 수수료도 안 실린다.**

`{itemName: "소파", region: "부산 해운대구"}` → `regionNotes`:
```
- 대형생활폐기물은 배출 전에 사전 신청하고 접수증 또는 접수번호를 부착해 배출합니다. 신청 기한은 시·군·구마다 다릅니다.
- 해운대구 상세 데이터는 아직 없어 부산광역시 광역 기준으로 안내합니다. 대형폐기물 신청 경로와 수수료는 해운대구 공식 안내에서 확인하세요.
```

같은 질의를 등록 지역으로 바꾸면 이렇게 달라진다. `{itemName: "소파", region: "서울 관악구"}` → `regionNotes`:
```
- 서울 관악구 대형생활폐기물은 배출 전에 미리 신청하고 접수증 또는 접수번호를 부착해 배출합니다. …
- 문의/신청 안내 전화: 02-882-5677
- 인터넷 신청: https://smartclean.gwanak.go.kr/online/bulky/request
- 수수료 조회: https://smartclean.gwanak.go.kr/online/bulky/item
- 서울 관악구 대형생활폐기물 수수료 후보:
  -   소파 1인용 당: 3,000원
- 신청 URL: https://smartclean.gwanak.go.kr/online/bulky/request
- 수수료 출처: https://smartclean.gwanak.go.kr/online/bulky/item
```

**이 여섯 줄이 Phase 9가 사는 이유다.** 부산·대구 사용자가 지금 못 받고 있는 게 정확히 이것이다.

나머지 실측:

| 질의 | 지금 |
| --- | --- |
| `{소파, 대구 북구}` | 광역 안내 두 줄 (대구광역시 기준) |
| `{책상의자, 인천 남동구}` | 품목은 `의자`로 확정, 광역 안내 두 줄 |
| `{침대, 대전 서구}` | 품목은 `침대 프레임`으로 확정, 광역 안내 두 줄 |
| `{소파, 북구}` | 품목만 나오고 **`regionNotes` 자체가 없다** |

마지막 줄이 중요하다. 맨 `북구`는 지역 줄이 통째로 빠져서, 광역 폴백보다도 얕은 답이 나간다.
그래도 남의 구 전화번호를 주는 것보다는 낫다는 게 지금의 설계다.

### 3-3. 저장소에 이미 있는 동명 자치구 케이스

`src/data/region-evaluation-cases.json` (94건 중 관련된 것):

```json
{ "region": "부산 해운대구", "expectedRegionId": "busan", "expectedLevel": "metro", "expectedNamedSubRegion": "해운대구" }
{ "region": "해운대구",     "expectedRegionId": "busan", "expectedLevel": "metro", "expectedNamedSubRegion": "해운대구" }
{ "region": "부평구",       "expectedRegionId": "incheon", "expectedLevel": "metro", "expectedNamedSubRegion": "부평구" }
{ "region": "부산 중구",    "expectedRegionId": "busan", "expectedLevel": "metro", "expectedNamedSubRegion": "중구" }
{ "region": "대구 동구",    "expectedRegionId": "daegu", "expectedLevel": "metro", "expectedNamedSubRegion": "동구" }
{ "region": "인천 서구",    "expectedRegionId": "incheon", "expectedLevel": "metro", "expectedNamedSubRegion": "서구" }
{ "region": "부산 어쩌구",  "expectedRegionId": "busan", "expectedLevel": "metro", "expectedNamedSubRegion": null }
{ "region": "경기 광주시",  "expectedRegionId": "gyeonggi", "expectedLevel": "metro", "expectedNamedSubRegion": "광주시" }
```

앞의 셋은 **고쳐야 하고**, 뒤의 다섯은 **그대로 통과해야 한다.** 이 갈림이 Phase 9의 회귀 방어선이다.

`src/data/mcp-answer-cases.json` (487건 중 관련된 것):

- `region_info_metro_fallback_battery_collection` — `{region: "부산 해운대구", itemName: "폐건전지 수거함 위치 알려줘"}`.
  광역 폴백 문구 전체와 `"regionStatus":"unregistered_district"`를 고정한다.
- `region_metro_names_the_homonym_district_busan_jung` — `{region: "부산 중구"}`. 광역이 앞에 붙으면 이름을 부른다.
- `region_bare_homonym_district_stays_national_jung` — `{region: "중구"}`. 맨 이름은 전국 폴백에 머문다.
  `"부산광역시"`가 응답에 **안 나오는지**까지 본다.
- `region_metro_named_homonym_district_bulky_item_daegu_dong` — `{region: "대구 동구", itemName: "책상의자"}`.
  품목을 같이 물어도 되묻지 않고 이름을 부른다.

이 넷이 고정하는 규칙을 한 줄로 줄이면 이렇다. **광역 접두어가 붙으면 이름을 부르고, 맨 이름은 확정하지 않는다.**
Phase 9는 앞쪽 절반만 "부르는 대신 확정한다"로 바꾸고, 뒤쪽 절반은 손대지 않는다.

---

## 4. 초안

### 4-1. `region-policies.json` 항목 골격

`sources`·`summary`·`specialCollections`·`bulkyWaste`는 R2에서 채운다. 나머지는 그대로 쓰면 된다.
아래는 `haeundae_gu` 하나를 다 편 것이고, 나머지 일곱은 `id`/`name`/`aliases`/`metroId`만 2-3의 표에서
갈아 끼우면 형태가 같다.

```json
{
  "id": "haeundae_gu",
  "name": "부산 해운대구",
  "aliases": ["해운대구", "부산 해운대구", "부산시 해운대구", "부산광역시 해운대구", "haeundae-gu"],
  "coverageTier": "standard",
  "metroId": "busan",
  "checkedAt": "TODO: R2에서 채운다 (실제 확인일, YYYY-MM-DD)",
  "summary": "TODO: R2에서 채운다 (그 지역에서 실제로 다른 점만 두세 문장)",
  "specialCollections": {
    "medicine": { "method": ["TODO: R2에서 채운다"] },
    "batteryAndFluorescentLamp": { "method": ["TODO: R2에서 채운다"] }
  },
  "bulkyWaste": {
    "applicationUrl": "TODO: R2에서 채운다 (https)",
    "feeUrl": "TODO: R2에서 채운다 (https)",
    "phone": "TODO: R2에서 채운다 (자원순환과·청소행정과 직통)",
    "contactCheckedAt": "TODO: R2에서 채운다 (YYYY-MM-DD)"
  },
  "sources": [
    { "title": "TODO", "url": "TODO(https)", "sourceType": "local_guidance", "checkedAt": "TODO", "basis": "TODO" },
    { "title": "TODO", "url": "TODO(https)", "sourceType": "local_guidance", "checkedAt": "TODO", "basis": "TODO" }
  ]
}
```

나머지 일곱 곳:

```
{ "id": "busanjin_gu",    "name": "부산 부산진구", "metroId": "busan",
  "aliases": ["부산진구", "부산 부산진구", "부산시 부산진구", "부산광역시 부산진구", "busanjin-gu"] }
{ "id": "dalseo_gu",      "name": "대구 달서구",  "metroId": "daegu",
  "aliases": ["달서구", "대구 달서구", "대구시 달서구", "대구광역시 달서구", "dalseo-gu"] }
{ "id": "buk_gu_daegu",   "name": "대구 북구",    "metroId": "daegu",
  "aliases": ["대구 북구", "대구시 북구", "대구광역시 북구", "daegu-buk-gu"] }
{ "id": "namdong_gu",     "name": "인천 남동구",  "metroId": "incheon",
  "aliases": ["남동구", "인천 남동구", "인천시 남동구", "인천광역시 남동구", "namdong-gu"] }
{ "id": "bupyeong_gu",    "name": "인천 부평구",  "metroId": "incheon",
  "aliases": ["부평구", "인천 부평구", "인천시 부평구", "인천광역시 부평구", "bupyeong-gu"] }
{ "id": "seo_gu_daejeon", "name": "대전 서구",    "metroId": "daejeon",
  "aliases": ["대전 서구", "대전시 서구", "대전광역시 서구", "daejeon-seo-gu"] }
{ "id": "buk_gu_gwangju", "name": "광주 북구",    "metroId": "gwangju",
  "aliases": ["광주 북구", "광주시 북구", "광주광역시 북구", "gwangju-buk-gu"] }
```

### 4-2. standard 티어 필수 필드 체크리스트

`scripts/validate-data.mjs`를 읽고 뽑았다. **하나라도 비면 그 지역은 못 들어간다.**
R2에서 구청마다 무엇을 반드시 구해와야 하는지가 이 목록이다.

지역 하나당 반드시 있어야 하는 것:

- [ ] `id` — 소문자 snake_case(`^[a-z0-9_]+$`), 기존 49개와 중복 금지
- [ ] `name` — 빈 문자열 불가
- [ ] `aliases` — **2개 이상**
- [ ] `coverageTier: "standard"`
- [ ] `metroId` — 값이 있어야 하고, 실제 metro 티어 id여야 한다
- [ ] `checkedAt` — `YYYY-MM-DD`
- [ ] `summary` — 빈 문자열 불가
- [ ] `specialCollections.medicine.method` — 배열이고 **빈 문자열이 아닌 원소가 하나 이상**
- [ ] `specialCollections.batteryAndFluorescentLamp.method` — 같은 조건
- [ ] `bulkyWaste.applicationUrl` — 값이 있어야 하고 **`https://`로 시작**
- [ ] `bulkyWaste.feeUrl` — 값이 있어야 하고 **`https://`로 시작**
- [ ] `bulkyWaste.phone` — 값이 있어야 하고, 아래 두 규칙을 통과해야 한다
- [ ] `bulkyWaste.contactCheckedAt` — `YYYY-MM-DD`
- [ ] `sources` — 1건 이상이고, 그중 **`https://` URL이 최소 하나**
- [ ] `sources[].title` / `sources[].sourceType` / `sources[].checkedAt` — 전부 필수.
      `sourceType`은 `official_guidance` | `local_guidance` | `law` | `safety_guidance` | `manual_review`
- [ ] `sources[].basis` — 없으면 warning(에러는 아니지만 코드 리뷰에서 지적된다)

전화번호 규칙 두 가지가 특히 잘 걸린다:

- 대표 민원번호(`^\d{2,3}-120$`, 예: `051-120`)는 **error**다. 자원순환과·청소행정과 직통을 써야 한다.
- 형식은 `^(\d{2,4}-\d{3,4}-\d{4}|\d{4}-\d{4})$` — `051-749-4374`나 `1522-3833` 같은 모양이다.
  `1577-6731`처럼 8자리 국번도 통과하고, 내선 표기(`051-749-4374(내선 2)`)는 안 된다.

district 티어에서 **넣으면 안 되는 것**:

- [ ] `districtAliases` / `prefixOnlyDistrictAliases` — metro 항목 전용. 자치구에 달면 error다.
- 배출 요일·시간·장소는 애초에 스키마에 없다. 커밋 `00bad44`에서 걷어낸 축이라 되살리지 않는다.

문서 카운트도 `validate-data.mjs`가 대조한다. 지역이나 케이스를 늘리면 **같은 커밋에서** 고쳐야 한다:

- `docs/session-coordination.md` — `지역 정책 데이터 (\d+)개`, `지역 평가 케이스 (\d+)개`,
  `MCP answer cases (\d+)개`(**본문에 나오는 전부**), 그리고 source snapshot 한 줄
  (`waste-items.json` N개, `evaluation-cases.json` N개, MCP answer cases N개, review count는 …)
- `docs/source-coverage.md` — `- MCP 답변 회귀 케이스: (\d+)`

현재값은 지역 49, 지역 평가 케이스 94, MCP answer cases 487이다.

### 4-3. `region-evaluation-cases.json` 케이스 초안

**고쳐야 하는 기존 3건** (append가 아니라 수정이다):

```json
{ "region": "부산 해운대구", "expectedRegionId": "haeundae_gu", "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "해운대구",      "expectedRegionId": "haeundae_gu", "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "부평구",        "expectedRegionId": "bupyeong_gu", "expectedLevel": "district", "expectedBulkyApplication": true }
```

`expectedNamedSubRegion` 필드는 빼야 한다. 그 필드는 광역으로 착지했을 때 부를 이름을 보는 것이라
자치구로 확정되면 볼 게 없다(`findNamedSubRegion`은 district 항목에 대해 항상 `undefined`를 준다).

**새로 넣는 확정 케이스 7건.** 해운대구는 위 3건에서 이미 고치므로 여기 또 적지 않는다 —
같은 `region` 문자열이 두 벌 남아도 `test-region-matching.ts`는 배열을 그냥 순회할 뿐이라 잡히지 않고,
`validate-data.mjs`가 `docs/session-coordination.md`와 대조하는 지역 평가 케이스 수만 조용히 어긋난다.

```json
{ "region": "부산 부산진구", "expectedRegionId": "busanjin_gu",   "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "대구 달서구",   "expectedRegionId": "dalseo_gu",     "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "대구 북구",     "expectedRegionId": "buk_gu_daegu",  "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "인천 남동구",   "expectedRegionId": "namdong_gu",    "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "인천 부평구",   "expectedRegionId": "bupyeong_gu",   "expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "대전 서구",     "expectedRegionId": "seo_gu_daejeon","expectedLevel": "district", "expectedBulkyApplication": true }
{ "region": "광주 북구",     "expectedRegionId": "buk_gu_gwangju","expectedLevel": "district", "expectedBulkyApplication": true }
```

품목까지 함께 보는 케이스는 `expectedGuideContains`가 필요한데, 그 문구는 R2에서 `itemGuides`를 실제로
넣기로 할 때만 쓸 수 있다. standard 티어에 `itemGuides`를 넣을 계획이 없으면 `query` 없는 형태로 둔다
(`query`를 주고 `expectedGuideContains`를 빼면 그 자체로 실패한다).

**동명 자치구 반례 — 지역마다 하나씩.** 왼쪽이 "안 바뀌어야 하는 것"이다.

```json
{ "region": "북구",       "expectedRegionId": null, "note": "대구·광주 북구를 넣어도 맨 북구는 전국 폴백에 머문다" }
{ "region": "서구",       "expectedRegionId": null, "note": "대전 서구를 넣어도 맨 서구는 전국 폴백에 머문다" }
{ "region": "부산 북구",   "expectedRegionId": "busan",   "expectedLevel": "metro", "expectedNamedSubRegion": "북구" }
{ "region": "울산 북구",   "expectedRegionId": "ulsan",   "expectedLevel": "metro", "expectedNamedSubRegion": "북구" }
{ "region": "광주 서구",   "expectedRegionId": "gwangju", "expectedLevel": "metro", "expectedNamedSubRegion": "서구" }
{ "region": "대전 동구",   "expectedRegionId": "daejeon", "expectedLevel": "metro", "expectedNamedSubRegion": "동구" }
{ "region": "부산 사하구", "expectedRegionId": "busan",   "expectedLevel": "metro", "expectedNamedSubRegion": "사하구" }
{ "region": "대구 수성구", "expectedRegionId": "daegu",   "expectedLevel": "metro", "expectedNamedSubRegion": "수성구" }
{ "region": "인천 미추홀구","expectedRegionId": "incheon","expectedLevel": "metro", "expectedNamedSubRegion": "미추홀구" }
```

`부산 중구`·`대구 동구`·`인천 서구`는 이 목록에서 뺐다. **셋 다 이미 파일에 글자까지 똑같이 들어 있고**,
3-3에서 "그대로 통과해야 하는 것"으로 분류해 둔 바로 그 케이스들이다. 또 적으면 두 벌이 된다.

맨 `북구`·`서구` 두 줄은 **스키마가 지금 그대로는 못 받는다.** `region-evaluation-cases.json`의 타입에는
"확정되면 안 된다"를 적을 자리가 없다(`expectedStatus: "ambiguous"`는 되묻기 전용이다).
확정 거부는 두 군데가 이미 막고 있으니 케이스로 또 적을 필요가 없다.

- `test-region-matching.ts`의 `nationallyAmbiguousDistrictQueries` — 여섯 이름과 로마자를 전부 본다.
- `logs/region-expansion-queries.example.jsonl`의 `expectRefusal: true` — `강서구` 줄이 선례다.

그러니 맨 이름 반례는 **jsonl 쪽에 `expectRefusal`로 넣는다.** 위 JSON 두 줄은 의도를 적어 둔 것이지
그대로 붙일 값이 아니다.

### 4-4. `logs/region-expansion-queries.example.jsonl` 갱신안

DoD가 이 파일로 재는 만큼 초안을 그대로 적어 둔다.

기존 4줄 수정:

```jsonl
{"query": "부산 해운대구", "expectedRegionId": "haeundae_gu", "expectedLevel": "district"}
{"query": "인천 남동구", "expectedRegionId": "namdong_gu", "expectedLevel": "district"}
{"query": "해운대구", "expectedRegionId": "haeundae_gu", "expectedLevel": "district"}
{"query": "부평구", "expectedRegionId": "bupyeong_gu", "expectedLevel": "district"}
```

새로 추가할 14줄:

```jsonl
{"query": "부산 부산진구", "expectedRegionId": "busanjin_gu", "expectedLevel": "district"}
{"query": "부산진구", "expectedRegionId": "busanjin_gu", "expectedLevel": "district"}
{"query": "대구 달서구", "expectedRegionId": "dalseo_gu", "expectedLevel": "district"}
{"query": "달서구", "expectedRegionId": "dalseo_gu", "expectedLevel": "district"}
{"query": "대구 북구", "expectedRegionId": "buk_gu_daegu", "expectedLevel": "district"}
{"query": "대구광역시 북구", "expectedRegionId": "buk_gu_daegu", "expectedLevel": "district"}
{"query": "광주 북구", "expectedRegionId": "buk_gu_gwangju", "expectedLevel": "district"}
{"query": "대전 서구", "expectedRegionId": "seo_gu_daejeon", "expectedLevel": "district"}
{"query": "인천 부평구", "expectedRegionId": "bupyeong_gu", "expectedLevel": "district"}
{"query": "남동구", "expectedRegionId": "namdong_gu", "expectedLevel": "district"}
{"query": "북구", "expectRefusal": true, "note": "대구·광주 북구를 넣어도 부산·울산 북구가 남아 확정 거부가 정답"}
{"query": "서구", "expectRefusal": true, "note": "대전 서구를 넣어도 부산·대구·인천·광주 서구가 남는다"}
{"query": "부산 북구", "expectedRegionId": "busan", "expectedLevel": "metro"}
{"query": "울산 북구", "expectedRegionId": "ulsan", "expectedLevel": "metro"}
```

이렇게 하면 n=79 → 93, 자치구 확정 30 → 44가 되어 **38.0% → 47.3%**가 나온다.
(광역 폴백 48 → 46, 전국 폴백 1 → 3.) 계산이지 측정이 아니니 실제로 돌려서 확인한다.
4곳으로 줄이는 축소안이면 해당 줄만 빼면 되고, 그때도 38.0%는 넘는다.

### 4-5. `mcp-answer-cases.json` 케이스 초안 (`p9_` prefix)

**먼저 손봐야 하는 기존 케이스가 하나 있다.** `region_info_metro_fallback_battery_collection`은
`부산 해운대구`로 광역 폴백 문구 전체를 고정하고 있어서, 해운대구를 등록하면 스모크가 깨진다.
append-only 원칙의 예외가 불가피하다. 두 가지 길이 있고 **후자를 권한다.**

1. 이 케이스의 문구 기대값을 자치구 응답으로 갈아엎는다 → 광역 폴백 계약을 검증하던 케이스가 사라진다.
2. 아직 미등록인 구로 옮긴다(`부산 사하구`가 맞다). 검증하던 계약은 그대로 살고,
   해운대구는 아래 `p9_` 케이스로 새로 덮는다.
   **인자만 바꿔서는 안 된다** — 이 케이스는 구 이름을 기대 문자열 네 군데에 직접 박아 뒀다.
   `expectedTextIncludes`의 `"해운대구 상세 데이터는 아직 없어 부산광역시 광역 기준으로 안내합니다"`와
   `"대형폐기물 신청 경로와 수수료는 해운대구 소관이니"`, `expectedTextExcludes`는 그대로 두고,
   `expectedStructuredIncludes`의 `"\"region\":\"부산 해운대구\""`까지 넷을 함께 갈아야 스모크가 통과한다.

신규 케이스:

```json
{ "id": "p9_haeundae_bulky_contact", "tool": "get_region_disposal_info",
  "arguments": { "region": "부산 해운대구" },
  "expectedTextIncludes": ["부산 해운대구 지역 확인 안내", "문의/신청 안내 전화: TODO", "인터넷 신청: TODO", "수수료 조회: TODO"],
  "expectedTextExcludes": ["상세 데이터는 아직 없어", "부산광역시 광역 기준"],
  "expectedStructuredIncludes": ["\"regionStatus\":\"district\"", "\"coverageTier\":\"standard\""] }

{ "id": "p9_haeundae_sofa_steps", "tool": "get_disposal_steps",
  "arguments": { "itemName": "소파", "region": "부산 해운대구" },
  "expectedTextIncludes": ["부산 해운대구 기준", "TODO(전화번호)"],
  "expectedTextExcludes": ["해운대구 상세 데이터는 아직 없어"] }

{ "id": "p9_namdong_bulky_contact", "tool": "get_region_disposal_info",
  "arguments": { "region": "인천 남동구" }, "…": "위와 같은 형태" }

{ "id": "p9_dalseo_bulky_contact",  "tool": "get_region_disposal_info", "arguments": { "region": "대구 달서구" } }
{ "id": "p9_bupyeong_bulky_contact","tool": "get_region_disposal_info", "arguments": { "region": "인천 부평구" } }
{ "id": "p9_busanjin_bulky_contact","tool": "get_region_disposal_info", "arguments": { "region": "부산 부산진구" } }
{ "id": "p9_daegu_buk_bulky_contact",  "tool": "get_region_disposal_info", "arguments": { "region": "대구 북구" } }
{ "id": "p9_daejeon_seo_bulky_contact","tool": "get_region_disposal_info", "arguments": { "region": "대전 서구" } }
{ "id": "p9_gwangju_buk_bulky_contact","tool": "get_region_disposal_info", "arguments": { "region": "광주 북구" } }
```

**반례 — 지역마다 하나씩.** 새 데이터가 새면 안 되는 자리다.

```json
{ "id": "p9_bare_buk_gu_stays_national", "tool": "get_region_disposal_info",
  "arguments": { "region": "북구" },
  "expectedTextIncludes": ["\"북구\"은(는) 아직 상세 지역 데이터가 없습니다"],
  "expectedTextExcludes": ["대구광역시", "광주광역시", "TODO(대구 북구 전화번호)", "TODO(광주 북구 전화번호)"],
  "expectedStructuredIncludes": ["\"regionStatus\":\"unknown\""] }

{ "id": "p9_bare_seo_gu_stays_national", "tool": "get_region_disposal_info",
  "arguments": { "region": "서구" },
  "expectedTextIncludes": ["\"서구\"은(는) 아직 상세 지역 데이터가 없습니다"],
  "expectedTextExcludes": ["대전광역시", "TODO(대전 서구 전화번호)"],
  "expectedStructuredIncludes": ["\"regionStatus\":\"unknown\""] }

{ "id": "p9_busan_buk_gu_stays_metro", "tool": "get_region_disposal_info",
  "arguments": { "region": "부산 북구" },
  "expectedTextIncludes": ["부산광역시 지역 확인 안내", "북구 상세 데이터는 아직 없어 부산광역시 광역 기준으로 안내합니다"],
  "expectedTextExcludes": ["TODO(대구 북구 전화번호)", "TODO(광주 북구 전화번호)"],
  "expectedStructuredIncludes": ["\"regionStatus\":\"unregistered_district\""] }

{ "id": "p9_ulsan_buk_gu_stays_metro",  "…": "위와 같되 울산광역시" }
{ "id": "p9_gwangju_seo_gu_stays_metro","…": "위와 같되 광주광역시 + 서구" }
{ "id": "p9_incheon_seo_gu_stays_metro","…": "위와 같되 인천광역시 + 서구" }
{ "id": "p9_daejeon_dong_gu_stays_metro","…": "위와 같되 대전광역시 + 동구" }

{ "id": "p9_busan_metro_has_no_district_phone", "tool": "get_region_disposal_info",
  "arguments": { "region": "부산" },
  "expectedTextIncludes": ["부산광역시 광역 기준 안내입니다", "시·군·구를 알려주시면"],
  "expectedTextExcludes": ["문의/신청 안내 전화", "TODO(해운대구 전화번호)", "TODO(부산진구 전화번호)"] }

{ "id": "p9_daegu_metro_has_no_district_phone",  "…": "위와 같되 대구" }
{ "id": "p9_incheon_metro_has_no_district_phone","…": "위와 같되 인천" }
{ "id": "p9_daejeon_metro_has_no_district_phone","…": "위와 같되 대전" }
{ "id": "p9_gwangju_metro_has_no_district_phone","…": "위와 같되 광주" }
```

마지막 다섯은 PRD가 콕 집은 반례다 — `부산` 질의에 해운대구 전화번호가 실리면 안 된다.
`region_metro_fallback_busan`이 이미 `"문의/신청 안내 전화"`를 `expectedTextExcludes`로 막고 있어서
사실상 덮이지만, 자치구 전화번호를 실제 문자열로 박아 두는 편이 회귀를 더 정확히 잡는다.

### 4-6. `scripts/import-bulky-fees.ts`의 `TARGETS` — 튜플만 늘려서는 안 된다

튜플은 `[고시상 지역명, regionId, 표시명]`이고 첫 칸은 표준데이터의 **`SGG_NM` 컬럼값**이다.
지금 들어 있는 4곳은 이렇다.

```ts
const TARGETS: Array<[string, string, string]> = [
  ["용산구", "yongsan_gu", "서울 용산구"],
  ["노원구", "nowon_gu", "서울 노원구"],
  ["강서구", "gangseo_gu", "서울 강서구"],
  ["관악구", "gwanak_gu", "서울 관악구"],
];
```

**문제는 그 아래 한 줄이다.**

```ts
const regionRows = rows.filter(r => r.CTPV_NM.startsWith("서울") && r.SGG_NM === gu);
```

시도(`CTPV_NM`)가 `"서울"`로 박혀 있다. 광역시 자치구를 이 배열에 그냥 넣으면 두 가지가 한꺼번에 터진다.

- 서울에는 해운대구가 없으니 `"해운대구: 표준데이터에 행이 없습니다."`로 throw된다.
- 서울 강서구 행을 부산 강서구가 가져가는 식의 **조용한 오귀속**은 더 나쁘다. `북구`·`서구`·`동구`처럼
  여러 시도에 같은 `SGG_NM`이 있는 이름은 시도를 안 걸면 네 광역시 행이 한 지역으로 뭉친다.

그래서 시도를 튜플의 네 번째 칸으로 올린다. 런타임 코드가 아니라 빌드타임 스크립트라 Phase 9 범위 안이다.

```ts
// [시도 접두(CTPV_NM), 고시상 지역명(SGG_NM), regionId, 표시명]
const TARGETS: Array<[string, string, string, string]> = [
  ["서울", "용산구",   "yongsan_gu",     "서울 용산구"],
  ["서울", "노원구",   "nowon_gu",       "서울 노원구"],
  ["서울", "강서구",   "gangseo_gu",     "서울 강서구"],
  ["서울", "관악구",   "gwanak_gu",      "서울 관악구"],
  ["부산", "해운대구", "haeundae_gu",    "부산 해운대구"],
  ["부산", "부산진구", "busanjin_gu",    "부산 부산진구"],
  ["대구", "달서구",   "dalseo_gu",      "대구 달서구"],
  ["대구", "북구",     "buk_gu_daegu",   "대구 북구"],
  ["인천", "남동구",   "namdong_gu",     "인천 남동구"],
  ["인천", "부평구",   "bupyeong_gu",    "인천 부평구"],
  ["대전", "서구",     "seo_gu_daejeon", "대전 서구"],
  ["광주", "북구",     "buk_gu_gwangju", "광주 북구"],
];

// 루프 안
const regionRows = rows.filter(r => r.CTPV_NM.startsWith(ctpv) && r.SGG_NM === gu);
```

`CTPV_NM`이 `"부산광역시"`인지 `"부산"`인지는 원본을 받아 봐야 안다. `startsWith`를 그대로 두면
어느 쪽이든 걸린다. 다만 **행이 붙기 시작하면 첫 지역에서 `SGG_NM`·`CTPV_NM` 실값을 눈으로 확인한다.**

`import-bulky-fees.ts`는 대상 지역이 `region-policies.json`에 있고 신청 URL·수수료 URL·전화가
전부 채워져 있어야 돈다. **R2가 R3보다 먼저다.**

---

## 5. 로컬 세션이 이어서 할 일

### 5-1. R2 — 구청별로 찾아야 하는 것 (지역당 6종)

구청 홈페이지는 JS 렌더링·팝업·프레임이 많아 `curl`로는 본문이 안 나오는 곳이 흔하다. **Aside CLI를 1순위로 쓴다.**
서브커맨드는 착수할 때 `aside --help`와 https://docs.aside.com/help/developers 로 확인한다.
공개 페이지만 **읽는다** — 대형폐기물 신청을 실제로 접수하지 않고, 폼 제출 버튼을 누르지 않는다.

지역 하나마다:

1. **대형폐기물 인터넷 신청 URL** — 구청 본사이트가 아니라 신청 시스템 도메인일 때가 많다
   (서울 노원구의 `smartclean.nowon.kr`처럼). 구청 페이지에서 링크를 따라 들어가 실제 신청 화면을 확인한다.
   자체 신청 화면이 없고 상용 앱('빼기'·'여기로')에 위임한 곳이면 서울 중구 선례를 따른다 —
   구청 안내 페이지를 `applicationUrl`로 쓴다.
2. **수수료 조회 URL** — 신청 시스템의 품목·요금 페이지가 1순위. 없으면 구 폐기물 관리 조례 별표를 건다
   (서울 중구가 그렇게 돼 있다).
3. **직통 전화** — 자원순환과·청소행정과. 대표번호는 마지막 수단이고 `051-120` 같은 민원 대표번호는 validate가 막는다.
4. **폐의약품 배출 안내** — 수거함 위치 유형(주민센터/보건소/우체통)과 약 형태별 배출법.
5. **폐건전지·폐형광등 배출 안내** — 주택 유형별 수거함 위치.
6. **`sources` 2~3건** — https URL 최소 하나, `basis`에 "이 페이지에서 무엇을 확인했는지"를 적는다.

**배출 요일·시간·장소는 넣지 않는다.** 동·주택 유형별로 갈려 한 줄로 못 적는다.
요일을 물으면 확인처 링크로 닫는 게 현재 동작이고 그대로 둔다.

착수 순서는 **한 곳을 끝까지 채워 `pnpm check`를 한 번 통과시킨 다음** 나머지로 넘어간다.
여덟 곳을 반쯤씩 채워 두면 validate가 한꺼번에 수십 건을 뱉어 어디서부터 볼지 알 수 없다.
첫 곳은 `haeundae_gu`가 좋다 — 맨 이름 별칭을 달 수 있어 반례를 새로 짤 필요가 없고,
저장소에 관련 문서(`docs/region-gap-research-2026-07-02.md`)와 케이스가 이미 있어 대조하기 쉽다.

### 5-2. R3 — 수수료 임포트, 트랙 순서

**표준데이터 트랙부터 시도한다.** 세 트랙 중 커버리지가 가장 넓고, 파서 결함 위험이 가장 낮다.
Phase 6이 조례 별표 파싱에서 이웃 품목의 금액을 여러 번 넘겨받은 전력이 있다
(서대문 「세탁기 / 소형 / 1,000원」이 실은 고무통 값이었다).

```bash
node scripts/fetch-bulky-fee-standard-data.mjs   # 전국 22,831행 → logs/bulky-fee-standard-data.json
```

PRD R3은 이 단계를 `pnpm fees:fetch`로 적어 뒀는데 **그건 법제처 조례 트랙(`fetch-ordinance-fees.mjs`)이다.**
표준데이터 수집 스크립트에는 pnpm 별칭이 없어 `node`로 직접 부른다.

받은 뒤 **대상 구가 실제로 실려 있는지부터 본다.** 표준데이터는 전국이지만 모든 기초자치단체가 올리지는 않는다.

```bash
node -e "const r=require('./logs/bulky-fee-standard-data.json');
const t=['해운대구','부산진구','달서구','북구','남동구','부평구','서구'];
for(const n of t) console.log(n, [...new Set(r.filter(x=>x.SGG_NM===n).map(x=>x.CTPV_NM))].join('|'),
  r.filter(x=>x.SGG_NM===n).length);"
```

실려 있으면 4-6의 `TARGETS` 수정을 넣고 `pnpm import:fees` → `pnpm fees:verify:rows`.
없는 지역은 이 순서로 우회한다.

1. **조례 트랙** — `pnpm fees:fetch`(법제처) 후 `pnpm import:ordinance`
2. **구청 수수료표 트랙** — `pnpm fees:fetch:district` 후 `pnpm import:district`.
   `scripts/fetch-district-fees.mjs`의 `TARGETS`에 `kind`를 정해 넣어야 하는데,
   신청 시스템이 스마트클린 계열이면 기존 `smartclean` 파서를 그대로 쓴다.
3. **둘 다 안 되면 수수료 없이 신청 경로만 낸다.** 동작구 선례가 있다.
   금액을 못 실어도 신청 URL·전화가 있으면 광역 폴백보다 훨씬 낫다.

행을 넣었으면 **지역당 최소 10행을 원문과 눈으로 맞춘다.** 임포터의 보수 판정 기준
(무상수거 행 제외, 수식어 위치 검사, 복수 품목 표기 배제, 옵션 요금 행 배제, (지역, 품목) 12행 상한)은
그대로 둔다. 대상 지역만 늘린다.

### 5-3. 순서대로 정리한 작업 목록

> 2026-08-21에 1~9·11단계를 5곳 기준으로 끝냈다(0절). 남은 것은 미룬 3곳의 R2와,
> 5곳 전부에 해당하는 R3 수수료 임포트(10단계), 그리고 12·13단계다.

1. `region-policies.json`에 8곳(또는 축소안 4곳) 추가 — 4-1 골격에 R2로 모은 값을 채운다.
2. 같은 파일에서 광역 5곳의 `districtAliases`·`prefixOnlyDistrictAliases` 정리 — **2-4.**
3. `pnpm check` — 여기서 걸리는 게 4-2 체크리스트의 미비다.
4. `logs/region-expansion-queries.example.jsonl` 갱신 — **4-4.** 기존 4줄 수정 + 새 줄 추가.
5. `pnpm measure:region` — 오매칭 0, 자치구 확정 38.0% 초과를 확인한다.
6. `region-evaluation-cases.json` — 기존 3건 수정 + 확정 7건 + 반례 7건. **4-3.**
   맨 `북구`·`서구`는 이 파일이 못 받으므로 4단계의 jsonl에 `expectRefusal`로만 넣는다.
7. `mcp-answer-cases.json` — `region_info_metro_fallback_battery_collection`을 `부산 사하구`로 옮기고,
   `p9_` 케이스를 append한다. **4-5.**
8. 문서 카운트 갱신 — `docs/session-coordination.md`(지역 수·지역 케이스 수·answer case 수 전부),
   `docs/source-coverage.md`. **4-2 마지막 항목.**
9. `docs/qa-runbook.md` 두 줄을 손본다. 189줄은 "`해운대구`는 부산광역시로 착지한다"가 사실이 아니게 되고,
   184줄은 티어 집계("49개 지역 / `full` 5곳 / `standard` 27곳 / `metro` 17곳")가 통째로 틀어진다.
   **`validate-data.mjs`는 이 파일을 안 본다** — `source-coverage.md`와 `session-coordination.md`만 대조하므로
   여기서 빠뜨리면 검사는 초록인데 운영 문서만 오답으로 남는다.
10. R3 수수료 임포트 — **5-2.** 넣었으면 `pnpm fees:verify:rows`와 10행 눈 대조.
11. `pnpm local:test` → `pnpm check:links` 전건 통과.
12. `docs/prd/README.md`의 진행 상태 표와 `phase-9-metro-districts.md` 체크리스트를 갱신한다.
13. 브랜치를 푸시하고 PR을 연다. **Phase 8이 먼저 머지된다** — 열기 전에 최신 main을 반영하고
    `docs/source-coverage.md`의 answer case 수까지 맞춘 뒤 `pnpm local:test`를 한 번 더 돌린다.

### 5-4. 이 세션이 못 한 것

- 신청 URL·수수료 URL·전화번호·`checkedAt` — 이그레스가 막혀 한 곳도 못 열었다. 전부 `TODO`로 남겼다.
- 표준데이터에 대상 구가 실려 있는지 — `data.go.kr`을 못 열어 확인 못 했다. R3의 첫 관문이다.
- `pnpm check:links` — 네트워크를 쓰므로 여기서는 의미가 없다. 원래도 `pnpm check`에 안 들어 있다.
- `src/data/` 수정 — 일부러 안 했다. 필수 필드가 빈 채로 넣으면 validate가 깨지고
  나중에 로컬 세션과 충돌한다.
