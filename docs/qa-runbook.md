# QA 대응 런북

카카오 QA 기간(8/24~26)과 본선(8/31~9/28)에 오류를 전달받았을 때 무엇부터 보고 어떻게 고칠지 정리한 문서다.
**당일 수정이 원칙**이므로 원인 파악에 쓸 시간을 아끼는 것이 목적이다.

전제 두 가지를 먼저 적는다.

- **8/27 코드 프리징 이후에는 서버를 고칠 수 없다.** 본선 중 발견된 문제는 심각한 것만 협의 후 수정한다.
  그러니 프리징 전까지는 "고칠 수 있는 문제"를, 프리징 후에는 "답변으로 안내할 수 있는 문제"를 분리해서 다뤄야 한다.
- **배포는 사람 손이 필요하다.** main 머지 → PlayMCP in KC에서 "재배포" 클릭 → Active 대기가 한 사이클이다.

## 1. 30초 안에 확인할 것

문의를 받으면 서버가 살아 있는지와 어떤 빌드가 떠 있는지부터 본다.

```bash
curl -sS https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/health
```

`{"ok":true,"service":"RecyclingHelper(재활용척척)","items":324}`가 정상이다.

- 응답이 없다 → 서버가 내려갔다. PlayMCP in KC 콘솔에서 Status를 확인한다. 코드 문제가 아니다.
- `items` 수가 다르다 → **옛 빌드가 떠 있다.** 최신 main의 품목 수와 대조한다(`node -e "console.log(require('./src/data/waste-items.json').length)"`).
  이 경우 "고쳤는데 왜 그대로냐"는 문의의 원인이 재배포 누락일 수 있다.

품목 수가 맞으면 문제를 재현한다.

```bash
curl -sS -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_disposal_steps","arguments":{"itemName":"문의받은 품목","region":"서울 강남구"}}}' \
  https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/mcp
```

`accept: application/json`만 주는 이 경로가 카카오 인프라가 쓰는 경로다. SSE 경로(`accept`에 `text/event-stream` 추가)와 결과가 같아야 한다.

## 2. 로그 읽기

서버는 툴 호출마다 stdout에 JSON 한 줄을 찍는다. PlayMCP in KC 콘솔의 로그에서 본다.

```json
{"ts":"...","tool":"get_disposal_steps","input":{...},"status":"match","matchedId":"pizza_box_oily","matchedRegion":"서울 강남구","score":100,"matched":1,"total":1,"ms":3}
```

| 필드 | 읽는 법 |
| --- | --- |
| `tool` | 호스트가 어느 툴을 골랐는지. 오라우팅 의심 문의는 여기부터 본다 |
| `input` | 호스트가 넘긴 인자. **사용자 발화 원문이 아니라 LLM이 뽑은 값**이다 |
| `status` | `match` / `ambiguous` / `not_found` / `error` |
| `matchedId` | 확정된 품목 id. 엉뚱한 값이면 오매칭이다 |
| `score` | 매칭 점수. 88 미만이면 폴백 티어에서 걸린 것 |
| `matched` / `total` | 후보 수. `ambiguous`의 후보 폭을 본다 |
| `ms` | 서버 처리 시간. 한 자릿수가 정상이다 |

`status: "error"`면 `message`가 함께 찍힌다. 이건 코드 결함이므로 최우선으로 다룬다.

**사용자 프롬프트는 수집하지 않는다.** 본선 규격이 금지한다. `input`은 호스트가 인자로 넘긴 값일 뿐이며, 이 범위를 넘겨 로깅을 늘리지 않는다.

## 3. 문의 유형별 대응

### ① "품목을 못 찾는다" — `status: not_found`

폴백이 재질별 안내로 이어졌다면 설계대로 동작한 것이다. 그래도 자주 나오는 품목이면 데이터를 추가한다.

- 고치는 곳: `src/data/waste-items.json`에 품목 추가 + `evaluation-cases.json`에 케이스 추가.
- **런타임 코드를 건드리지 않으므로 8/21 기능 변경 마감 이후에도 가능하다.**
- 공식 근거 없이 추가하지 않는다. 근거는 생활폐기물 분리배출 누리집 품목사전이나 지자체 공식 안내다.

### ② "엉뚱한 품목을 알려준다" — 오매칭

가장 위험한 유형이다. 사용자가 말한 적 없는 품목을 확신에 차서 안내하는 것이라 오답이다.

- 로그의 `matchedId`와 `score`를 본다. 복합명사의 수식어 자리에 걸린 경우가 대부분이다(`전자레인지 수납장` → 전자레인지).
- 고치는 곳: 보통은 별칭 조정으로 해결된다. `waste-items.json`의 `aliases`에서 문제되는 항목을 빼거나 더 긴 표기를 추가한다.
- **반례 회귀를 반드시 함께 넣는다.** `mcp-answer-cases.json`에 "이 질의는 이 품목으로 가면 안 된다"를 고정하지 않으면 다음 데이터 추가에서 되살아난다.

