# Phase 9 — 광역시 자치구 확장

## 목표

서울·경기 밖 사용자가 광역 폴백 대신 **자기 구 이름과 신청 경로**를 받게 한다. 데이터만 넣는다.

## 배경

2026-08-21 본선 심사기준 자체 평가에서 편의성 항목의 가장 큰 감점 근거였다.

- 실제 데이터가 있는 기초자치단체는 **32곳**이다 — 서울 25개 구 전부와 경기 7개 시.
  전국 기초자치단체 226곳 기준 14%다.
- 나머지는 광역 티어로 착지한다. 부산·대구 사용자는 시·도 수준 안내만 받고
  대형폐기물 신청 경로, 문의 전화, 수수료 같은 알맹이를 못 받는다.
- 본선은 8/31~9/28 **전국 카카오톡 사용자 투표**다. 이 지역 편중이 그대로 표에 반영된다.
- 수수료 데이터는 26곳뿐이고 전부 서울(+성남)이다.

## 범위

포함: `src/data/region-policies.json`, `src/data/bulky-waste-fees.json`,
`src/data/region-evaluation-cases.json`, `src/data/mcp-answer-cases.json`,
`scripts/import-bulky-fees.ts`의 `TARGETS` 배열, `docs/session-coordination.md`.

**제외: 런타임 코드.** `src/server.ts`와 `src/data.ts`는 건드리지 않는다.
지역 매칭은 Phase 5에서 티어·단계형으로 다시 짰고 회귀 94건이 그 동작을 고정하고 있다.
8/23 개발 완료까지 그걸 다시 흔들 시간이 없다.

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
  기존 스크립트(`pnpm fees:fetch`, `pnpm fees:fetch:district`)를 그대로 쓴다.
- 전화번호는 자원순환과·청소행정과 직통을 쓰고, 대표번호는 마지막 수단이다. 확인한 페이지를 `sources[].basis`에 남긴다.

### R3. 수수료 임포트

```bash
pnpm fees:fetch                 # 전국 표준데이터 (22,831행) → logs/bulky-fee-standard-data.json
# scripts/import-bulky-fees.ts 의 TARGETS 에 신규 지역 추가
pnpm import:fees
pnpm fees:verify:rows
```

`TARGETS`는 `[고시상 지역명, regionId, 표시명]` 튜플 배열이다. 현재 4곳이 들어 있다.

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
- 동명 자치구가 갈리는가 — `부산 중구`/`대구 중구`는 이름을 부르고, 맨 `중구`는 서울 중구로 확정된다.
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

- [ ] R1 대상 확정
- [ ] R2 지역 데이터 수집
- [ ] R3 수수료 임포트
- [ ] R4 케이스와 검증
- [ ] PR 생성
