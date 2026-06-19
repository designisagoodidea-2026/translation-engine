// Cloudflare Worker for the Translation Engine prototype.
//
// Routes:
//   GET  /api/state        — return pair config + baseline translation results
//   POST /api/preview      — body: { decisions }, return enhanced results
//   POST /api/propose      — body: { decisionKey, prompt }, return AI proposal
//   *                     — fall through to static SPA assets
//
// The translation grammar is imported from the existing library at
// `../src/grammars/project-management.ts` — the Worker IS the library wrapped
// in HTTP.

import { translateIssue } from '../../src/grammars/project-management.js';
import { normalizeJiraIssue } from '../../src/adapters/jira-normalize.js';
import type { GrammarContext, TranslationResult } from '../../src/grammars/types.js';

import {
  CUSTOM_FIELD_NAMES,
  PARENT_SUMMARIES,
  PAIR,
  SOURCE_ISSUES,
} from './fixtures.js';
import {
  applyDecisions,
  DECISION_CATALOG,
  DEFAULT_DECISIONS,
  type EnhancedResult,
  type UserDecisions,
} from './decisions.js';
import { propose, type ProposalRequest } from './propose.js';
import {
  effectiveDecisions,
  loadDecisions,
  saveDecisions,
  type DecisionsKv,
  type StoredDecisions,
} from './persistence.js';
import {
  deleteConnection,
  loadConnections,
  redact,
  saveConnection,
  validatePat,
  type ConnectionCredentials,
  type Platform,
} from './connections.js';
import {
  listStoredPairs,
  resolvePair,
  savePair,
  deletePair,
  type PairRecord,
} from './pairs.js';
import {
  getSchedule,
  listRuns,
  listSchedules,
  recordRun,
  setSchedule,
  shouldRun,
  type ScheduleFrequency,
} from './schedule.js';
import {
  signatureHeader,
  verifyHmacSignature,
  type WebhookSourcePlatform,
} from './webhooks.js';

/**
 * Seed pair — the prototype's original hardcoded pair from `fixtures.ts`.
 * Always present in `/api/pairs` listings; serves as the default when no
 * `?pairId=` is provided on a stateful endpoint.
 */
const SEED_PAIR: PairRecord = {
  id: PAIR.id,
  label: `${PAIR.source.label} → ${PAIR.destination.label} (${PAIR.grammar.label})`,
  source: PAIR.source,
  destination: PAIR.destination,
  grammar: PAIR.grammar,
  userCreated: false,
  createdAt: '2026-06-02T00:00:00Z',
};

/** Resolve the pairId from a request, falling back to the seed pair. */
function pairIdFromRequest(url: URL): string {
  return url.searchParams.get('pairId') ?? SEED_PAIR.id;
}

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  /**
   * Anthropic API key for /api/propose. Bound via `wrangler secret put
   * ANTHROPIC_API_KEY` in production, or via prototype/.dev.vars locally. If
   * unset, /api/propose falls back to a deterministic keyword stub.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * KV namespace for per-pair decision persistence. Bound via the
   * `kv_namespaces` block in `wrangler.toml`. If absent, decisions still
   * load/save through the API but are not persisted across Worker
   * invocations (graceful degradation — UI continues to work).
   */
  DECISIONS_KV?: DecisionsKv;
  /**
   * Jira webhook signing secret. Set via
   * `wrangler secret put JIRA_WEBHOOK_SECRET`. Required for the
   * `/api/webhooks/jira/<pairId>` endpoint to accept payloads — without
   * it, requests are rejected as unsigned.
   */
  JIRA_WEBHOOK_SECRET?: string;
  /**
   * Airtable webhook signing secret. Set via
   * `wrangler secret put AIRTABLE_WEBHOOK_SECRET`. Required for the
   * `/api/webhooks/airtable/<pairId>` endpoint to accept payloads.
   */
  AIRTABLE_WEBHOOK_SECRET?: string;
}

const GRAMMAR_CTX: GrammarContext = {
  parentSummaryByKey: PARENT_SUMMARIES,
};

/**
 * Run a single pair's forward pass. v0.6 only knows how to translate the
 * seed pair (which is fixture-backed) — stored pairs do not yet have a
 * live-data path. The runner records the outcome regardless so the
 * schedule history stays consistent across pair shapes.
 */
