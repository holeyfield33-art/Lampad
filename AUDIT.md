# Pre-Launch Audit — Lampad AtlasBridge

**Date:** 2026-07-26
**Commit audited:** `4c51916` (branch `claude/pre-launch-audit-hardening-6d8jjz`)
**Classification:** Web app with a backend — static Vite/Preact PWA (all inference
in-browser via Web Workers) **plus** a small Express SOS API (`server.js`).
Phases run: frontend, workers, API, deploy config, docs. **Skipped:** database
layer (no SQL anywhere; persistence is IndexedDB), dependency-vulnerability scan
(`npm audit` is non-functional in this environment — see Unverified).

**Verdict: SHIP WITH FIXES APPLIED.** No P0 found. Eight P1 defects were found
and fixed on this branch, each with a regression test that fails before the fix
and passes after. Baseline is green. The remaining open findings are P2/P3 and
none of them block launch.

---

## Baseline

| Command | Before | After |
| --- | --- | --- |
| `npm ci` | 544 packages, clean | clean |
| `npm run lint` (`tsc --noEmit`) | exit 0 | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| `npm test` | *(did not exist)* | 14/14 pass |
| `npm run test:e2e` | *(did not exist)* | 5/5 pass |
| Clean-clone `npm install && npm run lint && npm run build` | exit 0 | exit 0 |

Secret scan — **clean, nothing to rotate**:

```
git log --all -p -- . | grep -inE "(sk-[a-zA-Z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC|PRIVATE) PRIVATE KEY|xox[baprs]-)"
# no matches, in HEAD or in history
```

No committed `.env`; only `.env.example`. `.env`/`.env.*` added to `.gitignore`
as a guard.

---

## Fixed (P0/P1)

