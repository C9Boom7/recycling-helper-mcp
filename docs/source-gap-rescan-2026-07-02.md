# Source Gap Rescan - 2026-07-02

대상: `review.status: "needs_source"`로 남아 있던 8개 품목.

## Result

2026-07-02 기준 생활폐기물 분리배출 누리집 품목사전 검색 엔드포인트와 공공 도메인 웹 검색을 재확인했다. `설거지 솔`은 alias인 `청소솔` 공식 품목사전 항목을 대표 근거로 채택해 `verified`로 승격했고, 나머지 7개 품목은 단독 품목사전 항목을 찾지 못해 기존 보수 답변과 `needs_source` 상태를 유지한다.

| Item ID | 품목 | 재검색 결과 | 현행 답변 유지 근거 |
| --- | --- | --- | --- |
| `vacuum_dust` | 청소기 먼지 | 단독 항목 없음 | 화장지, 걸레, 물티슈, 테이프 클리너 등 오염·청소 잔재물 보조 근거와 예외 정책 |
| `laundry_lint` | 세탁 보풀 | 단독 항목 없음 | 화장지, 걸레, 물티슈, 테이프 클리너, 행주 등 오염·섬유성 잔재물 보조 근거와 예외 정책 |
| `soap_bar_piece` | 비누 조각 | 단독 항목 없음 | 가루세제, 샴푸, 핸드크림 등 세정제·위생제품 잔여물 보조 근거와 예외 정책 |
| `dish_brush` | 설거지 솔 | `청소솔` 대표 항목 확인 | 청소솔 공식 항목과 수세미, 칫솔 복합재질 세척·브러시류 보조 근거 |
| `cotton_swab` | 면봉 | 단독 항목 없음 | 화장솜, 사용한 화장지처럼 위생·오염 소모품 보조 근거 |
| `solvent_contaminated_rag` | 시너 묻은 걸레 | 단독 항목 없음 | 걸레, 페인트, 인화성 잔여물 지침 보조 근거 |
| `pet_waste_tissue` | 반려동물 배설물 묻은 휴지 | 단독 항목 없음 | 배변패드, 사용한 화장지처럼 배설물·오염 위생 폐기물 보조 근거 |
| `paint_palette` | 물감 묻은 팔레트 | 단독 항목 없음 | 수채화 물감, 붓처럼 물감 오염·복합재질 미술 도구 보조 근거 |

## Official Web Expansion

생활폐기물 분리배출 누리집 외에 공공 도메인 웹 검색을 추가로 확인했다.

