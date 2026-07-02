# Quality Seed High-Risk Source Review - 2026-07-01

`logs/quality-seed-queries.example.jsonl` 확장 후 `pnpm backlog:auto:quality -- --write`로 저장된 신규 후보 중 high-risk 3개를 먼저 검토했다.

## 처리 결과

| backlog id | 질문 | 판단 | 반영 |
| --- | --- | --- | --- |
| `auto_7c6518a357` | 주사바늘 달린 자가주사기는 어떻게 버려? | 날카로운 의료성 폐기물. 단독 생활폐기물 품목사전 항목은 확인하지 못해 보건소·처방기관·약국·지자체 회수 기준 확인으로 보수 안내 | `home_injection_needle` 추가 |
| `auto_15c0254bce` | 인덕션 유리 상판 깨진 건 대형폐기물이야? | 파손 유리 상판은 유리병류가 아니며 안전 포장 후 불연성폐기물/대형폐기물 분기 | `induction_cooktop_broken_glass` 추가 |
| `auto_fd664f22b1` | 깨진 보온병은 유리야 고철이야? | 보온병은 복합재질 가능성이 높아 유리병류·고철류 확정 안내 금지, 파손 안전 포장과 지역 불연성 기준 확인 | `broken_thermos` 추가 |

## 근거 메모

### 자가주사기 주사바늘

- 법령 근거: 폐기물관리법 시행령 별표 2 - 의료폐기물의 종류
  - URL: `https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%ED%8F%90%EA%B8%B0%EB%AC%BC%EA%B4%80%EB%A6%AC%EB%B2%95%EC%8B%9C%ED%96%89%EB%A0%B9/%EB%B3%84%ED%91%9C2`
- 생활폐기물 분리배출 누리집에서 `주사바늘`, `주사침`, `자가주사기` 단독 품목사전 항목은 확인하지 못했다.
- 2026-07-02 추가 확인: 환경부 `생활계 유해폐기물 관리지침`은 생활계 유해폐기물 분리수거 적용대상에 `폐주사기`를 포함하고, 폐주사기처럼 날카로운 폐기물은 신문지 등으로 포장 후 딱딱한 종이 또는 플라스틱 용기 등에 담아 위험성을 표시해 배출하도록 안내한다.
  - URL: `https://www.me.go.kr/m/file/readDownloadFile.do?fileId=153393&fileSeq=1`
- 2026-07-02 검색 범위에서 강남구 보건소, 서울시, 처방기관·약국의 자가주사 바늘 직접 회수처 공지는 확인하지 못했다. 따라서 지역별 회수 가능 여부 확인 안내는 유지한다.
- 데이터 정책:
  - 일반쓰레기나 재활용품 직접 배출로 확정하지 않는다.
  - 뚫리지 않는 용기 밀봉, 보건소·처방 의료기관·약국·지자체 회수 기준 확인을 우선 안내한다.
  - 추후 강남구 보건소 또는 서울시 공식 자가주사 바늘 회수처 안내를 찾으면 source를 추가 보강한다.

### 깨진 인덕션 유리 상판

- 생활폐기물 분리배출 누리집 품목사전 - 책상유리
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=756`
  - 책상유리는 불연성종량제봉투(마대)로 배출하고, 크거나 무거우면 대형폐기물로 배출한다. 깨진 유리는 신문지와 테이프 등으로 감싸 배출한다.
- 생활폐기물 분리배출 누리집 품목사전 - 조명 유리커버
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=515`
  - 강화유리 성격의 유리커버는 불연성폐기물이며, 봉투 배출이 어려운 크기는 대형폐기물로 배출한다.
- 생활폐기물 분리배출 누리집 품목사전 - 대형폐기물
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=539`
  - 대형폐기물은 종량제봉투에 담기 어려운 가전제품·생활용품 등을 포함한다.
- 데이터 정책:
  - 인덕션 단독 품목사전 항목은 확인하지 못했으므로 상판만 분리된 파손 유리와 본체 포함 대형폐기물을 나누어 안내한다.

### 깨진 보온병

- 생활폐기물 분리배출 누리집 품목사전 - 유리컵
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=503`
  - 유리컵은 불연성종량제봉투(마대)로 배출하고, 깨진 경우 신문지와 테이프 등으로 충분히 감싼다.
- 생활폐기물 분리배출 누리집 품목사전 - 내열식기
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=499`
  - 내열유리 제품은 재활용이 어렵고 불에 타지 않는 불연성 폐기물이다.
- 생활폐기물 분리배출 누리집 품목사전 - 불연성종량제폐기물
  - URL: `https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=543`
  - 유리, 내열식기류, 도자기 등 재활용이 어렵고 불에 타지 않는 폐기물은 불연성종량제폐기물이다.
- 데이터 정책:
  - 보온병/텀블러 단독 품목사전 항목은 확인하지 못했다.
  - 유리병류 또는 고철류로 단정하지 않고 복합재질, 파손 안전 포장, 지역 불연성 기준 확인으로 안내한다.
