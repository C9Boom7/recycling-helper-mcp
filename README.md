# 재활용척척 MCP

재활용척척은 헷갈리는 생활폐기물의 올바른 배출 방법을 안내하는 Remote MCP 서버입니다. 카카오톡에서 호출되며, 품목 분류부터 지역별 확인 항목까지 하나의 무상태(stateless) MCP 서버로 제공합니다.

## 아키텍처

본선(Agentic Player 10) 무대는 카카오톡의 **ChatGPT for Kakao — Kakao Tools**입니다. 예선의 PlayMCP AI채팅과 달리 호스트 LLM이 ChatGPT이고, **툴 호출이 보장되지 않습니다.** tool description 품질이 곧 노출률이라 설계가 여기에 맞춰져 있습니다.

```
카카오톡 사용자 → ChatGPT for Kakao (Kakao Tools) → MCP 서버 (Express, Streamable HTTP, 무상태) → 데이터 레이어 (품목·지역·수수료 JSON)
```

호출이 한 번에 그칠 수 있으므로 **한 번의 호출로 항상 유용한 결과를 돌려주는 것**을 원칙으로 잡았습니다. 대분류 → 소분류로 좁혀 가는 멀티스텝 체인은 중간 호출이 누락되면 답이 끊기므로 쓰지 않습니다. 품목을 못 찾아도 재질 기준 안내로, 포괄어면 후보를 제시하는 되묻기로 착지합니다.

- Transport: Streamable HTTP
- Endpoint: `/mcp`
- Session: stateless (요청마다 서버·도구를 새로 구성)
- Auth: 인증 사용하지 않음
- MCP name: `재활용척척`
- MCP identifier: `recyclingHelper`
- 구성: TypeScript, Express 5, `@modelcontextprotocol/sdk`(McpServer, StreamableHTTPServerTransport), Zod

## Tools

| Tool | 역할 |
| --- | --- |
| `classify_waste_item` | 품목을 분류하고 확신도·지역 영향까지 안내 |
| `get_disposal_steps` | 단계별 배출 방법과 근거 출처를 안내 |
| `check_confusing_item` | 헷갈리는 품목의 예외를 후보와 함께 설명 |
| `make_cleanup_plan` | 여러 품목을 배출 그룹별로 묶어 계획 생성 |
| `get_region_disposal_info` | 지역별 확인 항목과 공식 출처를 안내 |
| `find_disposal_spots` | 동네(법정동)의 수거함 실제 주소를 찾아 안내 — 인증키가 있을 때만 등록 |

`find_disposal_spots`만 외부 API(기후에너지환경부 분리배출 정보조회 서비스)를 실시간으로 부릅니다. 나머지 다섯은 서버가 들고 있는 데이터만으로 답하며, 이 툴이 죽어도 영향받지 않습니다. 자세한 동작은 아래 "동네 배출 장소 조회"를 보세요.

## 사진으로 물어보는 경로

카카오톡에서는 "이거 어떻게 버려?" 하며 사진을 찍어 보내는 게 가장 자연스러운 입력입니다. **서버는 이미지를 받지 않습니다.** 호스트가 ChatGPT라 비전이 있으니, 사진을 읽고 물건 이름을 뽑아내는 일은 호스트가 하고 서버는 늘 하던 대로 `itemName` 문자열만 받습니다. 이 경로를 여는 장치는 `get_disposal_steps`의 tool description입니다 — 사진이 오면 **버리려는 물건만** 골라 흔히 쓰는 우리말 이름으로 넘기고(스티로폼 용기, 과자봉지), 물건 종류만으로 갈리지 않으면 재질까지 붙이라고 적어 두었습니다. 사진에 여러 개가 찍혀 있으면 `make_cleanup_plan`으로 보냅니다.

