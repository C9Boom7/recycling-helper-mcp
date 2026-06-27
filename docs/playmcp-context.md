# PlayMCP Context

이 문서는 이전 Codex 세션 `카카오 playMcp 설명`에서 회수한 프로젝트 컨텍스트다. 이 프로젝트에서는 최신 결정인 `재활용척척` / `recyclingHelper` 기준으로 이어간다.

## Product Direction

- 서비스 목적: 이미 버릴 물건의 올바른 분리배출 방법을 안내한다.
- 핵심 사용자 질문: "이걸 어떻게 버려야 하지?"
- 최종 서비스명: `재활용척척`
- 최종 MCP 식별자: `recyclingHelper`
- 인증 방식: `인증 사용하지 않음`
- Endpoint: 배포 후 발급되는 외부 접근 가능 URL의 `/mcp`
- 등록 예시:
  - MCP 이름: `재활용척척`
  - MCP 식별자: `recyclingHelper`
  - MCP Endpoint: `https://<deployed-domain>/mcp`

## PlayMCP Requirements

- Streamable HTTP 방식만 지원한다.
- Remote MCP 서버만 지원하므로 공개 URL이 필요하다.
- Stateless 구성을 권장한다.
- MCP 지원 버전은 `2025-03-26`부터 `2025-11-25` 범위로 확인됐다.
- MCP Inspector 또는 JSON-RPC 호출로 사전 점검한다.
- 서버명과 툴명에 `kakao`를 넣지 않는다.
- 툴은 3~10개 권장, 20개 초과 금지.
- 각 툴은 `name`, `description`, `inputSchema`, `annotations`를 갖춰야 한다.
- `annotations`에는 `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint`를 포함한다.
- 응답 속도 목표는 평균 100ms 이내, p99 3초 이내다.
- 광고 유도 답변은 금지한다.

## Previous MVP

이전 세션에서 TypeScript + 공식 MCP SDK 기반 MVP가 만들어졌다.

- 이전 작업 경로: `/Users/user/Documents/Codex/2026-06-24/z/work/recycling-helper`
- 로컬 커밋: `aacaa2c Initial recycling helper MCP server`
- GitHub 대상: `https://github.com/C9Boom7/recycleHelperMcp`
- 브랜치: `main`
- push 상태: GitHub 인증 문제로 완료되지 않았던 것으로 확인됨.
- 현재 이전 작업 폴더는 남아 있고 Git 상태는 깨끗하다.

구현된 MCP 툴:

- `classify_waste_item`
- `get_disposal_steps`
- `check_confusing_item`
- `make_cleanup_plan`
- `get_region_disposal_info`

검증된 내용:

- TypeScript 빌드 통과
- `/mcp` Streamable HTTP 초기화 응답 정상
- `tools/list` 정상, `annotations` 필수 필드 노출
- `get_disposal_steps`로 "기름 묻은 피자박스" 호출 정상

## Deployment Context

공모전용 배포는 일반 카카오클라우드 Kubernetes 직접 배포보다 `PlayMCP in KC`를 우선한다.

- 접속: `https://playmcp.kakaocloud.io`
- 공모전 기간 중 한시 무료 지원
- 계정당 MCP 서버 최대 2대
- 등록 방식:
  - Git 소스 빌드
  - 컨테이너 이미지 등록
- 이 프로젝트는 Dockerfile이 있으므로 Git 소스 빌드가 우선 후보다.

PlayMCP in KC Git 소스 빌드 입력값 후보:

- MCP 서버 이름: `재활용척척`
- 설명: `헷갈리는 생활폐기물의 올바른 분리배출 방법을 안내하는 MCP 서버`
- Git URL: GitHub 저장소 URL
- 브랜치/ref: `main`
- Dockerfile 경로: `Dockerfile`
- PAT: public repository면 비움

서버가 `Active`가 되면 상세 화면의 `Endpoint URL`을 PlayMCP 콘솔에 등록한다.

## Data Sources

- 초기 데이터는 이전 MVP의 `src/data/waste-items.json`에 있다.
- 지역별 분리배출 정보 확장 후보:
  - `https://www.분리배출.kr/front/region/region.do`
  - punycode URL: `https://www.xn--oy2b29bd3a601b.kr/front/region/region.do`
- `get_region_disposal_info`는 지역 데이터 연동용 확장 포인트로 둔다.

## GitHub Auth Notes

GitHub push용 Fine-grained PAT가 필요하면 최소 권한은 다음과 같다.

- Repository access: `Only select repositories`
- Selected repository: `recycleHelperMcp`
- Repository permissions:
  - `Contents: Read and write`
  - `Metadata: Read-only`

PlayMCP in KC가 private repository를 읽기만 하는 경우에는 `Contents: Read-only`로 충분하다. 토큰은 채팅에 붙여넣지 않고 GitHub/PlayMCP 입력창이나 터미널 프롬프트에만 입력한다.

## Notes

- 중간 이름 후보로 `버릴까말까`, `분리척척`, `bunricheck` 등이 있었지만 최신 결정은 `재활용척척` / `recyclingHelper`다.
- 이전 대표 이미지는 `trash-or-not-representative.png`로 생성됐으나 초기 이름 기준이다. 필요하면 `재활용척척`용 대표 이미지를 새로 만드는 것이 낫다.
- 현재 저장소로 이전 MVP 코드를 가져올 때는 `node_modules`, `dist`, `.git`은 제외하고 소스와 설정 파일만 옮긴다.
