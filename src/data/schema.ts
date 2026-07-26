/**
 * Every retrievable passage carries its provenance.
 *
 * This is not decoration. The app answers questions about emergencies and
 * immigration status, where a confident wrong answer causes real harm, so a
 * passage that cannot name where it came from does not belong in the index.
 * `test/data.test.mjs` enforces that, and the UI shows the citation next to
 * every retrieved chunk.
 */
export interface Passage {
  /** Stable identifier, used as the citation anchor in the UI. */
  id: string;
  /** Bundle this passage belongs to. */
  bundle: BundleId;
  /** Coarse topic, used for filtering and for the diagnostics grid. */
  topic: Topic;
  /** The retrievable text. This is what gets embedded and shown to the user. */
  text: string;
  /** Human-readable name of the authority this came from. */
  source: string;
  /** Legal citation or document reference, when one exists. */
  citation?: string;
  /** URL where a user can verify the claim themselves. */
  url: string;
  /** ISO date the passage was checked against its source. */
  verified: string;
  /**
   * How the passage was checked.
   *
   * `primary-source`: the claim was checked against a verbatim excerpt stored in
   * `sources/cfr-excerpts.json`, pulled from the eCFR API.
   * `needs-review`: written from a public source that could not be fetched
   * automatically. Still shown, still cited — but flagged in the UI and listed
   * in `docs/DATA_REVIEW.md` so a human signs off before launch.
   */
  verifiedBy: 'primary-source' | 'needs-review';
  /**
   * For `primary-source` passages: the keys in `sources/cfr-excerpts.json` whose
   * verbatim text must support this passage. `test/data.test.mjs` fails if a key
   * is missing, so the regulation text and the plain-language summary cannot
   * drift apart silently.
   */
  provenanceKeys?: string[];
}

export type BundleId = 'county' | 'immigration';

export type Topic =
  | 'emergency'
  | 'health'
  | 'housing'
  | 'transit'
  | 'food'
  | 'legal'
  | 'education'
  | 'work-authorization'
  | 'visa-status'
  | 'rights';

export interface KnowledgeBundle {
  id: BundleId;
  title: string;
  /** Shown in the sidebar so a user knows what the app is grounded in. */
  description: string;
  /** Displayed alongside results; sets expectations about authority. */
  authority: string;
  passages: Passage[];
}
