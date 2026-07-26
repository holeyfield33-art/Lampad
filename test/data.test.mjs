// Integrity tests for the knowledge bundles.
//
// The app answers questions where a confident wrong answer causes real harm, so
// these tests are the gate: a passage that cannot name its source, or that
// asserts a number the regulation does not contain, fails the build.
//
// Run with: node --test test/data.test.mjs
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const excerpts = JSON.parse(read('../src/data/sources/cfr-excerpts.json'));
const countySrc = read('../src/data/bundles/county.ts');
const immigrationSrc = read('../src/data/bundles/immigration.ts');

// The bundles are TypeScript, so parse the fields we assert on out of the source
// rather than standing up a TS loader for a data check.
function parsePassages(src) {
  const out = [];
  const blocks = src.split(/\n    \{\n/).slice(1);
  for (const block of blocks) {
    const field = name => {
      const m = block.match(new RegExp(`      ${name}: ('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"),`));
      return m ? m[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"') : undefined;
    };
    const list = name => {
      const m = block.match(new RegExp(`      ${name}: \\[([\\s\\S]*?)\\],`));
      if (!m) return undefined;
      return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1].replace(/\\'/g, "'"));
    };
    out.push({
      id: field('id'),
      topic: field('topic'),
      text: field('text'),
      source: field('source'),
      citation: field('citation'),
      url: field('url'),
      verified: field('verified'),
      verifiedBy: field('verifiedBy'),
      provenanceKeys: list('provenanceKeys'),
    });
  }
  return out.filter(p => p.id);
}

const county = parsePassages(countySrc);
const immigration = parsePassages(immigrationSrc);
const all = [...county, ...immigration];

describe('knowledge bundles', () => {
  test('bundles are non-empty and parsed', () => {
    assert.ok(county.length >= 8, `county bundle parsed ${county.length} passages`);
    assert.ok(immigration.length >= 10, `immigration bundle parsed ${immigration.length} passages`);
  });

  test('every passage has an id, source, url and verification date', () => {
    for (const p of all) {
      assert.ok(p.text && p.text.length > 80, `${p.id}: text missing or too short`);
      assert.ok(p.source, `${p.id}: no source`);
      assert.match(p.url || '', /^https:\/\//, `${p.id}: url must be https`);
      assert.match(p.verified || '', /^\d{4}-\d{2}-\d{2}$/, `${p.id}: bad verified date`);
      assert.ok(
        ['primary-source', 'needs-review'].includes(p.verifiedBy),
        `${p.id}: verifiedBy must be primary-source or needs-review, got ${p.verifiedBy}`
      );
    }
  });

  test('passage ids are unique', () => {
    const ids = all.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids.join(', ')}`);
  });

  test('no fictional 555-01xx phone numbers anywhere in the corpus', () => {
    const bad = all.flatMap(p => (p.text.match(/\(?\d{3}\)?[ -]?555-01\d{2}/g) || []).map(n => `${p.id}: ${n}`));
    assert.deepEqual(bad, [], `fictional numbers in the knowledge base: ${bad.join(', ')}`);
  });

  // The heart of it: a plain-language summary of a regulation must not drift
  // away from the regulation. Each cited excerpt has to exist, and the numbers
  // the summary asserts have to appear in the verbatim text.
  test('every primary-source passage cites an excerpt that exists', () => {
    for (const p of immigration.filter(x => x.verifiedBy === 'primary-source')) {
      assert.ok(p.provenanceKeys?.length, `${p.id}: primary-source but no provenanceKeys`);
      for (const key of p.provenanceKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(excerpts, key),
          `${p.id}: cites missing excerpt "${key}"`
        );
        assert.ok(excerpts[key].length > 100, `${p.id}: excerpt "${key}" is suspiciously short`);
      }
    }
  });

  test('any passage citing 8 CFR must be backed by a primary-source excerpt', () => {
    for (const p of all) {
      if (p.citation?.includes('8 CFR')) {
        assert.equal(p.verifiedBy, 'primary-source', `${p.id}: cites CFR but is not primary-source`);
      }
    }
  });

  // Specific numbers, checked against the verbatim regulation text. These are
  // the claims that would do the most damage if they were wrong.
  const claims = [
    ['O-1A requires at least three forms of documentation',
      '8 CFR 214.2(o)(3)(iii) O-1A evidentiary criteria', 'At least three of the following'],
    ['O-1A lists exactly eight criteria',
      '8 CFR 214.2(o)(3)(iii) O-1A evidentiary criteria', '(8)'],
    ['O-1A has no ninth criterion',
      '8 CFR 214.2(o)(3)(iii) O-1A evidentiary criteria', null],
    ['O-1 validity does not exceed 3 years',
      '8 CFR 214.2(o)(6)(iii)(A) validity', 'not to exceed 3 years'],
    ['O-1 extensions come in increments of up to 1 year',
      '8 CFR 214.2(o)(12)(ii) extension period', 'increments of up to 1 year'],
    ['EB-1A requires at least three of ten',
      '8 CFR 204.5(h)(3) EB-1A initial evidence', 'at least three of the following'],
    ['EB-1A lists a tenth criterion',
      '8 CFR 204.5(h)(3) EB-1A initial evidence', '(x)'],
    ['EB-1A needs no job offer or labor certification',
      '8 CFR 204.5(h)(5) no offer of employment required',
      'Neither an offer for employment in the United States nor a labor certification is required'],
    ['OPT is 12 months per educational level',
      '8 CFR 214.2(f)(10) practical training', '12 months of practical training'],
    ['STEM OPT extension is 24 months',
      '8 CFR 214.2(f)(10)(ii)(C) STEM extension', '24-month extension'],
    ['extraordinary ability means the very top of the field',
      '8 CFR 214.2(o)(3)(ii) extraordinary ability definition', 'small percentage who have arisen to the very top'],
  ];

  for (const [label, key, needle] of claims) {
    if (needle === null) continue;
    test(`regulation text supports: ${label}`, () => {
      const text = excerpts[key];
      assert.ok(text, `missing excerpt ${key}`);
      assert.ok(
        text.toLowerCase().includes(needle.toLowerCase()),
        `"${needle}" not found in ${key}`
      );
    });
  }

  test('O-1A criteria list stops at eight, EB-1A goes to ten', () => {
    const o1a = excerpts['8 CFR 214.2(o)(3)(iii) O-1A evidentiary criteria'];
    assert.ok(o1a.includes('(8)'), 'O-1A should have an eighth criterion');
    assert.ok(!o1a.includes('(9)'), 'O-1A should not have a ninth criterion');

    const eb1a = excerpts['8 CFR 204.5(h)(3) EB-1A initial evidence'];
    assert.ok(eb1a.includes('(x)'), 'EB-1A should have a tenth criterion');
  });

  test('the immigration bundle states the right counts in its own prose', () => {
    const criteria = immigration.find(p => p.id === 'o1a-criteria');
    assert.match(criteria.text, /at least three of these eight/i);
    const eb1a = immigration.find(p => p.id === 'eb1a-criteria');
    assert.match(eb1a.text, /at least three of ten/i);
  });
});
