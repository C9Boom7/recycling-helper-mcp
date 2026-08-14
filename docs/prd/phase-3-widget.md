# Phase 3 — Kakao Tools 위젯 (get_disposal_steps)

## 목표

`get_disposal_steps`의 **확정 매칭 응답에만** 위젯(카드 UI)을 붙여, 카톡 화면에서 일관되고 브랜딩된 답변과 "공유하기"(copy_text)를 제공한다.
위젯은 선택 사항(권장)이며, Preview 검증이 계속 실패하면 이 Phase는 접고 텍스트 품질에 시간을 쓴다.

## 배경: 위젯 동작 방식 (Kakao Tools 개발 가이드 §3)

- 위젯을 쓰면 ChatGPT가 답변을 가공하지 않고 서버가 정의한 UI가 그대로 노출된다.
- 스펙은 OpenAI ChatKit widgets와 동일하되 카카오 전용 규칙 3가지:
  1. 위젯 전체를 `widget` 프로퍼티로 한 번 감싼다.
  2. `status` 프로퍼티는 넣지 않는다 (카카오가 로고/서비스명 표기에 사용, 자동 추가).
  3. 카톡 공유용 `copy_text`를 최상위에 넣는다 — Bold/Italic/리스트(ol·ul)/인라인 코드만 지원하는 간단한 마크다운.
- 응답 형식: `tools/call` 결과의 `content[0].text`에 **JSON 문자열을 직렬화해서** 넣는다:
  `{"widget": {...}, "copy_text": "...", "name": "..."}` 형태 (가이드 별첨 예시 준수).
- JSON이 스펙에 어긋나면 일반 텍스트 응답으로 폴백된다 (서비스가 죽지는 않음).
- 렌더링 검증은 **Kakao Tools Preview에서만** 가능하다. PlayMCP AI채팅은 위젯을 렌더링하지 않는다.
- 버튼(OnClickAction)을 쓰려면 `payload.target.url` 필수. v1에서는 버튼 없이 간다 (선택: 근거 출처 링크 버튼 1개까지만).

## 요구사항

### R1. 위젯 적용 조건 — 응답별 분기

- 위젯 사용: `get_disposal_steps` && `resolveWasteItem` 결과가 `match`.
- 텍스트 유지 (위젯 금지): ambiguous / not_found (되묻기·후속 대화 필요), 나머지 4개 툴 전부.
- 환경변수 `WIDGET_ENABLED`(기본 true)로 전체 토글 가능하게 — QA 중 문제가 생기면 코드 수정 없이 재배포만으로 끌 수 있는 안전장치.
- 파싱 규칙은 `process.env.WIDGET_ENABLED !== "false"` 한 줄로 고정한다. 값을 안 주면 켜지고, 정확히 `"false"`일 때만 꺼진다 (QA·smoke가 같은 규칙을 공유해야 하므로 다른 표기를 받아들이지 않는다).

### R2. 카드 구성

Card 하나로 구성 (ListView 남용 금지 — 답변은 목록이 아니라 하나의 안내다):

1. 제목: 품목명 (예: "기름 묻은 피자박스")
2. 배출 그룹 뱃지/캡션: `disposalGroupLabel` (예: "재활용/일반쓰레기")
3. 결론 텍스트: `item.summary`
4. 배출 방법: `steps`를 번호 리스트로
5. 주의: 첫 caution 1~2개
6. 지역 관련: 아래 R2-1 규칙에 따라 최대 3줄 (지역명 캡션 + 안내 2줄)
7. 하단 캡션: 대표 근거 출처 title 1개

ChatKit 컴포넌트 선택(Text/Title/Caption/Divider/Badge 등)은 구현 시 ChatKit 스펙 문서를 확인해 유효한 타입만 쓴다. 스펙에 없는 타입을 쓰면 폴백된다.

### R2-1. 카드의 지역 안내 분기

사용자가 `region`을 알려줬는데 카드가 "거주 지역 기준 확인 필요"만 보여주면, 일부러 준 정보에 대한 답이 사라진다. 지역이 있으면 그 지역 기준을 카드에 싣고, 없을 때만 확인 요청 문구를 쓴다.

