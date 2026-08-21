# Phase 8 초안 — 품목 커버리지 마감

[phase-8-item-coverage.md](phase-8-item-coverage.md)의 R1(성격 판정)과 R3·R4의 초안을 담는다.
로컬 세션이 R2(출처 조사)만 채우면 그대로 `src/data/`에 옮길 수 있는 상태로 썼다.

## 이 문서가 담지 않는 것 — 먼저 읽어라

이 초안을 쓴 세션은 **외부 사이트에 나갈 수 없었다.** 분리배출 누리집(`xn--oy2b29bd3a601b.kr`), law.go.kr,
data.go.kr, 지자체 사이트가 전부 이그레스 프록시에서 막혔다. curl과 WebFetch 둘 다 안 됐다.

그래서 아래 원칙을 지켰다.

- **`sources`는 전부 빈 배열이고 `review.status`는 `draft`다.** 열어본 적 없는 페이지를 근거로 적지 않았다.
- **URL과 `checkedAt`을 하나도 짓지 않았다.** 본문에 나오는 URL은 기존 데이터에서 옮겨온 것이거나
  누리집 검색 주소의 형태를 보여주는 예시뿐이다.
- **`src/data/` 아래 파일은 고치지 않았다.** 이 브랜치가 커밋하는 파일은 이 문서 하나뿐이다.
  회귀를 돌리려고 데이터 파일을 잠깐 바꾼 적은 있지만, 그때마다 백업본으로 되돌리고 `git status`로 확인했다.
  방법은 부록에 적었다.
- `summary`·`steps`·`cautions` 문안은 초안이다. **원문을 못 봤으므로 확정이 아니다.**
  각 품목 아래 "R2에서 확인할 것"에 어느 문장이 근거에 걸려 있는지 적어뒀다.

반대로, 코드를 돌려서 **실제로 잰 것**은 전부 실측이다. 기준값 측정, 현재 데이터의 라우팅,
초안을 넣었을 때의 라우팅과 회귀 결과가 여기 해당한다. 초안 검증은 `src/`를 통째로 복사한
샌드박스에서 돌렸고, 검증이 끝난 뒤 샌드박스를 지웠다.

---

## 1. 기준값 (2026-08-21, 초안 반영 전)

회귀를 재려면 이 숫자가 기준이다. 명령 출력을 그대로 옮긴다.

### `pnpm measure:coverage`

```
## question-backlog (111 queries)
- match: 110
- not_found: 1
- not_found rate: 0.9%
- not_found queries: 약과 포장지는 폐의약품 수거함에 넣어?

## coverage-expansion-utterances (50 queries)
- match: 44
- not_found: 6
- not_found rate: 12.0%
- not_found queries: 플라스틱 양념통 분리수거 되나? | 변기솔은 어떻게 버려? | 선크림 튜브 분리수거 돼? | 가죽 벨트는 어떻게 버려? | 젖병은 분리수거 돼? | 사료 포대는 어떻게 버려?
```

### `pnpm measure:utterances`

```
# 보류 발화 내성 (324 품목 x 10 발화 = 3240)
- match: 3240 (100.0%)
- wrong: 0
- ambiguous: 0
- not_found: 0

## 발화 틀별 정확도
- how            100.0%  (wrong 0, ambiguous 0, not_found 0)
- where          100.0%  (wrong 0, ambiguous 0, not_found 0)
- recyclable     100.0%  (wrong 0, ambiguous 0, not_found 0)
- subject        100.0%  (wrong 0, ambiguous 0, not_found 0)
- object         100.0%  (wrong 0, ambiguous 0, not_found 0)
- also           100.0%  (wrong 0, ambiguous 0, not_found 0)
- demonstrative  100.0%  (wrong 0, ambiguous 0, not_found 0)
- topic_only     100.0%  (wrong 0, ambiguous 0, not_found 0)
- method         100.0%  (wrong 0, ambiguous 0, not_found 0)
- until          100.0%  (wrong 0, ambiguous 0, not_found 0)
```

`pnpm local:test`도 초안 반영 전 상태에서 통과한다(아래 §8).

---

## 2. R1 판정 — 여섯 건

판정 기준은 PRD 그대로다. **배출 갈래와 단계가 기존 품목과 완전히 같을 때만 별칭이고, 하나라도 갈리면 신규다.**

| 질의 | PRD 1차 판정 | 최종 판정 | 갈린 지점 |
| --- | --- | --- | --- |
| 플라스틱 양념통 | 별칭 후보 | **신규** `plastic_seasoning_container` | 근접 품목 둘이 서로 갈래가 다르다 |
| 변기솔 | 신규 | **신규** `toilet_brush` | (유지) 지금 `변기 솔`이 변기로 오라우팅된다 |
| 선크림 튜브 | 신규 유력 | **신규** `sunscreen_tube` | (유지) 잔여물 처리가 치약과 다르다 |
| 가죽 벨트 | 신규 | **신규** `leather_belt` | (유지) 지갑과 가방이 갈래가 다르다 |
| 젖병 | 신규 | **신규** `baby_bottle` | (유지) 근접 품목 자체가 없다 |
| 사료 포대 | 재질이 같으면 별칭 | **별칭** → `rice_sack` | 갈래도 단계도 같다 |

1차 판정을 뒤집은 건 **플라스틱 양념통 하나**다. 이유는 아래에 적었다.

### 2-1. 플라스틱 양념통 → 신규 (1차 판정 뒤집음)

근접 후보를 둘 다 읽고 비교했다.

| | `plastic_food_container` (배달 플라스틱 용기) | `airtight_container` (플라스틱 밀폐용기) |
| --- | --- | --- |
| `disposalType` | `recycle_or_general` | `recycle` |
| 단계 수 | 5 | 3 |
| 뚜껑·패킹 분리 | 없음 (라벨·비닐·종이 분리만) | 있음 ("뚜껑과 본체를 분리하고 실리콘 패킹은 떼어냅니다") |
| 장류 잔여물 | 있음 (고추장·된장을 음식물류로) | 없음 (오염은 주의사항에만) |

양념통은 이 둘의 성격을 반씩 갖는다. **장류가 눌어붙는다는 점은 배달 용기 쪽이고, 뚜껑과 실리콘 패킹을
떼야 한다는 점은 밀폐용기 쪽이다.** 어느 한쪽을 그대로 쓰면 나머지 절반이 답에서 빠진다.

결정적인 건 근접 품목 둘의 `disposalType`이 애초에 갈린다는 사실이다(`recycle_or_general` vs `recycle`).
어느 쪽으로도 "완전히 같다"가 성립하지 않으므로 PRD 기준에서 별칭 조건을 만족하지 못한다.

별칭으로 흡수하면 어떻게 되는지도 짚어둔다. `plastic_food_container`에 `양념통`을 붙이면
"양념통 어떻게 버려?"에 **"배달 플라스틱 용기"라는 제목의 카드**가 나가고, 1단계 문장이
"남은 음식물을 비웁니다"가 된다. 주방 양념통을 물은 사람에게는 남의 물건 설명이다.