| # | Sev | Finding | Repro (executed) | Fix | Regression test |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | **The app told users an SOS was delivered when nothing was sent.** `triggerAutomatedSync` showed "SOS Log Sync Successful — synced securely to remote responders" after *every* attempt, including when the backend rejected all of them. Worst failure mode in the product: someone in distress is told help was notified. | `npm run test:e2e` → *"a rejecting backend reports failure and keeps the packet queued"* (mock endpoint returns 500) | Count delivered vs. failed; success toast only when ≥1 packet was accepted, new failure toast otherwise (states the queue is still armed and nobody was notified). Dropped the false "Encrypted" claim. `src/App.tsx` | `test/frontend.e2e.mjs` ×2 |
| 2 | P1 | **Fabricated crisis phone number.** The keyword-fallback engine — the path every non-WebGPU device takes — answered emergency questions with *"Newcomer Crisis Center: Call (408) 555-0199"*. 555-01xx is the NANP fictional-number range. Also an invented "Milpitas Family Shelter". Both were presented under the heading "Grounded Information" while the README promises the app refuses rather than inventing. | `node --test test/content.test.mjs` against pre-fix source → 2 failures, `fallback responses cite fictional numbers: (408) 555-0199` | Removed both fabricated entries; the remaining contacts all trace to `src/data/passages.ts` or are nationwide (911/988/211). `src/workers/inference.worker.ts` | `test/content.test.mjs` ×2 |
| 3 | P1 | **Loading banner never cleared on any device without WebGPU** (or when the weight download fails) — exactly the graceful-degradation path the README advertises. `isModelLoaded` was only set when progress hit 100%, which never happens in fallback mode, so the panel sat at "10% Initializing WebGPU context…" forever while the app worked underneath. | `npm run test:e2e` → *"loader panel clears once the engine falls back"* (runs with `navigator.gpu` removed and the model CDN blocked) | Set `isModelLoaded` when `INIT_ENGINE` resolves; report fallback state in the progress text. `src/App.tsx` | `test/frontend.e2e.mjs` |
| 4 | P1 | **A large paste locked the UI for over four minutes.** The fallback engine streams one chunk per word at ≥10 ms; a 100 KB input kept the input disabled with no progress and no cancel. Measured: **>240 s, never finished**. | `npm run test:e2e` → *"a 100KB paste completes promptly"*; pre-fix probe printed `finished=false after 240.7s` | `maxLength` on the input + defensive `slice()` in the handler and the worker (2 000 chars), and a 400-chunk cap on simulated streaming. Now **9.0 s**. `src/App.tsx`, `src/workers/inference.worker.ts` | `test/frontend.e2e.mjs` |
| 5 | P1 | **`/api/sos` leaked stack traces and absolute server paths** to any unauthenticated caller. Malformed JSON or an oversized body fell through to Express's default HTML error page: `SyntaxError … at parse (/home/user/Lampad/node_modules/body-parser/lib/types/json.js:92:19)`. | `curl -X POST …/api/sos -H 'Content-Type: application/json' -d '{"timestamp":'` → HTML + full stack | JSON 404 and JSON error handler; `NODE_ENV=production` in `render.yaml`. `server.js` | `test/server.test.mjs` ×3 |
| 6 | P1 | **`/api/sos` accepted and forwarded wrong types.** `{"timestamp":{"a":1},"prompt":["x"],"flags":"notanarray"}` returned **201** and logged `[SOS] [object Object] flags=[]`, forwarding the garbage upstream. Also no per-field length limits and no rate limit on an internet-exposed, unauthenticated write endpoint that fans out to an alerting webhook. | `curl -X POST …/api/sos -d '{"timestamp":{"a":1},"prompt":["x"],"flags":"notanarray"}'` → `HTTP 201` | Strict type + length validation, per-IP rate limit (30/min, configurable), 10 s timeout on the upstream forward. `server.js` | `test/server.test.mjs` ×5 |
| 7 | P1 | **The Render blueprint used field names that do not exist.** Static site used `env: static`, `publishPath: dist`, and `headers: [{key, value}]`; the spec requires `runtime: static`, `staticPublishPath`, and `headers: [{path, name, value}]`. As written the COOP/COEP headers the app depends on would not be applied. | Verified against the [Render blueprint spec](https://render.com/docs/blueprint-spec) (deploy itself not executed — see Unverified) | Corrected all field names, added `NODE_ENV=production`. `render.yaml` | — (config; no runtime hook) |
| 8 | P1 | **PWA manifest referenced icons that were never built.** `manifest.webmanifest` declares `pwa-192x192.png` / `pwa-512x512.png`; `dist/` contained neither, so the app is not installable — while the README's headline claim is offline PWA use. | `npm run build && ls dist \| grep pwa` → nothing; `node --test test/build.test.mjs` → `manifest references pwa-192x192.png but the build does not emit it` | Added both icons to `public/`. Build now precaches 11 entries instead of 7. | `test/build.test.mjs` |

Also fixed as trivial, zero-risk changes alongside the above:

- **Documented-but-dead config.** `.env.example` advertised `VITE_SOS_ENDPOINT`; nothing read it and the endpoint was hardcoded to `lampad-backend.onrender.com`. Now read at build time (same URL as the fallback, so behaviour is unchanged when unset). Covered by `test/frontend.e2e.mjs` → *"the SOS endpoint honours VITE_SOS_ENDPOINT"*.
- **Double-delivery race.** `triggerAutomatedSync` claimed its lock *after* two `await`s, so the `online` event and the `isOnline` effect could both pass the guard and POST every queued packet twice. Lock is now claimed synchronously.
- **A dying worker hung the UI forever.** `WorkerManager` had no `error`/`messageerror` handler, so a crashed worker left every pending promise unresolved with the input permanently disabled. Pending promises are now rejected with a real message.
- **Hotline numbers could not be selected or copied.** `select-none` on the app shell cascaded into the chat transcript; `getSelection().toString()` over a phone number returned `""`. The transcript is now `select-text`.
- **README corrections** (see Phase 3) and `.env`/`.env.*` added to `.gitignore`.

---

## Open findings (not fixed)

| Sev | Finding | Repro (executed) | Why not fixed |
| --- | --- | --- | --- |
| P2 | **The distress scanner fires on ordinary questions.** `DISTRESS_REGEX` includes `emergency`, `police`, `dangerous`, `escape` and `unpaid` — words the app's own placeholder text invites ("Ask about local transit, BART, shelter clinics, legal, or SOS alerts"). Asking *"Where can I find emergency shelter in Milpitas?"* silently writes an SOS record and later transmits that prompt off-device. | In the running app, ask *"Where can I find emergency shelter in Milpitas?"* — the SOS panel gains a PENDING record. Measured in the browser: one ordinary question plus one genuine distress message left **2** rows in `pending_sos`. `grep -n "DISTRESS_REGEX =" src/workers/inference.worker.ts` shows the term list. | Narrowing the term list is a safety/product judgement (false negatives are worse than false positives here) and changes what gets escalated. Owner's call. |
| P2 | **`/api/sos` has no authentication.** Anyone can POST a packet. Now rate-limited and validated, but an attacker can still inject plausible SOS packets into a responder webhook. | `curl -X POST …/api/sos -d '{"timestamp":"t","prompt":"help"}'` → `HTTP 201`, no credentials | A browser client cannot hold a secret, so this needs a gateway, a signed client, or a human triage step — an architecture decision, not a patch. Documented in the README. |
| P2 | **`CORS_ORIGIN` defaults to `*` and `render.yaml` does not set it.** | `curl -i …/health` → `Access-Control-Allow-Origin: *` | The API is credential-less so `*` is not itself an escalation; setting it is a deploy-time decision (the frontend's production origin isn't fixed in-repo). |
| P2 | **The 400 MB model download has no progress recovery.** If `CreateMLCEngine` fails mid-download the app silently drops to keyword fallback; the user is told "keyword fallback engine active" but is never offered a retry. | Observed in every browser run: `Web-LLM loading failed, falling back to client-side compiler engine: TypeError: Failed to fetch` | Adding a retry affordance is feature work. |
| P3 | **Markdown bold is never rendered.** The message renderer handles `### `, `- `, and `*   ` prefixes but not inline `**`, so every answer shows literal asterisks. | Observed in the browser: the rendered text node reads `**Milpitas Police Department:** Non-emergency dispatch can be reached at **(408) 586-2400**`. `grep -n "startsWith" src/App.tsx` shows the renderer handles only line prefixes. | Needs a real inline-markdown renderer; visible in every response but cosmetic. |
| P3 | **Hardcoded fake telemetry in the UI.** Footer shows `UUID_SESSION: 4f9d-128a-88bc-atlas`, `ESM_WORKER_POOL: 2/2 ACTIVE`, and `BUILD_DATE: 2026-06-27` — all static literals, and the build date is already stale. The sidebar's "100 % SECURE_ON_DEVICE" bar and "Thread correlation mapping" blocks are decorative. | `grep -n "UUID_SESSION\|BUILD_DATE\|ESM_WORKER_POOL" src/App.tsx` | Cosmetic, but worth a pass before demoing to judges — fake instrumentation reads badly next to real instrumentation. |
| P3 | **`markLogAsSynced` in `src/lib/db.ts` is dead code.** `App.tsx` writes the record inline instead, so the exported helper is never called. | `grep -rn "markLogAsSynced" src/` → definition only | Harmless; removing it is churn. |
| P3 | **`pingTestPassed` is computed and never used.** The <5 ms ping assertion is evaluated on boot and the result is discarded. | `grep -rn "pingTestPassed" src/` → set once, read nowhere | Harmless. |
| P3 | **`package.json` is still named `react-example` v0.0.0** on a project that ships as Lampad AtlasBridge and uses Preact. | `grep '"name"' package.json` | Cosmetic; renaming touches nothing functional but is the owner's branding call. |

---

## Phase 2 — attack results on the core flow

Primary flow from the README: *ask a survival question in Survival Info mode and
get a grounded answer.* Executed for real in Chromium against the production
build with the model CDNs blocked (i.e. the documented degraded path — this
environment has no usable WebGPU and no model download).

| Input | Result |
| --- | --- |
| Normal question ("Where can I find emergency shelter in Milpitas?") | Grounded answer in 1.7 s ✅ |
| `<script>alert(1)</script> where is the clinic?` | Rendered as text. `window.__alerted` false, no `<script>` node in the DOM ✅ |
| `'; DROP TABLE users--` | Refusal ("not in my local survival guide") ✅ |
| `../../../etc/passwd` | Refusal ✅ |
| `🚨 ¿Dónde está el refugio? 中文测试 עברית` | Refusal (keyword fallback is English-only) — acceptable degradation, no crash ✅ |
| Empty / whitespace-only | Submit disabled ✅ |
| 100 KB paste | **Was >240 s with the UI locked → now 9.0 s** (fix #4) ✅ |
| 5 rapid Enter presses | 5 messages, 5 records, no crash or duplication ✅ |
| Vector diagnostics: empty query | Scan button disabled ✅ |
| Vector diagnostics: 100 KB query | Completes, page responsive ✅ |
| Backend: malformed JSON / null body / wrong types / no content-type / 100 KB body / unknown route | **Was HTML stack traces and false 201s → now JSON `400`/`413`/`404`** (fixes #5, #6) ✅ |
| Backend: CRLF in `timestamp` | **Was a forged `[SOS] FAKE ENTRY injected` log line → now stripped** ✅ |
| Backend: 12 rapid posts | 5 accepted, rest `429` ✅ |
| SOS sync against a 500 backend | **Was "sync successful" → now failure toast, record stays PENDING** (fix #1) ✅ |
| SOS sync against a 201 backend | Success toast, record marked SYNCED ✅ |

No crash, hang, or silent failure remains in the core flow.

---

## Phase 3 — README claims

| Claim | Verdict |
| --- | --- |
| "No server round-trip for inference, no API keys, **no data leaving the device**" | **Was FALSE** — flagged SOS packets, including the raw prompt, are POSTed to a hardcoded remote host. **Corrected**: the README now states the SOS queue as the one exception and links to a Configuration section; the in-app SOS panel says the prompt text is transmitted. |
| "no API keys" | TRUE — no auth header or key anywhere in `src/` or `server.js`. |
| Worker table (`web-llm` / Qwen2.5-0.5B-q4f16_1, `@xenova/transformers` / paraphrase-multilingual-MiniLM-L12-v2) | TRUE — model IDs match `inference.worker.ts:193` and `retrieval.worker.ts:88`. |
| "Both workers degrade gracefully" | TRUE — observed both fallbacks serving answers with the model CDNs blocked and with `navigator.gpu` removed. (The *presentation* of that state was broken; fix #3.) |
| "If nothing relevant is found, it refuses rather than inventing an answer" | **Was contradicted** by the fabricated hotline in the fallback engine (fix #2). True for the retrieval/refusal path as observed. |
| `npm install` / `npm run dev` (localhost:3000) / `npm run build` / `npm run preview` / `npm run lint` | ALL TRUE — each executed; dev server serves `HTTP 200` on port 3000 from a clean clone. |
| "First load downloads the model weights (~400 MB) … after that the PWA serves them from cache and works offline" | **UNVERIFIED** — see below. |

---

## Unverified

Things I could not execute in this environment. None are claimed as working.

- **The real WebGPU + Qwen2.5 inference path.** No usable GPU and no access to the
  MLC/HuggingFace model CDNs here. Everything browser-side was exercised against
  the keyword-fallback and token-hashing-fallback engines. The WebGPU path needs
  a manual pass on real hardware before launch.
- **Offline/airplane-mode operation after the models are cached.** The service
  worker precaches the shell, workers and icons (11 entries); model weights are
  cached by web-llm at runtime, which I could not reach. Untested.
- **The ~400 MB weight figure.** Not downloaded, not measured.
- **`npm audit`.** The registry endpoint returns `400 Bad Request — This endpoint
  is being retired` through this environment's proxy on every invocation
  (`npm audit`, `--audit-level=low`, `--omit=dev`). **No dependency
  vulnerability scan was performed.** Run it before launch; note that
  `onnxruntime-web` uses `eval` (flagged at build time by Rollup) and the
  inference worker bundle is 6 MB.
- **The Render deploy.** `render.yaml` was corrected against the published
  blueprint spec, but no deploy was executed, so the corrected blueprint is
  unvalidated against the live platform.
- **Real-device PWA install.** The icons now exist and are precached; the actual
  install prompt was not exercised.

---

## Notes

- Fixes are committed on **`claude/pre-launch-audit-hardening-6d8jjz`**, not
  `audit/2026-07-26`: this session's operating instructions pin all work to that
  designated branch. Nothing was committed to `main`; no history was rewritten
  and no force-push was used.
- Two test suites were added: `npm test` (backend, build output, content — no
  browser needed, 14 tests) and `npm run test:e2e` (browser regressions via
  Playwright + Chromium, 5 tests; skips with a clear message if Playwright is
  absent rather than passing vacuously).
- Every "Fixed" and "Open findings" row above was reproduced by a command run in
  this session.
