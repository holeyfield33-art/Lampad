// Tests for the knowledge-pack hub and the client-side validation gate.
//
// The gate matters more than the digest. The digest is served by the same host
// as the pack, so it proves the bytes arrived intact — not that the host is
// honest. `validatePack` is what stops a compromised or impersonated hub from
// injecting an unsourced passage, a javascript: link, or a fabricated hotline
// into an app that people rely on for immigration and emergency guidance.
//
// Run with: node --test test/bundles.test.mjs
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.BUNDLE_TEST_PORT || 10733);
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let sync;      // compiled bundleSync module
let manifest;

const canonical = v =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
      : JSON.stringify(v);

before(async () => {
  // Packs must exist before the hub can serve them.
  execFileSync(process.execPath, [join(repo, 'scripts/build-bundles.mjs')], { cwd: repo, stdio: 'pipe' });
  manifest = JSON.parse(readFileSync(join(repo, 'public/bundles/manifest.json'), 'utf8'));

  server = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, PORT: String(PORT), SOS_RATE_MAX: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => String(d).includes('listening on port') && resolve());
    server.on('error', reject);
    setTimeout(() => reject(new Error('hub did not start')), 10000).unref();
  });

  // Compile the client sync module so the shipped validator is what is tested.
  const out = mkdtempSync(join(tmpdir(), 'lampad-sync-'));
  const bundle = join(out, 'sync.mjs');
  execFileSync(
    join(repo, 'node_modules/.bin/esbuild'),
    [
      join(repo, 'src/lib/bundleSync.ts'),
      '--bundle',
      '--format=esm',
      // Vite injects import.meta.env; plain Node does not, so supply it.
      `--define:import.meta.env=${JSON.stringify({ VITE_BUNDLE_HUB: BASE })}`,
      `--outfile=${bundle}`,
    ],
    { stdio: 'pipe' }
  );
  sync = await import(bundle);
});

after(() => server?.kill('SIGKILL'));

describe('hub endpoints', () => {
  test('serves a manifest listing every pack', async () => {
    const res = await fetch(`${BASE}/api/bundles`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schema, 1);
    assert.ok(body.bundles.length >= 2);
    for (const b of body.bundles) {
      assert.match(b.digest, /^[0-9a-f]{64}$/, `${b.id}: digest must be sha256 hex`);
      assert.ok(b.passageCount > 0);
    }
  });

  test('an unchanged pack revalidates as 304 with no body', async () => {
    const first = await fetch(`${BASE}/api/bundles`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'manifest must carry an ETag');
    const second = await fetch(`${BASE}/api/bundles`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
    assert.equal((await second.text()).length, 0);
  });

  test('each pack matches the digest advertised in the manifest', async () => {
    for (const entry of manifest.bundles) {
      const res = await fetch(`${BASE}/api/bundles/${entry.id}`);
      assert.equal(res.status, 200, `${entry.id} should be served`);
      const pack = await res.json();
      const { version, builtAt, ...content } = pack;
      const digest = createHash('sha256').update(canonical(content), 'utf8').digest('hex');
      assert.equal(digest, entry.digest, `${entry.id}: served bytes do not match the manifest digest`);
    }
  });

  test('rejects pack ids that could escape the bundle directory', async () => {
    for (const id of ['../server', '..%2f..%2fpackage', 'county%2f..%2fmanifest', 'COUNTY', 'a_b', 'a'.repeat(65)]) {
      const res = await fetch(`${BASE}/api/bundles/${id}`);
      assert.ok(res.status === 400 || res.status === 404, `${id} returned ${res.status}`);
      const body = await res.text();
      assert.equal(body.includes('node_modules'), false, `${id} leaked a server path`);
      assert.equal(body.includes('"name"'), false, `${id} may have served package.json`);
    }
  });

  test('an unknown pack is a JSON 404', async () => {
    const res = await fetch(`${BASE}/api/bundles/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  });

  test('the manifest itself is not fetchable as a pack', async () => {
    assert.equal((await fetch(`${BASE}/api/bundles/manifest`)).status, 404);
  });
});

describe('client validation gate', () => {
  const good = () => JSON.parse(readFileSync(join(repo, 'public/bundles/county.json'), 'utf8'));
  const strip = p => { const { version, builtAt, ...rest } = p; return rest; };
  const size = o => JSON.stringify(o).length;

  test('accepts a pack we published ourselves', () => {
    const pack = strip(good());
    assert.equal(sync.validatePack('county', pack, size(pack)), null);
  });

  test('rejects a pack whose id does not match what was requested', () => {
    const pack = strip(good());
    assert.match(sync.validatePack('immigration', pack, size(pack)) || '', /does not match/);
  });

  // The injection cases. Each of these is something a hostile hub would want.
  test('rejects a passage with no source', () => {
    const pack = strip(good());
    delete pack.passages[0].source;
    assert.match(sync.validatePack('county', pack, size(pack)) || '', /no source/);
  });

  test('rejects a non-https url', () => {
    for (const url of ['http://evil.example/x', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const pack = strip(good());
      pack.passages[0].url = url;
      assert.match(sync.validatePack('county', pack, size(pack)) || '', /url must be https/, `allowed ${url}`);
    }
  });

  test('rejects a fabricated 555-01xx hotline', () => {
    const pack = strip(good());
    pack.passages[0].text = 'Call the Newcomer Crisis Center at (408) 555-0199 for immediate help with housing.';
    assert.match(sync.validatePack('county', pack, size(pack)) || '', /fictional/);
  });

  test('rejects an unknown verifiedBy value', () => {
    const pack = strip(good());
    pack.passages[0].verifiedBy = 'trust-me';
    assert.match(sync.validatePack('county', pack, size(pack)) || '', /verifiedBy/);
  });

  test('rejects duplicate and malformed passage ids', () => {
    const dup = strip(good());
    dup.passages[1].id = dup.passages[0].id;
    assert.match(sync.validatePack('county', dup, size(dup)) || '', /duplicate/);

    const bad = strip(good());
    bad.passages[0].id = '../../etc/passwd';
    assert.match(sync.validatePack('county', bad, size(bad)) || '', /bad passage id/);
  });

  test('rejects oversized packs and oversized passages', () => {
    const pack = strip(good());
    assert.match(sync.validatePack('county', pack, 5 * 1024 * 1024) || '', /exceeds/);

    const big = strip(good());
    big.passages[0].text = 'x'.repeat(6000);
    assert.match(sync.validatePack('county', big, size(big)) || '', /exceeds/);
  });

  test('rejects empty and structurally broken packs', () => {
    const empty = strip(good());
    empty.passages = [];
    assert.match(sync.validatePack('county', empty, size(empty)) || '', /no passages/);
    assert.ok(sync.validatePack('county', null, 10));
    assert.ok(sync.validatePack('county', { id: 'county' }, 10));
    assert.match(sync.validatePack('county', { ...strip(good()), passages: 'nope' }, 100) || '', /not an array/);
  });

  test('digest helper agrees with the publisher', async () => {
    const pack = strip(good());
    const expected = manifest.bundles.find(b => b.id === 'county').digest;
    assert.equal(await sync.digestOf(pack), expected);
  });

  test('a tampered pack produces a different digest', async () => {
    const pack = strip(good());
    pack.passages[0].text = pack.passages[0].text.replace('(408) 586-2400', '(408) 000-0000');
    const expected = manifest.bundles.find(b => b.id === 'county').digest;
    assert.notEqual(await sync.digestOf(pack), expected);
  });
});
