// Manifest builder + writer. Aggregates many per-issue TranslationResults
// into one manifest (markdown for humans, JSON sidecar for tooling) and
// writes both into manifests/.
//
// The manifest IS the deliverable — the destination-system write is
// secondary. Keep the markdown specific, named, and human-readable.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  Conflict,
  LossEntry,
  LossKind,
  ReverseTranslationResult,
  TranslationResult,
} from './grammars/types.js';

export interface ManifestPass {
  /** ISO-8601 timestamp of the pass. */
  timestamp: string;
  /** Human-readable source label, e.g. "Jira Cloud". */
  source: string;
  /** Human-readable destination label, e.g. "Airtable". */
  destination: string;
  /** Grammar identifier, e.g. "project-management". */
  context: string;
  /** Source project key, e.g. "SCRUM". */
  projectKey: string;
  /** Whether destination writes were performed. */
  dryRun: boolean;
  /** Direction of the pass. Defaults to `'forward'` when omitted. Reverse
   *  passes emit `patches` and `conflicts` sections in addition to losses. */
  direction?: 'forward' | 'reverse';
}

export interface Manifest {
  pass: ManifestPass;
  counts: {
    issues: number;
    total: number;
    lossesByKind: Record<LossKind, number>;
    /** Conflict count for reverse passes. Omitted for forward passes. */
    conflicts?: number;
    /** Per-record patch counts for reverse passes. Omitted for forward passes. */
    patchedRecords?: number;
  };
  losslessFields: string[];
  losses: Array<LossEntry & { jiraKey: string }>;
  provenance: Array<{ jiraKey: string; airtableRecordId: string | null }>;
  /** Reverse-pass output: per-record source-side patches. Forward passes
   *  omit this field. */
  patches?: Array<{
    sourceKey: string;
    sourcePatch: Record<string, unknown>;
    applied: string[];
    skipped: Array<{ field: string; reason: string }>;
  }>;
  /** Reverse-pass output: aggregate conflict list. Forward passes omit this. */
  conflicts?: Conflict[];
}

export interface ReverseManifestEntry extends ReverseTranslationResult {
  sourceKey: string;
}

const LOSS_KINDS: LossKind[] = [
  'schema',
  'semantic',
  'hierarchy',
  'context',
  'provenance',
];

// --- Build ---------------------------------------------------------------

export function buildManifest(
  pass: ManifestPass,
  results: Array<TranslationResult & { airtableRecordId: string | null }>,
): Manifest {
  const losses: Manifest['losses'] = [];
  const losslessSet = new Set<string>();
  const counts: Record<LossKind, number> = {
    schema: 0,
    semantic: 0,
    hierarchy: 0,
    context: 0,
    provenance: 0,
  };

  for (const r of results) {
    for (const l of r.losses) {
      losses.push({ ...l, jiraKey: r.jiraKey });
      counts[l.kind]++;
    }
    for (const lf of r.losslessFields) losslessSet.add(lf);
  }

  return {
    pass: { ...pass, direction: pass.direction ?? 'forward' },
    counts: {
      issues: results.length,
      total: losses.length,
      lossesByKind: counts,
    },
    losslessFields: Array.from(losslessSet).sort(),
    losses,
    provenance: results.map((r) => ({
      jiraKey: r.jiraKey,
      airtableRecordId: r.airtableRecordId,
    })),
  };
}

/**
 * Build a reverse-pass manifest. `entries` is the per-record output of the
 * reverse grammar; `provenance` carries the source-key ↔ destination-record
 * mapping (typically read from the prior pass's snapshot).
 */
export function buildReverseManifest(
  pass: ManifestPass,
  entries: ReverseManifestEntry[],
  provenance: Array<{ sourceKey: string; destRecordId: string }>,
): Manifest {
  const conflicts: Conflict[] = [];
  let patchedRecords = 0;
  for (const e of entries) {
    conflicts.push(...e.conflicts);
    if (Object.keys(e.sourcePatch).length > 0) patchedRecords++;
  }
  return {
    pass: { ...pass, direction: 'reverse' },
    counts: {
      issues: entries.length,
      total: 0,
      lossesByKind: { schema: 0, semantic: 0, hierarchy: 0, context: 0, provenance: 0 },
      conflicts: conflicts.length,
      patchedRecords,
    },
    losslessFields: [],
    losses: [],
    provenance: provenance.map((p) => ({
      jiraKey: p.sourceKey,
      airtableRecordId: p.destRecordId,
    })),
    patches: entries.map((e) => ({
      sourceKey: e.sourceKey,
      sourcePatch: e.sourcePatch,
      applied: e.applied,
      skipped: e.skipped,
    })),
    conflicts,
  };
}

// --- Render --------------------------------------------------------------

