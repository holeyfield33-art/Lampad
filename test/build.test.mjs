// Regression tests for the production build output.
// Run with: npm run build && node --test test/build.test.mjs
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

describe('production build', { skip: existsSync(dist) ? false : 'run `npm run build` first' }, () => {
  test('every icon declared in the web manifest is actually emitted', () => {
    const manifest = JSON.parse(readFileSync(`${dist}manifest.webmanifest`, 'utf8'));
    assert.ok(manifest.icons?.length, 'manifest declares no icons');
    for (const icon of manifest.icons) {
      const file = `${dist}${icon.src.replace(/^\//, '')}`;
      assert.ok(existsSync(file), `manifest references ${icon.src} but the build does not emit it`);
      // A PNG the browser will reject is as bad as a missing one.
      const head = readFileSync(file).subarray(0, 8);
      assert.equal(head.subarray(1, 4).toString('ascii'), 'PNG', `${icon.src} is not a PNG`);
    }
  });
});
