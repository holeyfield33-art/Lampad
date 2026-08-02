# Open Atlas 2026 — submission readiness

**Deadline: August 20, 2026, 5:00 PM PDT.** Late submissions are not accepted.
As of 2026-07-26 that is 25 days.

---

## The qualification question: "are we really using an LLM?"

Short answer: **yes, and after this change it is defensible.** Before it, it was
not — and the reason is worth understanding, because a judge would have found it
in about ninety seconds.

The rule in the brief is: *"AI needs to be doing real work in your solution, not
just a single API call wrapped in a UI. Judges will look for substantive use of
LLMs, agents, RAG, vision, speech, or other AI techniques."*

**What the project runs:**

| Component | Model | Where it runs |
| --- | --- | --- |
| Generation | Qwen2.5-0.5B-Instruct (q4f16_1) via `@mlc-ai/web-llm` | In-browser, WebGPU |
| Retrieval | `paraphrase-multilingual-MiniLM-L12-v2` via `@xenova/transformers` | In-browser, WASM |

An on-device quantised LLM plus a multilingual embedding model doing RAG over a
cited corpus is comfortably "substantive". That is not the problem.

**The problem was what happened when either model failed to load**, which is
every browser without WebGPU — Safari, Firefox, most phones — and every first
run without network. In that state:

- Generation fell through to **19 hardcoded `prompt.includes('shelter')`
  branches** returning canned paragraphs. Not AI. A lookup table.
- Retrieval fell through to a token-hashing embedder that measured *stopword
  overlap*. Measured on the current corpus: **top-1 accuracy 50%**, and
  "what is the capital of France" scored **0.431** — higher than 8 of 12
  genuinely relevant queries. It always returned a nearest neighbour, so it
  always answered, usually from the wrong passage.

So on the most likely demo device, the "AI" was a lookup table fed by a broken
matcher. That is the version a judge would have opened.

**What changed:**

- The fallback engine now answers **from retrieval**: it receives the scored
  passages the embedding model selected and assembles the answer from them with
  citations attached. The 19 canned branches are gone.
- The fallback embedder was rebuilt — stopword filtering, IDF weighting over the
  indexed corpus, character trigrams, signed feature hashing. **Top-1 accuracy
  50% → 100%** on a 10-query labelled set (`test/retrieval.test.mjs`).
- A content-overlap guard means an unsupported question is **refused** instead of
  answered from whichever passage won the similarity contest. Verified in the
  browser: "What is the capital of France?" and "Write me a poem about the ocean"
  both refuse.
- The corpus went from **5 uncited strings to 18 cited passages**, 8 of them
  verified line-by-line against the Code of Federal Regulations.

**How to say it in the demo:** *"It runs a 0.5B LLM and a multilingual embedding
model entirely on-device. When the hardware can't take the LLM, it degrades to
retrieval-grounded extractive answering over a corpus verified against primary
legal sources — and refuses when it doesn't know. It never stops being grounded."*

That last clause is the differentiator. Most submissions cannot say what their
system does when the model is unavailable.

---

## Devpost requirements checklist

| Requirement | Status | Notes |
| --- | --- | --- |
| Project name | ✅ | Lampad AtlasBridge |
| Elevator pitch (2–3 sentences) | ⬜ **TODO** | Draft below |
| Full description | ⬜ **TODO** | Outline below; most content exists in README/AUDIT |
| — problem + who it affects | ⬜ | |
| — how the solution works | ✅ source | README "How it works" |
| — models/APIs/frameworks and what they *do* | ✅ source | Table above |
| — built during hackathon vs. pre-existing | ⬜ **TODO** | **You must answer this honestly.** See below |
| — complete tech stack | ✅ source | README |
| — challenges | ✅ source | This file + AUDIT.md are unusually good raw material |
| — what's next | ✅ source | README roadmap (signed bundles, publishing portal, delta-sync) |
| Demo video ≤3 min, YouTube/Vimeo, public or unlisted | ⬜ **TODO — highest risk item** | Must show the working product |
| Public repo with clear README (setup + usage) | ✅ | Verified from a clean clone this session |
| Team members tagged with roles | ⬜ **TODO** | Devpost form |
| Track selection | ⬜ **TODO** | Recommendation below |
| Screenshots / GIFs (optional) | ⬜ | Cheap win; the lessons tab and citations demo well |
| 3–5 slide PDF deck (optional) | ⬜ | |
| Live demo URL (optional) | ⚠️ | `render.yaml` was broken and is now fixed, but **no deploy has been verified** |

### Draft elevator pitch