`handleGetDisposalSteps`가 이미 계산해 둔 `regionMatch`와 `regionNotes`를 위젯 빌더 인자로 넘긴다 (빌더에서 재계산 금지). `regionMatch`는 `itemNeedsRegionCheck(item)`가 참일 때만 채워지므로, 아래 분기는 그 사실에 기댄다.

| 조건 | 카드에 넣을 내용 |
| --- | --- |
| `regionCheckLevel`이 "낮음" (= `regionMatch` 없음) | 지역 줄 자체를 넣지 않는다 (전국 공통 기준으로 이미 완결) |
| `regionNotes` 있음 | `"{지역명} 기준"` 캡션 + `regionNotes` 앞 2줄 (줄머리 `- ` 제거) |
| `regionMatch`는 있으나 `regionNotes` 없음 | `"{지역명} 기준으로 배출 요일·장소만 확인하면 됩니다"` 한 줄 |
| `regionMatch` 없음 (지역 미입력이거나 인식 실패) | `"거주 지역 기준 확인 필요"` 한 줄 |

- `regionNotes`는 품목·지역에 따라 3줄을 넘길 수 있다. 카드는 2줄에서 자르고 나머지는 텍스트 대화에 맡긴다 (카드가 길어지면 결론이 묻힌다).
- 지역명은 `regionMatch.region.name`을 쓴다. 사용자가 입력한 원문(`region` 인자)이 아니라 매칭된 정식 지역명이어야 오인식이 드러난다.

### R3. copy_text (카톡 공유용)

간단 마크다운. 예:

```
**기름 묻은 피자박스 버리는 법** — 재활용척척
1. 깨끗한 부분과 오염된 부분을 분리
2. 깨끗한 종이는 종이류로
3. 기름 묻은 부분은 일반쓰레기로
```

- 지원 문법(굵게/기울임/리스트/인라인코드)만 사용. 링크·헤딩 금지.
- 3~6줄 이내, 공유받는 사람이 맥락 없이 읽어도 완결되게.

### R4. 구현 구조

- [src/server.ts](../../src/server.ts)의 `get_disposal_steps` 핸들러에서, match 확정 시 `buildDisposalWidget(item, ...)` 결과를 `textResult` 대신 반환.
- 위젯 빌더는 `src/widgets.ts`로 분리 (server.ts 비대화 방지).
- 위젯 응답에는 structuredContent를 넣지 않는다 (위젯이 곧 최종 답변 — result 최소화 원칙).
- 위젯 JSON 생성 함수에 단위 성격의 smoke 케이스 추가: JSON.parse 가능, `widget` 래핑 존재, `status` 부재, `copy_text` 존재.

### R4-1. 기존 smoke 하니스와의 충돌 해소

[scripts/smoke-mcp.mjs](../../scripts/smoke-mcp.mjs)의 answer case 211개 중 183개가 `get_disposal_steps`이고, 대부분 사람이 읽는 텍스트(`expectedTextIncludes`)와 structuredContent 키 화이트리스트를 검증한다. 여기에 JSON-only 호출 검증이 "기름 묻은 피자박스"(확정 매칭)를 하드코딩해 `structuredContent.found === true`를 단언한다. 위젯이 켜진 채로 smoke를 돌리면 이 케이스들이 한꺼번에 깨진다.

- `startServer()`가 서버를 띄울 때 `WIDGET_ENABLED: "false"`를 **env에 직접 고정**한다. 현재는 `...process.env`를 그대로 물려주므로, 셸 환경에 따라 결과가 갈린다. 실행하는 사람과 무관하게 같은 결과가 나와야 한다.
- 그 위에 위젯을 켠 통합 케이스를 별도로 추가한다. 빌더 함수 단위 검증만으로는 server.ts의 분기 배선(match일 때만 위젯, ambiguous·not_found는 텍스트)이 사각지대로 남는다. 최소 3케이스:
  1. 확정 매칭 → `content[0].text`가 JSON으로 파싱되고 `widget` 래핑·`copy_text`가 있으며 `status` 키는 없다. 응답에 structuredContent가 없다.
  2. ambiguous 발화 → 위젯이 아니라 기존 텍스트 응답 그대로다.
  3. region 인자를 준 확정 매칭 → 카드에 매칭된 지역명이 들어간다 (R2-1 회귀 방지).

