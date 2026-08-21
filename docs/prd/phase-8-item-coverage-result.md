# Phase 8 — 품목 커버리지 마감 기록

명세인 [phase-8-item-coverage.md](phase-8-item-coverage.md)의 R1(성격 판정)부터 R4(검증)까지 실제로 마친 결과다.
여섯 건을 모두 데이터에 반영했고 `pnpm local:test`가 통과한다.

첫 커밋은 `src/data/`를 건드리지 않은 초안이었다. 그 초안이 R2(출처 조사)를 남겨뒀는데,
이번에 분리배출 누리집을 직접 열어 근거를 채우면서 **판정 두 건이 뒤집혔다.** 아래 2절에 적었다.

## 1. 최종 판정 — 여섯 건

| 질의 | 초안 판정 | 최종 | 근거 |
| --- | --- | --- | --- |
| 플라스틱 양념통 | 신규 `plastic_seasoning_container` (플라스틱 전용) | 신규 `seasoning_container` **재질 분기** | 고추장 항목 |
| 변기솔 | 신규 `toilet_brush` | 그대로 | 청소솔·칫솔 항목 |
| 선크림 튜브 | 신규 `sunscreen_tube` (치약 근거) | 그대로, **근거를 핸드크림으로** | 핸드크림 두 항목 |
| 가죽 벨트 | 신규 `leather_belt` / 종량제봉투 | 신규 `belt` / **의류수거함** | 의류·가방 항목 |
| 젖병 | 신규 `baby_bottle` | 그대로 | 공갈젖꼭지·내열식기 항목 |
| 사료 포대 | 별칭 → `rice_sack` | 그대로 | 쌀 마대자루 항목 |

품목사전에서 `양념통`·`변기솔`·`선크림`·`벨트`·`젖병`·`사료 포대`는 모두 단독 항목이 없었다.
검색이 비었다는 사실은 품목마다 `manual_review` source로 남겼다. `dish_brush`가 쓰던 방식 그대로다.

## 2. R2에서 뒤집힌 판정 둘

### 2-1. 양념통 — 플라스틱 전용에서 재질 분기로

품목사전 [고추장](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=170) 항목의 특징란이 이렇게 못 박는다.

> 고추장, 된장 등 장류는 가정에서 소량으로 발생하므로 음식물류폐기물로 배출합니다.
> 장류 용기는 물로 헹군 후 재질에 맞게 플라스틱 또는 유리병으로 배출합니다.

초안은 양념통을 플라스틱 전용 품목으로 잡고 `recycle_or_general`을 골랐다. 그런데 원문은 재질을 먼저 가른다.
그대로 두면 "유리 양념통 어떻게 버려?"에 플라스틱 안내가 나가는데, 정작 초안 주의사항에는
"유리 양념통은 유리병류 기준을 따릅니다"라고 적혀 있었다. 카드 본문과 주의사항이 서로 어긋난 셈이다.

그래서 이름을 `양념통`으로 넓히고 갈래를 `recycle_or_general_by_material`로 바꿨다.
플라스틱 갈래는 [간장용기](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EA%B0%84%EC%9E%A5) 항목("내용물을 비우고 라벨 등 이물질을 제거한 후 플라스틱 수거함으로 배출")이 보조 근거다.

### 2-2. 벨트 — 종량제봉투에서 의류수거함으로

초안은 `wallet`(명함지갑 → 종량제봉투)을 따라 `general`로 잡고, 의류수거함 수거 여부를 R2 숙제로 넘겼다.
[의류](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EC%9D%98%EB%A5%98) 항목이 그 답을 직접 들고 있었다.

> 의류(재킷, 티셔츠, 바지 등), 잡화(신발, 가방, 벨트 등)은 의류 수거함에 배출하거나
> 의류 수거함이 없는 문전수거 지역 등에서는 물기에 젖지 않도록 마대 등에 담거나 묶어서 배출합니다.

잡화 예시에 벨트가 이름 그대로 들어 있다. [가방](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=150) 항목도 "상태가 좋은 가방은 의류 수거함으로,
해지거나 오염된 가방은 종량제봉투로"라며 같은 구조를 쓴다. 그래서 갈래를 `reuse_collection_or_general`로 바꾸고
단계를 상태 기준으로 다시 썼다.

