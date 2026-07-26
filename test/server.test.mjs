// Regression tests for the SOS backend (server.js).
// Run with: node --test test/server.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = process.env.TEST_PORT || 10577;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

async function post(body, { raw = false, headers = { 'Content-Type': 'application/json' } } = {}) {
  return fetch(`${BASE}/api/sos`, {
    method: 'POST',
    headers,
    body: raw ? body : JSON.stringify(body),
  });
}

function startServer(env) {
  const proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdoutLines = [];
  return new Promise((resolve, reject) => {
    const onData = d => {
      const s = String(d);
      proc.stdoutLines.push(s);
      if (s.includes('listening on port')) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', d => proc.stdoutLines.push(String(d)));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('server did not start in time')), 10000).unref();
  });
}

before(async () => {
  // A high limit here so the functional tests are not throttled; the rate
  // limiter gets its own server instance below.
  child = await startServer({ PORT: String(PORT), SOS_RATE_MAX: '1000' });
});

after(() => {
  child.kill();
});

test('health endpoint responds', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('accepts a well-formed SOS packet', async () => {
  const res = await post({ timestamp: '2026-07-26T00:00:00Z', prompt: 'help me', flags: ['sos'] });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { received: true });
});

test('malformed JSON returns JSON, never a stack trace', async () => {
  const res = await post('{"timestamp":', { raw: true });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const text = await res.text();
  assert.equal(text.includes('node_modules'), false, 'response leaked a server file path');
  assert.equal(/\bat \w/.test(text), false, 'response leaked a stack frame');
  assert.deepEqual(JSON.parse(text), { error: 'invalid_json' });
});

test('oversized body returns JSON, never a stack trace', async () => {
  const res = await post({ timestamp: 't', prompt: 'A'.repeat(100000) });
  assert.equal(res.status, 413);
  const text = await res.text();
  assert.equal(text.includes('node_modules'), false, 'response leaked a server file path');
  assert.deepEqual(JSON.parse(text), { error: 'payload_too_large' });
});

test('unknown route returns JSON 404, not an HTML error page', async () => {
  const res = await fetch(`${BASE}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not_found' });
});

test('rejects non-string timestamp and prompt', async () => {
  const res = await post({ timestamp: { a: 1 }, prompt: ['x'], flags: 'notanarray' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /timestamp must be a non-empty string/);

  const res2 = await post({ timestamp: 't', prompt: { a: 1 } });
  assert.equal(res2.status, 400);
  assert.match((await res2.json()).error, /prompt must be a non-empty string/);
});

test('rejects non-array flags', async () => {
  const res = await post({ timestamp: 't', prompt: 'p', flags: 'notanarray' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /flags must be an array/);
});

test('rejects an over-long prompt and timestamp', async () => {
  assert.equal((await post({ timestamp: 't'.repeat(65), prompt: 'p' })).status, 400);
  assert.equal((await post({ timestamp: 't', prompt: 'p'.repeat(4001) })).status, 400);
});

test('missing fields still rejected', async () => {
  const res = await post({});
  assert.equal(res.status, 400);
});

test('CRLF in a field cannot forge a new log line', async () => {
  const mark = child.stdoutLines.length;
  const res = await post({ timestamp: '2026\n[SOS] FAKE ENTRY injected', prompt: 'x' });
  await new Promise(r => setTimeout(r, 200));
  const written = child.stdoutLines.slice(mark).join('');
  assert.equal(written.includes('\n[SOS] FAKE ENTRY'), false, 'log line forgery succeeded');
  assert.ok(res.status === 201 || res.status === 400);
});

test('rate limits repeated posts from one client', async () => {
  const port = Number(PORT) + 1;
  const proc = await startServer({ PORT: String(port), SOS_RATE_MAX: '5', SOS_RATE_WINDOW_MS: '60000' });
  try {
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: `2026-07-26T00:00:0${i % 10}Z`, prompt: 'flood' }),
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 in ${statuses.join(',')}`);
    assert.equal(statuses.filter(s => s === 201).length, 5, 'exactly the allowance should succeed');
  } finally {
    proc.kill();
  }
});