async function runPairPass(
  _env: Env,
  pairId: string,
): Promise<{ status: 'ok' | 'skipped' | 'error'; issues?: number; losses?: number; error?: string }> {
  if (pairId !== SEED_PAIR.id) {
    return {
      status: 'skipped',
      error:
        'stored pairs do not yet have a live-data source; scheduled passes for them will be a no-op until the connection-aware fetch path lands',
    };
  }
  try {
    const baseline = runBaseline();
    let losses = 0;
    for (const b of baseline) losses += b.losses.length;
    return { status: 'ok', issues: baseline.length, losses };
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }
}

function runBaseline(): TranslationResult[] {
  return SOURCE_ISSUES.map((issue) => {
    const normalized = normalizeJiraIssue(issue, { customFieldNames: CUSTOM_FIELD_NAMES });
    return translateIssue(normalized, GRAMMAR_CTX);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- API routes --------------------------------------------------
    const pairId = pairIdFromRequest(url);

    if (url.pathname === '/api/state' && request.method === 'GET') {
      const pair = await resolvePair(env.DECISIONS_KV, pairId, SEED_PAIR);
      if (!pair) return jsonResponse({ error: `unknown pairId: ${pairId}` }, 404);
      // v0.5: only the seed pair carries baked fixtures. Stored pairs
      // are placeholders until live-data wiring lands in a follow-on.
      const isSeed = pair.id === SEED_PAIR.id;
      const baseline = isSeed ? runBaseline() : [];
      const stored = await loadDecisions(env.DECISIONS_KV, pair.id);
      return jsonResponse({
        pair,
        sourceIssues: isSeed ? SOURCE_ISSUES : [],
        baseline,
        decisionCatalog: DECISION_CATALOG,
        defaultDecisions: DEFAULT_DECISIONS,
        storedDecisions: stored,
        effectiveDecisions: effectiveDecisions(stored),
        persistence: { enabled: !!env.DECISIONS_KV },
        fixtureBacked: isSeed,
      });
    }

    // --- Pair CRUD ---------------------------------------------------
    if (url.pathname === '/api/pairs' && request.method === 'GET') {
      const stored = await listStoredPairs(env.DECISIONS_KV);
      return jsonResponse({
        pairs: [SEED_PAIR, ...stored],
        seedPairId: SEED_PAIR.id,
        persistence: { enabled: !!env.DECISIONS_KV },
      });
    }

    if (url.pathname === '/api/pairs' && request.method === 'POST') {
      let body: Partial<PairRecord>;
      try {
        body = (await request.json()) as Partial<PairRecord>;
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      if (!body.id || !body.source || !body.destination || !body.grammar) {
        return jsonResponse(
          { error: 'pair requires { id, source, destination, grammar }' },
          400,
        );
      }
      if (body.id === SEED_PAIR.id) {
        return jsonResponse({ error: 'pairId conflicts with the seed pair' }, 409);
      }
      const rec: PairRecord = {
        id: body.id,
        label:
          body.label ?? `${body.source.label} → ${body.destination.label} (${body.grammar.label})`,
        source: body.source,
        destination: body.destination,
        grammar: body.grammar,
        userCreated: true,
        createdAt: new Date().toISOString(),
      };
      try {
        await savePair(env.DECISIONS_KV, rec);
        return jsonResponse({ ok: true, pair: rec }, 201);
      } catch (e) {
        return jsonResponse({ error: (e as Error).message }, 503);
      }
    }

    const pairMatch = url.pathname.match(/^\/api\/pairs\/([^/]+)$/);
    if (pairMatch) {
      const id = decodeURIComponent(pairMatch[1]);
      if (request.method === 'DELETE') {
        if (id === SEED_PAIR.id) {
          return jsonResponse({ error: 'cannot delete the seed pair' }, 400);
        }
        await deletePair(env.DECISIONS_KV, id);
        return jsonResponse({ ok: true });
      }
      if (request.method === 'GET') {
        const pair = await resolvePair(env.DECISIONS_KV, id, SEED_PAIR);
        if (!pair) return jsonResponse({ error: 'unknown pairId' }, 404);
        return jsonResponse({ pair });
      }
    }

    if (url.pathname === '/api/decisions' && request.method === 'GET') {
      const stored = await loadDecisions(env.DECISIONS_KV, pairId);
      return jsonResponse({
        pairId,
        stored,
        effective: effectiveDecisions(stored),
        persistence: { enabled: !!env.DECISIONS_KV },
      });
    }

    if (url.pathname === '/api/decisions' && request.method === 'PUT') {
      let body: { decisions?: UserDecisions };
      try {
        body = (await request.json()) as { decisions?: UserDecisions };
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      const decisions = { ...DEFAULT_DECISIONS, ...(body.decisions ?? {}) };
      const stored: StoredDecisions = await saveDecisions(
        env.DECISIONS_KV,
        pairId,
        decisions,
      );
      return jsonResponse({
        pairId,
        stored,
        persistence: { enabled: !!env.DECISIONS_KV },
      });
    }

    // --- Connections (v0.4 manual-paste path; OAuth callbacks are stubs) ---
    if (url.pathname === '/api/connections' && request.method === 'GET') {
      const conns = await loadConnections(env.DECISIONS_KV, pairId);
      return jsonResponse({
        pairId,
        connections: {
          jira: conns.jira ? redact(conns.jira) : null,
          airtable: conns.airtable ? redact(conns.airtable) : null,
        },
        persistence: { enabled: !!env.DECISIONS_KV },
      });
    }

    const connMatch = url.pathname.match(/^\/api\/connections\/(jira|airtable)$/);
    if (connMatch) {
      const platform = connMatch[1] as Platform;

      if (request.method === 'PUT') {
        let body: { kind?: string; credentials?: Record<string, string> };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ error: 'invalid JSON body' }, 400);
        }
        if (body.kind !== 'pat') {
          return jsonResponse(
            { error: 'only kind="pat" is supported in v0.4 (OAuth callbacks are stubs)' },
            400,
          );
        }
        const creds = body.credentials ?? {};
        let toValidate: ConnectionCredentials;
        if (platform === 'jira') {
          if (!creds.email || !creds.apiToken || !creds.siteUrl) {
            return jsonResponse(
              { error: 'jira PAT requires { email, apiToken, siteUrl }' },
              400,
            );
          }
          toValidate = {
            kind: 'pat',
            platform: 'jira',
            credentials: {
              email: creds.email,
              apiToken: creds.apiToken,
              siteUrl: creds.siteUrl,
            },
          };
        } else {
          if (!creds.apiToken) {
            return jsonResponse({ error: 'airtable PAT requires { apiToken }' }, 400);
          }
          toValidate = {
            kind: 'pat',
            platform: 'airtable',
            credentials: { apiToken: creds.apiToken },
          };
        }

        const v = await validatePat(toValidate);
        if (!v.ok || !v.identity) {
          return jsonResponse({ error: v.error ?? 'validation failed' }, 400);
        }

        try {
          const stored = await saveConnection(env.DECISIONS_KV, pairId, toValidate, v.identity);
          return jsonResponse({
            ok: true,
            connection: redact(stored),
            persistence: { enabled: !!env.DECISIONS_KV },
          });
        } catch (e) {
          return jsonResponse({ error: (e as Error).message }, 503);
        }
      }

      if (request.method === 'DELETE') {
        await deleteConnection(env.DECISIONS_KV, pairId, platform);
        return jsonResponse({ ok: true });
      }
    }

    // --- Schedules ---------------------------------------------------
    if (url.pathname === '/api/schedules' && request.method === 'GET') {
      const entries = await listSchedules(env.DECISIONS_KV);
      return jsonResponse({
        schedules: entries,
        persistence: { enabled: !!env.DECISIONS_KV },
      });
    }

    const schedMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (schedMatch) {
      const id = decodeURIComponent(schedMatch[1]);
      if (request.method === 'GET') {
        const entry = await getSchedule(env.DECISIONS_KV, id);
        return jsonResponse({ pairId: id, schedule: entry });
      }
      if (request.method === 'PUT') {
        let body: { frequency?: ScheduleFrequency };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ error: 'invalid JSON body' }, 400);
        }
        const allowed: ScheduleFrequency[] = ['hourly', 'daily', 'weekly', 'manual'];
        if (!body.frequency || !allowed.includes(body.frequency)) {
          return jsonResponse(
            { error: `frequency must be one of: ${allowed.join(', ')}` },
            400,
          );
        }
        try {
          const entry = await setSchedule(env.DECISIONS_KV, id, body.frequency);
          return jsonResponse({ ok: true, schedule: entry });
        } catch (e) {
          return jsonResponse({ error: (e as Error).message }, 503);
        }
      }
    }

    if (url.pathname === '/api/schedule-runs' && request.method === 'GET') {
      const pid = url.searchParams.get('pairId') ?? undefined;
      const runs = await listRuns(env.DECISIONS_KV, pid);
      return jsonResponse({ pairId: pid ?? null, runs });
    }

    if (url.pathname === '/api/schedules/run' && request.method === 'POST') {
      // Operator-driven manual run — useful for testing the loop without
      // waiting for cron. Same path the cron handler walks.
      const ranAt = new Date().toISOString();
      const trigger = 'manual' as const;
      const stats = await runPairPass(env, pairId);
      const run = { pairId, ranAt, trigger, ...stats };
      await recordRun(env.DECISIONS_KV, run);
      return jsonResponse({ ok: true, run });
    }

    // --- Webhooks (near-real-time pass triggers) -----------------------
    const webhookMatch = url.pathname.match(/^\/api\/webhooks\/(jira|airtable)\/([^/]+)$/);
    if (webhookMatch && request.method === 'POST') {
      const platform = webhookMatch[1] as WebhookSourcePlatform;
      const whPairId = decodeURIComponent(webhookMatch[2]);
      const secret =
        platform === 'jira' ? env.JIRA_WEBHOOK_SECRET : env.AIRTABLE_WEBHOOK_SECRET;
      const rawBody = await request.text();
      const verify = await verifyHmacSignature(
        rawBody,
        signatureHeader(request, platform),
        secret,
      );
      if (!verify.ok) {
        const status = verify.secretMissing ? 503 : 401;
        return jsonResponse(
          {
            error: `webhook rejected: ${verify.reason}`,
            platform,
            secretMissing: !!verify.secretMissing,
          },
          status,
        );
      }

      const pair = await resolvePair(env.DECISIONS_KV, whPairId, SEED_PAIR);
      if (!pair) return jsonResponse({ error: `unknown pairId: ${whPairId}` }, 404);

      const ranAt = new Date().toISOString();
      const stats = await runPairPass(env, whPairId);
      const run = { pairId: whPairId, ranAt, trigger: 'cron' as const, ...stats };
      await recordRun(env.DECISIONS_KV, run);
      return jsonResponse({ ok: true, platform, run });
    }

    // OAuth callback scaffold. Real handlers require Atlassian + Airtable
    // OAuth apps registered with this Worker's redirect URI; client_id +
    // client_secret would be Wrangler secrets. Returning 501 makes the
    // shape visible without claiming functionality that is not wired up.
    const oauthMatch = url.pathname.match(/^\/api\/auth\/(jira|airtable)\/callback$/);
    if (oauthMatch) {
      return jsonResponse(
        {
          error:
            'OAuth callback is scaffolded but not implemented. Register an OAuth app for this platform, set client_id / client_secret as Wrangler secrets, and wire the token exchange here. For now, use PUT /api/connections/<platform> with a PAT.',
          platform: oauthMatch[1],
        },
        501,
      );
    }

    if (url.pathname === '/api/preview' && request.method === 'POST') {
      let body: { decisions?: UserDecisions };
      try {
        body = (await request.json()) as { decisions?: UserDecisions };
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      const decisions = { ...DEFAULT_DECISIONS, ...(body.decisions ?? {}) };
      const baseline = runBaseline();
      const enhanced: EnhancedResult[] = baseline.map((b) =>
        applyDecisions(b, decisions),
      );
      return jsonResponse({ decisions, enhanced });
    }

    if (url.pathname === '/api/propose' && request.method === 'POST') {
      let body: ProposalRequest;
      try {
        body = (await request.json()) as ProposalRequest;
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      if (!body?.decisionKey || typeof body.prompt !== 'string') {
        return jsonResponse({ error: 'missing decisionKey or prompt' }, 400);
      }
      const catalog = DECISION_CATALOG[body.decisionKey];
      if (!catalog) {
        return jsonResponse({ error: 'unknown decisionKey' }, 400);
      }
      const proposal = await propose(body, env.ANTHROPIC_API_KEY, catalog);
      return jsonResponse(proposal);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not found' }, 404);
    }

    // --- Static SPA assets ------------------------------------------
    return env.ASSETS.fetch(request);
  },

  /**
   * Cron handler. Wrangler fires this on whatever cadence is declared in
   * `wrangler.toml`'s `[triggers]` block. We declare an hourly trigger;
   * the handler iterates over pairs that have a stored schedule, checks
   * whether the stored frequency should fire on this tick, and runs a
   * pass for each match.
   *
   * Each run is persisted to KV as a `ScheduleRun` so the SPA / operator
   * can audit what fired and when. The doctrine principle holds: each
   * tick produces a discrete-snapshot pass, not a continuous sync.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    const schedules = await listSchedules(env.DECISIONS_KV);
    const work = async () => {
      for (const entry of schedules) {
        if (!shouldRun(entry.frequency, now)) continue;
        const ranAt = now.toISOString();
        const stats = await runPairPass(env, entry.pairId);
        await recordRun(env.DECISIONS_KV, {
          pairId: entry.pairId,
          ranAt,
          trigger: 'cron',
          ...stats,
        });
      }
    };
    ctx.waitUntil(work());
  },
};
