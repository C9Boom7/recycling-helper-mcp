# Quality Seed Next Source Research - 2026-07-02

대상: `logs/quality-seed-queries.example.jsonl`을 88개로 확장한 뒤 `pnpm backlog:auto:quality -- --write`로 추가된 `quality-seed-next` 백로그 10개.

아래 처리 결과의 카운트는 이 배치 당시 스냅샷이며, 현재 전체 데이터 카운트는 [source-coverage.md](source-coverage.md)를 기준으로 한다.

## 처리 결과

- `src/data/question-backlog.json`: 93개 중 `covered` 93개, 열린 todo 0개
- `src/data/waste-items.json`: 120개에서 125개로 확장
- `src/data/evaluation-cases.json`: 120개에서 125개로 확장
- `src/data/mcp-answer-cases.json`: 119개에서 129개로 확장
- 신규 품목: `meat_absorbent_pad`, `paper_core`, `scissors`, `paint_palette`, `dental_floss`
- 기존 품목 보강: `glass_bottle`, `ceramic_bowl`, `knife_blade`, `cosmetic_cotton_pad`, `snack_bag`

## 공식 근거 반영

### 닭고기 포장 흡수패드

- 데이터 반영: `meat_absorbent_pad`
- 공식 근거: 생활폐기물 분리배출 누리집 품목사전 - 흡수패드
- URL: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=454
- 판단: 종이, 부직포, 고흡수성수지 등 복합재질이고 오염 가능성이 높아 종량제봉투로 배출

### 쿠킹랩 심지

- 데이터 반영: `paper_core`
- 공식 근거:
  - 휴지심: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=29
  - 키친타올 심: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=560
- 지역 근거: 강남구청 쓰레기배출안내
- 판단: 비닐랩 본품과 분리한 종이 심지는 이물질을 제거하고 눌러 부피를 줄인 뒤 종이류로 배출

### 스티커 붙은 유리병

- 데이터 반영: `glass_bottle` 별칭, 라벨 분리 단계, 라벨 보조 근거
- 공식 근거:
  - 유리병: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=534
  - 비닐 라벨: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=620
  - 수분리성 라벨: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=96
- 판단: 내용물을 비우고 병뚜껑과 라벨·스티커 등 다른 재질을 가능한 범위에서 분리한 뒤 유리병류로 배출

### 깨진 접시

- 데이터 반영: `ceramic_bowl` 별칭과 MCP 답변 회귀 케이스
- 공식 근거:
  - 머그잔: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=502
  - 재활용가능자원의 분리수거 등에 관한 지침 별표 1
  - 강남구청 쓰레기배출안내
- 판단: 도자기류는 유리병류가 아니며, 깨졌다면 안전하게 감싸 지역 불연성 봉투 또는 지정 봉투 기준을 확인

### 녹슨 칼

- 데이터 반영: `knife_blade` 별칭과 MCP 답변 회귀 케이스
- 공식 근거: 생활폐기물 분리배출 누리집 품목사전 - 칼
- URL: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=711
- 판단: 녹슬었거나 금속 재질이어도 날카로운 칼은 고철류가 아니라 안전 포장 후 종량제봉투로 배출

### 부러진 가위

- 데이터 반영: `scissors`
- 공식 근거: 생활폐기물 분리배출 누리집 품목사전 - 가위
- URL: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=306
- 판단: 가위는 금속 재질이어도 날카로운 제품이라 신문지와 테이프 등으로 감싼 후 종량제봉투로 배출

### 물감 묻은 팔레트

- 데이터 반영: `paint_palette`
- 유사 공식 근거:
  - 수채화 물감: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=373
  - 붓: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=517
- 판단: 물감이 묻어 굳었거나 세척이 어려운 팔레트는 플라스틱류가 아니라 종량제봉투로 보수 안내
- 남은 gap: `팔레트`, `물감 팔레트`, `미술 팔레트` 단독 품목사전 항목은 확인하지 못해 `review.status: needs_source`로 유지

### 네일 리무버 솜

- 데이터 반영: `cosmetic_cotton_pad` 별칭, 네일 리무버/아세톤 주의 문구, MCP 답변 회귀 케이스
- 공식 근거:
  - 화장솜: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=733
  - 매니큐어: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=414
- 판단: 화장솜은 일반종량제폐기물이며, 네일 리무버·아세톤이 묻은 솜은 재활용품이 아니고 화기 주의가 필요

### 샴푸 리필팩 뚜껑

- 데이터 반영: `snack_bag` 별칭과 MCP 답변 회귀 케이스
- 공식 근거: 생활폐기물 분리배출 누리집 품목사전 - 스파우트파우치
- URL: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=104
- 판단: 리필 파우치 몸체는 비닐류, 분리 가능한 뚜껑은 플라스틱류로 분리 배출

### 치실

- 데이터 반영: `dental_floss`
- 공식 근거: 생활폐기물 분리배출 누리집 품목사전 - 치실
- URL: https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=725
- 판단: 플라스틱 손잡이와 실이 결합되어 재질별 분리가 어려운 사용 위생 소모품이므로 종량제봉투로 배출

## 후속 메모

- `paint_palette`는 현재 유사 공식 근거 기반 보수 안내이므로 다음 source gap 재검색 때 단독 근거를 다시 확인한다.
- 새 quality seed를 추가할 때는 `pnpm backlog:auto:quality` dry-run으로 후보를 먼저 본 뒤, 실제 반영은 `--write` 후 공식 근거 검토와 MCP 답변 회귀 케이스 추가 순서로 진행한다.
