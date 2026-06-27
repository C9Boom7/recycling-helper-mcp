# 재활용척척 MCP

재활용척척은 헷갈리는 생활폐기물의 올바른 배출 방법을 안내하는 PlayMCP용 Remote MCP 서버입니다.

## PlayMCP 등록 기준

- Transport: Streamable HTTP
- Endpoint: `/mcp`
- Session: stateless
- Auth: 인증 사용하지 않음
- MCP name: `재활용척척`
- MCP identifier: `recyclingHelper`
- Tool count: 5

## Tools

- `classify_waste_item`
- `get_disposal_steps`
- `check_confusing_item`
- `make_cleanup_plan`
- `get_region_disposal_info`

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

## Kubernetes 직접 배포

일반 카카오클라우드 Kubernetes Engine에 직접 배포해야 하는 경우에만 `k8s/` manifest를 사용합니다.
공모전 예선 제출은 PlayMCP in KC에서 발급받은 Endpoint URL을 사용하는 흐름이 우선입니다.

## Data sources

- 기후에너지환경부 현행법령: https://www.mcee.go.kr/home/web/index.do?menuId=70
- 환경부 분리수거 요령: https://www.me.go.kr/webdata/education/class21/8-03.html
- 생활폐기물 분리배출 누리집: https://www.분리배출.kr/front/region/region.do

현재 MVP는 공식 기준과 자주 헷갈리는 품목 seed 데이터를 함께 사용합니다. 지역별 상세 배출 요일과 조례 정보는 `get_region_disposal_info`의 다음 확장 대상으로 둡니다.

## Data quality

정확도 개선은 품목 데이터와 대표 질문 평가셋을 함께 관리합니다.

- 품목 데이터: `src/data/waste-items.json`
- 대표 질문 평가셋: `src/data/evaluation-cases.json`
- 작업 가이드: [docs/data-quality.md](docs/data-quality.md)
- Top 50 품목: [docs/top-50-items.md](docs/top-50-items.md)
- 출처 커버리지: [docs/source-coverage.md](docs/source-coverage.md)
- 강남구 지역 기준: [docs/gangnam-region-policy.md](docs/gangnam-region-policy.md)

검증:

```bash
pnpm validate:data
pnpm eval:data
pnpm check
```
