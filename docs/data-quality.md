# Data Quality Workflow

재활용척척의 답변 정확도는 `src/data/waste-items.json`의 품목 데이터와 `src/data/evaluation-cases.json`의 대표 질문 테스트셋을 함께 키우는 방식으로 관리한다.
실제 MCP 응답의 문구와 구조화 데이터 회귀는 `src/data/mcp-answer-cases.json`으로 별도 관리한다.
아직 공식 근거와 처리 방향이 정리되지 않은 실제 질문 후보는 `src/data/question-backlog.json`에 먼저 쌓는다.

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
- `coated`: 코팅 여부가 판단에 영향
- `contaminated`: 오염 여부가 판단에 영향
- `food_contaminated`: 음식물, 국물, 소스 오염
- `oily`: 기름 오염
- `empty_required`: 내용물을 비우거나 헹궈야 함
- `remaining_content`: 내용물이 남아 있으면 배출 판단이 달라짐
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
- `nonburnable`: 불연성 폐기물
- `manufacturer_takeback`: 제조사 회수 프로그램 확인 필요
- `reusable`: 재사용 가능 여부가 판단에 영향
- `textile`: 섬유류

새 태그가 필요하면 lowercase snake_case로 추가한다.

## Review Status

- `draft`: 초안. 답변 문구와 출처가 아직 정리되지 않음
- `needs_source`: 전국 공통 답변 후보는 있으나 품목별 공식 근거 URL 또는 원문 기준 보강 필요
- `region_review_needed`: 지역별 수거함, 요일, 수수료, 신고 방식 확인 필요
- `verified`: 품목별 공식 근거를 확인했고, 지역 차이 안내까지 반영됨
- `standard_import`: Phase 2 커버리지 확장으로 추가한 표준 티어. 공식 출처(url 필수)를 확인한 얕지만 정확한 안내이며, 다중 출처·조건 분기 심층 검수 전 단계

`region_review_needed`는 품질이 낮다는 뜻이 아니다. 품목의 전국 공통 판단은 가능하지만, 사용자가 실제로 버리려면 지역별 정보가 답변 정확도에 영향을 주는 상태를 뜻한다.

예를 들어 폐건전지는 전국적으로 전용 수거함 배출이 맞지만, 실제 답변에는 사용자의 지역 기준 수거함 위치가 필요하다. 의자와 매트리스도 대형폐기물이라는 판단은 가능하지만, 수수료와 신고 URL은 지자체별로 다르다.

`verified`로 올릴 때는 최소한 다음을 확인한다.

- `sources`에 공식 또는 지자체 URL이 있다.
- `checkedAt`이 최신 확인일이다.
- 오염/파손/대형/유해/복합재질 같은 예외 조건이 `conditions`, `steps`, `cautions`에 반영되어 있다.
- 지역 차이가 있으면 `needsRegionCheck: true`와 `regionPolicy.checkItems`가 채워져 있다.

## Region Coverage Tier

품목의 `review.status`와 별개로, `region-policies.json`의 지역은 `coverageTier`로 담는 범위를 나눈다. 지역을 늘리려면 한 지역의 밀도를 낮춰야 하는데, 낮춘 범위를 스키마에 드러내지 않으면 얕은 데이터가 확정 안내처럼 보이기 때문이다.

- `full`: 배출 요일·시간, 음식물 예외, 특수수거, 대형폐기물 절차까지. 기존 5곳.
- `standard`: 대형폐기물 인터넷 신청 URL, 수수료 조회 URL, 담당 직통번호, `contactCheckedAt`, 폐의약품·폐건전지 수거함 안내, 출처 URL. **여섯 항목이 전부 있어야 추가한다.** 하나라도 못 채우면 넣지 않고 백로그에 남긴다. 배출 요일·시간은 같은 구 안에서도 동·주택 유형별로 갈려 담지 않는다.
- `metro`: 광역시도 폴백. `bulkyWaste` 자체를 두지 않는다 — 대형폐기물 접수가 기초자치단체 소관이라 광역에 대응하는 직통번호가 없고, 시청 대표번호로 메우면 번호 품질 기준이 무너진다. validate가 `metro`에 `bulkyWaste`가 있으면 error를 낸다.

전화번호는 티어와 무관하게 담당 직통번호만 쓴다. 지역번호+120 대표 민원번호는 validate가 막고, 지자체 대표번호(교환)는 쓰지 않는다. 번호를 확인하지 못하면 그 지자체를 추가하지 않는다.

## Source Priority

출처 우선순위:

