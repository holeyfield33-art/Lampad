// Browser regression tests for the audit fixes.
//
//   npm run build && npm run test:e2e
//
// Needs Playwright + Chromium. Resolved from local node_modules first, then a
// global install; the suite skips (loudly) when neither is present rather than
// pretending to have run.
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT || 4183);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 10601);
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  for (const p of ['/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    if (existsSync(p)) {
      try { ({ chromium } = require(p)); break; } catch { /* keep looking */ }
    }
  }
}

describe('frontend regressions', { skip: chromium ? false : 'playwright not installed' }, () => {
  let browser;
  let preview;
  let mock;
  let mockMode = 'ok';
  let received = [];

  before(async () => {
    assert.ok(
      existsSync(new URL('../dist/index.html', import.meta.url)),
      'dist/ missing — run `npm run build` first'
    );

    // Mock SOS endpoint. VITE_SOS_ENDPOINT must point here at build time.
    mock = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        received.push(body);
        if (mockMode === 'fail') {
          res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"boom"}');
        } else {
          res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"received":true}');
        }
      });
    });
    await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));

    // Spawn vite directly (not through npx) and in its own process group, so
    // teardown actually kills the server instead of orphaning it.
    preview = spawn(
      new URL('../node_modules/.bin/vite', import.meta.url).pathname,
      ['preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1'],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
    );
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        const r = await fetch(BASE);
        if (r.ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('preview server did not start');
      await new Promise(r => setTimeout(r, 300));
    }

    browser = await chromium.launch({ args: ['--no-sandbox'] });
  });

  after(async () => {
    await browser?.close();
    if (preview?.pid) {
      try { process.kill(-preview.pid, 'SIGKILL'); } catch { preview.kill('SIGKILL'); }
    }
    await new Promise(r => mock.close(r));
  });

  async function openApp({ allowMock = false, killGpu = false } = {}) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    if (killGpu) {
      await page.addInitScript(() => {
        try { Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true }); } catch { /* ignore */ }
      });
    }
    // Block the model CDNs so the run is offline-deterministic: this is the
    // degraded path the README promises, and the one the fixes target.
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(BASE)) return route.continue();
      if (allowMock && u.startsWith(`http://127.0.0.1:${MOCK_PORT}`)) return route.continue();
      return route.abort();
    });
    return { ctx, page };
  }

  // Regression: the loader panel used to key off progress reaching 100%, so on
  // any device where the weights never load it stayed on screen forever.
  test('loader panel clears once the engine falls back', async () => {
    const { ctx, page } = await openApp({ killGpu: true });
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await page.waitForSelector('#model-loader-panel', { state: 'detached', timeout: 60000 });
      assert.equal(await page.locator('#model-loader-panel').count(), 0);

      // ...and the app is actually usable in that state.
      await page.locator('form input[type=text]').first().fill('emergency police help');
      await page.locator('button[type=submit]').click();
      await page.waitForFunction(
        () => document.querySelector('#main-workbench')?.textContent?.includes('911'),
        null,
        { timeout: 30000 }
      );

      // The retry button is only for "WebGPU present but the fetch failed" —
      // a device with no WebGPU at all (this test) has nothing to retry, so
      // it must not appear and dangle a false promise of a different outcome.
      assert.equal(await page.locator('#retry-model-load').count(), 0);
    } finally {
      await ctx.close();
    }
  });

  // Regression: a large paste streamed one chunk per word at >=10ms each and
  // held the input disabled for over four minutes.
  test('a 100KB paste completes promptly instead of locking the input', async () => {
    const { ctx, page } = await openApp();
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await page.waitForSelector('#model-loader-panel', { state: 'detached', timeout: 60000 });
      await page.locator('button:has-text("English Tutor")').click();

      const input = page.locator('form input[type=text]').first();
      await input.evaluate((el, big) => {
        el.value = big;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, 'word '.repeat(20000).trim());

      const t0 = Date.now();
      await page.locator('button[type=submit]').click();
      await page.waitForFunction(
        () => !document.querySelector('form input[type=text]')?.disabled,
        null,
        { timeout: 30000 }
      );
      const elapsed = (Date.now() - t0) / 1000;
      assert.ok(elapsed < 25, `generation took ${elapsed.toFixed(1)}s, expected well under 25s`);
    } finally {
      await ctx.close();
    }
  });

  // No explicit version here: the app's own mount effect (updateSOSState in
  // App.tsx) opens the DB at DB_VERSION within milliseconds of #app-root
  // existing, so a hardcoded lower version here raced it and lost — the app's
  // open won, and this helper's `indexedDB.open(name, 1)` then threw a
  // VersionError that was silently swallowed into `resolve(false)`, seeding
  // nothing and leaving every SOS-sync test to time out waiting for a toast
  // that had nothing to report. Opening with no version argument attaches to
  // whatever version already exists (or creates fresh at v1, handled by
  // onupgradeneeded below, if this genuinely runs first) and never conflicts
  // with the app either way. Failures now reject instead of resolving
  // false/[] so a real regression fails fast instead of a 30s timeout.
  async function seedPendingSos(page, prompt) {
    const ok = await page.evaluate(p => new Promise((res, rej) => {
      const r = indexedDB.open('AtlasBridgeDB');
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending_sos')) {
          db.createObjectStore('pending_sos', { keyPath: 'id', autoIncrement: true });
        }
      };
      r.onsuccess = e => {
        const db = e.target.result;
        const st = db.transaction('pending_sos', 'readwrite').objectStore('pending_sos');
        const add = st.add({ timestamp: new Date().toISOString(), prompt: p, flags: ['sos'], synced: false });
        add.onsuccess = () => res(true);
        add.onerror = () => rej(add.error);
      };
      r.onerror = () => rej(r.error);
    }), prompt);
    assert.equal(ok, true, 'seedPendingSos: write did not succeed');
  }

  function readSos(page) {
    return page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('AtlasBridgeDB');
      r.onsuccess = e => {
        const g = e.target.result.transaction('pending_sos', 'readonly').objectStore('pending_sos').getAll();
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      };
      r.onerror = () => rej(r.error);
    }));
  }

  // Regression: the "SOS Log Sync Successful" toast fired after every sync
  // attempt, including ones where the backend rejected every packet. Telling
  // someone in distress that responders were notified when nothing was
  // delivered is the worst possible failure mode for this feature.
  test('a rejecting backend reports failure and keeps the packet queued', async () => {
    mockMode = 'fail';
    received = [];
    const { ctx, page } = await openApp({ allowMock: true });
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await seedPendingSos(page, 'sync-failure-probe');
      await page.reload({ waitUntil: 'load' });

      await page.waitForSelector('#sync-failure-toast', { timeout: 30000 });
      const body = await page.locator('#app-root').innerText();
      assert.equal(body.includes('SOS Log Sync Successful'), false, 'claimed success after a 500');

      const rows = await readSos(page);
      const row = rows.find(r => r.prompt === 'sync-failure-probe');
      assert.ok(row, 'seeded record disappeared');
      assert.equal(row.synced, false, 'record marked synced despite a 500 response');
      assert.ok(received.length >= 1, 'client never contacted the endpoint');
    } finally {
      await ctx.close();
    }
  });

  test('an accepting backend reports success and marks the packet synced', async () => {
    mockMode = 'ok';
    received = [];
    const { ctx, page } = await openApp({ allowMock: true });
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await seedPendingSos(page, 'sync-success-probe');
      await page.reload({ waitUntil: 'load' });

      await page.waitForFunction(
        () => document.body.textContent.includes('SOS Log Sync Successful'),
        null,
        { timeout: 30000 }
      );
      assert.equal(await page.locator('#sync-failure-toast').count(), 0);

      const rows = await readSos(page);
      const row = rows.find(r => r.prompt === 'sync-success-probe');
      assert.ok(row, 'seeded record disappeared');
      assert.equal(row.synced, true, 'record not marked synced after a 201');
    } finally {
      await ctx.close();
    }
  });

  // The endpoint must come from VITE_SOS_ENDPOINT, not a hardcoded host.
  test('the SOS endpoint honours VITE_SOS_ENDPOINT', async () => {
    mockMode = 'ok';
    received = [];
    const { ctx, page } = await openApp({ allowMock: true });
    const attempted = [];
    page.on('request', r => {
      if (r.url().includes('/api/sos')) attempted.push(r.url());
    });
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await seedPendingSos(page, 'endpoint-probe');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => document.body.textContent.includes('SOS Log Sync'), null, { timeout: 30000 });
      assert.ok(
        attempted.some(u => u.startsWith(`http://127.0.0.1:${MOCK_PORT}`)),
        `expected a POST to the configured endpoint, saw ${JSON.stringify(attempted)}`
      );
      assert.equal(
        attempted.some(u => u.includes('onrender.com')),
        false,
        'still posting to the hardcoded production host'
      );
    } finally {
      await ctx.close();
    }
  });

  // Regression: the message renderer handled line prefixes (###, -, *   ) but
  // not inline **bold**, so every English Tutor lesson (which is built with
  // heavy **bold** markup in src/workers/fallback.ts renderLesson) showed
  // literal asterisks instead of bold text.
  test('English Tutor markdown bold renders as <strong>, not literal asterisks', async () => {
    const { ctx, page } = await openApp();
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await page.waitForSelector('#model-loader-panel', { state: 'detached', timeout: 60000 });
      await page.locator('button:has-text("English Tutor")').click();

      await page.locator('form input[type=text]').first().fill('How do I talk to a landlord?');
      await page.locator('button[type=submit]').click();
      await page.waitForFunction(
        () => document.querySelector('#main-workbench')?.textContent?.includes('Vocabulary & Translation'),
        null,
        { timeout: 30000 }
      );

      const text = await page.locator('#main-workbench').innerText();
      assert.equal(
        text.includes('**'),
        false,
        `literal markdown asterisks leaked into rendered text: ${text.slice(0, 400)}`
      );
      const strongCount = await page.locator('#main-workbench strong').count();
      assert.ok(strongCount > 0, 'expected at least one <strong> element from rendered **bold** markdown');
    } finally {
      await ctx.close();
    }
  });

  // Regression: the footer showed hardcoded literals (UUID_SESSION,
  // ESM_WORKER_POOL, a stale BUILD_DATE) next to real instrumentation.
  test('footer diagnostics reflect real state, not hardcoded literals', async () => {
    const { ctx, page } = await openApp({ killGpu: true });
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#app-root');
      await page.waitForSelector('#model-loader-panel', { state: 'detached', timeout: 60000 });

      const footerText = await page.locator('#system-footer').innerText();
      assert.doesNotMatch(footerText, /4f9d-128a-88bc-atlas/, 'UUID_SESSION is still the hardcoded literal');
      assert.match(
        footerText,
        /UUID_SESSION: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        'expected a real UUID in UUID_SESSION'
      );
      assert.doesNotMatch(footerText, /BUILD_DATE: 2026-06-27/, 'BUILD_DATE is still the stale hardcoded literal');
      assert.match(footerText, /BUILD_DATE: \d{4}-\d{2}-\d{2}/, 'expected an actual build date');
    } finally {
      await ctx.close();
    }
  });
});
