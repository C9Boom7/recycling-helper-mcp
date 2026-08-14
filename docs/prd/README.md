# 본선 (Kakao Tools) 추가 개발 PRD 모음

Agentic Player 10 본선 추가 개발(2026-08-13 ~ 08-23)을 Phase 5개로 나눈 작업 명세다.
각 세션은 담당 Phase의 PRD 파일 하나만 읽으면 이 대화 컨텍스트 없이 작업할 수 있어야 한다.

## 배경 요약

- 본선 무대는 예선의 PlayMCP AI채팅이 아니라 **카카오톡 ChatGPT for Kakao의 Kakao Tools**다.
  호스트 LLM이 ChatGPT로 바뀌며, **툴 호출이 보장되지 않는다**. Tool description 품질이 곧 노출률이고 심사 기준에도 포함된다.
- 일반 카카오톡 사용자가 실제로 써보고 투표한다. 투표 + 심사위원 의견으로 최종 10팀 선발.
- 예선 심사 피드백(디스코드 수신):
  1. contain 방식 매칭이라 초기 데이터에서 품목을 못 찾는 케이스가 있다.
  2. AI가 한 번에 툴 콜을 잘하도록 description을 개선하거나, 여러 단계(대분류→소분류→검색어)로 찾아가는 시나리오도 좋겠다.
- 방향 결정: 멀티스텝 체인은 ChatGPT 환경에서 호출 누락 위험이 커서 배제. **한 번의 호출로 항상 유용한 결과**(원샷 강건성)를 반환하는 쪽으로 간다.

## 일정 (가이드 고정 일정)

| 날짜 | 내용 |
| --- | --- |
| 8/23(일) | 본선용 MCP 서버 개발 완료 — 이후 오류 수정만 가능 |
| 8/24~26 | 카카오 QA. 오류 전달 시 빠른 수정 필요 |
| 8/27(목) | 코드 프리징 — 이후 서버 수정 불가 |
| 8/31~9/28 | 본선 (툴 챌린지). 서버 수정 불가, 심각한 오류만 협의 후 수정 |

## Phase 구성과 의존성

