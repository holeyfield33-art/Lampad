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
  housing, health, transit, food, schooling, worker rights, and US visa status
  using only retrieved context, and cites the passage every answer came from. If
  nothing relevant is retrieved, it refuses rather than inventing an answer.
- **English Tutor.** Eight survival-English lessons — calling 911, a clinic
  visit, a landlord, a pay dispute, an immigration appointment — with
  vocabulary and phrases in Spanish, Chinese and Vietnamese, a practice
  dialogue, a grammar point, and a link to the resource passage for the same
  situation.
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

Both workers degrade gracefully, and the degraded path is the one most devices
actually take — Safari and Firefox have no WebGPU, and the first run of a fresh
install has no cached weights.

- **Without WebGPU**, the inference worker answers *from retrieval*: it receives
  the scored passages the embedding model selected and assembles the reply from
  them, with citations. It does not fall back to canned text.
- **Without the embedding model**, retrieval uses a lexical embedder — IDF
  weighted over the indexed corpus, stopword filtered, character trigrams,
  signed feature hashing. On a 10-query labelled set it scores 100% top-1
  (`npm test` → `test/retrieval.test.mjs`).
- **In either fallback**, a question that shares no vocabulary with any passage
  is refused rather than answered from the nearest neighbour.

## Knowledge base

18 passages across two bundles, every one carrying its source, a link, and a
verification date.

| Bundle | Passages | Authority |
| --- | --- | --- |
| Santa Clara County survival guide | 8 | County and city service providers |
| US visa & work authorization | 10 | Title 8, Code of Federal Regulations |

Eight of the immigration passages are plain-language restatements of regulation
text stored verbatim in `src/data/sources/cfr-excerpts.json`, pulled from the
eCFR API. `test/data.test.mjs` checks that each cited excerpt exists and that
the numbers the summary asserts — "at least three of eight" for O-1A, "three of
ten" for EB-1A, "not to exceed 3 years", "24-month extension" — actually appear
in the regulation, so the summary cannot drift from the source.

The remaining passages are marked `needs-review`: shown with a staleness caveat
and a link, but not independently confirmed. `docs/DATA_REVIEW.md` tracks the
sign-off.

### Updating packs without shipping an app update

Packs are published by the Render backend and pulled by the client:

```
npm run bundles          # build public/bundles/{manifest,county,immigration}.json
GET /api/bundles         # manifest: id, version, sha256 digest, counts
GET /api/bundles/:id     # one pack
```

The client compares digests, downloads only what changed, and revalidates with
ETags — an unchanged pack is a 304 with no body, which matters on a metered
connection. Packs are cached in IndexedDB, so a device that has synced once
keeps its knowledge base offline. Git stays the source of truth; a deploy
publishes.

**Trust model.** The digest is an *integrity* check, not an *authenticity* one:
it comes from the same host as the pack, so it catches corruption, not a
compromised hub. The real defence is `validatePack` in `src/lib/bundleSync.ts`,
which rejects any pack whose passages lack a source, carry a non-https URL,
contain a fictional 555-01xx number, or exceed declared size bounds — and keeps
the last good version when it does. Verified against a hub serving a
correctly-digested malicious pack (`test/bundles.test.mjs`). Authenticity needs
the signed bundles on the roadmap.

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
| `VITE_BUNDLE_HUB` | frontend (build time) | Base URL of the knowledge-pack hub. Defaults to the hosted backend when unset. |
| `BUNDLE_DIR` | `server.js` | Directory the hub serves packs from. Defaults to `public/bundles`. |
| `PORT` | `server.js` | Port the SOS backend listens on. |
| `SOS_FORWARD_URL` | `server.js` | Optional upstream webhook that received packets are forwarded to. |
| `SOS_FORWARD_TIMEOUT_MS` | `server.js` | How long to wait on that upstream before giving up. Defaults to 10000. |
| `CORS_ORIGIN` | `server.js` | Allowed origin for the SOS API. Defaults to `*`. |
| `SOS_RATE_MAX` / `SOS_RATE_WINDOW_MS` | `server.js` | Per-IP rate limit on `/api/sos` (default 30 requests per minute). |

`/api/sos` is unauthenticated: the client is a browser with no credentials, so
there is no secret it could hold. Rate limiting and payload validation are what
protect it — set `CORS_ORIGIN` and put it behind your own gateway if you point
`SOS_FORWARD_URL` at a real responder system.

## Roadmap

- **Signed knowledge bundles** (Ed25519) that the app verifies before trusting,
  so a bundle can be sideloaded onto a disconnected device and verified without a
  network ("RAG over sneakernet"). The hub and the client validation gate are
  built; what is missing is the signing key and the signature check, which
  `verifyDigest` in `bundleSync.ts` is factored to sit beside.
- **Publishing portal** for trusted orgs to author, sign, and update bundles.
  Today publishing is a git commit plus a deploy.
- **Delta-sync** so updates transfer as small diffs. Today the client skips
  unchanged packs entirely (digest comparison plus ETag revalidation) but
  re-downloads a changed pack whole.

## Disclaimer

Lampad provides general informational resources, not legal advice. Immigration
law changes frequently; always confirm critical details with official sources or
a licensed professional.
