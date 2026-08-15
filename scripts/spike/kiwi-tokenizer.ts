/**
 * Kiwi(형태소 분석기) 기반 질의 토크나이저 — 도입 검토용 스파이크.
 *
 * `kiwi-nlp`는 아직 프로젝트 의존성이 아니다. 모델 파일이 100MB대라 이미지에 넣을지
 * 부터가 이 스파이크로 판단할 문제여서, 설치는 워크트리 밖에 해 두고 경로만 받는다.
 *
 *   KIWI_SPIKE_DIR=/path/to/kiwi-spike pnpm tsx scripts/spike/measure-with-kiwi.ts
 *
 * 그 디렉터리에 `node_modules/kiwi-nlp`와 `model/models/cong/base/`가 있어야 한다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { QueryTokenizer } from "../../src/korean/query-tokenizer.ts";
import { wasteItems } from "../../src/data.ts";

/**
 * 모델 배포본마다 디렉터리 모양이 다르다. v0.22부터는 `models/cong/base/`에 신경망
 * 모델(cong)이 들어 있고, v0.21까지는 `base/`에 knlm/skipbigram이 들어 있다.
 * 둘 다 재볼 수 있어야 해서 배치를 찾아서 그 안의 파일을 통째로 넘긴다.
 */
function findModelDir(spikeDir: string): string {
  const candidates = [join(spikeDir, "model/models/cong/base"), join(spikeDir, "model/base"), join(spikeDir, "model")];
  const found = candidates.find((candidate) => existsSync(join(candidate, "sj.morph")));
  if (!found) throw new Error(`no Kiwi model directory under ${spikeDir} (looked for sj.morph)`);
  return found;
}

/**
 * 품목 정체성을 담을 수 있는 품사만 남긴다. 조사(J*)·어미(E*)·용언(V*)은 버린다.
 * 어근(XR)과 접두·접미사(XPN/XSN)를 남기는 건 "폐의약품"이 `폐/XPN + 의약품/NNG`으로
 * 갈리는 것처럼 품목명 조각이 접사로 태깅되는 경우가 있어서다.
 */
const CONTENT_TAGS = new Set(["NNG", "NNP", "NNB", "NR", "SL", "SH", "SN", "XR", "XPN", "XSN"]);

type KiwiToken = { str: string; tag: string; wordPosition: number };
type KiwiInstance = { tokenize: (text: string, matchOptions?: number) => KiwiToken[] };

/**
 * 어절 단위로 다시 붙인다. 형태소를 낱낱이 내보내면 안 된다 — 짧은 별칭 독립 토큰
 * 검사가 복합어 **속**에서 걸리기 때문이다. "변기솔"이 `변기 + 솔`로 갈리면 `변기`가
 * 낱말로 잡혀 변기(toilet_bowl) 답이 나가고, 정작 물어본 변기솔은 사라진다.
 *
 * 여기서 분석기에 시킬 일은 "복합어 쪼개기"가 아니라 "조사·어미 떼기"다. 그래서
 * 한 어절 안의 실질 형태소는 원래대로 이어 붙이고, 뒤에 붙은 조사·어미만 버린다.
 *   칫솔은요   -> 칫솔/NNG 은/JX 요/EF        -> "칫솔"
 *   변기솔은   -> 변기/NNG 솔/NNG 은/JX       -> "변기솔"
 *   폐의약품   -> 폐/XPN 의약품/NNG           -> "폐의약품"
 */
function joinWordsDroppingParticles(tokens: KiwiToken[]): string[] {
  const words: string[] = [];
  let currentPosition = -1;
  let current = "";

  const flush = (): void => {
    if (current) words.push(current);
    current = "";
  };

  for (const token of tokens) {
    if (token.wordPosition !== currentPosition) {
      flush();
      currentPosition = token.wordPosition;
    }

    if (CONTENT_TAGS.has(token.tag)) current += token.str;
  }

  flush();
  return words;
}