> Lampad AtlasBridge is an offline-first assistant for newcomers: it runs a small
> language model and a multilingual retrieval engine entirely in the browser, so
> it keeps working on a cheap phone in airplane mode. It answers survival and
> visa questions only from a knowledge base verified against the Code of Federal
> Regulations, cites the source of every answer, and refuses when it doesn't know.

### The "built during the hackathon" question

The submission form asks you to separate what you built during the hackathon
from what existed before. Answer it straight — judges can read the commit
history, and the repo's first commits predate the submission window. State what
was pre-existing and what was built in-window. Nothing here is disqualifying;
misrepresenting it would be.

---

## Track recommendation

| Track | Prize | Fit |
| --- | --- | --- |
| **Best Immigration Solution** | O-1 filing, ~$8,000 | **Primary.** The visa bundle is CFR-cited, and both immigration-track judges (Nusrat G., immigration attorney; Nikin Tharan, O-1/EB-1A/EB-5) are exactly the audience for a tool that cites 8 CFR 214.2(o)(3)(iii) rather than paraphrasing a blog. |
| **Best Education & Opportunity** | MS admissions package, ~$2,000 | **Secondary.** 8 survival-English lessons, 4 languages, tied to the resource corpus. Real, but thinner than the immigration story. |
| **Best Newcomer Settlement** | IKEA card, $100 | Qualifies. Low prize value; select it, don't build for it. |
| **People's Choice** | $10,000 | Voted by attendees at the demo expo. This is the biggest prize and it rewards **demo quality**, not architecture. Offline mode is a great live demo: put the laptop in airplane mode on stage. |
| **Best use of Render Workflows** | Render credits | ⚠️ **Still does not qualify.** The prize requires **Render Workflows** specifically. This project now uses Render for three things — static site, SOS API, and knowledge-pack hub — but none of them is Workflows. If you want this track, the natural fit is a Workflow that rebuilds and republishes packs on a schedule or on push, which is a real use of the product rather than a box-tick. |

**Multiple track selection is allowed.** Select Immigration + Education +
Settlement + People's Choice.

---

## Honest gaps a judge could find

Ranked by how likely they are to be noticed. **Updated 2026-08-02** — markdown
rendering, fake telemetry, dead code, and a missing model-download retry
(formerly gaps 6 and 8, plus two P3s not listed here) are fixed; see
`AUDIT.md`'s "Round 2" note. What's left all needs a human — none of it is
something an agent working from this repo alone can close.

1. **No demo video.** Hard requirement. Nothing else matters if this is missing.
2. **The WebGPU path has never been verified end-to-end.** No GPU and no model
   CDN access in the build environment, so the actual Qwen2.5 inference path is
   untested. **Test this on real hardware before the demo** — it is the headline
   claim. If it does not work on your demo machine, you will be demoing the
   fallback, which is now good but is not the same story.
3. **Offline mode needs re-verification.** You confirmed this worked before the
   pre-launch-audit fixes landed (2026-07-26) and again since; nothing in this
   round of changes touched the service worker or model caching, but re-check
   after this round too since a few workers/App.tsx edits landed (inline
   markdown rendering, the retry button, a `useFallback` fix). Load the app,
   let both models download, then airplane-mode it.
4. **10 of 18 passages are `needs-review`** — see `docs/DATA_REVIEW.md`. The
   local phone numbers were never independently confirmed. An immigration
   attorney judge who calls one number on stage and gets a disconnected line
   erases the credibility the CFR citations bought you. Highest-value hour of
   work available.
5. **The distress scanner false-positives on "emergency" and "police"** — words
   the app's own placeholder invites — silently creating SOS records and
   transmitting the prompt off-device. A judge typing "where is the emergency
   room" triggers it. Narrowing the term list is a safety/product judgement
   (false negatives are worse than false positives here) — your call, not one
   to automate.
6. **`npm audit`: 5 vulnerabilities remain**, down from 9 — `body-parser` and
   `postcss` were patched (safe, no breaking changes). The rest (`protobufjs`,
   `sharp`, `onnxruntime-web`) are all transitively pulled in by
   `@xenova/transformers` and confirmed unreachable in this app (not in the
   shipped browser bundle; `sharp` is a native Node addon nothing here calls).
   Fixing them needs a 2-major-version downgrade of the retrieval engine — not
   worth the risk this close to the deadline unless you want to revisit it.

## Suggested order of work

1. Verify the WebGPU + offline path on the demo machine (gaps 2, 3).
2. Confirm the 8 local phone numbers and addresses (gap 4).
3. Record the demo video (gap 1).
4. Write the Devpost long-form description.
5. Decide on the distress-scanner term list (gap 5).
