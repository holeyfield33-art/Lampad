# Lampad AtlasBridge

**Offline-first AI assistant for newcomers and disconnected regions.**

Lampad runs a small language model and a multilingual retrieval engine entirely
in the browser. No server round-trip for inference, no API keys, no data leaving
the device. Once the app and its models are cached, it keeps working with the
network fully disconnected (airplane mode).

## What it does

- **Survival Info (grounded chat).** Answers questions about local emergency,
  housing, health, transit, food, and document-safety resources using only
  retrieved local context. If nothing relevant is found, it refuses rather than
  inventing an answer.
- **English Tutor.** Provides translation aids, grammar notes, and practice
  prompts for newcomers.
- **Offline SOS queue.** A distress scanner flags dangerous situations and stores
  a packet in IndexedDB, forwarding it to a backend automatically once
  connectivity returns.

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
```

First load downloads the model weights (~400 MB) and the embedding model; after
that the PWA serves them from cache and works offline.

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
