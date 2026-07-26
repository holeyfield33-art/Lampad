// Builds distributable knowledge packs from the TypeScript bundle sources.
//
// The packs are what the Render hub serves and what a disconnected device can
// be handed on a USB stick. Git stays the source of truth; this script is the
// publishing step.
//
//   node scripts/build-bundles.mjs [--out public/bundles]
//
// Emits:
//   <out>/manifest.json     — id, version, digest, counts for every pack
//   <out>/<id>.json         — one pack per bundle
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const outArg = process.argv.indexOf('--out');
const outDir = join(repo, outArg > -1 ? process.argv[outArg + 1] : 'public/bundles');

/** Canonical JSON: stable key order, so an unchanged pack has an unchanged digest. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

// Load the TS data modules by bundling them to ESM first.
const work = mkdtempSync(join(tmpdir(), 'lampad-packs-'));
const entry = join(work, 'data.mjs');
execFileSync(
  join(repo, 'node_modules/.bin/esbuild'),
  [join(repo, 'src/data/index.ts'), '--bundle', '--format=esm', `--outfile=${entry}`],
  { stdio: 'pipe' }
);
const { BUNDLES } = await import(entry);
rmSync(work, { recursive: true, force: true });

mkdirSync(outDir, { recursive: true });

/**
 * Pack version.
 *
 * Derived from the content digest rather than hand-maintained, so a pack can
 * never claim a new version without new content, or ship new content under an
 * old version. The client compares digests, not dates.
 */
const entries = [];
for (const bundle of BUNDLES) {
  const pack = {
    id: bundle.id,
    title: bundle.title,
    description: bundle.description,
    authority: bundle.authority,
    passages: bundle.passages,
  };
  const body = canonical(pack);
  const digest = sha256(body);
  const withVersion = { ...pack, version: digest.slice(0, 12), builtAt: new Date().toISOString() };

  // The digest covers the content only — not `builtAt` — so rebuilding
  // unchanged data does not invalidate every client's cache.
  writeFileSync(join(outDir, `${bundle.id}.json`), JSON.stringify(withVersion, null, 2) + '\n');

  entries.push({
    id: bundle.id,
    title: bundle.title,
    version: digest.slice(0, 12),
    digest,
    passageCount: bundle.passages.length,
    primarySourceCount: bundle.passages.filter(p => p.verifiedBy === 'primary-source').length,
    needsReviewCount: bundle.passages.filter(p => p.verifiedBy === 'needs-review').length,
    bytes: Buffer.byteLength(body, 'utf8'),
    path: `/api/bundles/${bundle.id}`,
  });
}

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  bundles: entries,
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`wrote ${entries.length} packs to ${outDir}`);
for (const e of entries) {
  console.log(
    `  ${e.id.padEnd(14)} v${e.version}  ${String(e.passageCount).padStart(3)} passages  ` +
    `${String(e.bytes).padStart(6)} B  (${e.primarySourceCount} primary / ${e.needsReviewCount} needs-review)`
  );
}
