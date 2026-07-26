# Knowledge base review ledger

The app answers questions where a confident wrong answer causes real harm. This
file tracks what has been verified against a primary source and what still needs
a human to sign off.

`test/data.test.mjs` enforces that every passage declares one of two states:

- **`primary-source`** — the claim was checked against verbatim regulation text
  stored in [`src/data/sources/cfr-excerpts.json`](../src/data/sources/cfr-excerpts.json),
  pulled from the [eCFR API](https://www.ecfr.gov/api/versioner/v1/full/2026-01-01/title-8.xml).
  The test asserts the cited excerpt exists and that the specific numbers the
  passage asserts ("three of eight", "3 years", "24 months") appear in it.
- **`needs-review`** — written from a public source that could not be fetched
  automatically from the build environment. Shown to users with a staleness
  caveat and a link, but not independently confirmed.

## Verified against primary source — 8 passages

All from Title 8 of the Code of Federal Regulations, retrieved 2026-07-26.

| Passage | Citation |
| --- | --- |
| `o1a-standard` | 8 CFR 214.2(o)(3)(ii) |
| `o1a-criteria` | 8 CFR 214.2(o)(3)(iii) |
| `o1-consultation` | 8 CFR 214.2(o)(5) |
| `o1-duration` | 8 CFR 214.2(o)(6)(iii)(A), (o)(12)(ii) |
| `eb1a-criteria` | 8 CFR 204.5(h)(2), (h)(3) |
| `eb1a-self-petition` | 8 CFR 204.5(h)(5) |
| `f1-opt` | 8 CFR 214.2(f)(10) |
| `f1-stem-opt` | 8 CFR 214.2(f)(10)(ii)(C) |

Worth noting why this matters: a web search summary of the O-1A criteria
returned "ten evidentiary criteria" while listing eight. The regulation says
**at least three of eight** for O-1A, and **at least three of ten** for EB-1A —
different categories, different lists. The snapshot-and-test approach exists
because that class of error is easy to make and hard to spot.

## Needs human review before launch — 10 passages

**These are not blocked from shipping, but nobody has confirmed them.** Local
phone numbers, addresses and hours drift, and the two federal navigational
passages were written from public knowledge rather than a fetched page
(uscis.gov and travel.state.gov both return 403 to automated fetches).

Reviewer: confirm each number and address by calling or visiting the linked
site, then flip `verifiedBy` to `primary-source` — or correct the text.

### Local resources (Santa Clara County)

| Passage | What to confirm | Source |
| --- | --- | --- |
| `county-emergency` | (408) 586-2400 non-emergency line; 1275 N Milpitas Blvd | https://www.milpitas.gov/159/Police |
| `county-transit` | Orange Line / BART connections; Clipper START eligibility | https://www.vta.org/ |
| `county-housing` | Here4You (408) 385-2400; Bay Area Legal Aid (800) 551-5554 | https://osh.sccgov.org/homelessness/how-get-help |
| `county-health` | 143 N Main St clinic; (408) 957-0900; "regardless of status" claim | https://scvh.sccgov.org/ |
| `county-food` | 1440 S Main St; no-ID registration claim | https://www.milpitasfoodpantry.org/ |
| `county-211` | 24/7 availability; multilingual; no status questions | https://211bayarea.org/ |
| `county-school-enrollment` | MUSD enrolment documents; *Plyler v. Doe* right-to-education framing | https://www.musd.org/ |
| `county-worker-rights` | Wage claim process; "no status questions" claim | https://www.dir.ca.gov/dlse/ |

The two "regardless of immigration status" claims (`county-health`,
`county-worker-rights`) and the right-to-education claim
(`county-school-enrollment`) are the highest-stakes items on this list. They are
well-established, but if any of them is wrong the consequence for a user is
severe. Prioritise them.

### Federal navigational

| Passage | What to confirm | Source |
| --- | --- | --- |
| `accredited-representatives` | DOJ R&A programme description; notario framing | https://www.justice.gov/eoir/recognition-and-accreditation-program |
| `case-status` | Form I-797 receipt number format and length; case status URL | https://egov.uscis.gov/casestatus/landing.do |

## How the app handles the difference

- The vector diagnostics tab labels every passage `(primary source)` or
  `(needs review)`.
- Answers built from a `needs-review` passage append: *"Details such as hours
  and phone numbers change — confirm before you rely on this."*
- Answers built from a CFR-backed passage cite the section number, so a user or
  an attorney can check it directly.

## Standing rules

1. No passage ships without a `source` and an `https` URL. Enforced by test.
2. No fictional contact details, ever. `test/data.test.mjs` and
   `test/content.test.mjs` both scan for the NANP 555-01xx reserved range —
   added after a fabricated crisis line was found in the fallback engine.
3. A plain-language summary of a regulation must not drift from the regulation.
   When you edit a `primary-source` passage, re-run `npm test`; the numeric
   claims are checked against the stored excerpt.
4. To refresh the CFR snapshot, re-run the eCFR fetch for Title 8 parts 214 and
   204 and regenerate `src/data/sources/cfr-excerpts.json`.