1. 중앙정부, 공공기관 공식 분리배출 안내
2. 생활폐기물 분리배출 누리집 품목/지역 안내
3. 지자체 청소/환경/자원순환 부서 안내
4. 법령 또는 고시
5. 보도자료, 블로그, 커뮤니티는 참고만 하고 `verified` 근거로 쓰지 않는다.

## Add A New Item

1. 사용자 질문 또는 검색 로그에서 품목 후보를 고른다.
2. 바로 품목으로 만들기 애매하면 `src/data/question-backlog.json`에 먼저 추가한다.
3. 공식 출처를 먼저 찾고, 없으면 `review.status`를 `needs_source`로 둔다.
4. 품목 상태가 답을 바꾸는지 확인한다.
5. `src/data/waste-items.json`에 품목을 추가한다.
6. 같은 품목의 대표 질문을 `src/data/evaluation-cases.json`에 추가한다.
7. Top 50 품목과 사용자 질문에서 승격한 확장 품목은 품목당 정확히 1개의 대표 질문 평가 케이스를 유지한다.
8. 실제 답변 문구나 구조화 응답이 중요하면 `src/data/mcp-answer-cases.json`에 MCP 답변 케이스를 추가한다. 지역 정책 응답은 `expectedRegionalPolicy.level`, `shape`, `guidance`로 `regionCheckLevel`, 구조 축약 형태, `regionGuidance`를 함께 고정할 수 있다.
9. 백로그에서 승격한 질문은 `covered`로 바꾼다.
10. `pnpm check`를 실행한다.
11. 대표 MCP 호출로 실제 답변 톤을 확인한다.

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
pnpm backlog:questions
pnpm log:query -- --query "요가매트는 어떻게 버려?"
pnpm backlog:auto -- --query "요가매트는 어떻게 버려?"
pnpm backlog:auto:quality
pnpm check
pnpm smoke:mcp
pnpm local:test
```

`pnpm check`는 TypeScript 타입 검사, 데이터 스키마 검증, 대표 질문 평가를 모두 실행한다.

`pnpm backlog:questions`는 아직 품목 데이터로 승격하지 않은 실제 질문 후보를 상태와 우선순위별로 요약한다.

`pnpm backlog:auto`는 실제 질문 로그를 분석해 미매칭, 낮은 매칭 점수, `needs_source`, 낮은 confidence 품목을 자동으로 `question-backlog.json` 후보로 만든다. 기본은 dry-run이고, 저장하려면 `--write`를 붙인다.

`pnpm backlog:auto:quality`는 개인정보 없는 재현용 질문 묶음인 `logs/quality-seed-queries.example.jsonl`을 분석한다. 현재 quality seed는 116개 질문을 담고 있으며, 실제 백로그에 추가하려면 dry-run 후보를 검토한 뒤 `pnpm backlog:auto:quality -- --write`를 붙인다.

`pnpm log:query`는 수동 테스트 또는 사용자 피드백 질문을 `logs/manual-queries.jsonl`에 JSONL로 남긴다. 실제 로그 파일은 Git에 커밋하지 않고, `logs/manual-queries.example.jsonl`만 형식 예시로 관리한다.

대표 질문 평가는 Top 50 품목과 확장 품목이 각각 1개씩 평가 케이스를 갖는지까지 확인한다.

`pnpm smoke:mcp`는 빌드된 서버를 로컬 임시 포트로 띄우고 실제 MCP Streamable HTTP 호출을 보낸다. 답변 품질 케이스는 `src/data/mcp-answer-cases.json`에 저장한다.

`pnpm local:test`는 로컬 개발 기본 게이트다. PlayMCP in KC에 올리기 전에 최소 이 명령을 통과시킨다.

현재 Top 50 목록과 사용자 질문에서 승격한 확장 품목은 [top-50-items.md](top-50-items.md)를 기준으로 관리한다.

공식 출처 보강 현황은 [source-coverage.md](source-coverage.md)를 기준으로 관리한다.
공식 단독 근거를 찾지 못한 품목의 예외/근거 gap 기준은 [source-gap-policy.md](source-gap-policy.md)를 기준으로 한다.

1차 지역 보강은 `서울 강남구` 기준으로 시작한다. 지역 기본 정책은 `src/data/region-policies.json`에 저장하고, 대형폐기물 수수료처럼 품목별로 커질 수 있는 데이터는 `src/data/bulky-waste-fees.json`처럼 별도 파일로 분리한다.

로컬 우선 개발/검증 흐름은 [local-mcp-workflow.md](local-mcp-workflow.md)를 기준으로 한다.

실제 질문 백로그 관리 흐름은 [question-backlog.md](question-backlog.md)를 기준으로 한다.