### 2-2. 변기솔 → 신규 (유지). **지금 오라우팅이 나고 있다**

이건 커버리지 구멍이 아니라 **오답**이다. 현재 데이터에서 잰 결과다.

```
[변기 솔]  (띄어쓰기 있음)
  => match -> toilet_bowl (변기) [bulky_waste_or_construction_waste] s=79 k=short_alias_standalone by="변기"
[변기솔]   (붙여쓰기)
  => not_found
```

즉 **"변기 솔은 어떻게 버려?"라고 띄어 쓰면 지금도 답이 나가는데, 그 답이 "대형폐기물로 신고하라"다.**
솔 하나 버리려는 사람에게 신고 절차를 안내하는 셈이라, not_found보다 나쁘다. 신규 품목이 이걸 같이 막는다.

근접 품목 `dish_brush`(설거지 솔)는 갈래가 `general`로 같지만 단계가 다르다.
1단계가 "물기와 음식물 찌꺼기를 털어냅니다"인데 변기솔에는 음식물이 없고, 대신 오물 제거와
받침대(홀더) 분리가 필요하다. 카드 제목이 "설거지 솔"로 나가는 것도 위생 계열이 뒤바뀐 인상을 준다.

### 2-3. 선크림 튜브 → 신규 (유지)

PRD가 특히 조심하라고 한 자리다. `toothpaste_tube`와 갈래 문자열은 같게 잡았지만
(`recycle_or_general_after_empty`), **단계가 갈린다.**

치약은 물에 녹아서 헹구면 빠진다. 치약 튜브 3단계가 "입구를 열고 물로 최대한 헹궈 깨끗한 상태로 만듭니다"인 게 그 전제다.
선크림은 유분이라 헹궈도 남는다. 닦아내는 단계가 따로 필요하고, "헹궜으니 됐다"고 판단하면 오염된 채로 재활용에 들어간다.

`cosmetic_container`(화장품 용기) 쪽도 아니다. 그쪽은 `recycle_or_general_by_material`로
플라스틱이냐 유리냐를 먼저 가르는데, 선크림 튜브는 유리일 수가 없다. 재질 분기가 통째로 헛돈다.

**갈래 값을 `recycle_or_general_after_empty`로 고른 이유:** 분기 모양이 치약 튜브와 같기 때문이다.
"다 비우고 → 분리배출 표시를 보고 → 플라스틱이거나 종량제". `disposal-groups.json`에 이미 있는 값이고
라벨은 `재활용/일반쓰레기`다. 새 갈래를 만들지 않았다.

### 2-4. 가죽 벨트 → 신규 (유지)

가죽 계열 기존 품목 둘이 서로 갈린다.

- `wallet` (지갑) — `general`. 주의사항이 "가죽 제품은 의류수거함이 아니라 종량제봉투로 배출합니다".
- `handbag` (가방) — `reuse_collection_or_general`. 상태가 좋으면 의류수거함.

같은 가죽인데 지갑은 의류수거함에서 빼고 가방은 넣는다. 벨트가 어느 쪽인지는 **원문을 봐야 정해진다.**
어느 쪽이든 두 품목 중 하나와는 갈래가 다르므로 신규인 건 확정이다.

초안은 `wallet`을 따라 `general`로 잡았다. 종량제봉투로 안내하면 재활용 흐름을 오염시키지는 않으니
근거가 없는 동안 덜 위험한 쪽이다. **다만 이건 R2가 뒤집을 수 있는 자리다.** §4에 확인 항목을 적었다.

### 2-5. 젖병 → 신규 (유지)

근접 품목이 없다. `우유팩`은 종이팩이고, `유리병`은 일반 소다석회유리 기준이라 젖병에 그대로 쓰면 안 된다.

젖병은 부품마다 갈래가 갈린다. 실리콘 젖꼭지는 열경화성 수지라 종량제봉투이고(저장소 선례가 있다 —
`silicone_kitchenware` 실리콘 주걱이 같은 이유로 `general`이다), PP·PPSU 몸체는 플라스틱류,
유리 몸체는 대부분 내열유리라 유리병 수거함에 넣으면 안 된다(`glass_food_container` 유리 밀폐용기가
`nonburnable_special_bag`인 것과 같은 이유다).

**갈래 값은 `recycle_or_general_by_material`로 골랐다.** 재질을 먼저 가른 뒤 갈래가 정해지는 구조가
`cosmetic_container`와 같고, 라벨은 `재활용/일반쓰레기`다.

### 2-6. 사료 포대 → 별칭 (`rice_sack`)

여섯 건 중 유일하게 별칭 조건을 만족한다.

| | `rice_sack` (쌀포대) | 사료 포대 |
| --- | --- | --- |
| `disposalType` | `general` | 같음 |
| 1단계 | 남은 쌀과 이물질을 비웁니다 | 내용물만 다름 |
| 2단계 | 부피를 줄여 접은 뒤 종량제봉투로 배출합니다 | 같음 |
| 주의사항 | 직조된 마대류는 비닐 수거함에 넣지 않습니다 | 그대로 적용 |

PP 직조 마대든 알루미늄 첩합 필름 봉투든 결론이 종량제봉투로 같다. 갈래도 단계도 같으니 별칭이다.

**한 가지 걸리는 점:** 1단계 문장에 "쌀"이 박혀 있어서 사료를 물었는데 쌀 이야기가 나온다.
`rice_sack`의 1단계를 "남은 쌀이나 사료 등 내용물과 이물질을 비웁니다"로 한 줄만 넓히기를 권한다.
결론은 그대로라 근거를 다시 볼 필요는 없다. 로컬 세션이 판단할 자리로 남겨둔다.

---

## 3. 신규 품목 초안 (`src/data/waste-items.json`)

**공통 — `sources`와 `review`는 아래처럼 비워뒀다.** R2가 채울 자리다.

```jsonc
"sourceRefs": [],   // TODO: R2에서 채운다. 빈 배열이면 validate가 막는다
"sources": [],      // TODO: R2에서 채운다. checkedAt은 실제로 원문을 연 날짜를 쓴다
"review": { "status": "draft" }   // TODO: R2 결과에 따라 verified / region_review_needed / standard_import / needs_source
```

> `validate-data.mjs`를 초안 그대로 돌려보고 확인한 사항이다. `sources`가 비면 물론 막히지만,
> **`sourceRefs`가 비어도 막힌다.** 실제 오류 문구가 `item[324](plastic_seasoning_container).sourceRefs must not be empty`였다.
> 두 필드를 같이 채워야 한다.

### 3-1. `plastic_seasoning_container` — 플라스틱 양념통