### R5. 호출 로그의 status 보존

위젯 응답은 structuredContent가 없다. [src/server.ts](../../src/server.ts)의 `callStatus()`는 `found`/`ambiguous`로 상태를 추론하므로, 그대로 두면 확정 매칭인데도 로그에 `"ok"`로 남아 본선 기간 매칭률 집계가 왜곡된다.

- 다행히 배선은 이미 있다. `ToolLogMeta`에 `status` 필드가 있고 `withCallLog`가 `_log?.status ?? callStatus(result)` 순으로 참조한다. **위젯 경로에서 `_log.status`를 `"match"`로 명시**하면 끝이고, `callStatus()`는 손대지 않는다.
- 위젯 응답도 `matchedId`, `score`를 기존과 동일하게 `_log`에 실어, 텍스트 경로와 로그 스키마가 갈라지지 않게 한다.
- 로컬에서 확정 매칭 1회 호출해 stdout JSON 라인의 `status`가 `"match"`인지 눈으로 확인한다.

### R6. 검증 루프

1. 로컬: smoke 케이스로 JSON 구조 검증.
2. 배포 후 Kakao Tools Preview에서 발화 → 위젯 렌더링 확인 (Claude가 Chrome으로 대행, 스크린샷 기록).
3. 렌더링 실패 시: JSON을 가이드 별첨 예시와 대조 → 컴포넌트 타입 축소(순수 Text만) → 그래도 실패면 `WIDGET_ENABLED=false`로 접는다.
4. 폴백 확인: 고의로 깨진 위젯을 만들어 일반 텍스트로 처리되는지 1회 확인 (Preview).

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과. 비위젯 경로 무회귀 — smoke 하니스가 `WIDGET_ENABLED=false`를 고정한 상태로 기존 211케이스 전부 통과하고, 여기에 R4-1의 위젯 켠 통합 케이스 3종과 R4의 빌더 구조 케이스가 더해진다.
2. 확정 매칭 호출 1회의 stdout 로그에서 `status`가 `"match"`로 찍히는 것 확인 (R5).
3. Preview에서 확정 매칭 발화 3종의 위젯 렌더링 스크린샷. 이 중 1종은 지역을 함께 말한 발화로 잡아 카드의 지역 안내(R2-1)를 눈으로 확인한다.
4. ambiguous/not_found 발화가 여전히 텍스트로 나오는 것 확인.
5. 로컬 main 머지.

## 리스크

- ChatKit 스펙 해석 차이로 렌더링 실패 반복 → R6의 축소 전략, 최종적으로 토글 오프.
- 위젯이 대화 흐름을 끊는다는 사용자 반응 가능성 → 본선 중 수정 불가이므로, Phase 4 발화 테스트에서 위젯 유/무 체감을 비교해 최종 결정.

## 완료 체크리스트

- [x] R1 분기 + WIDGET_ENABLED — match만 위젯, ambiguous/not_found는 텍스트 유지. `process.env.WIDGET_ENABLED !== "false"`
- [x] R2 카드 + R2-1 지역 안내 분기 — Card/Title/Text/Caption/Divider만 사용 (Badge는 Preview 통과 후 검토). 지역 4분기 구현
- [x] R3 copy_text — 제목 1줄 + steps 최대 5개. 최장 품목(비닐류 포장재, 7 steps)도 6줄
- [x] R4 widgets.ts + 구조 smoke — `buildDisposalWidget` 순수 함수, structuredContent 미포함
- [x] R4-1 smoke 하니스 WIDGET_ENABLED 고정 + 위젯 통합 케이스 — 기존 211케이스는 `false` 고정 서버, 위젯은 별도 인스턴스에서 5케이스
- [x] R5 호출 로그 status="match" — `_log.status` 명시, smoke가 stdout 로그 라인으로 검증
- [ ] R6 Preview 렌더링 확인 — push·재배포 이후 가능
