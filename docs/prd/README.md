# 본선 (Kakao Tools) 추가 개발 PRD 모음

Agentic Player 10 본선 추가 개발(2026-08-13 ~ 08-23)을 Phase 7개로 나눈 작업 명세다.
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
| 5 | [phase-5-region-expansion.md](phase-5-region-expansion.md) | 지역 커버리지 확장 (스키마 티어링, 매칭 단계화, 표준·광역 티어) | Phase 4a 완주 이후, 4b와 병렬 |
| 6 | [phase-6-bulky-fee-etl.md](phase-6-bulky-fee-etl.md) | 자치법규 ETL로 등록 지역 10곳의 대형폐기물 수수료 금액 채우기 | Phase 5 머지 후. 런타임 코드 무변경이라 4b와 병렬 |
| 7 | [phase-7-bulky-item-fee-expansion.md](phase-7-bulky-item-fee-expansion.md) | 복합명사 오매칭 교정, 대형폐기물 품목 확장, 표준데이터 수수료 임포트(용산·노원·강서·관악) | Phase 5 이후 — Phase 6과 지역 배타 분담 |
| 8 | [phase-8-item-coverage.md](phase-8-item-coverage.md) | 확장 발화 not_found 6건 해소 (품목 데이터) | 없음 — Phase 9와 병렬 |
| 9 | [phase-9-metro-districts.md](phase-9-metro-districts.md) | 광역시 자치구 확장 (부산·대구·인천·대전·광주) | 없음 — Phase 8과 병렬 |

Phase 8·9는 2026-08-21 본선 심사기준 자체 평가에서 나온 구멍 둘을 메운다. 둘 다 **런타임 코드 무변경**이고 주 작업 영역이 갈린다 —
Phase 8은 `waste-items.json` 계열, Phase 9는 `region-policies.json` 계열이다.
공유 파일은 `mcp-answer-cases.json`(append-only, `p8_`/`p9_` prefix)과 카운트 문서 둘뿐이고, 머지 순서는 Phase 8이 먼저다.

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

마감 대비 이득이 작거나 프리징 때문에 이번 사이클에 넣을 수 없는 항목은 [docs/post-finals-backlog.md](../post-finals-backlog.md)에 모은다.

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
| 4a | 완료 | claude/prd4-analysis-review-56f5e3 | 4단계 전부 통과. Preview 렌더링·툴콜까지 확인했고 측정 환경을 ChatGPT 본체 커넥터로 옮겨 자동 측정이 가능해졌다 |
| 4b | R1~R3 완료, R4 마감 게이트만 남음 | claude/qa-runbook 외 | 발화 30개 시나리오 완주 — 의도 발화 툴 호출·정답 100%, 비의도 과호출 0(N1은 8/15 Preview 재확인으로 해소). 측정 중 버그 3건(오라우팅·카테고리어 과매칭·광역 임의 확정)을 잡아 배포로 검증. R3 문서 4종 완료 |
| 5 | 완료 (PR #10·#11 머지됨, R4 잔여는 #34에서 마감) | claude/phase5-doc-plan-review-4dcfdb 외 | 지역 5 → 35(full 5, standard 13, metro 17). 백로그로 남겼던 8곳을 2026-08-16에 채워 **43(standard 21) — 서울 25개 구 전부** |
| 6 | R0~R4 완료, R5 1차 완료 / 2차만 남음 | claude/phase6-r2-r4, claude/phase6-r5-early | 조례 10곳 1,176행 적재 — 수수료 보유 지역 8 → 18곳(비광역 전부), 행 849 → 2,025. R2 골든셋 69행 금액 불일치 0건, 파서 결함 둘을 고쳐 행 파싱 10/10. validate 규칙 3종·회귀 3건 추가. 코드 리뷰 후속으로 품목 오귀속 규칙을 조여 42행을 옮기거나 뺐다. **R5 1차(8/15 앞당겨 실행)**: 조례 개정 0곳, 링크 점검 범위를 수수료 파일까지 넓혀 117개로 확대하고 송파구 404·성남시 302를 고쳐 117/117. R5 2차(출고 직전 재대조)는 8/22~23 |
| 7 | 완료 (PR #22 머지됨) | claude/phase7-r2-batch4 외 | 오매칭 13 → 0, 답변 가능 94/100, 품목 324개. 되묻기 5건 해소 배치까지 마쳐 ambiguous는 포괄어 4건만 남았다 |
| 8 | 완료 (PR #61 머지됨) | claude/phase8-item-coverage | 확장 발화 50개 중 not_found 6 → 0, 품목 324 → 330. 신규 품목 6개(양념통·변기솔·선크림 튜브·벨트·젖병·젖병살균소독기)와 `rice_sack` 별칭 흡수(사료 포대). 발화 내성 3,300건 100% 유지 |
| 9 | 8곳 중 7곳 완료 (PR #62 머지됨 + 달서·광주 북구) | claude/phase9-metro-districts 외 | 기초자치단체 32 → 39/226. 부산 해운대·부산진, 대구 북구·달서, 인천 남동·부평, 광주 북구를 자치구로 승격했다. **대전 서구는 폐의약품을 구청 출처로 못 채워 넣지 않았다** — 나머지 필드는 [phase-9 문서](phase-9-metro-districts.md)에 적어 뒀다. 수수료는 임포터의 시도 필터를 고쳐야 해서 이번엔 넣지 않았다 |

각 세션은 Phase 완료 시 이 표와 담당 PRD 하단의 체크리스트를 갱신한다.

Phase 6·7은 같은 `src/data/bulky-waste-fees.json`을 채우므로 **지역으로 배타 분담**한다. 상세는 [phase-7 문서의 "트랙 분담"](phase-7-bulky-item-fee-expansion.md#트랙-분담-phase-6과-배타) 참조.