export function renderMarkdown(m: Manifest): string {
  const lines: string[] = [];

  const arrow = m.pass.direction === 'reverse' ? '←' : '→';
  const dryRunNote =
    m.pass.direction === 'reverse'
      ? m.pass.dryRun
        ? ' (dry run — no source writes)'
        : ''
      : m.pass.dryRun
      ? ' (dry run — no destination writes)'
      : '';
  lines.push(`# Translation manifest — ${m.pass.source} ${arrow} ${m.pass.destination}`);
  lines.push('');
  lines.push(`**Pass:** ${m.pass.timestamp}${dryRunNote}`);
  lines.push(`**Direction:** ${m.pass.direction ?? 'forward'}`);
  lines.push(`**Source:** ${m.pass.source}, project \`${m.pass.projectKey}\``);
  lines.push(`**Destination:** ${m.pass.destination}`);
  lines.push(`**Context grammar:** \`${m.pass.context}\``);
  lines.push('');

  // --- Summary
  lines.push('## Summary');
  lines.push('');
  const isReverse = m.pass.direction === 'reverse';
  if (isReverse) {
    lines.push(`- ${m.counts.issues} record(s) compared against the prior snapshot.`);
    lines.push(`- ${m.counts.patchedRecords ?? 0} record(s) would receive a source-side patch.`);
    lines.push(`- ${m.counts.conflicts ?? 0} conflict(s) surfaced (both sides moved since last pass).`);
    if (m.counts.total > 0) {
      lines.push(`- ${m.counts.total} reverse-pass loss(es) (round-trip semantic distance):`);
      for (const k of LOSS_KINDS) {
        if (m.counts.lossesByKind[k] > 0) {
          lines.push(`  - ${capitalize(k)}: ${m.counts.lossesByKind[k]}`);
        }
      }
    }
  } else {
    lines.push(`- ${m.counts.issues} issue(s) translated.`);
    lines.push(`- ${m.counts.total} loss(es) surfaced across the five-kind taxonomy:`);
    for (const k of LOSS_KINDS) {
      lines.push(`  - ${capitalize(k)}: ${m.counts.lossesByKind[k]}`);
    }
  }
  lines.push('');

  // --- Forward-only sections: lossless mappings + losses by kind.
  if (!isReverse) {
    lines.push('## Lossless mappings');
    lines.push('');
    if (m.losslessFields.length === 0) {
      lines.push('_(none observed in this pass.)_');
    } else {
      lines.push('Mapped 1:1 with no semantic distance:');
      lines.push('');
      for (const f of m.losslessFields) lines.push(`- \`${f}\``);
    }
    lines.push('');

    lines.push('## Losses by kind');
    lines.push('');
    for (const kind of LOSS_KINDS) {
      const ofKind = m.losses.filter((l) => l.kind === kind);
      lines.push(`### ${capitalize(kind)} (${ofKind.length})`);
      lines.push('');

      if (ofKind.length === 0) {
        lines.push(emptyKindHint(kind));
        lines.push('');
        continue;
      }

      const byField = groupBy(ofKind, (l) => l.field);
      for (const [field, entries] of byField) {
        const exemplar = entries[0];
        lines.push(`#### \`${field}\``);
        lines.push('');
        lines.push(`- **Distance:** ${exemplar.distance}`);
        lines.push(`- **Resolution:** \`${exemplar.resolution}\``);
        lines.push(`- **Affected issues (${entries.length}):**`);
        for (const e of entries) lines.push(`  - \`${e.jiraKey}\` → ${renderDestination(e.destination)}`);
        lines.push('');
      }
    }
  }

  // --- Reverse-pass sections (patches + conflicts) -----------------------
  if (m.pass.direction === 'reverse') {
    lines.push('## Reverse-pass patches');
    lines.push('');
    const patches = m.patches ?? [];
    const withPatch = patches.filter((p) => Object.keys(p.sourcePatch).length > 0);
    if (withPatch.length === 0) {
      lines.push('_No source-side patches generated this pass — no destination edits to round-trip._');
    } else {
      lines.push(`${withPatch.length} record(s) would receive a source-side patch (dry run — no live writes performed):`);
      lines.push('');
      for (const p of withPatch) {
        lines.push(`#### \`${p.sourceKey}\``);
        lines.push('');
        lines.push('- **Applied:** ' + (p.applied.length === 0 ? '_(none)_' : p.applied.map((f) => `\`${f}\``).join(', ')));
        lines.push('- **Patch:**');
        lines.push('');
        lines.push('  ```json');
        for (const line of JSON.stringify(p.sourcePatch, null, 2).split('\n')) {
          lines.push('  ' + line);
        }
        lines.push('  ```');
        lines.push('');
      }
    }

    // Skipped fields aggregated
    const skippedByReason = new Map<string, Array<{ sourceKey: string; field: string }>>();
    for (const p of patches) {
      for (const s of p.skipped) {
        const list = skippedByReason.get(s.reason) ?? [];
        list.push({ sourceKey: p.sourceKey, field: s.field });
        skippedByReason.set(s.reason, list);
      }
    }
    if (skippedByReason.size > 0) {
      lines.push('## Reverse-pass skipped fields');
      lines.push('');
      lines.push('Field-level round-trips the grammar refused, with reasons. Skipped is not the same as conflicted — these are choices, not collisions.');
      lines.push('');
      for (const [reason, entries] of skippedByReason) {
        lines.push(`- **${reason}**`);
        const byField = groupBy(entries, (e) => e.field);
        for (const [field, fs] of byField) {
          const keys = fs.map((f) => `\`${f.sourceKey}\``).join(', ');
          lines.push(`  - \`${field}\` — ${fs.length} record(s): ${keys}`);
        }
      }
      lines.push('');
    }

    // Conflicts section
    lines.push('## Conflicts');
    lines.push('');
    const conflicts = m.conflicts ?? [];
    if (conflicts.length === 0) {
      lines.push('_No conflicts detected. All destination edits round-tripped cleanly or were skipped by policy._');
    } else {
      lines.push(`${conflicts.length} conflict(s) detected. The engine does not auto-resolve — downstream tooling or a human picks.`);
      lines.push('');
      const byField = groupBy(conflicts, (c) => c.field);
      for (const [field, list] of byField) {
        lines.push(`#### \`${field}\` (${list.length})`);
        lines.push('');
        for (const c of list) {
          lines.push(`- \`${c.sourceKey}\`:`);
          lines.push(`  - **Last snapshot:** ${renderDestination(c.lastSnapshot)}`);
          lines.push(`  - **Source now:** ${renderDestination(c.sourceCurrent)}`);
          lines.push(`  - **Destination now:** ${renderDestination(c.destCurrent)}`);
          if (c.notes) lines.push(`  - **Notes:** ${c.notes}`);
        }
        lines.push('');
      }
    }
  }

  // --- Provenance
  lines.push('## Bidirectional ID mapping');
  lines.push('');
  lines.push('| Source Key | Destination Record ID |');
  lines.push('|---|---|');
  for (const p of m.provenance) {
    const rid = p.airtableRecordId
      ? `\`${p.airtableRecordId}\``
      : m.pass.dryRun
        ? '_(dry run)_'
        : '_(write failed)_';
    lines.push(`| \`${p.jiraKey}\` | ${rid} |`);
  }
  lines.push('');

  return lines.join('\n') + '\n';
}

