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

## 배포 서버 (실제 발급된 엔드포인트)

서버가 두 대 있고 용도가 다릅니다. **본선 작업은 본선 서버만 재배포합니다.**

| 용도 | 엔드포인트 | 비고 |
| --- | --- | --- |
| **본선** (Kakao Tools) | `https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/mcp` | 재배포 대상. main 브랜치 Git 소스 빌드 |
| ⚠️ **PlayMCP에 등록된 주소** | `https://recycling-helper-mcp.playmcp-endpoint.kakaocloud.io/mcp` (`-kakaotools` 없음) | 개발자 콘솔의 재활용척척 MCP가 **이 주소**를 가리킵니다. 2026-08-14 기준 Phase 0 이전 빌드(items 130) |
| 예선 (PlayMCP AI채팅) | `https://recycle-helper-mcp.playmcp-endpoint.kakaocloud.io/mcp` (서버 ID `1498`) | **절대 건드리지 않습니다.** 예선 제출 상태 보존. 현재 dex 인증 뒤로 들어가 외부 호출 불가 |

이름이 셋 다 비슷합니다. `recycle`/`recycling` 한 글자 차이에 더해, `-kakaotools` 접미사 유무로 또 갈립니다.

### ⚠️ 등록 주소와 재배포 주소가 어긋나 있습니다 (2026-08-14 확인, 미해결)

재배포는 `-kakaotools` 서버에 하는데, PlayMCP 개발자 콘솔에 등록된 MCP Endpoint는 접미사 없는 `recycling-helper-mcp`입니다.
그 결과 **Phase 0~3 결과물이 실사용자에게 전혀 도달하지 않았습니다.** 콘솔 지표 기준 Tool call 79회, 적용 사용자 8명이 모두 구버전을 사용했습니다.

| 항목 | `-kakaotools` (재배포 대상) | `recycling-helper-mcp` (등록된 주소) |
| --- | --- | --- |
| items | 272 (Phase 2 반영) | 130 (Phase 2 이전) |
| `get_disposal_steps` description | 482자, 한국어 발화 예시·툴 경계 포함 (Phase 0 R3) | 150자, Phase 0 이전 원문 |
| 위젯 (Phase 3) | 있음 | 없음 |

콘솔에는 툴 목록 JSON이 **등록 시점 스냅샷**으로 저장됩니다. 새 endpoint로 임시 등록해 보니 "정보 불러오기"가 그때 tools/list를 다시 읽어 왔습니다.
즉 서버를 고쳐도 등록을 갱신하지 않으면 ChatGPT는 계속 옛 description으로 툴을 고릅니다.

#### 테스트용 임시 등록 (2026-08-14 생성)

카카오 매뉴얼 안내대로, 기존 `심사 완료` 등록은 그대로 두고 신규 서버를 **임시 등록**해 테스트 경로를 따로 만들었습니다.

| 항목 | 값 |
| --- | --- |
| 이름 | 재활용척척 테스트 |
| MCP 식별자 | `recycleHelperV2` (툴 이름 prefix로 붙습니다) |
| Endpoint | `https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/mcp` |
| 등록 상태 | 심사 전 (임시 등록) |

도구함에는 이 임시 등록본만 활성화하고 기존 `재활용척척`은 껐습니다 (가이드 §4: 도구함에는 테스트할 MCP만 담는다).
Preview의 "도구 상세"에서 `recycleHelperV2-*` 5개가 Phase 0 개편 description으로 노출되는 것까지 확인했습니다.

운영 등록(`심사 완료`, 전체 공개)은 **아직 구버전 서버를 가리킨 채**입니다. 최종 반영 방법은 사용자 결정이 필요합니다.

