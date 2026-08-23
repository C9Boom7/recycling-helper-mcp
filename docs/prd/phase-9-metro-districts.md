# Phase 9 — 광역시 자치구 확장

## 목표

서울·경기 밖 사용자가 광역 폴백 대신 **자기 구 이름과 신청 경로**를 받게 한다. 데이터만 넣는다.

## 배경

2026-08-21 본선 심사기준 자체 평가에서 편의성 항목의 가장 큰 감점 근거였다.

- 실제 데이터가 있는 기초자치단체는 **32곳**이다 — 서울 25개 구 전부와 경기 7개 시.
  전국 기초자치단체 226곳 기준 14%다.
- 나머지는 광역 티어로 착지한다. 부산·대구 사용자는 시·도 수준 안내만 받고
  대형폐기물 신청 경로, 문의 전화, 수수료 같은 알맹이를 못 받는다.
- 본선은 9/16~10/12 **전국 카카오톡 사용자 투표**다. 이 지역 편중이 그대로 표에 반영된다.
- 수수료 데이터는 26곳뿐이고 전부 서울(+성남)이다.

## 범위

포함: `src/data/region-policies.json`(신규 자치구 + 광역 티어의 별칭 목록 정리), `src/data/bulky-waste-fees.json`,
`src/data/region-evaluation-cases.json`, `src/data/mcp-answer-cases.json`,
`logs/region-expansion-queries.example.jsonl`(`measure:region`이 읽는 기대값),
`scripts/import-bulky-fees.ts`의 `TARGETS` 배열, `docs/session-coordination.md`.
Phase 8이 먼저 머지되므로 `docs/source-coverage.md`는 Phase 8 전담이지만, 이쪽이 나중에 머지되면
그 파일의 MCP 답변 케이스 수까지 맞춘다(아래 [Phase 8과 병렬로 돌 때](#phase-8과-병렬로-돌-때) 참고).

> **2026-08-21 예외 한 건.** 저장소 주인의 판단으로 `bulkyWaste.prePosting` 하나를 런타임에 넣었다. standard 티어 고정 문장이 부산 해운대구·부산진구에 "없는 접수번호를 붙이라"고 지시하고 있었는데, `bulkyLine`이 `coverageTier`만 보고 계산돼 데이터로는 못 고치는 자리였다. 값이 없는 지역은 기존 문장을 그대로 써서 매칭·기존 회귀는 건드리지 않는다.

**제외: 런타임 코드.** `src/server.ts`와 `src/data.ts`는 건드리지 않는다.
지역 매칭은 Phase 5에서 티어·단계형으로 다시 짰고 회귀 94건이 그 동작을 고정하고 있다.
8/31 개발 완료까지 그걸 다시 흔들 시간이 없다.

임포터의 보수 판정 기준(무상수거 행 제외, 수식어 위치 검사, 복수 품목 표기 배제, 옵션 요금 행 배제,
(지역, 품목) 12행 상한)도 그대로 둔다. 대상 지역만 늘린다.

## 요구사항

### R1. 대상 확정

1차 후보 8곳. 인구와 카카오톡 사용자 밀도를 기준으로 잡았다.

| 지역 | `id` | `metroId` |
| --- | --- | --- |
| 부산 해운대구 | `haeundae_gu` | `busan` |
| 부산 부산진구 | `busanjin_gu` | `busan` |
| 대구 달서구 | `dalseo_gu` | `daegu` |
| 대구 북구 | `buk_gu_daegu` | `daegu` |
| 인천 남동구 | `namdong_gu` | `incheon` |
| 인천 부평구 | `bupyeong_gu` | `incheon` |
| 대전 서구 | `seo_gu_daejeon` | `daejeon` |
| 광주 북구 | `buk_gu_gwangju` | `gwangju` |

`metroId`에 들어갈 값은 이미 데이터에 있는 광역 티어 id를 그대로 쓴다 —
`seoul`, `busan`, `daegu`, `incheon`, `gwangju`, `daejeon`, `ulsan`, `sejong`, `gyeonggi` 등.

**시간이 모자라면 8곳을 4곳으로 줄이고 나머지는 백로그로 넘긴다.** 얕게 여러 곳보다 깊게 몇 곳이 낫다.
standard 티어는 신청 URL·수수료 URL·전화·확인일·폐의약품·폐건전지가 전부 있어야 `validate-data.mjs`를 통과하고,
하나라도 비면 그 지역은 아예 못 들어간다.

`id` 작명에 주의한다. `buk_gu`, `seo_gu`, `jung_gu`, `dong_gu`는 여러 광역시에 동시에 있고
`jung_gu`는 이미 서울 중구가 쓰고 있다. **동명 자치구는 광역 접미사를 붙인다.**

`id`만 갈라서는 모자란다. **동명 자치구는 맨 이름을 `aliases`에 넣지 않는다.** 이번 8곳에서는
`북구`(대구·광주)와 `서구`(대전)가 걸린다. `북구`를 두 지역이 모두 별칭으로 들면 배열에서 먼저 나오는
쪽이 조용히 이기고, 부산 북구·울산 북구 사용자는 남의 구 전화번호를 받는다.
`validate-data.mjs`는 이걸 못 잡는다 — 광역의 `districtAliases`·`prefixOnlyDistrictAliases`는 광역끼리
중복을 검사하지만, 지역 자신의 `aliases`에는 지역 간 중복 검사가 없다.
맨 `중구`가 전국 폴백에 머무는 걸 고정한 `region_bare_homonym_district_stays_national_jung`이
이 저장소가 지켜 온 기준이다. 동명 자치구는 광역 접두어가 붙은 표기(`대구 북구`, `대구광역시 북구`)만
별칭으로 쓰고, 맨 이름은 그대로 되묻게 둔다.

**로마자 별칭도 광역 로마자로 시작하면 달지 않는다**(2026-08-21 실측). `busanjin-gu`를 달면
`bus`·`busa`가 자치구 별칭의 조각으로 걸려 부산진구로 확정되고, `daegu-buk-gu`는 `da`·`dae`·`daeg`를
대구 북구로 끌어간다. 조각(strength 1) 매칭에서 자치구가 광역보다 먼저 채택되기 때문이다.
빼도 `busanjin-gu` 질의는 부산광역시 폴백으로 안전하게 내려앉는다.
대신 광역 쪽에 `대구광`·`대구광역`을 별칭으로 더해 잘린 광역 이름이 자치구로 새지 않게 막는다.

해운대구는 닫아 둔 결정 하나와 겹친다. [data-decision-backlog.md](../data-decision-backlog.md) 2026-07-05 —
`부산 해운대구` **위치형 탐색**은 진행하지 않고 폐건전지 수거함 위치 질문은 `wont_fix`로 닫았다.
그 결정은 그대로 둔다. 이번에 넣는 건 "가까운 수거함이 어디냐"에 주소를 답하는 기능이 아니라
구청이 고지한 배출처 안내문이고, 그건 다른 standard 티어 지역과 같은 축이다.

### R1b. 광역 티어의 자치구 별칭에서 승격 대상을 뺀다

**이걸 빼먹으면 `pnpm check`가 47건 터진다.** 2026-08-21 실측으로 확인했다.

`region-policies.json`의 광역 티어 항목은 아직 등록되지 않은 자치구 이름을 두 목록으로 들고 있다.

- `districtAliases` — 이름만으로 그 광역에 착지시키는 목록. 부산의 `해운대구`·`부산진구`가 여기 있다.
- `prefixOnlyDistrictAliases` — 광역이 앞에 붙었을 때만 보는 목록. 동명 자치구(`중구`·`북구`·`서구`·`동구`·`남구`)가 여기 있다.

자치구를 standard 티어로 승격하면 **그 이름을 위 두 목록에서 반드시 뺀다.** 안 그러면 같은 이름을
광역과 자치구가 동시에 주장한다. 이번 8곳 기준으로 `busan`·`daegu`·`incheon`의 `districtAliases`와
`daegu`·`gwangju`·`daejeon`의 `prefixOnlyDistrictAliases`가 대상이다.

`prefixOnly` 쪽을 놓치기 쉽다. `test-region-matching.ts`의 naming sweep이
`"대구광역시 북구"`가 daegu에 metro로 착지하는지를 단언하기 때문에, 그 목록에 이름이 남아 있으면
승격했는데도 광역으로 끌려간다.

**빼는 건 승격하는 지역만이다.** 울산 북구·부산 북구처럼 이번에 안 넣는 곳은 목록에 그대로 둬서
광역 폴백에 남겨야 한다.

### R2. 지역 데이터 수집

지역 하나마다 아래를 모은다. `src/data/region-policies.json`의 기존 항목이 필드 구성의 기준이다.

- `name` (`부산 해운대구` 형식), `aliases` (`해운대구`, `부산시 해운대구`, `부산광역시 해운대구`, 로마자 표기)
- `coverageTier: "standard"`, `metroId`, `checkedAt`
- `summary` — 그 지역에서 실제로 다른 점만 두세 문장
- `specialCollections.medicine.method` — 폐의약품 수거함 위치 안내 (standard 티어 필수)
- `specialCollections.batteryAndFluorescentLamp.method` — 폐건전지·폐형광등 배출처 (standard 티어 필수)
- `bulkyWaste.applicationUrl`, `bulkyWaste.feeUrl`, `bulkyWaste.phone`, `bulkyWaste.contactCheckedAt` (전부 필수)
- `sources` — 2~3건, **https URL이 최소 하나** 있어야 한다 (standard 티어 검사)

**배출 요일·시간·장소는 넣지 않는다.** 커밋 `00bad44`에서 일부러 걷어낸 축이다.
동·주택 유형별로 갈려서 한 줄로 못 적고, 틀리게 적으면 확신 있는 오답이 된다.
요일을 물으면 확인처 링크로 닫는 게 현재 동작이고 그대로 둔다.

#### 크롤링 도구

**Aside CLI를 1순위로 쓴다.** 구청 홈페이지는 JS 렌더링·팝업·프레임이 많아 `curl`로는 본문이 안 나오는 곳이 흔하다.
대형폐기물 신청 시스템은 별도 도메인으로 빠져 있는 경우가 많아(서울 노원구의 `smartclean.nowon.kr`처럼)
구청 본사이트에서 링크를 따라 들어가야 실제 신청 URL이 나온다.

- 정확한 서브커맨드는 착수할 때 `aside --help`와 https://docs.aside.com/help/developers 로 확인한다.
  이 문서에 명령을 박아두지 않는 건, 문서를 쓴 세션이 그 문법을 직접 확인하지 못했기 때문이다.
- Aside는 **로그인된 실제 브라우저**를 몰고 다닌다. 공개 페이지만 연다. 대형폐기물 신청을 실제로 접수하지 않는다 —
  **읽기만 한다.** 폼 제출 버튼을 누르지 않고, 자격 증명을 입력하거나 남기지 않는다.
- `data.go.kr` 표준데이터와 법제처 자치법규 API는 정적 JSON이라 Aside가 필요 없다.
  기존 스크립트(`node scripts/fetch-bulky-fee-standard-data.mjs`, `pnpm fees:fetch`, `pnpm fees:fetch:district`)를 그대로 쓴다.
- 전화번호는 자원순환과·청소행정과 직통을 쓰고, 대표번호는 마지막 수단이다. 확인한 페이지를 `sources[].basis`에 남긴다.

### R3. 수수료 임포트

```bash
node scripts/fetch-bulky-fee-standard-data.mjs   # 전국 표준데이터 → logs/bulky-fee-standard-data.json
# scripts/import-bulky-fees.ts 를 아래대로 고친 뒤
pnpm import:fees
pnpm fees:verify:rows
```

표준데이터 수집에는 **`pnpm fees:fetch`를 쓰지 않는다.** 그건 법제처 조례 트랙이다(`fetch-ordinance-fees.mjs`).
표준데이터 스크립트에는 package script가 없어서 파일을 직접 부른다.

**`TARGETS` 튜플만 늘려서는 안 된다.** 지금 `import-bulky-fees.ts`는 행을 이렇게 고른다.

```ts
const regionRows = rows.filter(r => r.CTPV_NM.startsWith("서울") && r.SGG_NM === gu);
```

시도가 `"서울"`로 박혀 있다. 광역시 구를 그대로 넣으면 한 행도 안 걸려 throw하고,
`북구`·`서구`처럼 여러 광역시에 있는 이름은 시도 필터가 없으면 네 곳의 행을 한 지역으로 뭉친다.
**시도를 튜플에 한 칸 더 넣고 필터를 그 값으로 바꾼다** — `[시도, 고시상 지역명, regionId, 표시명]`.
기존 서울 4곳도 같은 형태로 옮긴다.

이건 `scripts/` 변경이라 빌드타임이다. 런타임 무변경 원칙은 그대로 지킨다.

**착수 전에 원본을 받아 대상 구가 실제로 실려 있는지부터 본다.** 표준데이터는 전국이지만
모든 기초자치단체가 올리는 건 아니다. 없으면 이 순서로 우회한다.

1. 조례 트랙 — `pnpm fees:fetch` (법제처) 후 `pnpm import:ordinance`
2. 구청 수수료표 트랙 — `pnpm fees:fetch:district` 후 `pnpm import:district`
3. 둘 다 안 되면 **수수료 없이 신청 경로만 낸다.** 동작구 선례가 있다.
   금액을 못 실어도 신청 URL·전화가 있으면 광역 폴백보다 훨씬 낫다.

`import-bulky-fees.ts`는 대상 지역이 `region-policies.json`에 있고 신청 URL·수수료 URL·전화가 모두 채워져 있어야
동작한다. **R2가 R3보다 먼저다.**

수수료 행을 넣었으면 원문과 대조한다. 이 저장소는 조례 별표 파싱에서 이웃 품목의 금액이 넘어오는 사고를
여러 번 겪었다(서대문 「세탁기 / 소형 / 1,000원」이 실은 고무통 값이었다). 지역당 최소 10행을 표본으로 눈으로 맞춘다.

### R3b. 광역 폴백을 기대하던 기존 케이스를 갱신한다

승격하는 순간 지금 광역 폴백을 기대하는 케이스가 깨져 `pnpm check`와 스모크가 멈춘다.
**케이스 파일이 append-only라는 규칙은 새 케이스를 넣을 때 얘기고, 아래 넷은 기대값을 고쳐야 한다.**

`src/data/region-evaluation-cases.json` — 3건. 8곳을 다 넣을 때 기준이고, 대상을 줄이면 그만큼만 고친다.

| 지금 값 | 승격 후 |
| --- | --- |
| `{"region":"부산 해운대구","expectedRegionId":"busan","expectedLevel":"metro","expectedNamedSubRegion":"해운대구"}` | `haeundae_gu` / `district` |
| `{"region":"해운대구","expectedRegionId":"busan","expectedLevel":"metro",…}` | `haeundae_gu` / `district` |
| `{"region":"부평구","expectedRegionId":"incheon","expectedLevel":"metro",…}` | `bupyeong_gu` / `district` |

`src/data/mcp-answer-cases.json` — `region_info_metro_fallback_battery_collection` 1건.
`부산 해운대구`에 "해운대구 상세 데이터는 아직 없어 부산광역시 광역 기준으로 안내합니다"와
`"regionStatus":"unregistered_district"`를 기대하고 있다. **지우지 말고 자치구 확정 응답으로 기대값을 옮긴다.**
그 질의가 어디로 가는지를 고정하는 자리는 그대로 있어야 한다.

`logs/region-expansion-queries.example.jsonl` — `measure:region`이 읽는 입력이다.
`부산 해운대구`·`인천 남동구`·`해운대구` 세 줄이 `expectedLevel: "metro"`다. 승격한 곳만 `district`로 바꾼다.
`부산 기장군`·`대구 수성구`·`대전 유성구`는 이번에 안 넣으니 그대로 둔다.

**반대로, 안 넣는 지역의 폴백 케이스는 손대지 않는다.** `부산 중구`·`대구 동구`·`인천 서구`는
광역 폴백에 남는 게 맞는 동작이고, 그걸 고정하는 케이스가 이번 작업의 안전망이다.

### R4. 케이스와 검증

`src/data/region-evaluation-cases.json` — 신규 지역마다 확정 케이스.
```json
{ "region": "해운대구", "query": "폐건전지", "expectedRegionId": "haeundae_gu",
  "expectedItemId": "battery", "expectedGuideContains": "..." }
```

`src/data/mcp-answer-cases.json` — **append-only**, id는 `p9_` prefix.
신청 경로·문의 전화·수수료 줄이 실제로 답변에 실리는지 고정한다.

**반례를 반드시 함께 넣는다.**

- 광역 폴백에 자치구 값이 새지 않는가 — `부산` 질의에 해운대구 전화번호가 실리면 안 된다.
- 동명 자치구가 갈리는가 — `부산 중구`/`대구 중구`는 이름을 부르고, 맨 `중구`는 어느 광역으로도 확정하지 않고 전국 폴백에 머문다.
  `대구 북구`를 넣으면 `북구` 단독 질의가 어디로 가는지 반드시 케이스로 고정한다.
  저장소에 `부산 중구`·`대구 동구` 케이스가 이미 있으니 그 형태를 따른다.

검증:
```bash
pnpm local:test
pnpm measure:region     # 자치구 확정 비율이 올라갔는지
pnpm check:links        # 신규 링크 포함 전건
```

## 완료 기준 (DoD)

- [ ] 신규 지역 전부 자치구로 확정되고 **오매칭 0**
- [ ] `pnpm measure:region`의 자치구 확정 비율이 38.0%(현재값)보다 올라간다
- [ ] `pnpm check:links` 전건 통과
- [ ] `pnpm local:test` 통과
- [ ] 신규 지역마다 `sources` 2건 이상, https URL 1건 이상, `checkedAt`은 실제 확인일
- [ ] 동명 자치구 반례가 신규 지역마다 있다
- [ ] 동명 자치구(`북구`·`서구`)의 맨 이름이 어느 지역 `aliases`에도 들어가 있지 않다
- [ ] 승격한 자치구 이름을 광역 티어의 `districtAliases`·`prefixOnlyDistrictAliases`에서 뺐다
- [ ] 안 넣는 동명 자치구(울산 북구·부산 북구 등)는 광역 폴백에 그대로 남는다
- [ ] 광역 폴백을 기대하던 기존 케이스 4건(R3b)을 지우지 않고 기대값만 갱신했다
- [ ] `logs/region-expansion-queries.example.jsonl`의 기대값을 승격에 맞춰 고쳤다
- [ ] 수수료를 넣은 지역은 지역당 10행 이상을 원문과 눈으로 대조했다
- [ ] `docs/session-coordination.md`의 지역 개수·수수료 행 수가 데이터와 일치

## Phase 8과 병렬로 돌 때

같은 시기에 [phase-8-item-coverage.md](phase-8-item-coverage.md)가 품목 데이터를 넣는다. 겹치는 파일이 둘이다.

| 파일 | 규칙 |
| --- | --- |
| `src/data/mcp-answer-cases.json` | append-only. Phase 8은 `p8_`, Phase 9는 `p9_` prefix |
| `docs/session-coordination.md` | 나중에 머지되는 쪽이 최종 카운트로 맞춘다 |

**머지 순서는 Phase 8이 먼저다.** Phase 9는 머지 전에 최신 main을 브랜치에 반영하고,
`docs/source-coverage.md`의 MCP 답변 케이스 수까지 맞춘 뒤 `pnpm local:test`를 한 번 더 통과시킨다.
그 파일은 Phase 8 전담이지만 케이스 총계는 이쪽도 늘리기 때문이다.

## 작업 규칙

- 브랜치 `claude/phase9-metro-districts`에서 작업하고 PR을 연다. **main에 직접 커밋하거나 push하지 않는다.**
- 커밋 author는 저장소 주인(c9boom7), 에이전트 기여는 `Co-Authored-By`로 남긴다.
- 머지는 저장소 주인이 지시할 때만 한다. 머지가 곧 본선 서버 재배포 게이트다.

## 체크리스트

- [x] R1 대상 확정 — 8곳 중 **7곳을 넣었다.** 2026-08-22에 해운대·부산진·대구 북구·남동·부평, 2026-08-23에 달서·광주 북구
- [x] R1b 광역 별칭 정리 — `daegu.districtAliases`에서 `달서구`, `gwangju.prefixOnlyDistrictAliases`에서 `북구`를 뺐다
- [x] R2 지역 데이터 수집 — 지역마다 출처 4건, 전부 https
- [ ] R3 수수료 임포트 — 넣지 않았다. 아래 "수수료를 넣지 않은 이유" 참고
- [x] R3b 기존 폴백 케이스 갱신 — 달서·광주 북구를 광역 폴백으로 기대하던 케이스는 없었다. 맨 `북구` 거부 케이스의 사유 문구만 고쳤다
- [x] R4 케이스와 검증 — 지역 평가 케이스 108 → 113, MCP 답변 케이스 561 → 567
- [x] PR 생성

## 대전 서구를 넣지 못한 이유 (2026-08-23)

**폐의약품 안내를 구청 출처로 채울 수 없었다.** standard 티어 필수 필드라 하나가 비면 지역이 통째로 못 들어간다.

찾아본 곳과 결과를 적어 둔다. 다음에 다시 잡을 때 같은 검색을 되풀이하지 않도록.

- 구청 통합검색 `폐의약품` — **0건** (UTF-8·EUC-KR 두 인코딩 모두)
- 구청 `환경청소` 메뉴 — 생활쓰레기·재활용품·폐형광등·음식물·대형폐기물·공사장·무단투기·종량제 여덟 갈래뿐이고 폐의약품 항목이 없다
- 서구보건소 누리집 — 폐의약품 관련 메뉴가 없다(`안전상비의약품 판매업소 현황`만 있다)
- 공공데이터포털 `대전광역시 서구_폐의약품 수거함 현황`(15077806) — **데이터셋이 내려갔다.** 링크가 404다. 같은 기관의 폐건전지 수거함 현황(15126970)은 살아 있다

**나머지 필드는 다 확인해 뒀다.** 폐의약품 출처만 나오면 바로 들어간다.

| 필드 | 값 |
| --- | --- |
| `bulkyWaste.applicationUrl` | `https://www.seogu.go.kr/waste/main.do` (구청 자체 인터넷 배출신고 시스템) |
| `bulkyWaste.feeUrl` | `https://www.seogu.go.kr/waste/user/info/wasteCost.do?wMenuId=1010200` (품목·규격·금액 3열 표) |
| `bulkyWaste.phone` | `042-288-3584` (자원순환과, 대형폐기물 페이지 담당자) |
| `prePosting` | `sticker` — 신고 → 수수료 납부 → 스티커 혹은 배출번호 기재 부착 → 수거 |
| 폐형광등·폐전지 | `https://www.seogu.go.kr/kor/sub06_11_02_03.do` — 아파트는 단지 내 수거함, 단독주택은 동 행정복지센터 수거함. 깨진 형광등·백열등은 종량제봉투. 담당 042-288-3552 |

## 수수료를 넣지 않은 이유 (2026-08-23)

달서·광주 북구 둘 다 구청 누리집에 수수료표가 **HTML 표로** 떠 있어(달서 `menu_id=00002025`, 광주 북구 `mid=a10406070000`) 읽는 것 자체는 된다.
넣지 않은 건 `import-bulky-fees.ts`가 표준데이터(`logs/bulky-fee-standard-data.json`)만 읽고, 시도 필터가 `"서울"`로 박혀 있어 **임포터를 고쳐야 하기 때문**이다.
PRD R3이 적어 둔 대로 튜플에 시도를 한 칸 더 넣는 작업이고, 기존 서울 4곳도 같은 형태로 옮겨야 해서 이번 범위에서는 잘랐다.
수수료 없이도 신청 URL·수수료 조회 URL·직통번호가 광역 폴백보다 낫다는 건 동작구 선례가 있다(PRD R3의 3번 우회).
