/**
 * 보류 발화 세트 생성기 (Kiwi 도입 검토용 스파이크).
 *
 * `evaluation-cases.json`은 매칭 규칙과 같이 다듬여 온 회귀 방어선이라 이미 324/324가
 * 통과한다. 그래서 그 세트로는 "조사·어미 처리를 형태소 분석기로 바꾸면 나아지는가"를
 * 잴 수 없다 — 천장에 붙어 있어서 깨지는 것만 보이고 좋아지는 건 안 보인다.
 *
 * 여기서는 품목명(별칭 말고 대표명)을 실제 발화 틀에 끼워 넣어 보류 세트를 만든다.
 * 사람이 고른 문장이 아니라 데이터에서 기계적으로 파생시킨 문장이라, 규칙을 그 문장에
 * 맞춰 튜닝한 적이 없다는 점이 핵심이다.
 */

/** 받침이 있으면 true. 한글 음절이 아니면(영문·숫자로 끝나면) 받침 있는 쪽으로 친다. */
export function hasBatchim(word: string): boolean {
  const last = word.trim().at(-1);
  if (!last) return false;

  const code = last.codePointAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return true;
  return (code - 0xac00) % 28 !== 0;
}

function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  return word + (hasBatchim(word) ? withBatchim : withoutBatchim);
}

export type UtteranceTemplate = {
  id: string;
  /** 발화를 만든다. 조사는 품목명 받침에 맞춰 고른다. */
  build: (name: string) => string;
};

export const UTTERANCE_TEMPLATES: UtteranceTemplate[] = [
  { id: "how", build: (n) => `${n} 어떻게 버려요?` },
  { id: "where", build: (n) => `${josa(n, "은", "는")} 어디에 버리나요?` },
  { id: "recyclable", build: (n) => `${n} 분리수거 되나요?` },
  { id: "subject", build: (n) => `${josa(n, "이", "가")} 재활용이 되는지 궁금해요` },
  { id: "object", build: (n) => `${josa(n, "을", "를")} 버리려는데 어떻게 해야 하나요` },
  { id: "also", build: (n) => `${n}도 종량제봉투에 넣어도 되나요?` },
  { id: "demonstrative", build: (n) => `이 ${n} 처리 방법 알려줘` },
  { id: "topic_only", build: (n) => `${josa(n, "은", "는")}요?` },
  { id: "method", build: (n) => `${n} 버리는 법` },
  { id: "until", build: (n) => `${n}까지 같이 버려도 되나요?` },
];