```json
{
  "id": "plastic_seasoning_container",
  "name": "플라스틱 양념통",
  "aliases": ["양념통", "플라스틱 양념 용기", "조미료통", "소금통", "후추통"],
  "category": "plastic_container",
  "disposalType": "recycle_or_general",
  "summary": "플라스틱 양념통은 남은 양념을 비우고 뚜껑과 실리콘 패킹을 분리한 뒤 헹궈서 깨끗해지면 플라스틱류로, 고추장·된장 얼룩이 남으면 종량제봉투로 배출합니다.",
  "steps": [
    "남은 양념을 비웁니다.",
    "고추장, 된장처럼 긁어낼 수 있는 장류는 음식물류폐기물 기준으로 따로 배출합니다.",
    "뚜껑과 실리콘 패킹, 금속 스프링 같은 다른 재질 부품을 분리합니다.",
    "물로 헹궈 기름과 색소 얼룩을 제거합니다.",
    "깨끗하면 플라스틱류로 배출하고, 얼룩·냄새·기름막이 남으면 종량제봉투로 배출합니다."
  ],
  "cautions": [
    "고춧가루 기름과 색소는 헹궈도 잘 빠지지 않아 재활용 품질을 떨어뜨립니다.",
    "실리콘 패킹은 플라스틱류가 아니므로 떼어내 종량제봉투로 배출합니다.",
    "유리 양념통은 플라스틱류가 아니라 유리병류 기준을 따릅니다."
  ],
  "confidence": "medium",
  "needsRegionCheck": false,
  "sourceRefs": [],
  "conditions": ["empty_required", "contaminated", "food_contaminated", "separate_parts", "mixed_material"],
  "regionPolicy": { "scope": "national_default", "needsRegionCheck": false },
  "sources": [],
  "review": { "status": "draft" }
}
```

- `disposalType` `recycle_or_general` — `disposal-groups.json`에 있는 값이고 라벨은 `재활용/일반쓰레기`다.
  세척 여부로 갈래가 갈리는 `plastic_food_container`와 같은 분기 모양을 골랐다.
- **R2에서 확인할 것:** 2단계의 "장류는 음식물류폐기물로"는 `plastic_food_container`가 이미 쓰고 있는
  품목사전 `고추장` 항목(`niIdx=170`)이 근거다. 그 항목을 다시 열어 이 문장에 그대로 걸어라.
  실리콘 패킹 분리는 `airtight_container`의 기존 안내를 옮긴 것이라 별도 근거가 필요하다.

### 3-2. `toilet_brush` — 변기솔

```json
{
  "id": "toilet_brush",
  "name": "변기솔",
  "aliases": ["변기 청소솔", "화장실 청소솔", "변기 브러시", "변기 청소용 솔", "양변기 솔"],
  "category": "cleaning_tool_mixed",
  "disposalType": "general",
  "summary": "변기솔은 플라스틱 손잡이에 나일론 솔과 고무가 붙은 복합재질이라 플라스틱류가 아니라 종량제봉투로 배출합니다.",
  "steps": [
    "오물과 물기를 털어내고 말립니다.",
    "받침대(홀더)가 단일 플라스틱이면 헹궈서 플라스틱류로 따로 배출합니다.",
    "솔 본체는 종량제봉투에 담아 배출합니다."
  ],
  "cautions": [
    "손잡이가 플라스틱처럼 보여도 솔모와 고무가 붙어 있어 재활용되지 않습니다.",
    "위생상 오물이 묻은 채로 재활용품 수거함에 넣지 않습니다.",
    "일체형 변기솔 세트는 분리가 어려우면 통째로 종량제봉투로 배출합니다."
  ],
  "confidence": "medium",
  "needsRegionCheck": false,
  "sourceRefs": [],
  "conditions": ["contaminated", "mixed_material", "small_item"],
  "regionPolicy": { "scope": "national_default", "needsRegionCheck": false },
  "sources": [],
  "review": { "status": "draft" }
}
```

- `disposalType` `general` — 기존 값이고 라벨은 `일반쓰레기`다. `dish_brush`·`toothbrush`와 같다.
- `category`는 `dish_brush`가 쓰는 `cleaning_tool_mixed`를 그대로 썼다. 새 카테고리를 만들지 않았다.
- **`aliases`에 `변기 솔`을 넣지 않은 건 실수가 아니다.** 매칭기가 공백을 지운 뒤 비교하므로
  `변기 솔` 질의는 이름 `변기솔`에 정확 일치(100점)로 걸린다. 실측으로 확인했다(§5).
- **R2에서 확인할 것:** `dish_brush`가 이미 쓰는 품목사전 `청소솔`(`niIdx=83`)이 1순위 근거다.
  "금속, 플라스틱 등이 혼합된 복합재질"이라는 문장이 변기솔에도 그대로 걸린다.
  `변기솔` 단독 항목이 있는지 먼저 검색해보고, 없으면 `청소솔`을 대표 근거로 삼되
  단독 명칭 검색이 비었다는 사실을 `manual_review` source로 남겨라 — `dish_brush`가 쓴 방식이다.

### 3-3. `sunscreen_tube` — 선크림 튜브

```json
{
  "id": "sunscreen_tube",
  "name": "선크림 튜브",
  "aliases": ["썬크림 튜브", "선크림 용기", "썬크림 용기", "자외선차단제 튜브", "선블록 튜브", "다 쓴 선크림"],
  "category": "plastic_tube",
  "disposalType": "recycle_or_general_after_empty",
  "summary": "선크림 튜브는 내용물을 끝까지 비우고 헹군 뒤 분리배출 표시가 플라스틱이면 플라스틱류로, 도포·첩합이거나 유분이 남으면 종량제봉투로 배출합니다.",
  "steps": [
    "남은 선크림을 최대한 짜서 비웁니다.",
    "뚜껑과 펌프를 분리합니다.",
    "튜브를 갈라 열고 안쪽 유분을 닦거나 헹굽니다.",
    "몸체의 분리배출 표시를 확인합니다.",
    "플라스틱 표시이고 깨끗하면 플라스틱류로 배출합니다.",
    "도포·첩합 표시이거나 유분이 남으면 종량제봉투로 배출합니다."
  ],
  "cautions": [
    "선크림은 유분이라 물로만 헹구면 잘 지워지지 않습니다. 닦아낸 뒤 판단하세요.",
    "알루미늄층을 덧댄 튜브는 도포·첩합 표시가 붙어 종량제봉투 대상입니다.",
    "내용물이 남은 튜브는 플라스틱류 수거함에 넣지 않습니다."
  ],
  "confidence": "medium",
  "needsRegionCheck": true,
  "sourceRefs": [],
  "conditions": ["empty_required", "mixed_material", "separate_parts", "oily"],
  "regionPolicy": {
    "scope": "region_specific",
    "needsRegionCheck": true,
    "reason": "플라스틱류 배출 요일과 도포·첩합 표시 제품의 종량제봉투 기준은 지역 안내를 함께 확인하는 편이 안전합니다.",
    "checkItems": ["플라스틱류 배출 요일", "분리배출 표시의 도포·첩합 여부", "유분 잔여물이 남은 용기의 종량제봉투 기준"]
  },
  "sources": [],
  "review": { "status": "draft" }
}
```

