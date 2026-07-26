// Tests for the no-LLM answering path.
//
// This is what runs on any device without WebGPU, which in practice is most
// phones and every browser that has not shipped it. It used to be nineteen
// hardcoded substring branches; these tests pin the replacement: answers are
// assembled from retrieved passages with citations, and an unsupported question
// is refused rather than answered from the nearest passage.
//
// Run with: node --test test/fallback.test.mjs
import test, { before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
let fb;
let passages;

before(async () => {
  const out = mkdtempSync(join(tmpdir(), 'lampad-fb-'));
  const bundle = join(out, 'fallback.mjs');
  execFileSync(
    join(repo, 'node_modules/.bin/esbuild'),
    [join(repo, 'src/workers/fallback.ts'), '--bundle', '--format=esm', `--outfile=${bundle}`],
    { stdio: 'pipe' }
  );
  fb = await import(bundle);

  const dataBundle = join(out, 'data.mjs');
  execFileSync(
    join(repo, 'node_modules/.bin/esbuild'),
    [join(repo, 'src/data/index.ts'), '--bundle', '--format=esm', `--outfile=${dataBundle}`],
    { stdio: 'pipe' }
  );
  passages = (await import(dataBundle)).ALL_PASSAGES;
});

describe('INFO mode answering', () => {
  test('refuses when retrieval returned nothing', () => {
    assert.equal(fb.answerFromRetrieval('where is the shelter', []), fb.REFUSAL);
  });

  test('refuses when the retrieval worker marked the match ungrounded', () => {
    const p = passages.find(x => x.id === 'county-housing');
    const answer = fb.answerFromRetrieval('what is the capital of France', [
      { chunk: p.text, score: 0.9, grounded: false },
    ]);
    assert.equal(answer, fb.REFUSAL);
  });

  test('refuses when the query shares no vocabulary with the match', () => {
    const p = passages.find(x => x.id === 'county-food');
    // A high score alone must not be enough — this is the failure mode the old
    // embedder produced constantly.
    const answer = fb.answerFromRetrieval('who won the world cup in 1998', [
      { chunk: p.text, score: 0.95, grounded: true },
    ]);
    assert.equal(answer, fb.REFUSAL);
  });

  test('refuses on a below-threshold score', () => {
    const p = passages.find(x => x.id === 'county-housing');
    assert.equal(
      fb.answerFromRetrieval('shelter housing', [{ chunk: p.text, score: 0.01, grounded: true }]),
      fb.REFUSAL
    );
  });

  test('answers from the retrieved passage and cites it', () => {
    const p = passages.find(x => x.id === 'county-housing');
    const answer = fb.answerFromRetrieval('where can I find emergency shelter', [
      { chunk: p.text, score: 0.4, grounded: true },
    ]);
    assert.notEqual(answer, fb.REFUSAL);
    assert.ok(answer.includes('Here4You'), 'answer should contain the retrieved passage');
    assert.ok(answer.includes('Source:'), 'answer should carry a citation');
    assert.ok(answer.includes(p.url), 'answer should link the source');
  });

  test('a CFR-backed answer cites the regulation', () => {
    const p = passages.find(x => x.id === 'o1a-criteria');
    const answer = fb.answerFromRetrieval('what evidence do I need for an O-1A visa', [
      { chunk: p.text, score: 0.5, grounded: true },
    ]);
    assert.ok(answer.includes('8 CFR 214.2(o)(3)(iii)'), 'should cite the regulation');
    assert.ok(answer.includes('three of these eight'));
  });

  test('locally-sourced answers carry a staleness caveat, CFR answers do not', () => {
    const local = passages.find(x => x.id === 'county-health');
    const cfr = passages.find(x => x.id === 'f1-stem-opt');
    const localAnswer = fb.answerFromRetrieval('what clinic can I visit', [
      { chunk: local.text, score: 0.4, grounded: true },
    ]);
    const cfrAnswer = fb.answerFromRetrieval('how long is the STEM OPT extension', [
      { chunk: cfr.text, score: 0.4, grounded: true },
    ]);
    assert.match(localAnswer, /confirm before you rely on this/i);
    assert.doesNotMatch(cfrAnswer, /confirm before you rely on this/i);
  });

  test('never invents a phone number that is not in the retrieved passage', () => {
    const p = passages.find(x => x.id === 'county-emergency');
    const answer = fb.answerFromRetrieval('I need the police non emergency number', [
      { chunk: p.text, score: 0.4, grounded: true },
    ]);
    const numbersInAnswer = answer.match(/\(\d{3}\) \d{3}-\d{4}/g) || [];
    for (const n of numbersInAnswer) {
      assert.ok(p.text.includes(n), `answer contained ${n}, which is not in the retrieved passage`);
    }
  });
});

describe('LEARN mode answering', () => {
  test('selects the emergency lesson for an emergency question', () => {
    const lesson = fb.selectLesson('how do I call 911 for an ambulance');
    assert.equal(lesson.id, 'lesson-emergency-call');
  });

  test('selects the clinic lesson for a health question', () => {
    const lesson = fb.selectLesson('what do I say to the doctor about my fever');
    assert.equal(lesson.id, 'lesson-clinic-visit');
  });

  test('selects the pay lesson for a wage question', () => {
    const lesson = fb.selectLesson('my employer did not pay my wage for overtime hours');
    assert.equal(lesson.id, 'lesson-work-pay');
  });

  test('renders a full lesson with translations and grammar', () => {
    const answer = fb.answerLearnMode('how do I call 911');
    assert.ok(answer.includes('English Learning Corner'));
    assert.ok(answer.includes('Vocabulary & Translation'));
    assert.ok(answer.includes('Grammar Analysis'));
    // Spanish, Chinese and Vietnamese must all be present.
    assert.match(answer, /emergencia/);
    assert.match(answer, /[一-鿿]/, 'expected Chinese characters');
    assert.match(answer, /kh[ẩa]n c[ấa]p|c[ứa]u th[ưa]ơng|thông d[ịi]ch/u, 'expected Vietnamese');
  });

  test('always returns a lesson, even for an unrelated prompt', () => {
    const answer = fb.answerLearnMode('asdfghjkl');
    assert.ok(answer.includes('English Learning Corner'));
  });
});
