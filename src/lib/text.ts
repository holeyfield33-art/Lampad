/**
 * Shared text handling for the retrieval fallback.
 *
 * The retrieval worker embeds with MiniLM when it can download it. When it
 * cannot — no network, locked-down device, first run offline — it falls back to
 * the lexical embedder below. That fallback is a keyword matcher, not a
 * semantic one, so it needs an explicit guard against confidently retrieving an
 * unrelated passage. `hasContentOverlap` is that guard, and it is shared with
 * the tests so the measured behaviour is the shipped behaviour.
 */

export const EMBEDDING_DIM = 384;

/** High-frequency English words that carry no retrieval signal. */
const STOPWORDS = new Set(
  ('a an the and or but if then than so of to in on at by for with from as is are was were be been being ' +
    'do does did doing have has had having i you he she it we they me him her us them my your his its our their ' +
    'this that these those what which who whom when where why how can could will would shall should may might must ' +
    'not no yes there here about into over under again further once all any both each few more most other some ' +
    'such only own same too very just now need want please').split(' ')
);

/**
 * Content words only: lowercase, punctuation stripped, stopwords removed.
 * Unicode-aware so non-English queries still produce tokens.
 */
export function contentTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Retrieval features: content words plus character trigrams. The trigrams let
 * "visa"/"visas" and "petition"/"petitions" match, and give non-English input
 * something to match on when the multilingual model is unavailable.
 */
export function features(text: string): string[] {
  const out: string[] = [];
  for (const w of contentTerms(text)) {
    out.push(w);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) out.push('#' + padded.slice(i, i + 3));
  }
  return out;
}

/** FNV-1a. Cheap, well-distributed, and stable across runs. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export type Idf = Map<string, number>;

/** Inverse document frequency over the indexed corpus. */
export function buildIdf(documents: string[]): Idf {
  const df = new Map<string, number>();
  for (const doc of documents) {
    for (const f of new Set(features(doc))) df.set(f, (df.get(f) || 0) + 1);
  }
  const n = documents.length;
  const idf: Idf = new Map();
  for (const [f, count] of df) idf.set(f, Math.log((n + 1) / (count + 0.5)));
  return idf;
}

/**
 * IDF-weighted signed feature hashing, L2-normalised.
 *
 * Signed hashing matters: the previous implementation accumulated only positive
 * counts, so hash collisions could only ever inflate similarity, and common
 * words dominated every vector. With signs, collisions cancel on average
 * instead of compounding.
 */
export function lexicalEmbedding(text: string, idf?: Idf): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIM);
  const feats = features(text);

  if (feats.length === 0) {
    // No content words at all: return a constant unit vector, which scores
    // near-identically against everything and so retrieves nothing meaningful.
    vector.fill(1 / Math.sqrt(EMBEDDING_DIM));
    return vector;
  }

  const termFreq = new Map<string, number>();
  for (const f of feats) termFreq.set(f, (termFreq.get(f) || 0) + 1);

  for (const [term, count] of termFreq) {
    const h = hash32(term);
    const index = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    const weight = (1 + Math.log(count)) * (idf?.get(term) ?? 1);
    vector[index] += sign * weight;
  }

  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) sumSq += vector[i] * vector[i];
  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) vector[i] /= magnitude;
  }
  return vector;
}

/**
 * Does the query actually share vocabulary with this passage?
 *
 * A lexical embedder will always return a nearest neighbour, however unrelated
 * — "what is the capital of France" scored 0.43 against a food-pantry passage
 * before this guard existed. Requiring a shared content word of real length
 * turns that into a refusal instead of a confident wrong answer.
 */
export function hasContentOverlap(query: string, passage: string, minLength = 3): boolean {
  const passageTerms = new Set(contentTerms(passage));
  return contentTerms(query).some(t => t.length >= minLength && passageTerms.has(t));
}

/** Cosine similarity of two L2-normalised vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}