- `disposalType` `recycle_or_general_after_empty` — 기존 값이고 라벨은 `재활용/일반쓰레기`다.
  분기 모양이 `toothpaste_tube`와 같아서 골랐다(§2-3).
- `needsRegionCheck: true`로 잡았으므로 `review.status`를 `verified`로 올리면 validate가 경고를 낸다.
  `region_review_needed`가 맞는 자리로 보인다. R2가 확인해서 정해라.
- **R2에서 확인할 것 (여기가 제일 위험하다):**
  - 3단계 "튜브를 갈라 열고 안쪽 유분을 닦거나" — **근거를 못 본 상태로 쓴 문장이다.**
    누리집이 튜브를 가르라고 안내하는지 확인이 안 되면 문장을 빼거나 "닦아낼 수 있으면"으로 낮춰라.
  - "도포·첩합" 분기는 `toothpaste_tube`의 품목사전 `치약`(`niIdx=593`) 원문에서 온 표현이다.
    선크림 튜브에도 같은 결론이 확인되지 않으면 **치약 근거를 그대로 옮겨 붙이지 마라.** PRD가 못 박은 자리다.
  - 알루미늄층 튜브 주장도 마찬가지다. 근거가 안 나오면 주의사항에서 빼라.

### 3-4. `leather_belt` — 가죽 벨트

```json
{
  "id": "leather_belt",
  "name": "가죽 벨트",
  "aliases": ["벨트", "허리띠", "가죽 허리띠", "혁대", "천 벨트"],
  "category": "small_mixed_accessory",
  "disposalType": "general",
  "summary": "가죽 벨트는 가죽과 금속 버클이 붙은 복합재질이라 종량제봉투로 배출합니다.",
  "steps": [
    "금속 버클이 쉽게 분리되면 떼어내 고철로 배출합니다.",
    "가죽·인조가죽 몸체는 종량제봉투에 담아 배출합니다."
  ],
  "cautions": [
    "가죽 제품은 의류수거함 수거 대상이 아닌 경우가 많으므로 지역 안내를 확인합니다.",
    "버클이 분리되지 않으면 통째로 종량제봉투로 배출합니다."
  ],
  "confidence": "medium",
  "needsRegionCheck": false,
  "sourceRefs": [],
  "conditions": ["mixed_material", "separate_parts"],
  "regionPolicy": { "scope": "national_default", "needsRegionCheck": false },
  "sources": [],
  "review": { "status": "draft" }
}
```

- `disposalType` `general` — 기존 값, 라벨 `일반쓰레기`. `wallet`(지갑)을 따랐다.
- `category`도 `wallet`이 쓰는 `small_mixed_accessory`를 그대로 썼다.
- **R2에서 확인할 것 (갈래 자체가 바뀔 수 있다):**
  - 지자체 의류수거함 투입 가능 품목 목록에 **벨트가 들어 있는지**를 먼저 봐라.
    들어 있으면 `disposalType`을 `reuse_collection_or_general`로 바꾸고 단계를
    `handbag`(가방) 모양으로 다시 써야 한다 — 상태가 좋으면 수거함, 아니면 종량제봉투.
  - `wallet`이 쓰는 품목사전 `지갑` 검색 결과(명함지갑)의 "가죽 제품은 종량제봉투로 배출합니다"가
    벨트까지 덮는지도 같이 확인해라. 덮으면 지금 초안 그대로 가면 된다.
  - 갈래를 바꾸면 §6의 평가 케이스 `expectedDisposalType`과 §7의 MCP 케이스 기대 문구도 같이 바꿔야 한다.

### 3-5. `baby_bottle` — 젖병

```json
{
  "id": "baby_bottle",
  "name": "젖병",
  "aliases": ["아기 젖병", "유아 젖병", "분유병", "우유병", "젖병 젖꼭지"],
  "category": "container_by_material",
  "disposalType": "recycle_or_general_by_material",
  "summary": "젖병은 실리콘 젖꼭지와 몸체를 분리해, 플라스틱 몸체는 플라스틱류로, 내열유리 몸체와 실리콘 젖꼭지는 종량제봉투나 불연성 기준으로 배출합니다.",
  "steps": [
    "남은 분유와 우유를 비우고 헹굽니다.",
    "젖꼭지, 캡, 몸체를 분리합니다.",
    "실리콘 젖꼭지는 열경화성 수지라 종량제봉투로 배출합니다.",
    "PP·PPSU 등 플라스틱 몸체는 깨끗하게 헹궈 플라스틱류로 배출합니다.",
    "내열유리 몸체는 유리병 수거함에 넣지 말고 종량제봉투나 지역의 불연성 폐기물 기준으로 배출합니다."
  ],
  "cautions": [
    "젖병 유리는 대부분 내열유리라 일반 유리병과 녹는점이 달라 유리병 수거함에 넣으면 안 됩니다.",
    "실리콘은 플라스틱류로 재활용되지 않습니다.",
    "눈금 인쇄나 실리콘 커버가 몸체에서 떨어지지 않으면 종량제봉투로 배출합니다."
  ],
  "confidence": "medium",
  "needsRegionCheck": true,
  "sourceRefs": [],
  "conditions": ["empty_required", "mixed_material", "separate_parts"],
  "regionPolicy": {
    "scope": "region_specific",
    "needsRegionCheck": true,
    "reason": "내열유리를 불연성 전용마대로 받는지 종량제봉투로 받는지가 지역마다 다릅니다.",
    "checkItems": ["내열유리의 불연성 폐기물 배출 기준", "플라스틱류 배출 요일"]
  },
  "sources": [],
  "review": { "status": "draft" }
}
```

- `disposalType` `recycle_or_general_by_material` — 기존 값, 라벨 `재활용/일반쓰레기`.
  재질로 갈래가 갈리는 구조가 `cosmetic_container`와 같다(§2-5).
- `needsRegionCheck: true`라 `review.status`는 `region_review_needed`가 맞아 보인다. R2가 정해라.
- **`우유병` 별칭에 주의:** 지금은 not_found라 뺏어오는 게 없다(실측 확인). 다만 유리 우유병을 뜻하는
  질의가 섞일 수 있으니, R2에서 품목사전에 `우유병`이 다른 뜻으로 등재돼 있으면 이 별칭을 빼라.
- **R2에서 확인할 것:**
  - 내열유리 판단은 `glass_food_container`(유리 밀폐용기)가 쓰는 근거에 기대고 있다. 그 근거가
    젖병까지 덮는지 확인하고, 안 덮으면 젖병 전용 근거를 따로 찾아라.
  - 실리콘은 `silicone_kitchenware`(실리콘 주걱)의 열경화성 수지 근거를 그대로 옮겨 쓸 수 있는지 확인해라.
  - 젖병 단독 항목이 없으면 `source-gap-policy.md` 절차를 따라라. 부품마다 근거가 다른 품목이라
    `needs_source`로 떨어질 가능성이 여섯 건 중 제일 크다.

---

## 4. 별칭 초안 (`rice_sack`)

