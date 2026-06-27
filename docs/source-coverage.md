# Source Coverage

Top 50 데이터는 공식 출처를 기준으로 다음 검수 상태를 사용한다.

## Review Status Summary

- `verified`: 전국 공통 분리배출 기준으로 우선 답변 가능한 품목
- `region_review_needed`: 기본 판단은 있으나 수거함 위치, 배출일, 신고 방식, 수수료 등 지역 기준 확인이 필요한 품목
- `needs_source`: 보수적 seed 답변이며 품목사전 원문 또는 지자체 원문 보강이 필요한 품목

현재 상태:

- `verified`: 16
- `region_review_needed`: 34
- `needs_source`: 0

## Primary Sources

### 재활용가능자원의 분리수거 등에 관한 지침

- URL: https://www.xn--oy2b29bd3a601b.kr/front/bbsList.do?bbsId=BBS_0003
- 용도: 종이류, 종이팩, 종이컵, 유리병, 캔, PET병, 플라스틱 용기, 비닐류, 스티로폼, 의류, 전지류, 전기전자제품, 조명제품 등 공식 기준
- 데이터 반영: `sourceType: "law"`
- 근거 필드: `sources[].basis`

### 생활폐기물 분리배출 누리집 지역별 정보

- URL: https://www.xn--oy2b29bd3a601b.kr/front/region/region.do
- 용도: 지역별 배출 방법, 분리배출 장소, 종량제봉투 판매소, 조례 확인
- 데이터 반영: `sourceType: "local_guidance"`
- 적용 품목: `needsRegionCheck: true` 품목

### 생활폐기물 분리배출 누리집 품목사전

- URL: https://www.xn--oy2b29bd3a601b.kr/
- 상세 URL 형식: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=<품목ID>`
- 용도: 음식물류 예외, 생활용품, 위생용품, 복합재질 등 지침 별표만으로 부족한 품목의 품목별 원문 근거
- 데이터 반영: `sourceType: "official_guidance"`
- 데이터 반영: `sources[].url`에 품목별 상세 URL을 저장하고 `sources[].basis`에 핵심 판정 근거를 요약

### 환경부 재활용품 분리수거 요령

- URL: https://www.me.go.kr/webdata/education/class21/8-03.html
- 용도: 종이류, 의류, 플라스틱류, 캔류, 병류, 스티로폼 등 배출요령 보조 근거
- 데이터 반영: `sourceType: "official_guidance"`

## Verified Items

현재 `verified` 품목:

- 기름 묻은 피자박스
- 택배상자
- 송장스티커
- 영수증
- 샴푸통
- 과자봉지
- 뽁뽁이
- 컵라면 용기
- 유리병
- 음료캔
- 배달 플라스틱 용기
- 물티슈
- 칫솔
- 볼펜
- 칼날
- 일회용 마스크

## Needs Source Items

현재 `needs_source` 품목:

- 없음

Top 50 품목은 모두 공식 품목사전, 지침, 환경부 안내, 또는 강남구청 원문 중 하나 이상의 근거를 갖는다.

## Region Review Items

`region_review_needed` 품목은 지역별 수거함, 배출일, 신고 방식, 조례, 대형폐기물 수수료 중 하나 이상이 답변 정확도에 영향을 준다. 이 품목들은 사용자가 지역을 입력하면 기본 판단과 함께 지역 확인 항목을 안내한다.

현재 1차 지역 보강 대상은 `서울 강남구`이며, 세부 데이터는 [gangnam-region-policy.md](gangnam-region-policy.md)와 `src/data/region-policies.json`에 있다.
대형폐기물 수수료는 지역 기본 정책과 분리해 `src/data/bulky-waste-fees.json`에 저장한다.

대표 그룹:

- 종이팩, 멸균팩, 종이컵
- 무색 PET병, 스티로폼
- 스프레이캔, 부탄가스, 알루미늄 포일
- 음식물류 예외 일부
- 폐식용유, 건전지, 보조배터리, 형광등, LED등, 폐의약품
- 소형가전, 휴대폰
- 의자, 매트리스, 이불
- 의류, 신발
- 깨진 유리컵

## Next Source Tasks

1. 강남구 수거함 위치 페이지를 품목별 안내에 연결할지, 좌표/주소 데이터로 구조화할지 결정한다.
2. 음식물류 예외 품목은 강남구 외 1~2개 지역을 추가해 지역 차이가 있는지 교차 검증한다.
3. 대형폐기물 수수료는 강남구 Top 50 관련 품목에서 시작했으므로, 사용자 질문 로그에 따라 품목 범위를 확장한다.
4. Top 50 외 사용자 질문 로그가 쌓이면 검색 실패/낮은 confidence 품목을 다음 데이터 보강 후보로 선정한다.
