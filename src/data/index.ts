import { COUNTY_BUNDLE } from './bundles/county';
import { IMMIGRATION_BUNDLE } from './bundles/immigration';
import type { KnowledgeBundle, Passage } from './schema';

export type { KnowledgeBundle, Passage, BundleId, Topic } from './schema';

export const BUNDLES: KnowledgeBundle[] = [COUNTY_BUNDLE, IMMIGRATION_BUNDLE];

/** Every passage across every bundle, in bundle order. */
export const ALL_PASSAGES: Passage[] = BUNDLES.flatMap(b => b.passages);

/** Lookup used by the UI to attach a citation to a retrieved chunk. */
export const PASSAGE_BY_TEXT = new Map<string, Passage>(
  ALL_PASSAGES.map(p => [p.text, p])
);

/**
 * Back-compat: the retrieval worker indexes plain strings.
 * Kept as a derived export so there is exactly one source of truth.
 */
export const COUNTY_PASSAGES: string[] = ALL_PASSAGES.map(p => p.text);