```jsonc
// rice_sack.aliases 끝에 두 개만 더한다
"aliases": ["쌀 마대자루", "쌀마대", "쌀자루", "곡물 포대", "사료 포대", "사료포대"]
```

**`사료`나 `포대`를 단독으로 넣지 마라.** 둘 다 위험하다.

- `사료` 단독 — 사료 자체(내용물)를 버리는 질문이 포대 안내로 확정된다.
  지금은 `사료`·`강아지 사료`·`고양이 사료`가 전부 not_found다. 그대로 두는 게 맞다.
- `포대` 단독 — 지금도 `쌀포대`에 `generic_fragment` 82점으로 걸린다. 별칭을 더할 이유가 없다.

권장 사항 하나 더: `rice_sack`의 1단계를 "남은 쌀이나 사료 등 내용물과 이물질을 비웁니다"로 넓혀라(§2-6).
결론이 안 바뀌므로 근거를 다시 볼 필요는 없다.

---

## 5. 실측 — 지금 데이터에서 이 질의들이 어디로 가는가

`resolveWasteItem`을 직접 불러 잰 결과다. 로컬 세션이 반영한 뒤 같은 질의를 다시 재면 바로 비교된다.

### 5-1. 대상 여섯 건 (반영 전 → 초안 반영 후)

| 질의 | 지금 | 초안 반영 후(샌드박스 실측) |
| --- | --- | --- |
| 플라스틱 양념통 분리수거 되나? | `not_found` | `plastic_seasoning_container` s=98 `query_contains_name` |
| 변기솔은 어떻게 버려? | `not_found` | `toilet_brush` s=96 `query_contains_name` |
| 선크림 튜브 분리수거 돼? | `not_found` | `sunscreen_tube` s=98 `query_contains_name` |
| 가죽 벨트는 어떻게 버려? | `not_found` | `leather_belt` s=97 `query_contains_name` |
| 젖병은 분리수거 돼? | `not_found` | `baby_bottle` s=83 `short_alias_standalone` |
| 사료 포대는 어떻게 버려? | `not_found` | `rice_sack` s=97 `query_contains_name` |

### 5-2. 지금 이미 새고 있는 질의 둘

```
[변기 솔]        => toilet_bowl (변기) [bulky_waste_or_construction_waste] s=79 short_alias_standalone
[화장실 청소솔]  => dish_brush (설거지 솔) [general] s=91 query_contains_name
```

첫 번째는 오답이다(§2-2). 두 번째는 결론(`general`)은 맞지만 카드 제목이 "설거지 솔"로 나간다.
초안을 넣으면 둘 다 `toilet_brush`로 옮겨간다 — `변기 솔`은 100점 정확 일치,
`화장실 청소솔`은 100점 정확 일치가 `청소솔`의 91점을 이긴다.

### 5-3. 초안 반영 후 전체 회귀 (샌드박스 실측)

```
## coverage-expansion-utterances (50 queries)
- match: 50
- not_found rate: 0.0%

# 보류 발화 내성 (329 품목 x 10 발화 = 3290)
- match: 3290 (100.0%)
- wrong: 0
- ambiguous: 0
- not_found: 0
```

`question-backlog`는 110/111로 그대로다(남은 1건은 `약과 포장지…`로, 이 Phase 범위 밖이다).
**PRD의 DoD 두 줄을 초안 상태로 이미 만족한다.**

---

## 6. 반례 — 무엇을 뺏기는지 실제로 재봤다

PRD가 못 박은 자리다. 한국어는 핵심어가 뒤에 오므로 **새 이름이 앞에 오는 복합어**에서 샌다.
`query_contains_name`이 96~98점을 주는데 짧은 별칭은 77~83점이라, 앞자리 이름이 뒷자리 핵심어를 이긴다.

### 6-1. 안 새는 게 확인된 조합

| 질의 | 초안 반영 후 | 판정 |
| --- | --- | --- |
| 러닝머신 벨트 | `exercise_machine` s=97 (벨트는 79로 밀림) | 안전 |
| 젖병 건조대 | `drying_rack` s=91 (젖병은 79로 밀림) | 안전 |
| 젖병 세척솔 | `dish_brush` s=91 (젖병은 79로 밀림) | 안전 |
| 안전벨트 / 자동차 안전벨트 | `not_found` (한 낱말이라 짧은 별칭 독립 조건에 안 걸림) | 안전 |
| 청소솔 | `dish_brush` s=100 그대로 | 안전 |
| 배달 플라스틱 용기 / 반찬통 | `plastic_food_container` s=100 그대로 | 안전 |
| 플라스틱 밀폐용기 / 김치통 | `airtight_container` s=100 그대로 | 안전 |
| 치약 튜브 / 물감 튜브 / 물놀이 튜브 | 각자 s=100 그대로 | 안전 |
| 가방 / 지갑 / 가죽 가방 / 가죽지갑 | 각자 s=100 그대로 | 안전 |
| 쌀포대 / 쌀 마대자루 | `rice_sack` s=100 그대로 | 안전 |
| 변기 / 변기 뚜껑 | `toilet_bowl` / `toilet_seat_cover` s=100 그대로 | 안전 |
| 포괄어 `튜브` `솔` `통` | 반영 전후 모두 되묻기 유지 | 안전 |

### 6-2. 새지만 받아들이는 조합 — 새 이름이 앞에 오는데 뒤가 그 물건의 부품이다

| 질의 | 초안 반영 후 | 왜 괜찮은가 |
| --- | --- | --- |
| 양념통 뚜껑 | `plastic_seasoning_container` s=96 | 뚜껑이 양념통의 부품이고, 3단계가 뚜껑 분리를 이미 다룬다 |
| 변기솔 걸이 / 변기솔 세트 | `toilet_brush` s=96 | 받침대·세트 처리가 2·3단계와 주의사항에 있다 |
| 선크림 튜브 뚜껑 | `sunscreen_tube` s=98 | 2단계가 뚜껑 분리다 |
| 사료 포대 끈 | `rice_sack` s=97 | 포대에 딸린 끈이라 같은 안내로 덮인다 |
| 유리 젖병 / 플라스틱 젖병 | `baby_bottle` s=83 | 재질 분기가 단계 안에 들어 있다 |

### 6-3. 새고, 막지 못한 조합 — **알고 남기는 위험**

**`컨베이어 벨트` → `leather_belt` s=79 (`short_alias_standalone`).**

`벨트` 별칭이 짧은 별칭 독립 조건에 걸려서 확정된다. 공업용 벨트라 가정 배출 안내가 맞지 않는다.

그래도 `벨트` 별칭을 넣기로 한 이유는 실측 때문이다. 별칭을 빼고 재봤더니 이렇게 나온다.

```
(벨트 별칭 없음)
[벨트]              => leather_belt s=82 generic_fragment    ← 낱말 하나면 걸린다
[벨트 어떻게 버려?] => not_found                              ← 실제 발화가 통째로 샌다
[벨트는 어떻게 버려?] => not_found
```

