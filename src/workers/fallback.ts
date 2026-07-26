import { LESSONS, type Lesson } from '../data/lessons';
import { PASSAGE_BY_TEXT } from '../data';
import { buildIdf, cosineSimilarity, hasContentOverlap, lexicalEmbedding } from '../lib/text';

/**
 * The engine that answers when the on-device LLM is unavailable.
 *
 * This used to be nineteen hardcoded `prompt.includes('shelter')` branches
 * returning canned paragraphs, which meant that on any device without WebGPU
 * the "AI" was a lookup table — and one of those canned paragraphs contained a
 * phone number that did not exist.
 *
 * Now it answers *from retrieval*: the passages handed in were selected by the
 * embedding model (MiniLM when available, the lexical embedder otherwise), and
 * the answer is assembled from those passages with their citations attached.
 * If nothing relevant was retrieved it refuses, which is what the README has
 * always claimed the app does.
 */

export interface RetrievedMatch {
  chunk: string;
  score: number;
  /** False when the lexical fallback matched without any shared vocabulary. */
  grounded?: boolean;
}

export const REFUSAL =
  'I am an immigration assistant and that information is not in my local survival guide.';

/** Minimum cosine score to treat a match as usable at all. */
const MIN_SCORE = 0.08;

function usableMatches(prompt: string, matches: RetrievedMatch[]): RetrievedMatch[] {
  return matches.filter(
    m =>
      m &&
      typeof m.chunk === 'string' &&
      m.chunk.trim().length > 0 &&
      m.score >= MIN_SCORE &&
      // `grounded` is set by the retrieval worker for lexical matches. When the
      // real embedding model ran it is true, and we still require that the
      // question and the passage share some vocabulary before answering.
      (m.grounded ?? true) &&
      hasContentOverlap(prompt, m.chunk)
  );
}

/** Render a retrieved passage plus the citation that makes it checkable. */
function citeMatch(match: RetrievedMatch): string {
  const passage = PASSAGE_BY_TEXT.get(match.chunk);
  if (!passage) return match.chunk;

  const cite = passage.citation
    ? `${passage.source}, ${passage.citation}`
    : passage.source;
  const caveat =
    passage.verifiedBy === 'needs-review'
      ? ' *Details such as hours and phone numbers change — confirm before you rely on this.*'
      : '';

  return `${match.chunk}\n\n> Source: ${cite} — ${passage.url}${caveat}`;
}

/**
 * INFO mode: answer strictly from what retrieval returned.
 */
export function answerFromRetrieval(prompt: string, matches: RetrievedMatch[]): string {
  const usable = usableMatches(prompt, matches);
  if (usable.length === 0) return REFUSAL;

  const top = usable.slice(0, 2);
  const body = top.map(citeMatch).join('\n\n---\n\n');

  const header =
    top.length > 1
      ? `Here is what my local guide says, from ${top.length} matching entries:`
      : 'Here is what my local guide says:';

  return `${header}\n\n${body}\n\nIf this is an emergency, call 911. For county referrals in many languages, dial 211.`;
}

// ---------------------------------------------------------------------------
// LEARN mode
// ---------------------------------------------------------------------------

/** Text used to index each lesson for retrieval. */
function lessonSearchText(lesson: Lesson): string {
  return [
    lesson.title,
    lesson.scenario,
    lesson.objective,
    ...lesson.vocabulary.map(v => v.en),
    ...lesson.phrases.map(p => p.en),
  ].join(' ');
}

const LESSON_CORPUS = LESSONS.map(lessonSearchText);
const LESSON_IDF = buildIdf(LESSON_CORPUS);
const LESSON_VECTORS = LESSON_CORPUS.map(t => lexicalEmbedding(t, LESSON_IDF));

/** Pick the lesson closest to what the learner asked about. */
export function selectLesson(prompt: string): Lesson {
  const queryVec = lexicalEmbedding(prompt, LESSON_IDF);
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < LESSON_VECTORS.length; i++) {
    const score = cosineSimilarity(queryVec, LESSON_VECTORS[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return LESSONS[bestIndex];
}

/**
 * LEARN mode: render a real lesson rather than a fixed translation stub.
 */
export function renderLesson(prompt: string, lesson: Lesson): string {
  const cleaned = prompt.trim();
  const vocab = lesson.vocabulary
    .slice(0, 4)
    .map(v => `*   **${v.en}** — ${v.es} (es) / ${v.zh} (zh) / ${v.vi} (vi)${v.note ? ` — ${v.note}` : ''}`)
    .join('\n');
  const phrases = lesson.phrases
    .slice(0, 3)
    .map(p => `*   "${p.en}"\n    ${p.es} / ${p.zh} / ${p.vi}`)
    .join('\n');
  const dialogue = lesson.dialogue.map(d => `*   **${d.speaker}:** ${d.line}`).join('\n');
  const practice = lesson.practice.map(p => `*   ${p}`).join('\n');

  return `You asked: "${cleaned}"

The closest lesson in your offline pack is **${lesson.title}** (level ${lesson.level}).
Use it when: ${lesson.scenario}
Goal: ${lesson.objective}

### 🌸 English Learning Corner

**1. Vocabulary & Translation**
${vocab}

**2. Phrases you can use today**
${phrases}

**3. Practice dialogue**
${dialogue}

**4. Grammar Analysis — ${lesson.grammar.point}**
${lesson.grammar.explanation}
${lesson.grammar.examples.map(e => `*   ${e}`).join('\n')}

**5. Try it yourself**
${practice}`;
}

export function answerLearnMode(prompt: string): string {
  return renderLesson(prompt, selectLesson(prompt));
}
