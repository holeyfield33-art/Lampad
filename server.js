import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

// Where to forward received SOS packets (e.g. an alerting webhook). Optional:
// when unset, the backend simply acknowledges receipt so the client can stop
// retrying. CORS_ORIGIN restricts who may call the API ("*" by default).
const SOS_FORWARD_URL = process.env.SOS_FORWARD_URL || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

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

// Receives a queued SOS packet from the client once connectivity returns.
// Only a 2xx response causes the client to mark the record delivered, so any
// failure here keeps the record queued for retry.
app.post('/api/sos', async (req, res) => {
  const { timestamp, prompt, flags } = req.body || {};
  if (!timestamp || !prompt) {
    return res.status(400).json({ error: 'timestamp and prompt are required' });
  }

  const packet = { timestamp, prompt, flags: Array.isArray(flags) ? flags : [] };
  console.log(`[SOS] ${timestamp} flags=${JSON.stringify(packet.flags)}`);

  if (SOS_FORWARD_URL) {
    try {
      const upstream = await fetch(SOS_FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet),
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

app.listen(PORT, () => {
  console.log(`Lampad backend listening on port ${PORT}`);
});