"벨트 어떻게 버려?"는 사람들이 실제로 치는 말이다. 이걸 살리는 값이 `컨베이어 벨트` 오답보다 훨씬 크다.
게다가 `컨베이어 벨트`는 가정 분리배출 봇에 들어올 질의가 아니다.

**대신 진짜 지켜야 할 자리를 회귀로 고정한다.** `러닝머신 벨트`는 97점으로 `exercise_machine`을 지키고 있고,
그 우열이 뒤집히면 사람들이 실제로 묻는 질의가 깨진다. §7에 케이스로 넣었다.

### 6-4. 일부러 넣지 않은 별칭 — 근거는 실측이다

**`선크림` / `썬크림` 단독 별칭은 넣지 않았다.** 넣고 재보면 이렇게 샌다.

```
(선크림·썬크림 별칭 추가 시)
[선크림 묻은 옷]    => sunscreen_tube s=96  (clothing 옷은 83으로 밀림)   ← 오답
[썬크림 묻은 수건]  => sunscreen_tube s=96  (towel 수건은 79로 밀림)      ← 오답
```

오염된 옷·수건을 물었는데 튜브 배출 안내가 나간다. `다 쓴 선크림`처럼 용기를 가리키는 게 분명한
복합어만 별칭으로 넣었다. **로컬 세션이 `선크림`을 별칭으로 추가하고 싶어지면 이 실측부터 다시 봐라.**

---

## 7. 케이스 초안

### 7-1. `evaluation-cases.json` — 신규 품목 5건

품목과 1:1이라 신규 5건만 더한다(324 → 329). 별칭인 `사료 포대`는 새 품목이 아니라 여기 안 들어간다.

```json
{ "query": "플라스틱 양념통 분리수거 되나?", "expectedItemId": "plastic_seasoning_container", "expectedDisposalType": "recycle_or_general", "notes": "Phase 8 품목 커버리지. 배달 용기·밀폐용기 어느 쪽과도 단계가 갈려 신규로 넣었다." },
{ "query": "변기솔은 어떻게 버려?", "expectedItemId": "toilet_brush", "expectedDisposalType": "general", "notes": "Phase 8 품목 커버리지. 띄어 쓴 '변기 솔'이 변기(대형폐기물)로 오라우팅되던 것을 같이 막는다." },
{ "query": "선크림 튜브 분리수거 돼?", "expectedItemId": "sunscreen_tube", "expectedDisposalType": "recycle_or_general_after_empty", "notes": "Phase 8 품목 커버리지. 유분 잔여물 처리가 치약 튜브와 달라 별칭으로 묶지 않았다." },
{ "query": "가죽 벨트는 어떻게 버려?", "expectedItemId": "leather_belt", "expectedDisposalType": "general", "notes": "Phase 8 품목 커버리지. 의류수거함 수거 여부가 R2에서 뒤집히면 갈래를 함께 고친다." },
{ "query": "젖병은 분리수거 돼?", "expectedItemId": "baby_bottle", "expectedDisposalType": "recycle_or_general_by_material", "notes": "Phase 8 품목 커버리지. 실리콘 젖꼭지와 내열유리 몸체가 갈려 재질 분기로 잡았다." }
```

> `expectedDisposalType`은 §3의 초안 값이다. **R2가 갈래를 바꾸면 여기도 같이 바꿔야 한다.**
> 특히 `leather_belt`가 그렇다.

### 7-2. `mcp-answer-cases.json` — 신규 12건 (전부 `p8_` prefix, append-only)

확정 케이스 6건과 반례 6건을 짝으로 넣는다. **아래 12건은 문서에서 그대로 뽑아 스모크에 태워 통과를 확인했다**(§8-2).

```json
{ "id": "p8_seasoning_container_confirmed", "tool": "get_disposal_steps", "arguments": { "itemName": "플라스틱 양념통 분리수거 되나?" }, "expectedTextIncludes": ["## 플라스틱 양념통", "종량제봉투"], "expectedStructuredIncludes": ["\"id\":\"plastic_seasoning_container\""] },
{ "id": "p8_delivery_container_not_stolen", "tool": "get_disposal_steps", "arguments": { "itemName": "배달 플라스틱 용기" }, "expectedTextIncludes": ["## 배달 플라스틱 용기"], "expectedStructuredIncludes": ["\"id\":\"plastic_food_container\""] },

{ "id": "p8_toilet_brush_confirmed", "tool": "get_disposal_steps", "arguments": { "itemName": "변기솔은 어떻게 버려?" }, "expectedTextIncludes": ["## 변기솔", "종량제봉투"], "expectedStructuredIncludes": ["\"id\":\"toilet_brush\""] },
{ "id": "p8_toilet_brush_spaced_not_toilet_bowl", "tool": "get_disposal_steps", "arguments": { "itemName": "변기 솔 어떻게 버려?" }, "expectedTextIncludes": ["## 변기솔"], "expectedTextExcludes": ["대형폐기물로 신고"], "expectedStructuredIncludes": ["\"id\":\"toilet_brush\""] },
{ "id": "p8_toilet_bowl_not_stolen", "tool": "get_disposal_steps", "arguments": { "itemName": "변기 어떻게 버려?" }, "expectedTextIncludes": ["## 변기"], "expectedStructuredIncludes": ["\"id\":\"toilet_bowl\""] },

{ "id": "p8_sunscreen_tube_confirmed", "tool": "get_disposal_steps", "arguments": { "itemName": "선크림 튜브 분리수거 돼?" }, "expectedTextIncludes": ["## 선크림 튜브"], "expectedStructuredIncludes": ["\"id\":\"sunscreen_tube\""] },
{ "id": "p8_toothpaste_tube_not_stolen", "tool": "get_disposal_steps", "arguments": { "itemName": "치약 튜브" }, "expectedTextIncludes": ["## 치약 튜브", "도포·첩합"], "expectedStructuredIncludes": ["\"id\":\"toothpaste_tube\""] },

{ "id": "p8_leather_belt_confirmed", "tool": "get_disposal_steps", "arguments": { "itemName": "가죽 벨트는 어떻게 버려?" }, "expectedTextIncludes": ["## 가죽 벨트", "종량제봉투"], "expectedStructuredIncludes": ["\"id\":\"leather_belt\""] },
{ "id": "p8_treadmill_belt_not_stolen", "tool": "get_disposal_steps", "arguments": { "itemName": "러닝머신 벨트" }, "expectedTextIncludes": ["## 운동기구"], "expectedTextExcludes": ["## 가죽 벨트"], "expectedStructuredIncludes": ["\"id\":\"exercise_machine\""] },

{ "id": "p8_baby_bottle_confirmed", "tool": "get_disposal_steps", "arguments": { "itemName": "젖병은 분리수거 돼?" }, "expectedTextIncludes": ["## 젖병"], "expectedStructuredIncludes": ["\"id\":\"baby_bottle\""] },
{ "id": "p8_bottle_drying_rack_not_stolen", "tool": "get_disposal_steps", "arguments": { "itemName": "젖병 건조대" }, "expectedTextIncludes": ["## 빨래건조대"], "expectedTextExcludes": ["## 젖병"], "expectedStructuredIncludes": ["\"id\":\"drying_rack\""] },

{ "id": "p8_pet_food_sack_alias", "tool": "get_disposal_steps", "arguments": { "itemName": "사료 포대는 어떻게 버려?" }, "expectedTextIncludes": ["## 쌀포대", "종량제봉투"], "expectedStructuredIncludes": ["\"id\":\"rice_sack\"", "\"matchedBy\":\"사료 포대\""] }
```

