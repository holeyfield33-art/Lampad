import 'dotenv/config';
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;

// Where to forward received SOS packets (e.g. an alerting webhook). Optional:
// when unset, the backend simply acknowledges receipt so the client can stop
// retrying. CORS_ORIGIN restricts who may call the API ("*" by default).
const SOS_FORWARD_URL = process.env.SOS_FORWARD_URL || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const FORWARD_TIMEOUT_MS = Number(process.env.SOS_FORWARD_TIMEOUT_MS || 10000);

// Field limits. The body parser caps the request at 64kb; these keep a single
// oversized field from being logged or forwarded upstream.
const MAX_TIMESTAMP_CHARS = 64;
const MAX_PROMPT_CHARS = 4000;
const MAX_FLAGS = 32;
const MAX_FLAG_CHARS = 64;

// Per-IP rate limit. The endpoint is unauthenticated by design (the client is a
// browser with no credentials), so this is what keeps it from being used to
// flood an alerting webhook.
const RATE_LIMIT_WINDOW_MS = Number(process.env.SOS_RATE_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.SOS_RATE_MAX || 30);
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Drop expired buckets so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now > entry.resetAt) hits.delete(ip);
}, RATE_LIMIT_WINDOW_MS).unref();

// Strip control characters (CR/LF included) before anything reaches the log, so
// a caller cannot forge extra "[SOS] ..." lines in the operator's log.
function forLog(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
}

app.use(express.json({ limit: '64kb' }));

// Minimal CORS so the static frontend (a different origin) can POST SOS
// packets. The JSON content-type triggers a preflight, so answer OPTIONS too.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Knowledge pack hub
//
// Packs are built from the repo by `npm run bundles` and served from disk, so a
// deploy publishes them. Clients poll the manifest, compare digests, and pull
// only what changed; ETags make an unchanged pack a 304 with no body, which
// matters on a metered or intermittent connection.
//
// The digest is an integrity check, not an authenticity one: it is served by
// the same host as the pack, so it protects against truncation and corruption,
// not against this server being compromised. Authenticity needs the signed
// bundles on the roadmap. The client validates pack contents independently for
// that reason.
// ---------------------------------------------------------------------------
const BUNDLE_DIR = process.env.BUNDLE_DIR || join(__dirname, 'public', 'bundles');

function readPack(name) {
  const file = join(BUNDLE_DIR, `${name}.json`);
  // `name` is matched against a strict allowlist pattern before it reaches
  // here, but re-check the resolved path stays inside BUNDLE_DIR anyway.
  if (!file.startsWith(BUNDLE_DIR) || !existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function serveJsonFile(req, res, body, weakTag) {
  if (body === null) return res.status(404).json({ error: 'not_found' });
  const etag = `"${weakTag}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=300');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.type('application/json').send(body);
}

let manifestCache = null;
function manifest() {
  if (manifestCache) return manifestCache;
  const raw = readPack('manifest');
  if (!raw) return null;
  try {
    manifestCache = { raw, parsed: JSON.parse(raw) };
  } catch {
    return null;
  }
  return manifestCache;
}

app.get('/api/bundles', (req, res) => {
  const m = manifest();
  if (!m) return res.status(503).json({ error: 'bundles_unavailable' });
  const version = m.parsed.bundles.map(b => b.version).join('-');
  serveJsonFile(req, res, m.raw, version);
});

app.get('/api/bundles/:id', (req, res) => {
  const { id } = req.params;
  // Allowlist: lowercase letters, digits and dashes only. Nothing that could
  // walk out of the bundle directory.
  if (!/^[a-z0-9-]{1,64}$/.test(id)) {
    return res.status(400).json({ error: 'invalid_bundle_id' });
  }
  const m = manifest();
  const entry = m?.parsed.bundles.find(b => b.id === id);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  serveJsonFile(req, res, readPack(id), entry.version);
});


// Receives a queued SOS packet from the client once connectivity returns.
// Only a 2xx response causes the client to mark the record delivered, so any
// failure here keeps the record queued for retry.
app.post('/api/sos', async (req, res) => {
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { timestamp, prompt, flags } = body;

  // Validate types, not just presence: an object or array here used to be
  // accepted and then logged and forwarded as "[object Object]".
  if (typeof timestamp !== 'string' || timestamp.trim() === '') {
    return res.status(400).json({ error: 'timestamp must be a non-empty string' });
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'prompt must be a non-empty string' });
  }
  if (timestamp.length > MAX_TIMESTAMP_CHARS) {
    return res.status(400).json({ error: 'timestamp too long' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: 'prompt too long' });
  }
  if (flags !== undefined && !Array.isArray(flags)) {
    return res.status(400).json({ error: 'flags must be an array of strings' });
  }

  const packet = {
    timestamp,
    prompt,
    flags: Array.isArray(flags)
      ? flags.filter(f => typeof f === 'string').slice(0, MAX_FLAGS).map(f => f.slice(0, MAX_FLAG_CHARS))
      : [],
  };
  console.log(`[SOS] ${forLog(packet.timestamp)} flags=${forLog(JSON.stringify(packet.flags))}`);

  if (SOS_FORWARD_URL) {
    try {
      const upstream = await fetch(SOS_FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet),
        // Without a timeout an unresponsive webhook holds the request open
        // until the platform kills it.
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        // Forwarding failed: surface a 5xx so the client retries later.
        return res.status(502).json({ error: 'forward_failed', status: upstream.status });
      }
    } catch (err) {
      return res.status(502).json({ error: 'forward_unreachable' });
    }
  }

  res.status(201).json({ received: true });
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// JSON error handler. Express's default handler renders the stack trace into an
// HTML page, which leaked absolute server paths and dependency versions to any
// unauthenticated caller that sent malformed JSON or an oversized body.
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const code =
    status === 413 ? 'payload_too_large' : status === 400 ? 'invalid_json' : 'internal_error';
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ error: code });
});

app.listen(PORT, () => {
  console.log(`Lampad backend listening on port ${PORT}`);
});
