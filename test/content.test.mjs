// Content safety tests for the answers the app can produce without a model.
// The keyword-fallback engine ships canned text; anything it presents as a
// real-world contact has to be real, because someone in distress will dial it.
// Run with: node --test test/content.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worker = readFileSync(fileURLToPath(new URL('../src/workers/inference.worker.ts', import.meta.url)), 'utf8');
const passages = readFileSync(fileURLToPath(new URL('../src/data/passages.ts', import.meta.url)), 'utf8');

test('no fictional 555-01xx phone numbers are presented as real contacts', () => {
  const fictional = worker.match(/\(?\d{3}\)?[ -]?555-01\d{2}/g) || [];
  assert.deepEqual(fictional, [], `fallback responses cite fictional numbers: ${fictional.join(', ')}`);
});

test('grounded emergency and housing answers cite only sourced hotlines', () => {
  // Numbers that may appear without being in passages.ts: nationwide services.
  const nationwide = new Set(['911', '988', '211']);
  const cited = worker.match(/\(\d{3}\) \d{3}-\d{4}/g) || [];
  const unsourced = cited.filter(n => {
    const local = n.slice(-8); // "586-2400"
    return !nationwide.has(n) && !passages.includes(local) && !KNOWN_PUBLIC.has(n);
  });
  assert.deepEqual(unsourced, [], `these numbers appear in answers but in no knowledge passage: ${unsourced.join(', ')}`);
});

// Real, publicly listed numbers that are intentionally offered outside the
// seeded passages. Adding to this list is a deliberate editorial act.
const KNOWN_PUBLIC = new Set([
  '(408) 321-2300', // VTA customer service
]);
