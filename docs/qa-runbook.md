# QA 대응 런북

카카오 QA 기간(8/24~26)과 본선(8/31~9/28)에 오류를 전달받았을 때 무엇부터 보고 어떻게 고칠지 정리한 문서다.
**당일 수정이 원칙**이므로 원인 파악에 쓸 시간을 아끼는 것이 목적이다.

전제 두 가지를 먼저 적는다.

- **8/27 코드 프리징 이후에는 서버를 고칠 수 없다.** 본선 중 발견된 문제는 심각한 것만 협의 후 수정한다.
  그러니 프리징 전까지는 "고칠 수 있는 문제"를, 프리징 후에는 "답변으로 안내할 수 있는 문제"를 분리해서 다뤄야 한다.
- **배포는 사람 손이 필요하다.** main 머지 → PlayMCP in KC에서 "재배포" 클릭 → Active 대기가 한 사이클이다.

## 1. 30초 안에 확인할 것

문의를 받으면 서버가 살아 있는지와 어떤 빌드가 떠 있는지부터 본다. **주소를 둘 다 찍는다.** 우리가 재배포하는 서버와
사용자가 실제로 닿는 서버가 어긋나 있어서, 한쪽만 보면 멀쩡해 보인다.

```bash
# 재배포 대상
curl -sS https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/health
# 운영 등록이 가리키는 주소
curl -sS https://recycling-helper-mcp.playmcp-endpoint.kakaocloud.io/health
```

둘 다 `{"ok":true,"service":"RecyclingHelper(재활용척척)","items":324}`여야 정상이다.

- 응답이 없다 → 서버가 내려갔다. PlayMCP in KC 콘솔에서 Status를 확인한다. 코드 문제가 아니다.
- **두 주소의 `items`가 다르다 → 등록 불일치다. 여기서 멈추고 이것부터 해결한다.** 2026-08-15 기준 재배포 대상은 324,
  등록 주소는 130(Phase 0 이전 빌드)이다. 이 상태에서는 무엇을 고쳐 배포해도 사용자에게 닿지 않는다.
  해결 방법은 사용자 결정이 필요하다 — [playmcp-in-kc.md](playmcp-in-kc.md)의 "등록 주소와 재배포 주소가 어긋나 있습니다"를 본다.
- 두 주소가 같은데 `items` 수가 최신 main과 다르다 → **재배포 누락이다.** 최신 main의 품목 수와 대조한다
  (`node -e "console.log(require('./src/data/waste-items.json').length)"`).