| Phase | 문서 | 내용 | 의존성 |
| --- | --- | --- | --- |
| 0 | [phase-0-compliance.md](phase-0-compliance.md) | 본선 규격 정비: allowlist/CORS, description 개편, 툴 정의 일원화, 응답 다이어트, 호출 로깅 | 없음 — 최우선, 단독 진행 |
| 1 | [phase-1-matching-fallback.md](phase-1-matching-fallback.md) | not_found 폴백, 자모 오타 허용, 별칭 보강 | Phase 0 머지 후 |
| 2 | [phase-2-coverage.md](phase-2-coverage.md) | 표준 티어 품목 벌크 확장 (데이터 중심) | Phase 0 머지 후, Phase 1과 병렬 가능 |
| 3 | [phase-3-widget.md](phase-3-widget.md) | get_disposal_steps 확정 매칭 위젯 + copy_text | Phase 0 머지 후 — 1·2와 병렬 가능 |
| 4a | [phase-4-release.md](phase-4-release.md) §4a | 본선 서버 배포 + Preview 연결·툴콜 확인 | Phase 0 배포 직후 — **즉시 착수** |
| 4b | [phase-4-release.md](phase-4-release.md) | 발화 테스트 매트릭스, description 튜닝, 회귀, 마감 | Phase 1~3 배포 이후 |
| 5 | [phase-5-region-expansion.md](phase-5-region-expansion.md) | 지역 커버리지 확장 (표준·광역 티어), 동명 자치구 매칭 교정 | Phase 4a 이후 |
| 6 | `phase-6-bulky-fee-etl.md` (PR #13에서 추가 예정) | 자치법규 조례 ETL로 대형폐기물 수수료 채우기 (서울 13곳 + 성남) | Phase 5 이후 |
| 7 | [phase-7-bulky-item-fee-expansion.md](phase-7-bulky-item-fee-expansion.md) | 복합명사 오매칭 교정, 대형폐기물 품목 확장, 표준데이터 수수료 임포트(용산·노원·강서·관악) | Phase 5 이후 — Phase 6과 지역 배타 분담 |

병렬 규칙: Phase 1은 `src/data.ts`·`src/server.ts` 로직, Phase 2는 `src/data/*.json` 데이터가 주 작업 영역이라 병렬 가능하다.
단, 둘 다 `evaluation-cases.json`/`mcp-answer-cases.json`을 만지므로 케이스 추가는 append-only로 하고 id 충돌만 피한다.
Phase 3도 1·2와 병렬 가능하다. 같은 `src/server.ts`를 만지지만 Phase 1은 `unknownItemResult`(not_found 경로)와 `src/data.ts`,
Phase 3은 확정 매칭 경로와 신규 `src/widgets.ts`라 겹치는 함수가 없다.

**실제 병목은 코드 의존성이 아니라 배포 사이클이다.** `push → (사람) 재배포 → Active 대기 → Preview 테스트 → 수정`은
병렬화되지 않고 사람 손이 필요하다. 8/23까지 이 사이클을 여러 번 돌려야 하므로, Phase 1~3 완료를 기다리지 말고
Phase 0 배포로 사이클을 한 번 완주해 연결·툴콜을 먼저 검증한다(4a). 여기서 막히면 이후 작업이 전부 무의미해진다.

## Git 워크플로 (PR 기반)

- 각 Phase는 자기 워크트리 브랜치에서 작업한다 (`claude/phase-N-*`).
- 완료 기준(각 PRD의 DoD) 충족 + `pnpm local:test` 통과 후 **브랜치를 origin에 푸시하고 PR을 연다.**
  브랜치 푸시는 배포와 무관하므로(배포 소스는 main뿐) 별도 지시 없이 진행한다.
- PR 본문에는 변경 요약, `pnpm local:test` 결과, 리뷰 포인트를 적는다.
- **PR 머지가 배포 게이트다. 사용자가 명시적으로 지시했을 때만 머지한다.**
- **main에 직접 커밋하거나 push하지 않는다.** 로컬 main에 머지한 뒤 main을 직접 푸시하는 방식은 쓰지 않는다 —
  PR을 우회하면 리뷰 이력이 커밋과 연결되지 않고, 열려 있던 PR이 머지 불가 상태로 고아가 된다(PR #1이 그렇게 닫혔다).
- 다른 Phase가 이미 머지됐다면, PR을 열기 전에 최신 main을 브랜치에 반영하고 `pnpm local:test`를 다시 통과시킨다.
  충돌 해소는 각 Phase 세션이 자기 브랜치에서 한다 — 남의 세션이 작업 중인 트리는 건드리지 않는다.
- 머지 후 배포는 사용자가 PlayMCP in KC에서 "재배포" 버튼을 눌러야 반영된다 (Git 소스 빌드, main 기준).
- 예선 서버(`recycle-helper-mcp`, ID 1498)는 절대 건드리지 않는다. 본선용 신규 서버만 재배포한다.

## 사용자(사람) 개입 지점 — 이것만 요청한다

1. **PR 머지 지시** = 배포 게이트. 마일스톤마다 요청. (Phase 브랜치 푸시·PR 생성은 지시 없이 진행한다.)
2. **PlayMCP in KC 재배포 클릭** (머지 직후).
3. **Chrome에 카카오/ChatGPT 계정 로그인 유지** — Kakao Tools Preview 발화 테스트는 Claude가 Chrome 확장으로 대행한다.
4. 그 외 데이터 모델링 등 급하지 않은 결정은 기존 규칙대로 `docs/data-decision-backlog.md`에 쌓고 묶어서 확인한다.

## 본선 규격 요약 (모든 Phase 공통 준수사항)

- 툴 이름: 영문/숫자/`_`/`-`만, 128자 이내, 중복 금지. Kakao가 MCP 식별자를 prefix로 자동 부착하므로 이름에 서비스명 불필요.
- 툴 개수 3~10 권장 (현재 5개 유지).
- `name`, `description`, `inputSchema`, `annotations` 필수. annotations에 `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint` 모두 값 지정.
- description: 영문 권장, 서비스명 국·영문 병기(`RecyclingHelper(재활용척척)`), 1,024자 이내.
- **result 크기 최소화**. 에러/비위젯 응답의 text는 정제된 마크다운. API 원본 덤프 금지.
- 응답속도 평균 100ms 이내, p99 3,000ms 필수.
- 광고성 응답 금지. 사용자 프롬프트 수집 금지. 주민번호/면허번호/여권번호/외국인등록번호/카드번호/계좌번호를 요구하거나 응답에 싣는 것 금지.
- 서비스 컨셉 변경 금지, Key/Token 인증 금지 (인증은 안 씀 — 현행 유지).

## 진행 상태

| Phase | 상태 | 브랜치 | 비고 |
| --- | --- | --- | --- |
| 0 | 완료 (main 반영) | claude/kakaotalk-mcp-analysis-4dfb43 | 코드리뷰 지적 10건 수정 포함(32757f5) |
| 1 | 완료 (main 반영) | claude/prd1-analysis-review-3b08e7 | 자모 오타 매칭 + 재질 폴백 + 별칭 4그룹. 코드리뷰 후속 수정은 PR #6으로 머지 |
| 2 | 완료 (PR #4 머지됨) | claude/prd2-analysis-review-862248 | 표준 티어 142개 추가, 품목 130 → 272 |
| 3 | 완료 (PR #5 머지됨) | claude/prd3-analysis-review-884092 | 위젯 카드 + copy_text + 지역 안내 분기. Preview 렌더링(R6) 확인은 4a로 이관 |
| 4a | 서버 검증 완료, Preview 대기 | claude/prd4-analysis-review-56f5e3 | `c205fdf` 배포분 1·2단계 통과(health 272, 툴 5개, 위젯 JSON, 평균 59ms). 3·4단계는 Chrome 확장 연결 후 |
| 4b | 미착수 | - | 4a 완주 이후 |
| 5 | 완료 (PR #10·#11 머지됨) | claude/phase5-* | 지역 5 → 35곳(서울 17구 + 광역 17). 대형폐기물 수수료 금액은 범위 밖이었음 |
| 6 | PRD·구현 진행 중 (PR #13) | claude/phase6-* | 조례 ETL. 종로 + 표준데이터 미수록 9곳 담당 |
| 7 | PRD 작성됨 | claude/region-expansion-analysis | 오매칭 교정 + 품목 확장 + 표준데이터 수수료 4곳 |

각 세션은 Phase 완료 시 이 표와 담당 PRD 하단의 체크리스트를 갱신한다.

Phase 6·7은 같은 `src/data/bulky-waste-fees.json`을 채우므로 **지역으로 배타 분담**한다. 상세는 [phase-7 문서의 "트랙 분담"](phase-7-bulky-item-fee-expansion.md#트랙-분담-phase-6과-배타) 참조.
