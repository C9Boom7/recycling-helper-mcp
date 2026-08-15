/**
 * 질의를 "품목 정체성을 담을 수 있는 조각"으로 자르는 지점.
 *
 * 짧은 별칭(2글자 이하)은 문장 어디에 박혀 있든 걸리면 안 되고 독립된 낱말로
 * 나왔을 때만 인정한다(`hasStandaloneShortAliasMatch`). 165개 이름·별칭이 이
 * 경로를 타므로 "낱말 경계를 어디로 보느냐"가 매칭 품질을 크게 좌우한다.
 *
 * 한국어는 조사가 낱말에 붙어 나오므로, 문자/숫자가 아닌 곳에서만 자르면
 * "칫솔은요?"에서 `칫솔`을 못 꺼낸다. 형태소 분석기(Kiwi)를 붙여서 재 봤고,
 * 조사를 반복해서 떼는 규칙이 같은 점수를 냈다 — 보류 발화 3,240건에서 둘 다
 * 100%, 결과가 한 건도 다르지 않았다. 분석기는 상주 메모리를 85MB에서 918MB로
 * 올리는데 파드 한도가 512Mi라 그 값을 치를 이유가 없다. 측정은
 * `scripts/spike/`에 남겨 뒀다.
 *
 * 교체 지점은 그 측정을 위해 열어 둔 것이다. 제약이 바뀌면 다시 재 보면 된다.
 */

/** 질의를 낱말 후보들로 자른다. 정규화는 호출부가 한다. */
export type QueryTokenizer = (query: string) => string[];

export const splitOnNonWordBoundary: QueryTokenizer = (query) => query.toLowerCase().split(/[^\p{L}\p{N}]+/gu);

/**
 * 어절 끝에 붙는 조사·종결어미. 이전 `stripShortAliasParticle`의 목록에서 두 가지가
 * 달라졌다.
 *
 *  1. 겹쳐 붙은 걸 끝까지 뗀다 — `칫솔은요` = `칫솔` + `은` + `요`. 한 번만 떼던
 *     기존 방식은 `칫솔은`에서 멈춰 `칫솔`을 못 만들었다.
 *  2. 보조사를 넓게 본다 — `까지`, `부터`, `만`, `밖에` 같은 게 목록에 없었다.
 *
 * `과`/`와`는 일부러 뺐다. `약과`(과자)에서 `과`를 조사로 떼면 `약`이 남아 의약품
 * 별칭에 걸린다. 접속조사까지 규칙으로 처리하려면 낱말을 알아야 하는데, 그건
 * 규칙이 아니라 사전이 할 일이다.
 */
const TRAILING_PARTICLES = [
  "이라도",
  "으로는",
  "이랑은",
  "에서는",
  "한테는",
  "에게는",
  "밖에",
  "부터",
  "까지",
  "조차",
  "마저",
  "처럼",
  "보다",
  "에서",
  "에게",
  "한테",
  "이랑",
  "으로",
  "라도",
  "이나",
  "이란",
  "이든",
  "인가",
  "예요",
  "이야",
  "이요",
  "는요",
  "은요",
  "랑",
  "로",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "에",
  "도",
  "만",
  "의",
  "야",
  "요",
  "죠",
  "지",
  "나",
  "뿐",
];

/**
 * 조사를 하나씩 떼면서 나오는 **모든 중간 형태**를 돌려준다. 원형이 맨 앞이다.
 *
 * 마지막 형태만 남기면 안 된다. 규칙은 조사와 낱말 꼬리를 구별하지 못해서 알맹이를
 * 지나쳐 깎아낸다 — `벽지는요`는 `벽지`를 거쳐 `벽`까지 가고, `난로는요`는 `난`까지
 * 간다. 어디서 멈춰야 하는지는 품목 목록만 알고 있으므로, 판단은 부르는 쪽에
 * 넘기고 여기서는 후보만 다 늘어놓는다.
 */
export function particleStrippedForms(word: string): string[] {
  const forms = [word];
  let current = word;
  let stripped = true;

  while (stripped) {
    stripped = false;
    for (const particle of TRAILING_PARTICLES) {
      // 남는 알맹이가 최소 한 글자는 되어야 한다 — `요`(이불) 같은 한 글자 별칭이
      // 조사만 남은 껍데기에서 튀어나오면 안 된다.
      if (current.length > particle.length && current.endsWith(particle)) {
        current = current.slice(0, -particle.length);
        forms.push(current);
        stripped = true;
        break;
      }
    }
  }

  return forms;
}

/** 어절을 자르고, 조사를 떼어 가며 나오는 중간 형태를 모두 후보로 내보낸다. */
export const splitAndStripParticles: QueryTokenizer = (query) =>
  splitOnNonWordBoundary(query).flatMap((word) => (word ? particleStrippedForms(word) : []));

let activeTokenizer: QueryTokenizer = splitAndStripParticles;

export function tokenizeQuery(query: string): string[] {
  return activeTokenizer(query);
}

/** 형태소 분석기가 준비되면 갈아 끼운다. 되돌리려면 기본 구현을 다시 넘긴다. */
export function setQueryTokenizer(tokenizer: QueryTokenizer): void {
  activeTokenizer = tokenizer;
}