**`items`만으로는 부족하다. 데이터를 안 건드린 배포는 이 숫자가 그대로다.** 매칭 규칙처럼 코드만 바뀐 배포는
품목 수가 똑같아서 옛 빌드가 떠 있어도 "정상"으로 읽힌다. 2026-08-15에 조사 처리 개선(PR #27)을 머지했을 때가 그랬다.
재배포 대상의 `items`가 배포 전에도 324, 배포 후에도 324여서 이 숫자로는 재배포가 됐는지 알 길이 없었다.
(같은 날 등록 주소가 130이던 것은 바로 위에 적은 등록 불일치이고, 이 문제와는 별개다.)
그래서 기능 프로브를 한 번 더 친다. **여기서도 주소를 둘 다 찍는다.**

```bash
PROBE='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_disposal_steps","arguments":{"itemName":"칫솔은요?"}}}'
# 재배포 대상
curl -sS -H 'content-type: application/json' -H 'accept: application/json' -d "$PROBE" \
  https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io/mcp
# 운영 등록이 가리키는 주소
curl -sS -H 'content-type: application/json' -H 'accept: application/json' -d "$PROBE" \
  https://recycling-helper-mcp.playmcp-endpoint.kakaocloud.io/mcp
```

**응답에 `칫솔`이 보이는지로 판정하면 안 된다.** 못 찾았을 때의 폴백 문구가 질의를 그대로 되풀이해서
(`입력한 품목 "칫솔은요?"을(를) ... 확실히 찾지 못했습니다`) 구버전 응답에도 `칫솔`이 들어 있다.
눈으로 훑거나 `grep 칫솔`로 보면 옛 빌드를 최신으로 읽는다 — 이 절이 막으려는 바로 그 오진이다.

### 프로브를 고르는 법 — 이게 본체다

아래 명령은 PR #27용 예시일 뿐이다. **매번 새로 골라야 하고, 고를 때 지켜야 할 것이 셋이다.**

1. **두 빌드의 응답이 실제로 갈리는 질의여야 한다.** 그리고 **갈리는 지점을 문자열로 적어 둔다.** 아래 예시는
   "구버전은 폴백, 최신은 카드"라 `widget` 유무로 갈리지만, 수수료 표기나 문구를 고친 배포는 **양쪽 다 카드**라
   `widget`으로는 안 갈린다. 그런 배포는 바뀐 문구 자체를 찾아야 한다(예: `수수료 4,000원~8,000원`).
2. **판정 문자열을 배포 전에 실제로 확인한다.** 고친 브랜치를 로컬에서 띄워 한 번, 배포 전 서버에 한 번 쳐 보고
   두 응답이 정말 다른지 본다. 이걸 안 하면 "안 갈리는 프로브"를 근거로 삼게 된다.
3. **되묻기 경로는 문구가 다르다.** not_found는 `확실히 찾지 못했습니다`, 되묻기는 `정확히 찾지 못했습니다`다
   (`src/server.ts`). 프로브의 이전 상태가 되묻기였다면 이 문자열로 잡아야 한다.

`WIDGET_ENABLED=false`로 돌려놓은 상태라면 확정 매칭도 텍스트로 나가므로 `widget` 판정은 쓸 수 없다.
4절에서 위젯을 끈 채 운영 중이면 프로브도 텍스트 기준으로 다시 잡는다.

### 예시 — PR #27 (조사 처리) 기준

확정 매칭만 위젯 카드로 나가므로 `widget`이라는 낱말이 신호다
(응답 안에서는 `{\"widget\":...`로 이스케이프돼 있어 따옴표까지 넣어 찾으면 안 걸린다).

```bash
PROBE='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_disposal_steps","arguments":{"itemName":"칫솔은요?"}}}'
for H in https://recycling-helper-mcp-kakaotools.playmcp-endpoint.kakaocloud.io \
         https://recycling-helper-mcp.playmcp-endpoint.kakaocloud.io; do
  R=$(curl -sS -H 'content-type: application/json' -H 'accept: application/json' -d "$PROBE" $H/mcp)
  printf "%-60s " "$H"
  if   echo "$R" | grep -q 'Not Acceptable';        then echo "406 — JSON-only 미지원 빌드"
  elif echo "$R" | grep -q '찾지 못했습니다';        then echo "구버전 (폴백 또는 되묻기)"
  elif echo "$R" | grep -q 'widget';                 then echo "최신 (카드)"
  else echo "판정 불가 — 응답 원문을 직접 본다"; fi
done
```

`칫솔은요?`는 회귀 케이스로 고정돼 있지 않다. 칫솔이 들어간 별칭이 하나 더 늘면 되묻기로 바뀌어
**멀쩡한 빌드에 "구버전" 판정이 난다** — 그때도 `pnpm local:test`는 초록이다. 판정이 이상하면 프로브부터 의심한다.

한쪽 주소만 최신으로 나오면 `items`가 같더라도 등록 불일치다 — 위의 등록 불일치 항목으로 돌아간다.

`Not Acceptable: Client must accept both application/json and text/event-stream` 오류가 돌아오는 경우도 있다.
**JSON-only `tools/call`을 지원하기 전 빌드라는 뜻이다.** 이 지원은 Phase 0 코드 리뷰 후속으로 들어갔으므로,
"Phase 0 이전"이라고 단정하지는 마라 — `items`가 130인 빌드 중에도 이 경로가 되는 것과 안 되는 것이 갈린다
([playmcp-in-kc.md](playmcp-in-kc.md)의 `a696026` 검증 이력). 어느 커밋인지는 이 신호만으로 못 짚는다.

**어느 주소에서 났는지가 다음 행동을 가른다.**

- 운영 등록 주소에서 났다 → 등록 불일치다. 등록 불일치 항목으로 간다. (2026-08-15 기준이 이 상태다.)
- **재배포 대상에서 났다 → 등록 문제가 아니라 우리 서버에 옛 빌드가 떠 있는 것이다.** 롤백이나 배포 실패를 의심하고
  PlayMCP in KC 콘솔에서 다시 배포한다. 이쪽을 등록 문제로 오해하면 엉뚱한 데를 파게 된다.

**런타임을 고칠 때마다 이 프로브도 갱신한다.** 배포 여부를 가르는 기준은 "그 배포에서만 달라지는 응답"이지
품목 수가 아니다. 데이터만 바뀐 배포라면 `items`로 충분하다.

"고쳤는데 왜 그대로냐"는 문의는 위 셋 중 하나가 원인인 경우가 많다. 코드를 파기 전에 여기부터 지운다.

`items`와 기능 프로브가 모두 최신 빌드를 가리키면 그때 문제를 재현한다.

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
- **런타임 코드를 건드리지 않으므로 8/21 기능 변경 마감 이후에도 가능하다.** 단 스키마·코드 변경 없이 검증을 통과하는
  데이터여야 하고, 재배포가 필요하므로 **8/27 프리징까지가 상한이다.**
- 공식 근거 없이 추가하지 않는다. 근거는 생활폐기물 분리배출 누리집 품목사전이나 지자체 공식 안내다.

### ② "엉뚱한 품목을 알려준다" — 오매칭

가장 위험한 유형이다. 사용자가 말한 적 없는 품목을 확신에 차서 안내하는 것이라 오답이다.

- 로그의 `matchedId`와 `score`를 본다. 복합명사의 수식어 자리에 걸린 경우가 대부분이다(`전자레인지 수납장` → 전자레인지).
- 고치는 곳: 보통은 별칭 조정으로 해결된다. `waste-items.json`의 `aliases`에서 문제되는 항목을 빼거나 더 긴 표기를 추가한다.
- **반례 회귀를 반드시 함께 넣는다.** `mcp-answer-cases.json`에 "이 질의는 이 품목으로 가면 안 된다"를 고정하지 않으면 다음 데이터 추가에서 되살아난다.

### ③ "지역 정보가 틀리다"

- 등록된 43개 지역인지 먼저 본다. `full` 5곳은 배출 요일까지, `standard` 21곳은 신청·수수료 링크와 전화, `metro` 17곳은 광역 폴백만 담는다.
- **서울은 25개 구가 전부 등록돼 있다**(full 4곳 + standard 21곳). 서울 자치구 문의를 "미등록 지역"으로 넘기면 안 된다.
- 예외 하나: `중구`만 치면 전국 폴백으로 떨어진다. **이건 버그가 아니다.** 중구는 부산·대구·인천·대전·울산에도 있어서, 광역 접두어 없이 확정하면 다른 지역 주민이 서울 중구의 전화번호를 받는다. `서울 중구`로 다시 물으면 정상 안내가 나간다. `동구`·`서구`·`남구`·`북구`도 같다 — 별칭을 달아 "고치지" 마라.
- 미등록 지역이면 폴백이 정상 동작이다. 없는 정보를 지어내지 않는 것이 이 설계의 목적이다.
- 수수료 금액 문의는 **조례·고시 기준이고 실제 부과액은 접수 담당자가 정한다.** 응답에 "수수료 후보"라는 표현과 신청 URL이 함께 나가는 이유다.
- 링크가 죽었다는 문의는 `pnpm check:links`로 전수 확인한다.

### ④ "툴이 아예 호출되지 않는다"

서버 문제가 아닐 가능성이 높다. 호스트 LLM이 툴을 고르지 않은 것이다.

- 로그에 해당 시각의 호출이 없으면 서버까지 오지 않은 것이다.
- description 조정이 유일한 수단이다. **8/21 기능 변경 마감에는 걸리지 않는다** — 마감되는 건 기능이고, description은
  마감 이후에도 허용되는 "문구 수정"이다([phase-4-release.md](prd/phase-4-release.md) R4). 8/27 프리징까지는 고칠 수 있다.
- 걸리는 건 날짜가 아니라 **등록 갱신**이다. PlayMCP는 툴 목록을 **등록 시점 스냅샷**으로 저장하므로, 서버의 description을
  고쳐 배포해도 등록을 갱신하지 않으면 ChatGPT는 계속 옛 description으로 툴을 고른다.
  운영 등록은 `심사 완료` 상태라 수정이 재심사를 유발하는지부터 확인해야 한다. 그래서 **서버 수정보다 이쪽이 오래 걸린다.**
  당일 대응이 필요하면 이 절차부터 사용자와 합의하고 시작한다.

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
6. 반영을 확인한다. `/health`의 `items`는 데이터를 고쳤을 때만 움직이므로, **코드만 고쳤다면 1절의 기능 프로브가 유일한 근거다.**
   1절의 "프로브를 고르는 법" 셋을 그대로 따른다 — 이번 수정으로 갈리는 질의를 고르고, **갈리는 문자열까지 정하고,
   배포 전에 두 응답이 실제로 다른지 확인한다.** 그리고 재배포 대상과 운영 등록 주소를 둘 다 친다.
   그 다음 문의받은 상황을 툴 호출로 재현해 본다.

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