갈래가 재질이 아니라 **상태**로 갈리니 가죽 벨트와 천 벨트가 같은 답을 받는다. 품목 이름도 `벨트`로 넓혔다.
의류 항목 유의사항이 "의류수거함 배출 품목은 지자체에 따라 상이할 수 있음"이라고 달아 둬서
`needsRegionCheck: true`, `review.status: region_review_needed`로 두었다.

### 2-3. 선크림 튜브 — 결론은 그대로, 근거를 바꿨다

PRD가 "치약 근거를 그대로 옮겨 붙이지 마라"고 못 박은 자리였다. 다행히 더 가까운 항목이 있다.
[핸드크림(금속∙플라스틱)](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=734)과
[핸드크림(도포·첩합)](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=800)이 같은 피부용 크림 튜브를 두 갈래로 나눠 설명한다.

- 깨끗한 용기는 재질에 맞게 고철·플라스틱 수거함으로, 금속(알루미늄)은 고철, 플라스틱 용기(LDPE)와 뚜껑(PP)은 플라스틱
- 분리배출 표시가 도포·첩합인 제품은 종량제봉투

덕분에 치약 근거를 빌리지 않고도 `recycle_or_general_after_empty`를 그대로 쓸 수 있었다.
초안에 있던 "튜브를 갈라 열고" 단계는 원문에 없어서 뺐고, 알루미늄 관련 주의도
"도포·첩합 대상"이 아니라 원문대로 "고철"로 고쳤다.

## 3. 나머지 셋의 근거

| 품목 | 대표 근거 | 원문 요지 |
| --- | --- | --- |
| 변기솔 | [청소솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=83), [칫솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=334) | 금속·플라스틱 혼합 복합재질이라 재질별 분리가 어려우면 종량제봉투 |
| 젖병 | [공갈젖꼭지](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EA%B3%B5%EA%B0%88%EC%A0%96%EA%BC%AD%EC%A7%80), [내열식기](https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=%EB%82%B4%EC%97%B4%EC%9C%A0%EB%A6%AC) | 실리콘은 열경화성 수지라 종량제봉투, 내열유리는 불연성 종량제 특수마대 |
| 사료 포대 | [쌀 마대자루](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=465) | 가정에서 나오는 마대자루는 종량제봉투 |

젖병을 찾다가 **분유통이 금속캔(기타캔류)으로 따로 등재돼 있는 것**을 확인했다. 젖병과 갈래가 다르니
별칭으로 넣지 않았고, 대신 주의사항 한 줄로 갈라뒀다.

`rice_sack`은 1단계를 "남은 쌀이나 사료 등 내용물과 이물질을 비웁니다"로 넓히고 별칭에 `사료 포대`를 더했다.
결론이 안 바뀌어서 근거는 그대로 둔다.

## 4. 코드 리뷰 지적 반영

초안 커밋에 붙은 리뷰 여덟 건을 이렇게 처리했다.

| 지적 | 처리 |
| --- | --- |
| `p8_delivery_container_not_stolen`이 기존 케이스와 tool·arguments가 같아 validate가 막는다 | 질의를 `양념 묻은 배달용기`로 바꿔 중복을 풀었다. 뺏김 반례라는 성격은 오히려 더 날카로워졌다 |
| 초안 §8-2의 validate 출력이 실제 실행 결과와 다르다 | 초안이 사라졌다. 아래 6절은 실제로 돌린 출력이다 |
| `session-coordination.md` 53행 카운트가 갱신 목록에서 빠졌다 | 49행과 53행을 함께 501로 맞췄다 |
| `유리 양념통`이 플라스틱 카드로 확정된다 | 2-1대로 재질 분기 품목으로 바꿨다. 회귀 케이스 `p8_seasoning_container_glass_branch`로 고정했다 |
| `우유병` 별칭이 유리 우유병 질의까지 젖병으로 끌어간다 | 별칭에서 뺐다. `우유병`·`유리 우유병`은 다시 not_found다 |
| `천 벨트`가 가죽 전용 품목에 붙어 있다 | 2-2대로 갈래가 상태 기준이 되면서 두 벨트가 같은 답을 받는다. 케이스 `p8_fabric_belt_same_answer`로 고정했다 |
| 5단계 품목은 `standard_import`로 못 올린다 | 양념통은 `verified`, 나머지는 근거 깊이에 맞춰 정했다. `standard_import`는 쓰지 않았다 |
| `사료포대` 별칭이 죽은 항목이다 | 넣지 않았다. 매칭기가 공백을 지우므로 `사료 포대` 하나면 붙여 쓴 질의도 100점으로 걸린다 |