export function renderJson(m: Manifest): string {
  return JSON.stringify(m, null, 2) + '\n';
}

// --- Write ---------------------------------------------------------------

export async function writeManifest(
  m: Manifest,
  dir: string,
): Promise<{ markdownPath: string; jsonPath: string }> {
  await fs.mkdir(dir, { recursive: true });
  const slug = filenameSlug(m.pass);
  const markdownPath = path.join(dir, `${slug}.md`);
  const jsonPath = path.join(dir, `${slug}.json`);
  await fs.writeFile(markdownPath, renderMarkdown(m), 'utf8');
  await fs.writeFile(jsonPath, renderJson(m), 'utf8');
  return { markdownPath, jsonPath };
}

function filenameSlug(p: ManifestPass): string {
  const ts = p.timestamp.replace(/[:.]/g, '-');
  return `${ts}-${kebab(p.source)}-to-${kebab(p.destination)}-${kebab(p.context)}${p.dryRun ? '-dry-run' : ''}`;
}

// --- Tiny utils ----------------------------------------------------------

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

function emptyKindHint(kind: LossKind): string {
  switch (kind) {
    case 'schema':
      return '_No project-specific schema losses observed. If a custom field is expected here (e.g. "Customer Segment"), verify it has been added to the source project AND set on issues. Jira system fields (Rank, Story Points, Flagged, etc.) are intentionally filtered out — they are not translation candidates._';
    case 'semantic':
      return '_No semantic losses observed in this pass._';
    case 'hierarchy':
      return '_No hierarchy losses observed in this pass._';
    case 'context':
      return '_No context-loss signals detected. The grammar scans descriptions for embedded Slack thread URLs; widen detection here as new context-loss patterns surface._';
    case 'provenance':
      return '_No provenance losses — Jira issue keys are preserved losslessly via the Bidirectional ID mapping below. Add an entry here if a future pass observes a provenance gap (e.g. assignees translated by displayName only)._';
  }
}

function renderDestination(value: unknown): string {
  if (value == null) return '_(dropped)_';
  if (typeof value === 'string') return value.length === 0 ? '_(empty)_' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value);
  return json.length > 100 ? json.slice(0, 99) + '…' : json;
}
