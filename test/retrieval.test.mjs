// Retrieval quality tests for the lexical fallback.
//
// This is the path every device without WebGPU or without network takes, so
// "it degrades gracefully" has to mean something measurable. These tests pin
// top-1 accuracy on a labelled query set and, more importantly, pin the
// refusal behaviour: an off-topic question must not be answered from whichever
// passage happened to win the similarity contest.
//
// Run with: node --test test/retrieval.test.mjs
import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Compile lib/text.ts to JS so the test exercises the shipped implementation
// rather than a copy of it.
const repo = fileURLToPath(new URL('..', import.meta.url));
let text;

before(async () => {
  const out = mkdtempSync(join(tmpdir(), 'lampad-text-'));
  execFileSync(
    join(repo, 'node_modules/.bin/esbuild'),
    [join(repo, 'src/lib/text.ts'), '--format=esm', `--outfile=${join(out, 'text.mjs')}`],
    { stdio: 'pipe' }
  );
  text = await import(join(out, 'text.mjs'));
});

function passageTexts(file) {
  const src = readFileSync(join(repo, file), 'utf8');
  return [...src.matchAll(/^      text:\s*'((?:[^'\\]|\\.)*)',$/gm)].map(m => m[1].replace(/\\'/g, "'"));
}

// (query, a distinctive string that must appear in the correct passage)
const LABELLED = [
  ['Where can I find emergency shelter in Milpitas?', 'Here4You'],
  ['How do I call the police non emergency line', 'Milpitas Police'],
  ['how long is OPT for a STEM degree', '24 months'],
  ['can I get a green card without a job offer', 'does not require a job offer'],
  ['do I need a lawyer or is a notario ok', 'notario'],
  ['how do I check my case status', 'receipt notice'],
  ['can my child go to school without documents', 'free public education'],
  ['my boss did not pay me for my hours', 'Labor Commissioner'],
  ['how do I take the bus to san jose', 'VTA'],
  ['what are the O-1A evidence criteria', 'three of these eight'],
];

const OFF_TOPIC = [
  'what is the capital of France',
  'write me a poem about the ocean',
  'how do I bake sourdough bread',
  "'; DROP TABLE users--",
  '../../../etc/passwd',
  'who won the world cup in 1998',
  'tell me a joke about cats',
];

describe('lexical retrieval fallback', () => {
  let corpus, idf, vecs;

  before(() => {
    corpus = [
      ...passageTexts('src/data/bundles/county.ts'),
      ...passageTexts('src/data/bundles/immigration.ts'),
    ];
    assert.ok(corpus.length >= 18, `expected the full corpus, got ${corpus.length}`);
    idf = text.buildIdf(corpus);
    vecs = corpus.map(c => text.lexicalEmbedding(c, idf));
  });

  const rank = q => {
    const qv = text.lexicalEmbedding(q, idf);
    return vecs
      .map((v, i) => ({ i, score: text.cosineSimilarity(qv, v) }))
      .sort((a, b) => b.score - a.score);
  };

  test('top-1 retrieval accuracy on the labelled set is at least 70%', () => {
    let hits = 0;
    const misses = [];
    for (const [query, marker] of LABELLED) {
      const best = corpus[rank(query)[0].i];
      if (best.includes(marker)) hits++;
      else misses.push(`"${query}" -> ${best.slice(0, 60)}...`);
    }
    const accuracy = hits / LABELLED.length;
    assert.ok(
      accuracy >= 0.7,
      `top-1 accuracy ${(accuracy * 100).toFixed(0)}% (${hits}/${LABELLED.length}). Misses:\n  ${misses.join('\n  ')}`
    );
  });

  // The important one. Without this guard the fallback answers every question,
  // including ones the corpus knows nothing about.
  test('off-topic queries share no content vocabulary with their best match', () => {
    const leaked = [];
    for (const query of OFF_TOPIC) {
      const best = corpus[rank(query)[0].i];
      if (text.hasContentOverlap(query, best)) {
        leaked.push(`"${query}" overlapped with: ${best.slice(0, 70)}...`);
      }
    }
    assert.deepEqual(leaked, [], `off-topic queries would be answered:\n  ${leaked.join('\n  ')}`);
  });

  test('on-topic queries do share content vocabulary with their best match', () => {
    const ungrounded = [];
    for (const [query] of LABELLED) {
      const best = corpus[rank(query)[0].i];
      if (!text.hasContentOverlap(query, best)) ungrounded.push(query);
    }
    assert.deepEqual(ungrounded, [], `these on-topic queries would be wrongly refused: ${ungrounded.join(', ')}`);
  });

  test('empty and whitespace queries produce no content terms', () => {
    for (const q of ['', '   ', '\n\t']) {
      assert.deepEqual(text.contentTerms(q), [], `"${q}" produced terms`);
    }
  });

  test('embeddings are unit length and the right dimension', () => {
    for (const sample of [corpus[0], 'short query', '🚨 emergencia refugio', '']) {
      const v = text.lexicalEmbedding(sample, idf);
      assert.equal(v.length, 384);
      let sumSq = 0;
      for (const x of v) sumSq += x * x;
      assert.ok(Math.abs(Math.sqrt(sumSq) - 1) < 1e-5, `not unit length for "${sample.slice(0, 20)}"`);
    }
  });

  test('stopword-only queries do not retrieve anything grounded', () => {
    for (const q of ['how do I', 'what is the', 'can you please']) {
      const best = corpus[rank(q)[0].i];
      assert.equal(text.hasContentOverlap(q, best), false, `"${q}" was treated as grounded`);
    }
  });
});