사진에서 알아본 이름은 사용자가 직접 친 이름보다 틀릴 확률이 높은데, 서버에 도착하는 건 어느 쪽이든 그냥 문자열입니다. 그래서 선택 파라미터 `inputSource: "photo"`로 그 차이를 받습니다. 이 값이 오면 확정 매칭 응답에 `사진 속 물건은 "○○" 품목 기준으로 안내합니다. 다르면 품목명을 알려주세요.` 한 줄이 붙습니다(카드는 배출 그룹 캡션과 결론 사이, 텍스트는 맨 앞). 잘못 알아본 답을 확정된 답으로 받게 두는 것보다 낫다는 판단입니다. 되비추는 `○○`는 호스트가 넘긴 문자열이 아니라 서버가 고른 품목명입니다 — 사용자가 바로잡을 대상이 그쪽이라, `스티로폼 용기`를 넘겨도 안내는 `스티로폼` 기준으로 나갑니다. 공유용 `copy_text`에는 넣지 않습니다 — 공유받는 사람은 사진을 보낸 적이 없어서 맥락이 없습니다.

값은 `photo` 하나뿐이지만 검증은 느슨하게 합니다. 호스트가 `image` 같은 다른 값을 얹어도 그 인자만 무시하고 안내는 그대로 나갑니다. 로그 필드 하나 때문에 배출 안내를 통째로 잃을 이유가 없어서입니다. 그 로그는 `get_disposal_steps` 호출에만 `inputSource`로 남습니다 — 여기서 세는 건 이 툴로 들어온 사진 입력뿐이고, 사진에 여러 개가 찍혀 `make_cleanup_plan`으로 간 몫은 집계에 잡히지 않습니다(그 툴에는 `inputSource`가 없습니다).

## 매칭 엔진

사용자가 입력한 자유 형식 질의(`itemName`)는 `src/data.ts`의 `scoreItem()`이 아래 기준으로 점수를 매겨 가장 가까운 품목을 찾습니다.

- `exact` (100점): 품목명/별칭과 완전히 일치
- `query_contains_name` (88~99점): 질의 안에 품목명 전체가 포함
- `short_alias_standalone` (78점~): 2글자 이하 별칭이 독립된 단어로 등장
- `generic_fragment` (82점~): 품목명이 짧은 질의어를 단순 포함 — 동점 후보가 있으면 확정하지 않음
- `fuzzy_jamo` (40~70점): 한글 자모 분해 후 레벤슈타인 유사도로 오타 허용 ("패트병"→"페트병"). 유사도 0.85 이상 단일 후보만 확정하고, 그 미만은 후보로만 제시

`resolveWasteItem()`은 이 점수를 `match` / `ambiguous` / `not_found` 세 가지 결과로 정리합니다. "컵", "통", "병"처럼 여러 품목에 동시에 해당하는 포괄어는 `ambiguous`로 처리해 임의로 하나를 확정하지 않고, 후보 목록과 함께 재질·용도를 되묻습니다.

한국어는 핵심어가 뒤에 오므로 복합명사의 **앞자리에 붙은 이름은 수식어로 봅니다.** "전자레인지 수납장"은 수납장이지 전자레인지가 아닙니다. 다만 수식어로 걸린 후보를 목록에서 통째로 지우지는 않습니다 — 남은 하나가 단독 확정돼 "컴퓨터"가 노트북으로 바뀌는 일이 생기기 때문에, 확정 후보에서만 빼고 "질의가 덜 특정됐다"는 신호로는 남깁니다.

## 응답 형태 — 위젯과 폴백

품목 하나를 확정한 응답은 **위젯 카드**로 나갑니다. `content[0].text`에 `{widget, copy_text, name}` JSON을 담는 Kakao Tools 형식이고, 제목·캡션·단계·주의·근거(출처 제목과 확인일)에 더해 지역을 함께 물었으면 `서울 강남구 기준` 블록이 붙습니다. 카드에는 사용자가 그대로 복사할 수 있는 `copy_text`가 따라갑니다.

카드를 내는 툴은 `get_disposal_steps`와 `classify_waste_item` 둘이고, 같은 카드를 냅니다. 카카오가 붙이는 `Kakao Tools · 재활용척척` 라벨이 위젯 응답에만 나오고 텍스트 답변은 ChatGPT가 다시 쓰기 때문에, 호스트가 어느 쪽을 골랐는지로 답변 품질이 갈리지 않게 맞춘 것입니다. 품목 3개를 견주는 `check_confusing_item`과 여러 품목을 묶는 `make_cleanup_plan`은 단일 품목 카드에 담기지 않아 텍스트로 답합니다.

