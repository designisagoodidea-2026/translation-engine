// Pair registry — KV-backed list of system pairs the prototype can serve.
//
// v0.1–v0.4 hardcoded a single pair (`PAIR` in fixtures.ts). The KV
// substrate has been pair-scoped since v0.4 (decisions and connections
// already key on pairId); this module finally lets new pairs be created
// and selected at request time via `?pairId=` on every stateful endpoint.
//
// The hardcoded `PAIR` from `fixtures.ts` is preserved as the "seed" pair
// — it's always present in the registry's listing, drives the fixture-
// backed forward pass, and serves as the default when no `?pairId=` is
// supplied. Stored pairs (POSTed via `/api/pairs`) sit alongside it.
//
// Tenant isolation (one set of pairs per user) is a step-2 concern that
// requires a session/user model — out of scope for this slice. Today the
// pair registry is workspace-global.

import type { DecisionsKv } from './persistence.js';

export interface PairRecord {
  id: string;
  /** Human-readable label for the pair. */
  label: string;
  source: {
    kind: 'jira' | 'asana';
    label: string;
    projectName: string;
    projectKey: string;
  };
  destination: {
    kind: 'airtable' | 'notion';
    label: string;
    baseName: string;
    tableName: string;
  };
  grammar: { id: string; label: string; description: string };
  /** True when the pair was created via `POST /api/pairs`. False on the
   *  seed pair which lives in `fixtures.ts`. */
  userCreated: boolean;
  createdAt: string;
}

const KEY_PREFIX = 'pair:';

function key(id: string): string {
  return KEY_PREFIX + id;
}

export async function loadPair(
  kv: DecisionsKv | undefined,
  id: string,
): Promise<PairRecord | null> {
  if (!kv) return null;
  try {
    return ((await kv.get(key(id), 'json')) as PairRecord) ?? null;
  } catch {
    return null;
  }
}

export async function savePair(
  kv: DecisionsKv | undefined,
  rec: PairRecord,
): Promise<PairRecord> {
  if (!kv) {
    throw new Error(
      'DECISIONS_KV binding is not configured; cannot persist a new pair. See prototype/README.md.',
    );
  }
  await kv.put(key(rec.id), JSON.stringify(rec));
  return rec;
}

export async function listStoredPairs(
  kv: DecisionsKv | undefined,
): Promise<PairRecord[]> {
  if (!kv) return [];
  const lister = (kv as unknown as {
    list?: (opts: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
  }).list;
  if (typeof lister !== 'function') return [];
  try {
    const res = await lister({ prefix: KEY_PREFIX });
    const records: PairRecord[] = [];
    for (const k of res.keys) {
      const id = k.name.slice(KEY_PREFIX.length);
      const rec = await loadPair(kv, id);
      if (rec) records.push(rec);
    }
    return records;
  } catch {
    return [];
  }
}

export async function deletePair(
  kv: DecisionsKv | undefined,
  id: string,
): Promise<void> {
  if (!kv) return;
  const deleter = (kv as unknown as { delete?: (k: string) => Promise<void> }).delete;
  if (typeof deleter !== 'function') return;
  await deleter(key(id));
}

/**
 * Resolve a pair by ID. Returns the seed pair when `id` matches it (the
 * seed pair lives in code, not KV); otherwise looks it up in KV. Returns
 * null when neither matches.
 */
export async function resolvePair(
  kv: DecisionsKv | undefined,
  id: string,
  seed: PairRecord,
): Promise<PairRecord | null> {
  if (id === seed.id) return seed;
  return loadPair(kv, id);
}