1. 콘솔에서 운영 등록의 MCP Endpoint를 `-kakaotools` 주소로 **수정**한다. `심사 완료` 상태라 수정이 재심사를 유발하는지 먼저 확인해야 합니다.
2. 임시 등록본을 **심사 요청**해 새로 올린다. 식별자가 `recycleHelperV2`로 바뀌므로 툴 이름 prefix도 함께 바뀝니다.
3. 등록된 `recycling-helper-mcp` 서버 자체를 main 기준으로 **재배포**한다. 등록 정보는 안 건드리지만, 위에 적었듯 description 스냅샷 갱신 문제가 남습니다.

### Preview 발화 테스트는 자동화할 수 없습니다

Phase 4 PRD는 "Preview 테스트는 Claude가 Chrome 확장으로 대행한다"를 전제로 했지만, 실제로는 불가능합니다.
Preview의 채팅 영역은 `<chatgpt-shell>` 커스텀 엘리먼트의 shadow DOM 안에 있는 `cdn.platform.openai.com` **교차 출처 iframe**이라,
Chrome 확장의 합성 클릭·키 입력이 입력창에 닿지 않습니다 (한글·ASCII 모두 실패).

읽기 쪽은 됩니다 — 툴 목록, description, 등록 상태, 도구함 설정은 확인·조작할 수 있습니다.
따라서 **발화 입력과 위젯 렌더링 육안 확인은 사람이 직접** 해야 하고, Claude는 시나리오 목록 작성·결과 기록·서버 측 교차검증을 맡습니다.

서버 코드의 host allowlist는 `*.playmcp-endpoint.kakaocloud.io` suffix 와일드카드라, 서버를 새로 만들어 호스트명이 바뀌어도 코드 수정 없이 동작합니다.

### 재배포 후 확인

main에 머지하고 사용자가 PlayMCP in KC에서 "재배포"를 누른 뒤, 아래로 반영 여부를 확인합니다.

```bash
curl -sS https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/health
```

`items` 수가 방금 배포한 커밋의 품목 수와 같아야 합니다. 다르면 이전 빌드가 떠 있는 것입니다.

툴 호출까지 확인하려면 (Kakao 인프라가 쓰는 JSON-only 경로):

```bash
curl -sS -H 'content-type: application/json' -H 'accept: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_disposal_steps","arguments":{"itemName":"기름 묻은 피자박스"}}}' https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/mcp
```

#### 확인 이력

- 2026-08-14, `a696026`(Phase 0 + Phase 1) 배포분 검증 통과: health 200(items 130), initialize, tools/list 5개(SSE·JSON-only 동일), JSON-only `tools/call`, not_found 재질 폴백, ambiguous 후보 제시, CORS 4개 origin(`playmcp.kakaocloud.io`, `playmcp.kakao.com`, `preview-chatgpt.kakao.com`, `tools.kakao.com`), 응답속도 평균 24ms·p99 30ms(네트워크 왕복 포함, 가이드 기준 p99 3,000ms).
- 2026-08-14, `c205fdf`(Phase 0~3 전체) 배포분 서버 검증 통과 — Phase 4a의 1·2단계:
  - health 200, `items: 272` (Phase 2 확장분 반영 확인).
  - tools/list 5개. description 269~482자로 전부 1,024자 이내, annotations 5개 필드 모두 지정됨.
  - 툴 5개 실호출 정상: `get_disposal_steps`(확정/오타/ambiguous), `classify_waste_item`, `check_confusing_item`, `make_cleanup_plan`, `get_region_disposal_info`.
  - 위젯 경로 확인: 확정 매칭 응답의 `content[0].text`가 `{widget, copy_text, name}` JSON 문자열이고 `status` 키가 없다(가이드 별첨 형식). ambiguous는 텍스트 유지 — Phase 3 R1 분기대로 동작.
  - Phase 1 자모 매칭 반영: "패트병" → 페트병 카드.
  - CORS 4개 origin 허용, 미등록 origin은 헤더 없음. JSON-only accept 경로 200.
  - 응답속도 20회 표본 평균 59ms·p50 59ms·p95 84ms (네트워크 왕복 포함).
  - **미완**: Kakao Tools Preview 렌더링·툴 호출 확인(4a의 3·4단계). Chrome 확장 미연결로 대기 중.

