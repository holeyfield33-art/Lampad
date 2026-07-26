# Lampad AtlasBridge

**Offline-first AI assistant for newcomers and disconnected regions.**

Lampad runs a small language model and a multilingual retrieval engine entirely
in the browser. No server round-trip for inference, no API keys. Once the app and
its models are cached, it keeps working with the network fully disconnected
(airplane mode).

**One exception to on-device-only:** the offline SOS queue. When the distress
scanner flags a message, the prompt that triggered it is stored in IndexedDB and
then POSTed to the SOS endpoint (`VITE_SOS_ENDPOINT`, see
[Configuration](#configuration)) as soon as connectivity returns. Chat messages,
retrieval queries, and model output never leave the device.

## What it does

- **Survival Info (grounded chat).** Answers questions about local emergency,
  housing, health, transit, food, and document-safety resources using only
  retrieved local context. If nothing relevant is found, it refuses rather than
  inventing an answer.
- **English Tutor.** Provides translation aids, grammar notes, and practice
  prompts for newcomers.
- **Offline SOS queue.** A keyword distress scanner flags dangerous situations
  and stores a packet in IndexedDB, forwarding it to the configured backend
  automatically once connectivity returns. A packet is only marked delivered on
  a 2xx response; anything else keeps it queued and tells you the sync failed.

## How it works

Two dedicated Web Workers, coordinated by a typed message protocol:

| Worker | Library | Job |
| --- | --- | --- |
| `inference.worker.ts` | `@mlc-ai/web-llm` | Runs `Qwen2.5-0.5B-Instruct` (q4f16) locally via WebGPU |
| `retrieval.worker.ts` | `@xenova/transformers` | Embeds text with `paraphrase-multilingual-MiniLM-L12-v2` for in-browser RAG |

Both workers degrade gracefully: without WebGPU the inference worker uses a
keyword fallback, and the retrieval worker falls back to a token-hashing
embedder, so the app still runs on low-capability devices.

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:3000)
npm run build    # production build into dist/
npm run preview  # serve the production build
npm run lint     # type-check with tsc --noEmit
npm test         # backend + build-output tests (no browser needed)
npm run test:e2e # browser regression tests (needs Playwright + Chromium)
```

First load downloads the model weights (~400 MB) and the embedding model; after
that the PWA serves them from cache and works offline.

## Configuration

Everything in `.env.example` is optional — the on-device LLM and retrieval
features need no configuration at all.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_SOS_ENDPOINT` | frontend (build time) | Where queued SOS packets are POSTed. Defaults to the hosted backend when unset. |
| `PORT` | `server.js` | Port the SOS backend listens on. |
| `SOS_FORWARD_URL` | `server.js` | Optional upstream webhook that received packets are forwarded to. |
| `CORS_ORIGIN` | `server.js` | Allowed origin for the SOS API. Defaults to `*`. |
| `SOS_RATE_MAX` / `SOS_RATE_WINDOW_MS` | `server.js` | Per-IP rate limit on `/api/sos` (default 30 requests per minute). |

`/api/sos` is unauthenticated: the client is a browser with no credentials, so
there is no secret it could hold. Rate limiting and payload validation are what
protect it — set `CORS_ORIGIN` and put it behind your own gateway if you point
`SOS_FORWARD_URL` at a real responder system.

## Roadmap

- **Signed knowledge bundles** (Ed25519) that the app verifies before trusting,
  so a bundle can be sideloaded onto a disconnected device and verified without a
  network ("RAG over sneakernet").
- **Publishing portal** for trusted orgs to author, sign, and update bundles.
- **Delta-sync** so updates transfer as small diffs.

## Disclaimer

Lampad provides general informational resources, not legal advice. Immigration
law changes frequently; always confirm critical details with official sources or
a licensed professional.