## 4-2. PR #61 리뷰 1라운드 반영

blocking 넷 중 셋을 데이터로 고치고, 하나는 케이스로 채웠다. 문서만 고친 둘은 5-4에 적었다.

| 지적 | 처리 |
| --- | --- |
| `젖병 소독기`가 소형가전인데 젖병 카드를 받는다 | 품목사전 단독 항목(niIdx=268)을 근거로 `bottle_sterilizer`를 세웠다. `젖병 워머`·`젖병 중탕기`는 살균이 아니라 데우는 기계지만 같은 소형전기전자 갈래라 별칭으로 묶었다 |
| `젖꼭지`가 자기 근거와 어긋나는 답을 받는다 | `젖병 젖꼭지` 별칭을 뺐다. 맨 `젖꼭지`는 재질 폴백으로 내려가고, `젖병 젖꼭지`는 이름 `젖병`이 걸려 그대로 젖병 카드다 |
| `seasoning_container`의 주의사항 두 줄이 출처에 없다 | 내열유리 줄은 지웠다 — 세 출처 어디에도 없고 `baby_bottle`의 `needsRegionCheck: true`와도 어긋났다. 실리콘 패킹 줄은 공갈젖꼭지 항목을 근거로 붙여 남겼다 |
| 폴백 `askFor` 구조화 페이로드를 보는 케이스가 0건이 됐다 | 여전히 not_found인 `안전벨트`·`젖꼭지`로 두 건을 채웠다. `안전벨트`는 벨트 품목이 안전벨트를 안 먹는다는 반례를 겸한다 |
| `belt` 이름이 전동 제품까지 잡는다 | 저장소 주인이 게이트를 보류해 코드는 그대로 두고, 5-4와 `data-decision-backlog.md` Open Decisions에 실측과 함께 남겼다 |
| 포괄어 `병`의 되묻기 후보에서 `깨진 병`이 밀렸다 | 되묻기 자체는 유지된다. 후보 한 칸이 밀린 사실을 5-3·5-4에 적었다 |

새 품목의 `needsRegionCheck`는 `true`다. 무상방문수거를 안내하면서 이 값을 `false`로 두면
지역 신청 경로가 통째로 사라진다 — PR #16 후속에서 8품목이 그 사고를 냈고,
`session-coordination.md`에 기록이 남아 있다.

## 4-3. PR #61 리뷰 2라운드 반영

| 지적 | 처리 |
| --- | --- |
| `젖병 솔`·`젖병 브러시`가 젖병 카드를 받는다 | `dish_brush` 별칭으로 되돌렸다. 두 글자 이름 `젖병`에 79점으로 걸리던 것이 100점 정확 일치로 바뀐다. 새 출처는 만들지 않았다 — `dish_brush`가 이미 든 청소솔·칫솔 근거가 손잡이와 솔이 붙은 복합재질 청소도구를 그대로 덮는다. 웃기게도 `젖병 세척솔`은 원래부터 91점으로 제대로 갔다. 띄어쓰기와 낱말 선택으로 답이 갈리던 자리를 `p8_bottle_brush_not_baby_bottle`·`p8_bottle_brush_alias_variant`가 못 박는다 |
| `사료 포대` 흡수 판단이 데이터에 안 남아 있다 | `rice_sack`이 별칭만 받고 `sources`·`review`는 Phase 2 임포트 그대로였다. 사료 포대·마대 검색이 비었다는 사실과 쌀 마대자루 원문을 그대로 쓰는 이유를 `manual_review` source로 넣고(`standard_import`라 url 필수), `sourceRefs`·`review.notes`·`lastReviewedAt`을 함께 올렸다. `summary`도 "쌀 마대자루(쌀포대)는 …"이라 사료 포대를 물은 사람에게 남의 물건처럼 읽히던 것을 쌀·사료·곡물 포대를 함께 덮는 문장으로 고쳤다 |
| 출처에 없는 주의사항이 두 줄 더 남아 있다 | 1라운드에서 `seasoning_container`를 지운 것과 같은 이유다. `belt`의 "금속 버클이 쉽게 떨어지면 떼어내 고철로" 줄은 세 출처 어디에도 근거가 없어 지웠다(단계가 이 문장에 기대지 않는다). `baby_bottle`의 "젖병 유리는 대부분 내열유리라"는 사실 단정을 "내열유리인지 먼저 확인하고, 내열유리면 유리병 수거함에 넣지 않는다"는 조건형으로 바꿔 내열식기 출처가 덮는 범위 안으로 넣었다 — `유리 젖병`·`젖병 유리`·`강화유리` 모두 품목사전 검색 결과가 없어 "대부분"을 뒷받침할 근거가 없다 |
| Phase 8 상태 문서가 미착수 그대로다 | `docs/prd/README.md`의 Phase 8 행과 `phase-8-item-coverage.md` 하단 체크리스트를 실제 상태로 맞췄다. PR이 아직 안 머지됐으니 "완료"가 아니라 "작업 완료, PR #61 리뷰 중 (머지 전)"으로 적었다 |
| `선크림`·`썬크림`을 별칭으로 추가해도 안전하다 | 반박했다. 별칭을 임시로 넣고 재보니 `선크림 묻은 옷`이 `sunscreen_tube` 96점으로 `clothing` 83을 밀어낸다. 다만 지적이 짚은 비대칭(`선크림`만 82점으로 나가고 `썬크림`·`자외선차단제`·`선블록`은 not_found)은 사실이라 5-4에 실측 그대로 남겼다. 데이터는 건드리지 않았다 |

