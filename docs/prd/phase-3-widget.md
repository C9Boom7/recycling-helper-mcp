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

### R2. 카드 구성

Card 하나로 구성 (ListView 남용 금지 — 답변은 목록이 아니라 하나의 안내다):

1. 제목: 품목명 (예: "기름 묻은 피자박스")
2. 배출 그룹 뱃지/캡션: `disposalGroupLabel` (예: "재활용/일반쓰레기")
3. 결론 텍스트: `item.summary`
4. 배출 방법: `steps`를 번호 리스트로
5. 주의: 첫 caution 1~2개
6. 지역 관련: `regionCheckLevel`이 "필수"인 품목이면 "거주 지역 기준 확인 필요" 한 줄 (지역 세부는 텍스트 대화에 맡김)
7. 하단 캡션: 대표 근거 출처 title 1개

ChatKit 컴포넌트 선택(Text/Title/Caption/Divider/Badge 등)은 구현 시 ChatKit 스펙 문서를 확인해 유효한 타입만 쓴다. 스펙에 없는 타입을 쓰면 폴백된다.

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

### R5. 검증 루프

1. 로컬: smoke 케이스로 JSON 구조 검증.
2. 배포 후 Kakao Tools Preview에서 발화 → 위젯 렌더링 확인 (Claude가 Chrome으로 대행, 스크린샷 기록).
3. 렌더링 실패 시: JSON을 가이드 별첨 예시와 대조 → 컴포넌트 타입 축소(순수 Text만) → 그래도 실패면 `WIDGET_ENABLED=false`로 접는다.
4. 폴백 확인: 고의로 깨진 위젯을 만들어 일반 텍스트로 처리되는지 1회 확인 (Preview).

## 검증 및 완료 기준 (DoD)

1. `pnpm local:test` 통과 (비위젯 경로 무회귀 — `WIDGET_ENABLED=false`로 기존 smoke 전체 통과 + 위젯 구조 케이스 통과).
2. Preview에서 확정 매칭 발화 3종의 위젯 렌더링 스크린샷.
3. ambiguous/not_found 발화가 여전히 텍스트로 나오는 것 확인.
4. 로컬 main 머지.

## 리스크

- ChatKit 스펙 해석 차이로 렌더링 실패 반복 → R5의 축소 전략, 최종적으로 토글 오프.
- 위젯이 대화 흐름을 끊는다는 사용자 반응 가능성 → 본선 중 수정 불가이므로, Phase 4 발화 테스트에서 위젯 유/무 체감을 비교해 최종 결정.

## 완료 체크리스트

- [ ] R1 분기 + WIDGET_ENABLED
- [ ] R2 카드
- [ ] R3 copy_text
- [ ] R4 widgets.ts + 구조 smoke
- [ ] R5 Preview 렌더링 확인
