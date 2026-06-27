# PlayMCP in KC 배포 가이드

Agentic Player 10 공모전에서는 PlayMCP in KC가 제공하는 공모전용 MCP 서버 배포 서비스를 사용합니다.

## 핵심 조건

- 접수 기간: 2026-06-15 ~ 2026-07-14
- PlayMCP 회원 계정으로만 이용 가능
- 계정당 MCP 서버 최대 2대
- PlayMCP in KC에서 발급받은 MCP Endpoint URL을 PlayMCP 콘솔에 등록해야 공모전 참여 가능
- 공모전 참가 목적 외 사용 또는 예선 미접수 시 서버가 회수될 수 있음
- 무상 지원은 한시적이며 종료 일정은 추후 공지

## 추천 방식: Git 소스 빌드

이 프로젝트는 Dockerfile을 포함하고 있으므로 Git 소스 빌드 방식이 가장 간단합니다.

1. 이 프로젝트를 GitHub 같은 Git 저장소에 올립니다.
2. 브라우저에서 `https://playmcp.kakaocloud.io`에 접속합니다.
3. PlayMCP에 가입된 카카오 계정으로 로그인합니다.
4. `+ 새 MCP 서버 등록`을 누릅니다.
5. `Git 소스 빌드`를 선택합니다.
6. 아래 값을 입력합니다.

```text
MCP 서버 이름: 재활용척척
설명: 헷갈리는 생활폐기물의 올바른 분리배출 방법을 안내하는 MCP 서버
Git URL: 이 프로젝트를 올린 Git 저장소 URL
브랜치 / ref: main
Dockerfile 경로: Dockerfile
PAT: public 저장소면 비움, private 저장소면 Personal Access Token 입력
```

7. `등록하기`를 누른 뒤 Status가 `Active`가 될 때까지 기다립니다.
8. 서버 상세 정보에서 `Endpoint URL`을 복사합니다.
9. PlayMCP 개발자 콘솔의 MCP Endpoint에 복사한 URL을 입력합니다.

## 컨테이너 이미지 방식

이미지를 직접 빌드하고 레지스트리에 푸시한 경우 사용할 수 있습니다.

Apple Silicon Mac에서는 반드시 AMD64 이미지로 빌드해야 합니다.

```bash
docker build --platform linux/amd64 -t recycling-helper-mcp:latest .
```

PlayMCP in KC에서 `이미지 등록`을 선택하고 아래 값을 입력합니다.

```text
MCP 서버 이름: 재활용척척
설명: 헷갈리는 생활폐기물의 올바른 분리배출 방법을 안내하는 MCP 서버
Registry 호스트: docker.io 또는 ghcr.io 등
Registry 사용자: private registry인 경우 입력
Registry 비밀번호: private registry인 경우 입력
image_name: 레지스트리에 등록된 이미지 이름
image_tag: 이미지 태그
```

## PlayMCP 콘솔 등록값

PlayMCP in KC에서 Endpoint URL을 받은 뒤 PlayMCP 콘솔에는 아래처럼 등록합니다.

```text
MCP 이름: 재활용척척
MCP 식별자: recyclingHelper
인증 방식: 인증 사용하지 않음
MCP Endpoint: PlayMCP in KC에서 발급받은 Endpoint URL
```

