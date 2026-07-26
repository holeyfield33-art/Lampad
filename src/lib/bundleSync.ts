import { BUNDLE_STORE, openDB } from './db';
import { BUNDLES as BUILTIN_BUNDLES } from '../data';
import type { KnowledgeBundle, Passage } from '../data/schema';

/**
 * Knowledge pack sync.
 *
 * Packs are published by the Render hub (`GET /api/bundles`), cached in
 * IndexedDB, and merged over the packs compiled into the app. The app must keep
 * working with the network fully disconnected, so every step degrades: no
 * network means cached packs, no cache means the built-ins.
 *
 * ## Trust model — read this before changing anything here
 *
 * The manifest digest is an **integrity** check, not an **authenticity** one.
 * It is served by the same host as the pack, so it catches truncation and
 * corruption in transit; it proves nothing if the hub itself is compromised or
 * impersonated. This app hands immigration guidance to people for whom bad
 * guidance is dangerous, so integrity alone is not enough.
 *
 * `validatePack` is the actual defence: a downloaded pack is rejected outright
 * unless every passage carries a source and an https URL, no passage contains a
 * fictional contact number, and the whole thing fits declared size bounds. A
 * hostile hub cannot inject an unsourced passage, a `javascript:` link, or an
 * unbounded payload — the worst it can do is serve nothing, and then the user
 * keeps the last good pack.
 *
 * Authenticity needs the signed bundles on the roadmap (Ed25519, key shipped
 * with the app, signature over the canonical pack). `verifyDigest` is
 * deliberately factored so a signature check slots in beside it.
 */

const HUB_BASE =
  (import.meta.env.VITE_BUNDLE_HUB || '').trim() ||
  'https://lampad-backend.onrender.com';

const FETCH_TIMEOUT_MS = 12000;

// Bounds. A pack that exceeds any of these is refused rather than truncated.
const MAX_PACK_BYTES = 512 * 1024;
const MAX_PASSAGES = 500;
const MAX_TEXT_CHARS = 5000;

/** Reserved fictional range (NANP 555-01xx). Never a real contact. */
const FICTIONAL_PHONE = /\(?\d{3}\)?[ -]?555-01\d{2}/;

export interface ManifestEntry {
  id: string;
  title: string;
  version: string;
  digest: string;
  passageCount: number;
}

export interface SyncResult {
  status: 'updated' | 'current' | 'offline' | 'unavailable';
  updated: string[];
  rejected: Array<{ id: string; reason: string }>;
  bundles: KnowledgeBundle[];
}

interface StoredPack {
  id: string;
  version: string;
  digest: string;
  bundle: KnowledgeBundle;
  fetchedAt: string;
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** SHA-256 of the canonical form, hex. Mirrors scripts/build-bundles.mjs. */
export async function digestOf(value: unknown): Promise<string> {
  const canonical = (v: any): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v)
        .sort()
        .map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(v);
  };
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Reject anything that does not look like a knowledge pack we would have
 * published ourselves. Returns null when valid, a reason when not.
 */
export function validatePack(id: string, raw: unknown, rawBytes: number): string | null {
  if (rawBytes > MAX_PACK_BYTES) return `pack exceeds ${MAX_PACK_BYTES} bytes`;
  if (!raw || typeof raw !== 'object') return 'pack is not an object';

  const pack = raw as Record<string, unknown>;
  if (pack.id !== id) return `pack id "${pack.id}" does not match requested "${id}"`;
  for (const field of ['title', 'description', 'authority'] as const) {
    if (typeof pack[field] !== 'string' || (pack[field] as string).length === 0) {
      return `missing ${field}`;
    }
  }
  if (!Array.isArray(pack.passages)) return 'passages is not an array';
  if (pack.passages.length === 0) return 'pack has no passages';
  if (pack.passages.length > MAX_PASSAGES) return `more than ${MAX_PASSAGES} passages`;

  const seen = new Set<string>();
  for (const entry of pack.passages as unknown[]) {
    if (!entry || typeof entry !== 'object') return 'passage is not an object';
    const p = entry as Record<string, unknown>;

    if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(p.id)) {
      return `bad passage id: ${String(p.id)}`;
    }
    if (seen.has(p.id)) return `duplicate passage id: ${p.id}`;
    seen.add(p.id);

    if (typeof p.text !== 'string' || p.text.trim().length < 40) {
      return `${p.id}: text missing or too short`;
    }
    if (p.text.length > MAX_TEXT_CHARS) return `${p.id}: text exceeds ${MAX_TEXT_CHARS} chars`;

    // Provenance is not optional. An unsourced passage is exactly what an
    // attacker would want to inject, and exactly what a user cannot check.
    if (typeof p.source !== 'string' || p.source.trim().length === 0) {
      return `${p.id}: no source`;
    }
    if (typeof p.url !== 'string' || !p.url.startsWith('https://')) {
      return `${p.id}: url must be https`;
    }
    if (p.verifiedBy !== 'primary-source' && p.verifiedBy !== 'needs-review') {
      return `${p.id}: bad verifiedBy`;
    }
    if (typeof p.verified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.verified)) {
      return `${p.id}: bad verified date`;
    }
    if (FICTIONAL_PHONE.test(p.text)) {
      return `${p.id}: contains a fictional 555-01xx phone number`;
    }
  }
  return null;
}

