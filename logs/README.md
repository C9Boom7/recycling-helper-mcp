# Query Logs

이 폴더는 로컬 테스트나 실제 사용자 질문에서 발견한 애매한 질문을 임시로 쌓는 곳이다.

실제 로그 파일은 개인정보나 원문 민감정보가 들어갈 수 있으므로 Git에 커밋하지 않는다. `.gitignore`는 `logs/*.jsonl`을 무시하고, 예시 파일만 추적한다.

## Append A Query

```bash
pnpm log:query -- --query "요가매트는 어떻게 버려?" --region "서울 강남구" --answer "bad_match" --note "이불의 짧은 별칭 요로 과매칭됨"
```

기본 출력 파일:

```text
logs/manual-queries.jsonl
```

## Generate Backlog Candidates

먼저 dry-run으로 확인한다.

```bash
pnpm backlog:auto -- --input logs/manual-queries.jsonl --region "서울 강남구"
```

후보가 적절하면 저장한다.

```bash
pnpm backlog:auto -- --input logs/manual-queries.jsonl --region "서울 강남구" --write
pnpm backlog:questions
pnpm check
```

## Quality Seed Queries

`logs/quality-seed-queries.example.jsonl`은 실제 사용자 질문처럼 만든 재현용 품질 seed다.
개인정보가 없는 합성 질문만 넣고, 자동 백로그 루틴과 매칭 품질을 반복 검증할 때 사용한다.
현재 seed는 88개 질문이며, dry-run에서 후보를 확인한 뒤 필요한 경우에만 `--write`로 `src/data/question-backlog.json`에 저장한다.

```bash
pnpm backlog:auto:quality
pnpm backlog:auto:quality -- --write
pnpm backlog:questions
```

실제 사용자 로그는 `logs/manual-queries.jsonl`처럼 `.example.jsonl`이 아닌 파일에 쌓고 커밋하지 않는다.

## JSONL Fields

- `createdAt`: ISO timestamp
- `query`: 사용자 질문 원문
- `region`: 지역이 있으면 기록
- `source`: `manual-test`, `playmcp-manual`, `user-session` 등
- `tool`: 테스트한 MCP tool 이름
- `answer`: `unknown`, `missing_item`, `bad_match`, `unclear`, `missing_condition`, `missing_region`, `ok_but_low_confidence` 등 짧은 판정
- `backlogType`: 필요하면 `new_item_candidate`, `synonym_gap`, `answer_gap`, `region_gap`, `source_gap`, `condition_gap` 중 하나로 강제 지정
- `notes`: 사람이 보는 메모 배열

질문 로그에는 이름, 전화번호, 주소 상세, 계정 정보 같은 민감정보를 넣지 않는다.