`WIDGET_ENABLED=false`로 되돌린 텍스트 답변도 **결론을 제목 바로 다음 줄에** 세웁니다. 위젯 카드는 원래 제목 다음이 결론이었는데 텍스트 쪽만 `배출 그룹`·`확신도`·`판단 범위` 뒤 네 번째 줄에 두고 있어서, 되돌린 상태에서 답이 아래로 밀렸습니다. 두 표면을 맞춘 것입니다.

같은 이유로 `확신도`는 **높지 않을 때만** 냅니다 — 336개 중 255개가 `높음`이라 대부분의 답에서 아무것도 가르지 않고, 오히려 확신이 없다는 인상만 줍니다. 위젯 카드가 이미 같은 조건을 쓰고 있었습니다. `판단 범위`는 아래 지역 블록(`지역 확인 필요`·`지역 참고`)이 서는 응답에서는 뺍니다 — 그 블록이 같은 말을 더 자세히 합니다.

이 편집은 `get_disposal_steps`의 텍스트 경로에만 걸립니다. `classify_waste_item`의 텍스트 분기는 분류 요약이 그 툴의 일이라 세 줄을 그대로 냅니다.

확정이 아닐 때는 텍스트로 답합니다.

- `ambiguous` — 후보를 제시하고 재질·용도를 되묻습니다. 임의로 하나를 고르지 않습니다.
- `not_found` — 재질 기준 안내로 착지합니다. "모르겠다"로 끝내지 않는 것이 목적입니다.
- 카테고리어(`대형폐기물`, `음식물쓰레기` 등)로만 이뤄진 질의도 폴백으로 보냅니다. 문장형 별칭에 걸려 엉뚱한 품목 카드가 뜨는 것을 막기 위해서입니다.

`WIDGET_ENABLED=false`로 두면 확정 매칭도 마크다운 텍스트로 나갑니다 — 위젯 렌더링이 문제일 때 되돌리는 스위치입니다([docs/qa-runbook.md](docs/qa-runbook.md) 참고).

되돌리면 `get_disposal_steps`는 같은 내용이 렌더링만 바뀌어 나가지만, `classify_waste_item`은 답의 성격이 달라집니다. 카드는 배출 단계와 지역 수수료까지 싣는 반면 텍스트 분기는 원래의 분류 요약(갈래·확신도·판단 범위)으로 돌아갑니다. 되돌린 상태로 오래 두게 되면 이 차이를 감안해야 합니다.

## 동네 배출 장소 조회 — `find_disposal_spots`

"상계동 사는데 폐의약품 어디 버려?"에 **실제 주소**로 답하는 툴입니다. 지역 데이터는 "약국·보건소 수거함"처럼 어디 종류인지까지만 말하는데, 기후에너지환경부 분리배출 정보조회 서비스의 `getSpot`은 어느 주소인지를 줍니다. 서버의 **유일한 외부 런타임 의존**이라 실패 설계를 함께 넣었습니다.

- **입력은 법정동입니다.** `상계동`·`역삼동`은 되고 `강남구`·`서울`은 조회되지 않습니다. `상계1동` 같은 행정동 표기는 `상계동`으로 줄여 보냅니다.
- **동음 오염을 걸러냅니다.** 주소 부분일치라 `서교동`을 물으면 마포구 것에 여수시 것이 섞여 옵니다. `region`을 함께 주면 광역과 시·군·구가 **둘 다** 맞는 주소만 남기고, 지역이 없으면 응답이 한 시·군·구로 수렴할 때만 답하고 아니면 어느 지역인지 되묻습니다.
- **답이 비지 않습니다.** 타임아웃(2.5초)·오류·0건 어느 쪽이든 MCP 오류를 던지지 않고, 전국 확인 경로와 (있으면) 지역 공식 확인처·품목별 일반 안내로 내려앉습니다. 오류 내용은 응답에 싣지 않습니다.
- 응답은 묶음당 최대 3곳, 전체 최대 12곳입니다. 종량제봉투 판매소는 응답의 절반을 차지해 기본 노출에서 뺐습니다.

