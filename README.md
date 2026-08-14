# 재활용척척 MCP

재활용척척은 헷갈리는 생활폐기물의 올바른 배출 방법을 안내하는 PlayMCP용 Remote MCP 서버입니다. 카카오톡에서 PlayMCP를 통해 호출되며, 품목 분류부터 지역별 확인 항목까지 하나의 무상태(stateless) MCP 서버로 제공합니다.

## 아키텍처

```
카카오톡 사용자 → PlayMCP (Kakao Cloud) → MCP 서버 (Express, Streamable HTTP, 무상태) → 데이터 레이어 (품목·지역·수수료 JSON)
```

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

## 매칭 엔진

사용자가 입력한 자유 형식 질의(`itemName`)는 `src/data.ts`의 `scoreItem()`이 아래 기준으로 점수를 매겨 가장 가까운 품목을 찾습니다.

- `exact` (100점): 품목명/별칭과 완전히 일치
- `query_contains_name` (88~99점): 질의 안에 품목명 전체가 포함
- `short_alias_standalone` (78점~): 2글자 이하 별칭이 독립된 단어로 등장
- `generic_fragment` (82점~): 품목명이 짧은 질의어를 단순 포함 — 동점 후보가 있으면 확정하지 않음
- `fuzzy_jamo` (40~70점): 한글 자모 분해 후 레벤슈타인 유사도로 오타 허용 ("패트병"→"페트병"). 유사도 0.85 이상 단일 후보만 확정하고, 그 미만은 후보로만 제시

`resolveWasteItem()`은 이 점수를 `match` / `ambiguous` / `not_found` 세 가지 결과로 정리합니다. "컵", "통", "병"처럼 여러 품목에 동시에 해당하는 포괄어는 `ambiguous`로 처리해 임의로 하나를 확정하지 않고, 후보 목록과 함께 재질·용도를 되묻습니다.

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

현재는 공식 기준과 자주 헷갈리는 품목 seed 데이터에 더해, 서울 강남구·서초구·송파구·마포구와 경기 성남시 등 5개 지역의 배출 요일·수거함·대형폐기물 수수료 기준을 함께 사용합니다. 신규 지역 확장은 사용자 질문 로그와 자동 백로그에서 필요가 확인될 때 진행합니다.

## 데이터 신뢰도 파이프라인

품목·지역 데이터는 아래 4단계를 통과해야 반영됩니다.

1. `pnpm validate:data` — 스키마와 문서 카운트 정합성 확인
2. `pnpm eval:data` — 품목·지역 평가 케이스 1:1 매칭 검증
3. `pnpm smoke:mcp` — 실제 MCP 서버에 답변 회귀 케이스 실행
4. 질문 백로그 (`pnpm log:query`, `pnpm backlog:auto`) — 새로 발견한 갭을 추적하고 후속 작업으로 승격

## Data quality

정확도 개선은 품목 데이터와 대표 질문 평가셋을 함께 관리합니다.

- 품목 데이터: `src/data/waste-items.json` (272개)
- 대표 질문 평가셋: `src/data/evaluation-cases.json` (272개)
- MCP 답변 품질 케이스: `src/data/mcp-answer-cases.json` (290개)
- 지역 정책 데이터: `src/data/region-policies.json` (5개 지역)
- 지역 평가셋: `src/data/region-evaluation-cases.json` (35개)
- 대형폐기물 수수료: `src/data/bulky-waste-fees.json` (강남·서초·송파·마포 4개 지역)
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

품목 리뷰 상태: `verified` 39 / `region_review_needed` 84 / `needs_source` 7 / `standard_import` 142. 질문 백로그: `covered` 110 / `wont_fix` 1 / `todo` 0.

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