`젖병 집게`·`젖병 보관함`은 대응 품목이 없어 별칭으로 되돌릴 수가 없다. 벨트와 원인이 같아
`data-decision-backlog.md`의 벨트 Open Decision을 넓혀 함께 다루기로 했고, 코드 게이트는 넣지 않았다.

## 5. 실측 — 반영 전과 후

### 5-1. 대상 여섯 건

| 질의 | 반영 전 | 반영 후 |
| --- | --- | --- |
| 플라스틱 양념통 분리수거 되나? | `not_found` | `seasoning_container` s=98 |
| 변기솔은 어떻게 버려? | `not_found` | `toilet_brush` s=96 |
| 선크림 튜브 분리수거 돼? | `not_found` | `sunscreen_tube` s=98 |
| 가죽 벨트는 어떻게 버려? | `not_found` | `belt` s=97 |
| 젖병은 분리수거 돼? | `not_found` | `baby_bottle` s=83 |
| 사료 포대는 어떻게 버려? | `not_found` | `rice_sack` s=97 |

### 5-2. 이미 새고 있던 오답 둘

```
반영 전
[변기 솔]        => toilet_bowl (변기) [bulky_waste_or_construction_waste] s=79
[화장실 청소솔]  => dish_brush (설거지 솔) [general] s=91
반영 후
[변기 솔]        => toilet_brush (변기솔) s=100
[화장실 청소솔]  => toilet_brush (변기솔) s=100
```

띄어 쓴 "변기 솔"에 대형폐기물 신고 안내가 나가던 자리를 `p8_toilet_brush_spaced_not_toilet_bowl`이 못 박는다.

### 5-3. 뺏기지 않는지 확인한 조합

평가·MCP·백로그 케이스에 들어 있는 질의 651개를 반영 전후로 전부 돌려 비교했다.
바뀐 건 아래 세 개뿐이고, 셋 다 의도한 변화다.

```
변기솔 버리는 법      not_found -> toilet_brush 96
가죽 벨트 어떻게 버려?  not_found -> belt 97
사료 포대 버리기       not_found -> rice_sack 97
```

따로 재본 반례도 그대로다.

| 질의 | 결과 |
| --- | --- |
| 러닝머신 벨트 | `exercise_machine` s=97 (벨트는 79로 밀림) |
| 자전거 벨트 | `bicycle` s=96 |
| 안전벨트 / 자동차 안전벨트 | `not_found` |
| 젖병 건조대 / 젖병 세척솔 | `drying_rack` 91 / `dish_brush` 91 |
| 젖병 솔 / 젖병 브러시 | `dish_brush` s=100 (2라운드에서 별칭으로 되돌렸다. 그 전에는 `baby_bottle` 79) |
| 젖병 / 아기 젖병 / 분유병 / 젖병 젖꼭지 | `baby_bottle` 그대로 (앞의 셋은 100, `젖병 젖꼭지`는 79) |
| 젖병 소독기 / 설거지 솔 / 청소솔 | `bottle_sterilizer` 100 / `dish_brush` 100 / `dish_brush` 100 |
| 양념 묻은 배달용기 / 고추장 묻은 플라스틱 용기 | `plastic_food_container` s=100 |
| 케첩통 / 참기름병 / 간장 유리병 | 각자 s=100 그대로 |
| 청소솔 / 치약 튜브 / 변기 / 변기 뚜껑 | 각자 s=100 그대로 |
| 선크림 묻은 옷 | `clothing` s=83 (튜브는 안 걸린다) |
| 포괄어 `튜브` `솔` `통` `유리` `병` | 되묻기 유지. 다만 `병`은 후보 구성이 바뀌었다 — 아래 5-4 참고 |