`DATA_GO_KR_SERVICE_KEY`(공공데이터포털 인증키)를 넣어야 동작합니다. **비어 있으면 이 툴은 `tools/list`에 아예 나오지 않습니다** — 등록해 놓고 매번 폴백으로 내려앉는 것보다 호스트가 처음부터 다른 툴을 고르는 쪽이 낫고, 이 성질이 그대로 되돌리기 스위치입니다(키를 지우고 재배포하면 툴이 내려갑니다. 별도 켬/끔 플래그는 없습니다). 키는 비밀이라 커밋하지 않고 배포 콘솔에서 주입합니다. `MOE_API_BASE_URL`은 테스트에서 목 서버를 꽂는 자리이고 평소에는 건드리지 않습니다.

콘솔의 툴 목록 스냅샷은 등록 시점에 저장되므로, **재등록하지 않으면 여섯 번째 툴이 호스트에 보이지 않습니다**([docs/playmcp-in-kc.md](docs/playmcp-in-kc.md) "등록 갱신").

`CALL_LOG_DETAILS=true`는 툴 호출 로그에 호출 인자와 예외 메시지까지 남깁니다. **로컬 디버깅 전용이고 배포 환경변수에는 넣지 않습니다.** 기본값에서는 라우팅·매칭·지연만 남으며, 예외는 클래스 이름과 스택 맨 윗줄로 식별합니다([docs/qa-runbook.md](docs/qa-runbook.md) 2절).

## Run

```bash
pnpm install
pnpm build
PORT=3000 pnpm start
```

Local endpoint:

```text
http://localhost:3000/mcp
```

PlayMCP에는 카카오클라우드 등에 배포한 공개 URL을 등록합니다.

배포 컨테이너에서 외부 트래픽을 받아야 하는 경우:

```bash
HOST=0.0.0.0 PORT=3000 pnpm start
```

## Docker

```bash
docker build -t recycling-helper-mcp .
docker run --rm -p 3000:3000 recycling-helper-mcp
```

Apple Silicon Mac에서 카카오클라우드 Kubernetes Engine용 이미지를 빌드할 때는 AMD64로 빌드합니다.

```bash
docker build --platform linux/amd64 -t recycling-helper-mcp:latest .
```

## PlayMCP in KC 배포

Agentic Player 10 공모전에서는 PlayMCP in KC가 제공하는 공모전용 MCP 서버 배포 서비스를 사용합니다.
이 프로젝트는 Dockerfile을 포함하므로 `Git 소스 빌드` 방식으로 등록하는 것을 권장합니다.

자세한 절차는 [docs/playmcp-in-kc.md](docs/playmcp-in-kc.md)를 참고하세요.

평소 개발은 로컬 검증을 우선하고, 큰 개선이나 제출 전 확인이 필요할 때만 PlayMCP in KC에 새 서버를 올립니다.
자세한 로컬 검증 흐름은 [docs/local-mcp-workflow.md](docs/local-mcp-workflow.md)를 참고하세요.

## Kubernetes 직접 배포

일반 카카오클라우드 Kubernetes Engine에 직접 배포해야 하는 경우에만 `k8s/` manifest를 사용합니다.
공모전 예선 제출은 PlayMCP in KC에서 발급받은 Endpoint URL을 사용하는 흐름이 우선입니다.

## Data sources

- 기후에너지환경부 현행법령: https://www.mcee.go.kr/home/web/index.do?menuId=70
- 환경부 분리수거 요령: https://www.me.go.kr/webdata/education/class21/8-03.html
- 생활폐기물 분리배출 누리집: https://www.분리배출.kr/front/region/region.do

현재는 공식 기준과 자주 헷갈리는 품목 seed 데이터에 더해, 지역 데이터를 세 가지 티어로 나눠 사용합니다.

- `full` 5곳(서울 강남구·서초구·송파구·마포구, 경기 성남시): 배출 요일·수거함·대형폐기물 수수료 기준까지
- `standard` 35곳(서울 자치구 21곳, 경기 6개 시, 광역시 자치구 8곳): 대형폐기물 인터넷 신청·수수료 조회 URL과 담당 직통번호, 폐의약품·폐건전지 수거함 안내까지
- `metro` 17곳(광역시도 전체): 자치구 데이터가 없을 때 착지할 광역 폴백. 대형폐기물 접수는 기초자치단체 소관이라 전화번호를 두지 않습니다