/**
 * 품목명·별칭을 사용자 사전에 넣는다. 안 넣으면 분석기가 일반 어휘 기준으로 쪼개서
 * `닭뼈`가 `닭 + 뼈`, `티백`이 `티 + 백`이 된다 — 우리 데이터에서는 한 낱말이다.
 *
 * 한 글자짜리는 절대 넣지 않는다. 별칭에는 `요`(이불), `약`(의약품), `옷`, `칼`처럼
 * 한 글자가 여럿 있는데, 이걸 명사로 등록하면 분석기가 종결어미 `요`와 조사를
 * 명사로 읽는다 — "칫솔은요?"가 `칫솔 + 은 + 요(이불)`로 갈려 이불 답이 나왔다.
 * 이 별칭들은 사전에 없어도 띄어쓰기로 떨어져 나오면 독립 토큰 검사가 잡는다.
 */
/**
 * 품목이 아닌데 사전에 넣어야 하는 낱말. 분석기가 이걸 쪼개면 그 조각이 우리 짧은
 * 별칭과 겹쳐 엉뚱한 품목으로 확정된다. `약과`(과자)는 `약/NNG + 과/JC`로 갈려
 * `약`(의약품) 별칭에 걸린다 — "약과 포장지는 폐의약품 수거함에 넣어?"가 의약품
 * 안내를 받는다. 되묻거나 재질 폴백으로 가는 게 맞는 질의다.
 *
 * 짧은 별칭이 165개나 되니 이런 충돌은 더 나올 수 있다. 발화 로그에서 잡히는 대로
 * 여기 채우는 수밖에 없고, 이게 Kiwi를 넣어도 남는 유지보수 비용이다.
 */
const NON_ITEM_WORDS = ["약과"];

function itemUserWords(): Array<{ word: string; tag: string; score: number }> {
  const words = new Set<string>(NON_ITEM_WORDS);
  for (const item of wasteItems) {
    for (const name of [item.name, ...item.aliases]) {
      const trimmed = name.trim();
      // 문장형 별칭("곰팡이 핀 빵은 음식물쓰레기야")은 낱말이 아니라 사전에 넣지 않는다.
      if (/\s/.test(trimmed) || trimmed.length > 10) continue;
      if (trimmed.length < 2) continue;
      words.add(trimmed);
    }
  }

  return Array.from(words, (word) => ({ word, tag: "NNG", score: 3 }));
}

export type KiwiTokenizerHandle = {
  tokenizer: QueryTokenizer;
  loadMs: number;
  analyze: (query: string) => KiwiToken[];
};

export async function createKiwiTokenizer(options: { userDictionary: boolean }): Promise<KiwiTokenizerHandle> {
  const spikeDir = process.env.KIWI_SPIKE_DIR;
  if (!spikeDir) throw new Error("KIWI_SPIKE_DIR is not set — see the comment at the top of this file");

  const started = Date.now();
  const moduleUrl = pathToFileURL(join(spikeDir, "node_modules/kiwi-nlp/dist/index.js")).href;
  const { KiwiBuilder, Match } = (await import(moduleUrl)) as {
    KiwiBuilder: { create: (wasmPath: string) => Promise<{ build: (args: unknown) => Promise<KiwiInstance> }> };
    Match: Record<string, number>;
  };

  const builder = await KiwiBuilder.create(join(spikeDir, "node_modules/kiwi-nlp/dist/kiwi-wasm.wasm"));
  const modelDir = findModelDir(spikeDir);
  const modelFiles: Record<string, Uint8Array> = {};
  for (const name of readdirSync(modelDir)) {
    modelFiles[name] = readFileSync(join(modelDir, name));
  }

  const kiwi = await builder.build({
    modelFiles,
    ...(options.userDictionary ? { userWords: itemUserWords() } : {}),
  });
  const loadMs = Date.now() - started;

  const matchOptions = Match.allWithNormalizing;
  const analyze = (query: string): KiwiToken[] => kiwi.tokenize(query, matchOptions);

  const tokenizer: QueryTokenizer = (query) => joinWordsDroppingParticles(analyze(query));

  return { tokenizer, loadMs, analyze };
}