### 5-4. 알고 남기는 위험

`컨베이어 벨트`·`타이밍 벨트`·`시계 벨트`가 `belt`로 79점 확정된다. 공업용·부품 벨트라 가정 배출 안내와는 안 맞는다.
그래도 `벨트`라는 이름을 포기하면 "벨트 어떻게 버려?"가 통째로 not_found가 되어 손해가 더 크다.
정말 지켜야 할 `러닝머신 벨트`는 97점으로 `exercise_machine`을 지키고 있고, 그 우열은 회귀 케이스로 고정했다.

`선크림`·`썬크림` 단독은 별칭으로 넣지 않았다. 넣으면 "선크림 묻은 옷"이 옷을 제치고 튜브로 확정된다.
리뷰 2라운드에서 "별칭을 넣어도 `선크림 묻은 옷`은 `clothing` 83으로 안전하다"는 제안이 다시 올라와,
별칭을 임시로 넣고 직접 재봤다. 안전하지 않다.

```
(선크림·썬크림 별칭을 넣었을 때)
[선크림 묻은 옷]    => sunscreen_tube s=96 query_contains_name   (clothing 83이 밀린다)
[썬크림 묻은 수건]  => sunscreen_tube s=96 query_contains_name
[선크림 묻은 이불]  => sunscreen_tube s=96
```

별칭이 세 글자라 `short_alias_standalone`(79)이 아니라 `query_contains_name` 갈래를 타서 88+3+5=96이 되고,
`clothing`의 83을 넘어선다. 오염된 옷·수건·이불을 물은 사람에게 튜브 배출 안내가 나간다.
`선크림 묻은 옷`이 83으로 버틴다는 관찰은 **별칭이 없는 지금 상태**의 값이라, 별칭 추가 후의 근거가 되지 못한다.

다만 제안의 나머지 절반은 사실이다. 지금 상태에는 비대칭이 있다.

```
(현재 상태)
[선크림]             => sunscreen_tube s=82 generic_fragment
[썬크림]             => not_found
[선크림 어떻게 버려?] => not_found
[자외선차단제]        => not_found
[선블록]             => not_found
```

`선크림`만 품목 이름 `선크림 튜브`의 뒷자리 규칙(`generic_fragment`)에 걸려 82점으로 답이 나가고,
표기만 다른 `썬크림`과 조사·어미가 붙은 `선크림 어떻게 버려?`, 동의어 `자외선차단제`·`선블록`은 전부 되묻기다.
비대칭인 건 맞지만 별칭으로 메우면 위의 96점 사고를 부르므로 이번에는 데이터를 건드리지 않았다.
게다가 별칭을 넣어도 `자외선차단제`·`선블록`은 그대로 not_found라, 비대칭이 다 메워지지도 않는다.
같은 제안이 다시 올라올 때를 대비해 두 실측을 함께 남긴다.
메우려면 별칭이 아니라, 오염 표현(`묻은`·`묻힌`)이 붙은 질의에서 세정용품 품목을 확정 후보에서 빼는 쪽이 맞다.

포괄어 `유리`의 되묻기 후보 목록에서 유리병이 밀려나는 바람에 `유리 양념통` 별칭도 뺐다.
품목 이름을 품고 있어 별칭 없이도 91점으로 걸린다.

포괄어 `병`은 되묻기가 그대로지만 **후보 한 칸이 밀렸다.** `baby_bottle`(젖병)이 같은 82점 동점 후보로
들어오면서 7칸 상한에 걸려 `broken_glass`의 별칭 `깨진 병`이 목록 밖으로 나갔다.
유리병·페트병·향수병은 그대로라 `classify_ambiguous_short_bottle_candidates`는 통과하지만,
"병"을 물었을 때 깨진 병 갈래가 후보로 안 보이는 건 사실이다.
깨진 병은 `깨진 병`·`깨진 유리병`처럼 재질을 밝혀 물으면 그대로 확정되므로 이대로 둔다.