async function readCache(): Promise<Map<string, StoredPack>> {
  const out = new Map<string, StoredPack>();
  try {
    const db = await openDB();
    const rows: StoredPack[] = await new Promise((resolve, reject) => {
      const req = db.transaction(BUNDLE_STORE, 'readonly').objectStore(BUNDLE_STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredPack[]);
      req.onerror = () => reject(req.error);
    });
    for (const row of rows) out.set(row.id, row);
  } catch (err) {
    console.warn('[Bundles] Could not read the pack cache:', err);
  }
  return out;
}

async function writeCache(pack: StoredPack): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(BUNDLE_STORE, 'readwrite').objectStore(BUNDLE_STORE).put(pack);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Built-ins, overlaid with whatever cached packs exist. */
function merge(cache: Map<string, StoredPack>): KnowledgeBundle[] {
  const byId = new Map<string, KnowledgeBundle>(BUILTIN_BUNDLES.map(b => [b.id, b]));
  for (const [id, stored] of cache) byId.set(id, stored.bundle);
  return [...byId.values()];
}

/**
 * Check the hub and pull any pack whose digest changed.
 *
 * Never throws: a failure here must not stop the app from starting offline.
 */
export async function syncBundles(): Promise<SyncResult> {
  const cache = await readCache();
  const rejected: SyncResult['rejected'] = [];

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', updated: [], rejected, bundles: merge(cache) };
  }

  let manifest: { bundles: ManifestEntry[] };
  try {
    const res = await fetch(`${HUB_BASE}/api/bundles`, { signal: timeoutSignal(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    manifest = await res.json();
    if (!manifest || !Array.isArray(manifest.bundles)) throw new Error('malformed manifest');
  } catch (err) {
    console.warn('[Bundles] Hub unreachable; using cached and built-in packs:', err);
    return { status: 'unavailable', updated: [], rejected, bundles: merge(cache) };
  }

  const updated: string[] = [];

  for (const entry of manifest.bundles) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(entry.id)) {
      rejected.push({ id: String(entry?.id), reason: 'bad manifest entry' });
      continue;
    }
    if (typeof entry.digest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.digest)) {
      rejected.push({ id: entry.id, reason: 'bad digest in manifest' });
      continue;
    }
    if (cache.get(entry.id)?.digest === entry.digest) continue; // already current

    try {
      const res = await fetch(`${HUB_BASE}/api/bundles/${entry.id}`, {
        signal: timeoutSignal(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.text();
      if (body.length > MAX_PACK_BYTES) throw new Error('pack too large');
      const parsed = JSON.parse(body);

      // The digest covers content only; version and builtAt are metadata.
      const { version: _v, builtAt: _b, ...content } = parsed;
      const actual = await digestOf(content);
      if (actual !== entry.digest) {
        rejected.push({ id: entry.id, reason: 'digest mismatch' });
        continue;
      }

      const problem = validatePack(entry.id, content, body.length);
      if (problem) {
        rejected.push({ id: entry.id, reason: problem });
        continue;
      }

      const bundle = content as unknown as KnowledgeBundle;
      await writeCache({
        id: entry.id,
        version: entry.version,
        digest: entry.digest,
        bundle,
        fetchedAt: new Date().toISOString(),
      });
      cache.set(entry.id, {
        id: entry.id,
        version: entry.version,
        digest: entry.digest,
        bundle,
        fetchedAt: new Date().toISOString(),
      });
      updated.push(entry.id);
    } catch (err) {
      rejected.push({ id: entry.id, reason: String(err) });
    }
  }

  for (const r of rejected) {
    console.warn(`[Bundles] Rejected pack "${r.id}": ${r.reason}. Keeping the previous version.`);
  }

  return {
    status: updated.length > 0 ? 'updated' : 'current',
    updated,
    rejected,
    bundles: merge(cache),
  };
}

/** Flatten bundles to the passage list the retrieval worker indexes. */
export function passagesOf(bundles: KnowledgeBundle[]): Passage[] {
  return bundles.flatMap(b => b.passages);
}