2026-08-16에 남은 여덟 구를 채워 **서울 25개 구가 전부 등록됐습니다**(full 4곳 + standard 21곳).

같은 날 경기 인구 상위 도시 여섯 곳(수원·용인·고양·화성·부천·남양주)을 열어 경기 등록 지역이 성남 포함 일곱 곳이 됐습니다. 그전까지 경기도는 인구가 1,360만으로 서울보다 많은데 등록된 곳이 성남시 하나뿐이었고, 여섯 도시 모두 시 이름만으로는 광역 폴백조차 받지 못하고 매칭에 실패했습니다.

`standard` 지역은 다섯 항목이 전부 확인된 곳만 넣습니다. 하나라도 못 채우면 추가하지 않고 [docs/data-decision-backlog.md](docs/data-decision-backlog.md)에 사유와 함께 남깁니다.

## 데이터 신뢰도 파이프라인

품목·지역 데이터는 아래 4단계를 통과해야 반영됩니다.

1. `pnpm validate:data` — 스키마와 문서 카운트 정합성 확인
2. `pnpm eval:data` — 품목·지역 평가 케이스 1:1 매칭 검증
3. `pnpm smoke:mcp` — 실제 MCP 서버에 답변 회귀 케이스 실행
4. 질문 백로그 (`pnpm log:query`, `pnpm backlog:auto`) — 새로 발견한 갭을 추적하고 후속 작업으로 승격

## Data quality

정확도 개선은 품목 데이터와 대표 질문 평가셋을 함께 관리합니다.

- 품목 데이터: `src/data/waste-items.json` (336개)
- 대표 질문 평가셋: `src/data/evaluation-cases.json` (336개)
- MCP 답변 품질 케이스: `src/data/mcp-answer-cases.json` (637개)
- 지역 정책 데이터: `src/data/region-policies.json` (57개 지역 — full 5, standard 35, metro 17)
- 지역 평가셋: `src/data/region-evaluation-cases.json` (136개)
- 대형폐기물 수수료: `src/data/bulky-waste-fees.json` (28개 지역 3,829행 — 서울 25개 구는 전부 있고, 경기 6개 시와 광역시 자치구 6곳이 남았다)
- 질문 백로그: `src/data/question-backlog.json`
- 작업 가이드: [docs/data-quality.md](docs/data-quality.md)
- 질문 백로그 흐름: [docs/question-backlog.md](docs/question-backlog.md)
- Top 50 품목: [docs/top-50-items.md](docs/top-50-items.md)
- 출처 커버리지: [docs/source-coverage.md](docs/source-coverage.md)
- 출처 갭 정책: [docs/source-gap-policy.md](docs/source-gap-policy.md)
- High-priority 출처 조사: [docs/source-research-high-priority-2026-07-01.md](docs/source-research-high-priority-2026-07-01.md)
- 강남구 지역 기준: [docs/gangnam-region-policy.md](docs/gangnam-region-policy.md)
- 지역 정책 비교: [docs/region-policy-comparison.md](docs/region-policy-comparison.md)
- 로컬 MCP 검증 흐름: [docs/local-mcp-workflow.md](docs/local-mcp-workflow.md)
- 본선 이후로 미룬 과제: [docs/post-finals-backlog.md](docs/post-finals-backlog.md)

품목 리뷰 상태: `verified` 44 / `region_review_needed` 91 / `needs_source` 7 / `standard_import` 194. 질문 백로그: `covered` 110 / `wont_fix` 1 / `todo` 0.

검증:

```bash
pnpm validate:data
pnpm eval:data
pnpm backlog:questions
pnpm log:query -- --query "요가매트는 어떻게 버려?"
pnpm backlog:auto -- --query "요가매트는 어떻게 버려?"
pnpm backlog:auto:quality
pnpm check
pnpm smoke:mcp
pnpm local:test
```