리뷰 1라운드에서 벨트 위험이 공업용·부품 말고 하나 더 있다는 것이 드러났다.
`안마 벨트`·`벨트 마사지기`·`복대 벨트`·`등산 벨트`가 전부 `belt` 79점으로 확정돼 의류수거함 안내를 받는다.
앞의 둘은 전동 제품이라 소형가전 갈래여야 맞고, 뒤의 둘은 의류수거함이 받을지 자체가 불확실한 보조기구다.
두 글자 품목 이름 `벨트`가 수식어를 못 가리는 같은 원인인데, `가스레인지` 때와 달리 게이트를 넣으면
`벨트 어떻게 버려?` 같은 정상 질의까지 함께 죽는다. 저장소 주인이 게이트 도입을 보류해
이번에는 코드를 건드리지 않고 [data-decision-backlog.md](../data-decision-backlog.md)의 Open Decisions에 올렸다.

## 6. 검증

```
Data validation passed: 330 waste items, 49 regional policies
Data evaluation passed: 330 item cases (resolver: src/data.ts)
Region matching test passed: 9 fixture cases, 94 region cases, 49 policies' aliases, 168 sub-region names, 854 metro-prefixed combinations
Item classification test passed: 17 whole-cell names, 3 spec fragments, 4 runtime queries
MCP smoke test passed at http://127.0.0.1:58945 (509 answer cases)
Widget catalogue sweep: 330/330 cards validated
Widget smoke passed at http://127.0.0.1:58692 (WIDGET_ENABLED=true)
```

```
## coverage-expansion-utterances (50 queries)
- match: 50
- not_found rate: 0.0%        (반영 전 44/50, not_found 6)

# 보류 발화 내성 (330 품목 x 10 발화 = 3300)
- match: 3300 (100.0%)
- wrong: 0
- ambiguous: 0
- not_found: 0
```

`question-backlog`는 110/111로 그대로다. 남은 하나(`약과 포장지…`)는 이 Phase 범위 밖이다.
PRD의 DoD 두 줄을 채웠다.

## 7. 카운트

| 항목 | 반영 전 | 반영 후 | 리뷰 1라운드 반영 후 | 리뷰 2라운드 반영 후 |
| --- | --- | --- | --- | --- |
| 총 품목 | 324 | 329 | 330 | 330 |
| 평가 케이스 | 324 | 329 | 330 | 330 |
| MCP 답변 회귀 케이스 | 487 | 501 (신규 14, 기존 3건은 기대값 수정) | 507 (신규 6) | 509 (신규 2) |
| `verified` | 39 | 41 | 41 | 41 |
| `region_review_needed` | 84 | 87 | 88 | 88 |
| `needs_source` | 7 | 7 | 7 | 7 |
| `standard_import` | 194 | 194 | 194 | 194 |

`docs/source-coverage.md` 14~20행, `docs/session-coordination.md` 49행과 53행을 함께 맞췄다.
53행은 검증기가 `MCP answer cases (\d+)개`를 전역으로 훑기 때문에 빠뜨리면 그대로 실패한다.

기대값을 바꾼 기존 케이스 셋은 `steps_fallback_toilet_brush`, `steps_fallback_leather_belt`,
`classify_fallback_pet_food_bag`이다. id에 `fallback`이 남아 실제 동작과 어긋나 보이지만,
`mcp-answer-cases.json`은 append-only로 굴러가는 파일이라 그대로 뒀다.

`docs/session-coordination.md`는 Phase 9와 겹치니 PRD의 머지 순서를 지킨다. 이 브랜치가 먼저다.

## 8. 남은 자리

- `belt`와 `baby_bottle`, `sunscreen_tube`는 `region_review_needed`다. 지자체 의류수거함 품목 목록,
  내열유리 불연성 마대 기준, 도포·첩합 표시 제품의 지역 기준을 지역 데이터에 붙이면 등급을 올릴 수 있다.
- 품목사전 유사검색어에 `볶음고추장 용기(도포·첩합)`가 있다. 도포·첩합 표시가 붙은 장류 용기가 따로 있다는 뜻이라,
  양념통에 세 번째 갈래를 더할지는 실제 질의가 들어오면 다시 본다.
- `컨베이어 벨트` 계열은 대응 품목이 없어 별칭으로 못 막는다. `data-decision-backlog.md`의 기존 처리와 같은 자리다.