**반례를 새 이름이 앞에 오는 복합어로도 짰다.** `변기 솔`(띄어쓰기), `러닝머신 벨트`, `젖병 건조대`가
그 자리다. 이 저장소가 PR #22 리뷰에서 놓쳤던 게 정확히 이 형태였다.

`p8_toilet_brush_spaced_not_toilet_bowl`은 **지금 나고 있는 오답을 고정하는 케이스**라 특히 중요하다.
띄어쓰기 한 칸으로 답이 갈리던 자리를 못 박는다.

### 7-3. **경고 — 기존 케이스 3건이 깨진다. 반드시 같이 고쳐라**

초안을 넣고 `pnpm smoke:mcp`를 돌리면 여기서 멈춘다. 세 케이스 모두 지금은 not_found 폴백을
기대하고 있어서, 품목이 생기는 순간 기대값이 틀려진다. 실제로 재현하고 확인했다.

```
Error: steps_fallback_toilet_brush text did not include "초기 데이터에서 확실히 찾지 못했습니다"
```

| 케이스 id | 지금 기대 | 왜 깨지나 |
| --- | --- | --- |
| `steps_fallback_toilet_brush` | `변기솔 버리는 법` → 재질 폴백 | `toilet_brush`가 확정으로 받는다 |
| `steps_fallback_leather_belt` | `가죽 벨트 어떻게 버려?` → 재질 폴백 | `leather_belt`가 확정으로 받는다 |
| `classify_fallback_pet_food_bag` | `사료 포대 버리기` → 재질 원칙 안내 | `rice_sack`이 별칭으로 받는다 |

id는 그대로 두고 기대값만 바꾸기를 권한다. 케이스 총계가 안 흔들리고 이력도 이어진다.
**아래 기대값으로 바꾸면 스모크가 전부 통과한다 — §7-2의 신규 12건까지 얹어 499건으로 실제로 돌려 확인했다.**

```jsonc
// steps_fallback_toilet_brush
"expectedTextIncludes": ["## 변기솔", "종량제봉투"],
"expectedStructuredIncludes": ["\"id\":\"toilet_brush\""]
// expectedTextExcludes / 기존 found:false 기대는 지운다

// steps_fallback_leather_belt
"expectedTextIncludes": ["## 가죽 벨트", "종량제봉투"],
"expectedStructuredIncludes": ["\"id\":\"leather_belt\""]

// classify_fallback_pet_food_bag  (classify는 "분류 결과:" / matchedItem 형태다)
"expectedTextIncludes": ["분류 결과: 쌀포대"],
"expectedStructuredIncludes": ["\"matchedItem\":\"쌀포대\"", "\"matchedBy\":\"사료 포대\""]
```

> `classify_waste_item`은 `get_disposal_steps`와 구조가 다르다. `"id":"..."`가 아니라
> `"matchedItem":"..."`을 쓴다. 처음에 `"id":"rice_sack"`으로 썼다가 스모크에서 걸렸다.

세 케이스 id에 `fallback`이 남아 있어 이름이 실제 동작과 어긋나 보인다. 그래도 지우고 새로 만드는 것보다
그대로 두는 편이 낫다 — `mcp-answer-cases.json`은 append-only 규칙으로 굴러가는 파일이다.
이름이 계속 걸리면 `notes` 대신 `docs/source-coverage.md`에 한 줄 남겨라.

---

## 8. 검증 결과와 카운트

### 8-1. 초안 반영 전 `pnpm local:test`

통과한다. 데이터를 안 건드렸으니 당연한 결과지만, 기준선으로 기록해둔다.

```
Data validation passed: 324 waste items, 49 regional policies
Data evaluation passed: 324 item cases (resolver: src/data.ts)
Region matching test passed: 9 fixture cases, 94 region cases, 49 policies' aliases, 168 sub-region names, 854 metro-prefixed combinations
Item classification test passed: 17 whole-cell names, 3 spec fragments, 4 runtime queries
MCP smoke test passed at http://127.0.0.1:44037 (487 answer cases)
Widget catalogue sweep: 324/324 cards validated
Widget smoke passed at http://127.0.0.1:41349 (WIDGET_ENABLED=true)
```

### 8-2. 초안을 전부 넣고 돌린 결과

**이 문서의 §3·§4·§7-1·§7-2 블록을 파서로 그대로 뽑아 데이터에 넣고 돌렸다.** 문서와 검증 대상이 같은 텍스트라
"문서에는 맞게 적었는데 실제로는 안 되는" 어긋남이 없다. §7-3의 기존 3건 수정도 함께 반영했다.

```
Data evaluation passed: 329 item cases (resolver: src/data.ts)
MCP smoke test passed at http://127.0.0.1:44765 (499 answer cases)
Widget catalogue sweep: 329/329 cards validated
Widget smoke passed at http://127.0.0.1:40139 (WIDGET_ENABLED=true)
```

```
## coverage-expansion-utterances (50 queries)
- match: 50
- not_found rate: 0.0%

# 보류 발화 내성 (329 품목 x 10 발화 = 3290)
- match: 3290 (100.0%)
- wrong: 0
- ambiguous: 0
- not_found: 0
```

돌린 뒤 `src/data/`는 백업본으로 되돌렸다. 이 브랜치가 건드린 파일은 이 문서 하나뿐이다.

`validate-data.mjs`도 돌렸다. 남은 오류는 아래 카운트 문서 두 줄과 `sourceRefs` 빈 배열뿐이었다.
**품목 스키마 자체에는 오류가 없다.**

```
- docs/source-coverage.md total waste items count must be 329, got 324
- docs/session-coordination.md wasteItems count must be 329, got 324
- item[324](plastic_seasoning_container).sourceRefs must not be empty
- item[325](toilet_brush).sourceRefs must not be empty
- item[326](sunscreen_tube).sourceRefs must not be empty
- item[327](leather_belt).sourceRefs must not be empty
- item[328](baby_bottle).sourceRefs must not be empty
```

### 8-3. 갱신할 카운트

`docs/source-coverage.md` 14~20행과 `docs/session-coordination.md` 49행이다.