### ③ "지역 정보가 틀리다"

- 등록된 35개 지역인지 먼저 본다. `full` 5곳은 배출 요일까지, `standard` 13곳은 신청·수수료 링크와 전화, `metro` 17곳은 광역 폴백만 담는다.
- 미등록 지역이면 폴백이 정상 동작이다. 없는 정보를 지어내지 않는 것이 이 설계의 목적이다.
- 수수료 금액 문의는 **조례·고시 기준이고 실제 부과액은 접수 담당자가 정한다.** 응답에 "수수료 후보"라는 표현과 신청 URL이 함께 나가는 이유다.
- 링크가 죽었다는 문의는 `pnpm check:links`로 전수 확인한다.

### ④ "툴이 아예 호출되지 않는다"

서버 문제가 아닐 가능성이 높다. 호스트 LLM이 툴을 고르지 않은 것이다.

- 로그에 해당 시각의 호출이 없으면 서버까지 오지 않은 것이다.
- description 조정이 유일한 수단인데 **이건 런타임 변경이라 8/21 이후에는 못 한다.** 프리징 후에는 대응 불가로 분류한다.
- PlayMCP는 툴 목록을 **등록 시점 스냅샷**으로 저장한다. description을 고쳤다면 등록도 갱신해야 반영된다.

### ⑤ "응답이 느리다"

서버 처리 시간(`ms`)은 한 자릿수다. 느리다면 네트워크나 호스트 쪽이다.
측정할 때는 **연결을 재사용해야 한다** — `curl`을 반복문으로 돌리면 매번 TLS 핸드셰이크가 붙어 실제보다 3배 느리게 나온다.
기준값과 재측정 방법은 [deploy-verification-2026-08-15.md](deploy-verification-2026-08-15.md)에 있다.

## 4. 위젯이 문제일 때 — `WIDGET_ENABLED`

확정 매칭 응답은 위젯 카드 JSON으로 나간다. 카드 렌더링 자체가 깨지면 환경변수로 텍스트 응답으로 되돌릴 수 있다.

```bash
WIDGET_ENABLED=false
```

`false`가 아닌 값이면 전부 활성이다(기본값 활성). 텍스트 폴백은 마크다운으로 나가며 내용은 같다.

**되돌리기 전에 알아둘 것**: 텍스트 폴백은 응답이 커진다(노원구 매트리스 기준 5.7KB). 원인은 수수료가 아니라 지역 안내가 text와 structuredContent에 두 번 실리는 것이고, 본선 실사용 경로가 위젯이라 지금은 손대지 않았다. 자세한 분해는 [post-finals-backlog.md](post-finals-backlog.md) 1번에 있다.

## 5. 수정하고 내보내는 절차

1. 브랜치를 만들어 고친다. main에 직접 커밋하지 않는다.
2. `pnpm local:test`를 통과시킨다. 워크트리에서는 `pnpm --config.verify-deps-before-run=false local:test`가 필요하다.
3. 브랜치를 푸시하고 PR을 연다.
4. **사용자에게 머지를 요청한다. 머지가 배포 게이트다.**
5. 머지 후 사용자가 PlayMCP in KC에서 "재배포"를 누른다. Status가 `Active`가 될 때까지 기다린다.
6. `/health`의 `items`로 반영을 확인한다. 툴 호출까지 재현해 본다.

**재배포 횟수를 아끼려면 수정을 묶어서 내보낸다.** 하루 1~2회가 적당하다.

## 6. 건드리면 안 되는 것

- **예선 서버(`recycle-helper-mcp`, 서버 ID 1498)** — 어떤 경우에도 손대지 않는다.
- 이름이 비슷한 서버가 셋이라 반드시 구분한다. 재배포 대상은 `-kakaotools` 접미사가 붙은 쪽이다. 상세는 [playmcp-in-kc.md](playmcp-in-kc.md).
- 서비스 컨셉 변경, 인증 추가, 광고성 응답, 사용자 프롬프트 수집, 주민번호·카드번호 등 민감정보 요구 — 전부 본선 규격 위반이다.

## 7. 참고 문서

| 문서 | 언제 보나 |
| --- | --- |
| [playmcp-in-kc.md](playmcp-in-kc.md) | 배포·재배포 절차, 서버 3종 구분, 등록 주소 문제 |
| [deploy-verification-2026-08-15.md](deploy-verification-2026-08-15.md) | 응답속도 기준값과 재측정 방법 |
| [preview-test-results-2026-08-14.md](preview-test-results-2026-08-14.md) | 발화별 기대 동작, 측정 환경의 한계 |
| [post-finals-backlog.md](post-finals-backlog.md) | "이건 왜 안 고쳤나"에 대한 답 |
| [prd/README.md](prd/README.md) | 본선 규격 요약, Phase별 진행 상태 |
