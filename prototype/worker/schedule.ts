// Scheduled-pass support — recurring forward passes per pair.
//
// Cloudflare Workers cron triggers fire the Worker's `scheduled()` export.
// Our trigger runs once per hour (see `wrangler.toml`); on each tick the
// handler iterates over registered pairs, picks the ones whose stored
// frequency matches the current wall clock, runs a pass for each, and
// records the run in KV.
//
// Doctrine note (from `CLAUDE.md` / project memory): each pass is still a
// *discrete snapshot*, not a continuous sync. Scheduled passes are just
// "discrete snapshots, more often" — every run still emits a manifest.
// Webhook-driven near-real-time is task #11 and a separate substrate.
//
// v0.6 supports a four-value frequency enum (`hourly`, `daily`, `weekly`,
// `manual`). Arbitrary cron expressions per pair are deferred; declare
// them in `wrangler.toml` if you need them today.

import type { DecisionsKv } from './persistence.js';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'manual';

export interface ScheduleEntry {
  pairId: string;
  frequency: ScheduleFrequency;
  updatedAt: string;
}

export type ScheduleRunStatus = 'ok' | 'skipped' | 'error';

export interface ScheduleRun {
  pairId: string;
  ranAt: string;
  /** Trigger reason: `cron` (automatic via cron handler) or `manual`
   *  (operator-driven via API). */
  trigger: 'cron' | 'manual';
  status: ScheduleRunStatus;
  /** Number of issues processed and losses surfaced in the run, when ok. */
  issues?: number;
  losses?: number;
  error?: string;
}

const ENTRY_PREFIX = 'schedule:';
const RUN_PREFIX = 'schedule-run:';
const MAX_RUNS_RETAINED = 50;

function entryKey(pairId: string): string {
  return `${ENTRY_PREFIX}${pairId}`;
}

function runKey(pairId: string, ranAt: string): string {
  return `${RUN_PREFIX}${pairId}:${ranAt}`;
}

// --- Schedule entries ---------------------------------------------------

export async function getSchedule(
  kv: DecisionsKv | undefined,
  pairId: string,
): Promise<ScheduleEntry | null> {
  if (!kv) return null;
  try {
    return ((await kv.get(entryKey(pairId), 'json')) as ScheduleEntry) ?? null;
  } catch {
    return null;
  }
}

export async function setSchedule(
  kv: DecisionsKv | undefined,
  pairId: string,
  frequency: ScheduleFrequency,
): Promise<ScheduleEntry> {
  const entry: ScheduleEntry = {
    pairId,
    frequency,
    updatedAt: new Date().toISOString(),
  };
  if (!kv) {
    throw new Error(
      'DECISIONS_KV binding is not configured; cannot persist a schedule. See prototype/README.md.',
    );
  }
  await kv.put(entryKey(pairId), JSON.stringify(entry));
  return entry;
}

export async function listSchedules(
  kv: DecisionsKv | undefined,
): Promise<ScheduleEntry[]> {
  if (!kv) return [];
  const lister = (kv as unknown as {
    list?: (opts: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
  }).list;
  if (typeof lister !== 'function') return [];
  const out: ScheduleEntry[] = [];
  try {
    const res = await lister({ prefix: ENTRY_PREFIX });
    for (const k of res.keys) {
      const pid = k.name.slice(ENTRY_PREFIX.length);
      const e = await getSchedule(kv, pid);
      if (e) out.push(e);
    }
  } catch {
    // best-effort listing
  }
  return out;
}

// --- Run records --------------------------------------------------------

export async function recordRun(
  kv: DecisionsKv | undefined,
  run: ScheduleRun,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(runKey(run.pairId, run.ranAt), JSON.stringify(run));
  } catch {
    // best-effort; scheduling history is observability, not correctness
  }
}

export async function listRuns(
  kv: DecisionsKv | undefined,
  pairId?: string,
  limit = MAX_RUNS_RETAINED,
): Promise<ScheduleRun[]> {
  if (!kv) return [];
  const lister = (kv as unknown as {
    list?: (opts: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
  }).list;
  if (typeof lister !== 'function') return [];
  const prefix = pairId ? `${RUN_PREFIX}${pairId}:` : RUN_PREFIX;
  try {
    const res = await lister({ prefix });
    // Newest first — keys end with ISO timestamp, so lexicographic descending
    // is chronological descending.
    const keys = res.keys.map((k) => k.name).sort().reverse().slice(0, limit);
    const out: ScheduleRun[] = [];
    for (const k of keys) {
      try {
        const r = (await kv.get(k, 'json')) as ScheduleRun | null;
        if (r) out.push(r);
      } catch {
        // skip
      }
    }
    return out;
  } catch {
    return [];
  }
}

// --- Frequency → "should run now?" --------------------------------------

/**
 * Decide whether a stored frequency should fire at the given UTC time.
 * Mirrors a coarse cron interpretation:
 *
 *   - `hourly` — fires on the hour (UTC minute == 0)
 *   - `daily`  — fires at 00:00 UTC
 *   - `weekly` — fires at 00:00 UTC on Mondays
 *   - `manual` — never fires automatically
 *
 * Because the Worker's cron trigger runs hourly (see `wrangler.toml`),
 * `hourly` matches every invocation, `daily` matches on the 00:00 UTC
 * invocation, etc.
 */
export function shouldRun(frequency: ScheduleFrequency, now: Date): boolean {
  switch (frequency) {
    case 'manual': return false;
    case 'hourly': return now.getUTCMinutes() === 0;
    case 'daily':  return now.getUTCHours() === 0 && now.getUTCMinutes() === 0;
    case 'weekly': return now.getUTCDay() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() === 0;
  }
}