- `solvent_contaminated_rag`: [국가법령정보센터 - 생활계 유해폐기물의 종류](https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=2100000266748), [환경부 행정예고](https://opinion.lawmaking.go.kr/gcom/admpp/26361), [연제구 생활계 유해폐기물 분리배출](https://www.yeonje.go.kr/portal/contents.do?mId=0602020500), [세종시 생활계유해폐기물 안내](https://www.sejong.go.kr/recycle/sub03_04_01.do)를 확인했다. 폐페인트·폐광택제·폐접착제와 건강·환경 피해 가능 폐기물의 생활계 유해폐기물 관리 근거는 확인했지만, `시너 묻은 걸레` 단독 품목 기준은 확인하지 못했다. 데이터에는 법령 보조 근거를 추가하고 `needs_source`는 유지했다.
- `dish_brush`: 생활폐기물 분리배출 누리집 [청소솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=83) 항목을 확인했다. 청소솔은 금속·플라스틱 등이 섞인 복합재질 제품으로, 재질별 분리가 어려우면 종량제봉투로 배출하도록 안내한다. 데이터에는 설거지 솔의 alias/대표 근거로 추가하고 `verified`로 승격했다.
- `cotton_swab`: [한국소비자원 일회용 면봉 안전실태조사](https://www.kca.go.kr/smartconsumer/board/download.do?fno=10022760&bid=00000146&did=1002733386&menukey=7301)에서 면봉의 위생용품 정의는 확인했지만, 배출 기준은 확인하지 못했다.
- `vacuum_dust`, `laundry_lint`, `soap_bar_piece`, `pet_waste_tissue`, `paint_palette`: 공공 도메인 검색에서 일반 생활쓰레기 안내, 생활계 유해폐기물 일반 안내, 민원·제안·교육자료 등은 확인됐으나 해당 품목의 직접 배출 기준으로 쓰기에는 부족했다.

## Final Narrow Validation

2026-07-02 최종 검증에서는 생활폐기물 분리배출 누리집 AJAX 검색 결과를 `fnViewArticle` 상세 후보 기준으로 다시 확인했고, 공공 웹 검색은 `site:go.kr` 중심의 공식/지자체 결과만 승격 후보로 보았다. 아래 7개 품목은 직접 배출 기준으로 쓸 단독 공식 항목이나 공공 원문이 없어 `needs_source` 유지를 확정한다.

| Item ID | 최종 확인 검색어 | 직접 항목 판단 |
| --- | --- | --- |
| `vacuum_dust` | `청소기 먼지`, `진공청소기 먼지`, `로봇청소기 먼지`, `먼지봉투`, `청소기 먼지봉투`, `집 먼지`, `먼지`, `청소기` | 먼지는 일회용 마스크·테이프 클리너 보조 항목만, 청소기는 본체·배터리 등 전자제품 항목만 확인 |
| `laundry_lint` | `세탁 보풀`, `빨래 보풀`, `보풀`, `세탁 먼지`, `세탁먼지`, `건조기 먼지`, `건조기 보풀`, `세탁기 거름망`, `건조기` | 보풀 계열 단독 항목 없음. 건조기는 식기건조기·식품건조기 등 전자제품 항목만 확인 |
| `soap_bar_piece` | `비누 조각`, `비누`, `고체비누`, `세안비누`, `샴푸바`, `고체 샴푸`, `세정제` | 비누 검색은 가루세제만, 세정제 검색은 욕실 세정제·청소 세제 등 유사 항목만 확인 |
| `cotton_swab` | `면봉`, `사용한 면봉`, `종이 면봉`, `플라스틱 면봉`, `귀이개 면봉`, `화장솜` | 면봉 계열 단독 항목 없음. 화장솜은 보조 위생 소모품 근거로만 유지 |
| `solvent_contaminated_rag` | `시너 묻은 걸레`, `신나 묻은 걸레`, `페인트 묻은 걸레`, `유기용제 묻은 걸레`, `용제 묻은 천`, `시너`, `신나`, `유기용제`, `페인트` | 오염 걸레 단독 항목 없음. 페인트·생활계 유해폐기물 보조 근거만 유지 |
| `pet_waste_tissue` | `반려동물 배설물 묻은 휴지`, `반려동물 배설물`, `강아지 똥 묻은 휴지`, `강아지 똥`, `개똥`, `고양이 똥`, `배설물 묻은 휴지`, `오염 휴지`, `배변`, `반려동물` | 배변패드·반려동물 용품·고양이 모래 등 관련 항목만 확인 |
| `paint_palette` | `물감 묻은 팔레트`, `물감 팔레트`, `미술 팔레트`, `플라스틱 팔레트`, `수채화 팔레트`, `아크릴 물감 팔레트`, `팔레트`, `파레트`, `물감`, `수채화`, `미술` | 팔레트 단독 항목 없음. 수채화 물감·붓·크레파스·캔버스 등 유사 미술용품만 확인 |

## Search Terms

### 청소기 먼지

- 검색어: `청소기 먼지`, `진공청소기 먼지`, `로봇청소기 먼지`, `먼지봉투`, `먼지`
- 품목사전 검색 URL 예시: [청소기 먼지](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EC%B2%AD%EC%86%8C%EA%B8%B0%20%EB%A8%BC%EC%A7%80)
- 결과: 단독 품목사전 상세 항목 없음. `먼지` 검색은 일회용 마스크, 테이프 클리너만 확인했고 `청소기` 검색은 청소기 본체·배터리 등 전자제품 항목만 확인

### 세탁 보풀

- 검색어: `세탁 보풀`, `보풀`, `건조기 먼지`, `건조기 보풀`, `세탁먼지`, `세탁기 거름망`
- 품목사전 검색 URL 예시: [세탁 보풀](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EC%84%B8%ED%83%81%20%EB%B3%B4%ED%92%80)
- 결과: 단독 품목사전 상세 항목 없음. `건조기` 검색은 식기건조기, 식품건조기 등 전자제품 항목만 확인

### 비누 조각

- 검색어: `비누`, `비누 조각`, `고체비누`, `세안비누`, `샴푸바`
- 품목사전 검색 URL 예시: [비누](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EB%B9%84%EB%88%84)
- 결과: 단독 품목사전 상세 항목 없음. `비누` 검색은 가루세제만, `세정제` 검색은 욕실 세정제·청소 세제 등 유사 세정제 항목만 확인

### 설거지 솔

- 검색어: `설거지 솔`, `설거지솔`, `주방 솔`, `청소솔`, `세척솔`, `브러시`
- 품목사전 검색 URL 예시: [설거지 솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EC%84%A4%EA%B1%B0%EC%A7%80%20%EC%86%94)
- 결과: `설거지 솔`, `설거지솔`, `주방 솔` 단독 항목은 없지만 `청소솔` 검색에서 공식 품목사전 [청소솔](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionaryView.do?niIdx=83) 항목 확인. 설거지 솔의 대표/alias 근거로 채택해 `verified` 승격

### 면봉

- 검색어: `면봉`, `종이 면봉`, `플라스틱 면봉`
- 품목사전 검색 URL 예시: [면봉](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EB%A9%B4%EB%B4%89)
- 결과: 단독 품목사전 상세 항목 없음. `화장솜` 검색은 화장솜 등 위생 소모품 보조 항목만 확인

### 시너 묻은 걸레

- 검색어: `시너 묻은 걸레`, `신나 묻은 걸레`, `페인트 묻은 걸레`, `시너`, `신나`, `유기용제`
- 품목사전 검색 URL 예시: [시너 묻은 걸레](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EC%8B%9C%EB%84%88%20%EB%AC%BB%EC%9D%80%20%EA%B1%B8%EB%A0%88)
- 결과: 단독 품목사전 상세 항목 없음

### 반려동물 배설물 묻은 휴지

- 검색어: `반려동물 배설물`, `강아지 똥`, `개똥`, `고양이 똥`, `배설물 묻은 휴지`, `오염 휴지`
- 품목사전 검색 URL 예시: [반려동물 배설물](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EB%B0%98%EB%A0%A4%EB%8F%99%EB%AC%BC%20%EB%B0%B0%EC%84%A4%EB%AC%BC)
- 결과: 단독 품목사전 상세 항목 없음. `배변` 검색은 배변패드, 반려동물 케이지, 캣타워, 고양이 모래 등 관련 항목만 확인

### 물감 묻은 팔레트

- 검색어: `팔레트`, `파레트`, `물감 팔레트`, `미술 팔레트`, `플라스틱 팔레트`, `물감`, `수채화`
- 품목사전 검색 URL 예시: [물감 팔레트](https://www.xn--oy2b29bd3a601b.kr/front/dischargeMethod/dictionary.do?searchCnd=1&searchWrd=%EB%AC%BC%EA%B0%90%20%ED%8C%94%EB%A0%88%ED%8A%B8)
- 결과: 단독 품목사전 상세 항목 없음. `물감`, `수채화` 검색은 `수채화 물감`, `붓`, `크레파스`, `캔버스` 등 유사 미술용품 항목만 확인

## Follow-up

- 남은 7개 `needs_source` 품목은 단독 공식 근거가 없더라도 사용자가 자주 묻는 품목이므로 답변은 유지한다.
- 새 지자체 원문이나 공공기관 문서에서 직접 기준이 발견되면 `review.status`를 `verified` 또는 `region_review_needed`로 승격한다.
- 다음 데이터 보강은 새 quality seed 또는 실제 사용자 로그에서 `missing_item`, `bad_match`, `needs_source`, 낮은 confidence 항목을 다시 자동 백로그화해 진행한다.
