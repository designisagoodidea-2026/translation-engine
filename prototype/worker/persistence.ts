// Decision persistence — per system pair.
//
// Backed by Cloudflare KV when the `DECISIONS_KV` binding is present.
// Without the binding, the Worker still answers the persistence endpoints
// but reads return defaults and writes are no-ops. That keeps the prototype
// usable on a cold workers.dev deploy without forcing KV setup, while
// production deployments get real persistence by declaring the namespace
// in `wrangler.toml`.
//
// v0.4 scope: single pair (the one in fixtures.ts). Multi-pair routing
// keys on `pairId` in the URL, which task #9 (multi-tenancy) wires up.

import { DEFAULT_DECISIONS, type UserDecisions } from './decisions.js';

/** Stored decisions plus metadata. */
export interface StoredDecisions {
  pairId: string;
  decisions: UserDecisions;
  savedAt: string;
}

/**
 * Minimal Cloudflare KV surface — typed locally so the file does not depend
 * on @cloudflare/workers-types being available at the call site. Matches
 * the runtime shape Cloudflare exposes.
 */
export interface DecisionsKv {
  get(key: string, type: 'json'): Promise<unknown | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
}

const KEY_PREFIX = 'decisions:';

function key(pairId: string): string {
  return KEY_PREFIX + pairId;
}

/**
 * Load decisions for a pair. Returns `null` when nothing is stored yet
 * (legitimate first-visit case) so the caller can fall back to defaults
 * intentionally rather than confusing "no record" with "explicit default
 * was saved".
 */
export async function loadDecisions(
  kv: DecisionsKv | undefined,
  pairId: string,
): Promise<StoredDecisions | null> {
  if (!kv) return null;
  try {
    const raw = (await kv.get(key(pairId), 'json')) as StoredDecisions | null;
    return raw ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist decisions for a pair. No-op (but returns success) when the KV
 * binding is absent so the SPA does not error out on a cold deploy.
 * Returns the saved payload so the caller can echo it back.
 */
export async function saveDecisions(
  kv: DecisionsKv | undefined,
  pairId: string,
  decisions: UserDecisions,
): Promise<StoredDecisions> {
  const stored: StoredDecisions = {
    pairId,
    decisions,
    savedAt: new Date().toISOString(),
  };
  if (!kv) return stored;
  try {
    await kv.put(key(pairId), JSON.stringify(stored));
  } catch {
    // Swallow — KV write failures should not block the UI. The SPA still
    // holds the in-memory state; persistence is best-effort.
  }
  return stored;
}

/** Merge stored decisions over defaults so partial older payloads still
 *  produce a complete `UserDecisions` shape. */
export function effectiveDecisions(stored: StoredDecisions | null): UserDecisions {
  if (!stored) return DEFAULT_DECISIONS;
  return { ...DEFAULT_DECISIONS, ...stored.decisions };
}
