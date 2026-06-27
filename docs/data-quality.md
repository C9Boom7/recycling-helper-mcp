# Data Quality Workflow

재활용척척의 답변 정확도는 `src/data/waste-items.json`의 품목 데이터와 `src/data/evaluation-cases.json`의 대표 질문 테스트셋을 함께 키우는 방식으로 관리한다.

## Data Shape

새 품목은 단순 FAQ 문장이 아니라 아래 축을 함께 가진다.

- `name`, `aliases`: 사용자가 실제로 말할 법한 이름과 별칭
- `category`, `disposalType`: 내부 분류와 최종 배출 판단
- `conditions`: 판단을 바꾸는 상태 태그
- `summary`, `steps`, `cautions`: 사용자에게 보여줄 답변 재료
- `needsRegionCheck`, `regionPolicy`: 지역 확인 필요 여부와 확인 항목
- `sources`: 근거 출처, URL, 출처 유형, 확인일
- `review`: 검수 상태와 메모

## Condition Tags

자주 쓰는 태그:

- `clean`: 깨끗한 상태일 때 재활용 가능
- `contaminated`: 오염 여부가 판단에 영향
- `food_contaminated`: 음식물, 국물, 소스 오염
- `oily`: 기름 오염
- `empty_required`: 내용물을 비우거나 헹궈야 함
- `mixed_material`: 복합재질
- `separate_parts`: 라벨, 뚜껑, 펌프 등 부품 분리 필요
- `damaged`: 파손 상태
- `safe_wrap_required`: 안전 포장 필요
- `sharp`: 날카로운 품목
- `pressurized`: 가스/압축 용기
- `hazardous`: 유해 또는 화재 위험 품목
- `hygiene`: 위생용품
- `electronics`: 전자제품
- `bulky`: 대형폐기물 가능성
- `liquid`: 액체류
- `reusable`: 재사용 가능 여부가 판단에 영향
- `textile`: 섬유류

새 태그가 필요하면 lowercase snake_case로 추가한다.

## Review Status

- `draft`: 초안. 답변 문구와 출처가 아직 정리되지 않음
- `needs_source`: 전국 공통 답변 후보는 있으나 품목별 공식 근거 URL 또는 원문 기준 보강 필요
- `region_review_needed`: 지역별 수거함, 요일, 수수료, 신고 방식 확인 필요
- `verified`: 품목별 공식 근거를 확인했고, 지역 차이 안내까지 반영됨

`region_review_needed`는 품질이 낮다는 뜻이 아니다. 품목의 전국 공통 판단은 가능하지만, 사용자가 실제로 버리려면 지역별 정보가 답변 정확도에 영향을 주는 상태를 뜻한다.

예를 들어 폐건전지는 전국적으로 전용 수거함 배출이 맞지만, 실제 답변에는 사용자의 지역 기준 수거함 위치가 필요하다. 의자와 매트리스도 대형폐기물이라는 판단은 가능하지만, 수수료와 신고 URL은 지자체별로 다르다.

`verified`로 올릴 때는 최소한 다음을 확인한다.

- `sources`에 공식 또는 지자체 URL이 있다.
- `checkedAt`이 최신 확인일이다.
- 오염/파손/대형/유해/복합재질 같은 예외 조건이 `conditions`, `steps`, `cautions`에 반영되어 있다.
- 지역 차이가 있으면 `needsRegionCheck: true`와 `regionPolicy.checkItems`가 채워져 있다.

## Source Priority

출처 우선순위:

1. 중앙정부, 공공기관 공식 분리배출 안내
2. 생활폐기물 분리배출 누리집 품목/지역 안내
3. 지자체 청소/환경/자원순환 부서 안내
4. 법령 또는 고시
5. 보도자료, 블로그, 커뮤니티는 참고만 하고 `verified` 근거로 쓰지 않는다.

## Add A New Item

1. 사용자 질문 또는 검색 로그에서 품목 후보를 고른다.
2. 공식 출처를 먼저 찾고, 없으면 `review.status`를 `needs_source`로 둔다.
3. 품목 상태가 답을 바꾸는지 확인한다.
4. `src/data/waste-items.json`에 품목을 추가한다.
5. 같은 품목의 대표 질문을 `src/data/evaluation-cases.json`에 추가한다.
6. Top 50 품목은 품목당 정확히 1개의 대표 질문 평가 케이스를 유지한다.
7. `pnpm check`를 실행한다.
8. 대표 MCP 호출로 실제 답변 톤을 확인한다.

## Expansion Order

추천 배치:

1. Top 50 생활 품목: 종이, 플라스틱, 비닐, 유리, 캔, 음식물 관련 예외
2. 헷갈리는 예외 품목: 영수증, 코팅지, 컵라면 용기, 멸균팩, 오염 비닐, 깨진 유리
3. 위험 품목: 건전지, 보조배터리, 형광등, 의약품, 라이터, 스프레이캔, 칼날
4. 지역 차이 품목: 종이팩 수거함, 소형가전, 폐식용유, 아이스팩, 대형폐기물
5. 지역별 정책 데이터: 서울/경기/인천 등 목표 지역부터 시작

## User Decisions Needed

작업 중 다음 선택은 제품 방향에 영향을 주므로 바로 확인한다.

- 전국 공통 품목을 더 넓힐지, 특정 지역 정확도를 먼저 높일지
- 사용자 입력 로그를 저장할지, 저장하지 않고 수동 품목 리스트로 갈지
- `verified` 기준을 얼마나 엄격하게 둘지
- PlayMCP 심사 전까지 몇 개 품목을 목표로 할지
- 지역 데이터의 1차 타깃을 어느 시군구로 잡을지

## Commands

```bash
pnpm validate:data
pnpm eval:data
pnpm check
```

`pnpm check`는 TypeScript 타입 검사, 데이터 스키마 검증, 대표 질문 평가를 모두 실행한다.

대표 질문 평가는 Top 50 품목이 각각 1개씩 평가 케이스를 갖는지까지 확인한다.

현재 Top 50 목록은 [top-50-items.md](top-50-items.md)를 기준으로 관리한다.

공식 출처 보강 현황은 [source-coverage.md](source-coverage.md)를 기준으로 관리한다.

1차 지역 보강은 `서울 강남구` 기준으로 시작한다. 지역 기본 정책은 `src/data/region-policies.json`에 저장하고, 대형폐기물 수수료처럼 품목별로 커질 수 있는 데이터는 `src/data/bulky-waste-fees.json`처럼 별도 파일로 분리한다.
