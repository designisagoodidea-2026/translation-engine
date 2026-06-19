// Connection-management abstraction. Stores per-pair credentials for each
// connected source / destination platform and validates them against the
// platform's identity endpoint before persisting.
//
// Two credential paths are supported by the type surface:
//
//   - `pat`  — personal access token / API token, supplied by the user via
//     a paste form. Works today; the only thing the operator needs is
//     access to their own platform credentials.
//   - `oauth` — OAuth 2.0 access token captured from a callback. Scaffolded
//     here so the storage shape is OAuth-ready; the actual `/api/auth/<platform>/callback`
//     handlers are stubs pending Atlassian + Airtable app registration
//     (operator step, not a code step).
//
// Backed by the same `DECISIONS_KV` namespace the decision-persistence
// module uses, with a distinct key prefix. Without the binding, GET
// returns "not connected" and PUT is rejected — the operator is told to
// either bind KV or run on baked fixtures.

import type { DecisionsKv } from './persistence.js';

export type Platform = 'jira' | 'airtable';

export type ConnectionKind = 'pat' | 'oauth';

export interface JiraPatCredentials {
  /** Atlassian account email — paired with the API token for Basic auth. */
  email: string;
  apiToken: string;
  siteUrl: string;
}

export interface AirtablePatCredentials {
  /** Personal access token from airtable.com/create/tokens. */
  apiToken: string;
}

export interface OauthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  /** Whatever scopes were granted, surfaced in the connection status. */
  scopes?: string[];
}

export type ConnectionCredentials =
  | { kind: 'pat'; platform: 'jira'; credentials: JiraPatCredentials }
  | { kind: 'pat'; platform: 'airtable'; credentials: AirtablePatCredentials }
  | { kind: 'oauth'; platform: Platform; credentials: OauthCredentials };

export interface StoredConnection {
  pairId: string;
  platform: Platform;
  kind: ConnectionKind;
  /** Identity surfaced by the platform's `/me`-style endpoint after
   *  validation. Kept verbatim so the UI can show "Connected as Jane Doe". */
  identity: { displayName: string; handle?: string };
  /** Stored credentials. NEVER returned to the SPA — the `redact` helper
   *  strips this before serialization. */
  credentials: ConnectionCredentials;
  addedAt: string;
  validatedAt: string;
}

/** Public-shape connection record. No credentials. */
export interface ConnectionSummary {
  pairId: string;
  platform: Platform;
  kind: ConnectionKind;
  identity: { displayName: string; handle?: string };
  addedAt: string;
  validatedAt: string;
}

const KEY_PREFIX = 'connection:';

function key(pairId: string, platform: Platform): string {
  return `${KEY_PREFIX}${pairId}:${platform}`;
}

export function redact(c: StoredConnection): ConnectionSummary {
  return {
    pairId: c.pairId,
    platform: c.platform,
    kind: c.kind,
    identity: c.identity,
    addedAt: c.addedAt,
    validatedAt: c.validatedAt,
  };
}

export async function loadConnection(
  kv: DecisionsKv | undefined,
  pairId: string,
  platform: Platform,
): Promise<StoredConnection | null> {
  if (!kv) return null;
  try {
    return ((await kv.get(key(pairId, platform), 'json')) as StoredConnection) ?? null;
  } catch {
    return null;
  }
}

export async function loadConnections(
  kv: DecisionsKv | undefined,
  pairId: string,
  platforms: Platform[] = ['jira', 'airtable'],
): Promise<Record<Platform, StoredConnection | null>> {
  const out: Record<Platform, StoredConnection | null> = { jira: null, airtable: null };
  for (const p of platforms) {
    out[p] = await loadConnection(kv, pairId, p);
  }
  return out;
}

export async function saveConnection(
  kv: DecisionsKv | undefined,
  pairId: string,
  conn: ConnectionCredentials,
  identity: StoredConnection['identity'],
): Promise<StoredConnection> {
  const now = new Date().toISOString();
  const stored: StoredConnection = {
    pairId,
    platform: conn.platform,
    kind: conn.kind,
    identity,
    credentials: conn,
    addedAt: now,
    validatedAt: now,
  };
  if (!kv) {
    throw new Error(
      'DECISIONS_KV binding is not configured; cannot persist connection. See prototype/README.md for setup.',
    );
  }
  await kv.put(key(pairId, conn.platform), JSON.stringify(stored));
  return stored;
}

export async function deleteConnection(
  kv: DecisionsKv | undefined,
  pairId: string,
  platform: Platform,
): Promise<void> {
  if (!kv || typeof (kv as unknown as { delete?: (k: string) => Promise<void> }).delete !== 'function') {
    return;
  }
  await (kv as unknown as { delete: (k: string) => Promise<void> }).delete(key(pairId, platform));
}

// --- Validation against platform identity endpoints ----------------------

export interface ValidationResult {
  ok: boolean;
  identity?: StoredConnection['identity'];
  error?: string;
}

/**
 * Hit the platform's "who am I" endpoint to confirm a PAT works before we
 * persist it. Returns identity on success, an error string on failure.
 * Network errors are reported as `ok: false` with the message — no throw.
 */
export async function validatePat(creds: ConnectionCredentials): Promise<ValidationResult> {
  try {
    if (creds.platform === 'jira' && creds.kind === 'pat') {
      const c = creds.credentials;
      const auth = 'Basic ' + btoa(`${c.email}:${c.apiToken}`);
      const res = await fetch(`${c.siteUrl.replace(/\/$/, '')}/rest/api/3/myself`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!res.ok) return { ok: false, error: `Jira /myself returned ${res.status}` };
      const me = (await res.json()) as { displayName?: string; accountId?: string };
      return {
        ok: true,
        identity: { displayName: me.displayName ?? c.email, handle: me.accountId },
      };
    }
    if (creds.platform === 'airtable' && creds.kind === 'pat') {
      const c = creds.credentials;
      const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
        headers: { Authorization: `Bearer ${c.apiToken}`, Accept: 'application/json' },
      });
      if (!res.ok) return { ok: false, error: `Airtable /whoami returned ${res.status}` };
      const me = (await res.json()) as { id?: string; email?: string; name?: string };
      return {
        ok: true,
        identity: { displayName: me.name ?? me.email ?? me.id ?? 'Airtable user', handle: me.id },
      };
    }
    return { ok: false, error: 'OAuth validation is not wired up yet (callback handlers are stubs).' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