| 항목 | 현재 | 초안 반영 후 |
| --- | --- | --- |
| 총 품목 | 324 | **329** |
| 평가 케이스 | 324 | **329** |
| MCP 답변 회귀 케이스 | 487 | **499** (신규 12건, 기존 3건은 수정이라 총계 불변) |
| `verified` | 39 | R2 결과에 따라 |
| `region_review_needed` | 84 | R2 결과에 따라 |
| `needs_source` | 7 | R2 결과에 따라 |
| `standard_import` | 194 | R2 결과에 따라 |

`review.status` 네 줄은 R2가 각 품목의 상태를 정한 뒤에야 확정된다. 초안의 예상은 이렇다 —
`sunscreen_tube`·`baby_bottle`은 `needsRegionCheck: true`라 `region_review_needed`,
나머지 셋은 근거의 깊이에 따라 `verified`나 `standard_import`. 단독 근거를 못 찾으면 `needs_source`다.

`docs/session-coordination.md`는 Phase 9와 겹치는 파일이니 PRD의 머지 순서를 지켜라.

---

## 9. 로컬 세션이 이어서 할 일

순서대로 하면 된다. 1번이 제일 오래 걸린다.

### 1) R2 출처 조사 — 품목별 검색어와 확인할 URL 형태

품목사전 검색은 이 형태다. `<검색어>`만 URL 인코딩해서 갈아 끼우면 된다.

```
https://www.xn--oy2b29bd3a601b.kr/front/search/searchDispose.do?searchCnd=1&searchWrd=<검색어>
```

상세 항목은 `dictionaryView.do?niIdx=<번호>` 또는 `searchDispose.do?niIdx=<번호>` 형태다.
저장소 안에 두 형태가 섞여 있는데, **실제로 열어서 본문이 나온 주소를 그대로 적어라.**
`sources[].checkedAt`은 그 페이지를 연 날짜다.

| 품목 | 1순위 검색어 | 없으면 볼 것 | 이미 저장소에 있는 근거 |
| --- | --- | --- | --- |
| 플라스틱 양념통 | `양념통`, `조미료 용기`, `양념 용기` | `플라스틱`(`niIdx=531`), `고추장`(`niIdx=170`) | `plastic_food_container.sources`에 고추장 원문 |
| 변기솔 | `변기솔`, `변기 청소솔`, `변기솔대` | `청소솔`(`niIdx=83`), `칫솔`(`niIdx=334`) | `dish_brush.sources`에 셋 다 있다 |
| 선크림 튜브 | `선크림`, `자외선차단제`, `썬크림` | `치약`(`niIdx=593`) — **결론이 같은지 반드시 대조** | `toothpaste_tube.sources` |
| 가죽 벨트 | `벨트`, `허리띠`, `가죽` | 지자체 의류수거함 투입 가능 품목 목록 | `wallet`(명함지갑), `handbag`(가방·관악구 안내) |
| 젖병 | `젖병`, `우유병`, `내열유리` | `유리`, `실리콘` | `glass_food_container`, `silicone_kitchenware` |
| 사료 포대 | `사료 포대`, `마대` | `쌀 마대자루`(`niIdx=465`) | `rice_sack.sources` — 그대로 쓸 수 있는지 확인 |

**분리배출 누리집에 없으면** 중앙정부·공공기관·지자체 페이지를 본다. 그래도 없으면
`docs/source-gap-policy.md` 절차다 — 보조 근거 + `재활용척척 예외 배출 정책` source +
`review.status: "needs_source"` + 검색일을 `review.notes`에 남긴다.

크롤링은 PRD대로 Aside CLI를 1순위로 쓰고, 착수할 때 `aside --help`로 서브커맨드를 확인해라.
정적 페이지면 `curl`이 빠르다. 판단 기준은 "본문이 나오느냐"다.

**갈래를 뒤집을 수 있는 근거를 만나면 여기로 돌아와라.** 가장 가능성 큰 자리를 다시 적어둔다.

- `leather_belt` — 의류수거함이 벨트를 받으면 `reuse_collection_or_general`로 바꾸고 단계를 다시 쓴다.
- `sunscreen_tube` — 치약과 결론이 다르면 도포·첩합 분기를 빼고 단계를 다시 쓴다.
- `plastic_seasoning_container` — 품목사전에 양념통 단독 항목이 있고 결론이 `plastic_food_container`와
  완전히 같게 나오면, 그때는 별칭으로 되돌리는 게 맞다. §2-1의 판단이 뒤집히는 유일한 경우다.

### 2) 데이터 반영

1. `waste-items.json`에 §3의 5건을 넣고 `sources`·`sourceRefs`·`review`를 채운다.
2. `rice_sack.aliases`에 §4의 두 개를 더한다. 1단계 문장도 같이 넓힐지 정한다.
3. `evaluation-cases.json`에 §7-1의 5건을 더한다. 갈래가 바뀌었으면 `expectedDisposalType`도 고친다.
4. `mcp-answer-cases.json`에 §7-2의 12건을 더한다.
5. **§7-3의 기존 3건을 고친다. 이걸 빼먹으면 스모크가 멈춘다.**
6. `docs/source-coverage.md`와 `docs/session-coordination.md` 카운트를 §8-3대로 맞춘다.

### 3) 검증

```bash
pnpm measure:utterances    # 반영 전 3,240/3,240 확인
# ... 반영 ...
pnpm local:test
pnpm measure:coverage      # coverage-expansion not_found 0/50
pnpm measure:utterances    # 3,290/3,290, wrong 0, ambiguous 0
```

숫자가 §5-3과 다르게 나오면 §3의 별칭을 건드렸다는 뜻이다. §6의 반례부터 다시 재봐라.

### 4) PR

브랜치 `claude/phase8-item-coverage`에서 PR을 연다. 머지는 저장소 주인이 지시할 때만 한다.
Phase 9보다 먼저 머지한다 — 카운트 문서를 더 많이 건드리는 쪽이 앞이다.

---

## 부록 — 이 초안이 실측한 방법

`src/`를 통째로 복사한 샌드박스에 초안을 넣고 잰 결과다. `src/data/`는 손대지 않았다.

1. **라우팅과 반례 측정** — `src/` 전체를 `logs/p8sim/`으로 복사하고 복사본의 `waste-items.json`에만
   초안을 넣었다. `resolveWasteItem`·`findWasteItems`를 복사본에서 불러 질의별 점수와 `matchKind`를 찍었다.
   `measure-coverage.ts`와 `measure-utterance-robustness.ts`는 import만 복사본으로 돌린 사본을 만들어 돌렸다.
2. **전체 회귀** — `validate-data.mjs`와 `smoke-mcp.mjs`는 경로를 고정으로 읽어서 우회가 안 된다.
   `src/data/`의 세 파일을 백업하고, **이 문서의 JSON 블록을 정규식으로 뽑아** 잠깐 넣고 돌린 뒤 되돌렸다.
   문서에 적힌 텍스트와 검증에 태운 텍스트가 같아야 초안이 초안 구실을 한다.
3. 매 단계 뒤에 `git status`로 트리가 깨끗한 걸 확인했고, 마지막에 샌드박스·사본 스크립트·백업본을 전부 지웠다.
