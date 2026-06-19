// Translation grammar: project management context → Airtable (Roadmap shape).
//
// Source-agnostic as of v0.2. The grammar consumes a `NormalizedIssue`
// (produced by a per-platform normalizer in `src/adapters/<platform>-normalize.ts`)
// rather than reaching into Jira-specific fields directly. The translation
// rules and loss taxonomy are the same; the input contract is the change.
//
// Deterministic. Pattern-based loss classification per the five-kind
// taxonomy (schema, semantic, hierarchy, context, provenance). No LLM in
// the loop — every loss is named by a regex, map, or explicit rule.
//
// One translateIssue() call per source issue. The aggregate manifest is
// built downstream from many translateIssue() results.

import type {
  Conflict,
  GrammarContext,
  LossEntry,
  NormalizedIssue,
  ReverseTranslationResult,
  TranslationResult,
} from './types.js';
import type { SnapshotRecord } from '../snapshot.js';

// --- Deterministic maps --------------------------------------------------

// PM priority labels — names map 1:1 with the Airtable single-select if the
// destination's options match. The map exists so renames or mismatches stay
// localized to this file.
const PRIORITY_MAP: Record<string, string> = {
  Highest: 'Highest',
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  Lowest: 'Lowest',
};

// Destination status bucket — three values, fuzzily matched from any
// source-side workflow / section name (Backlog/Up Next/Active/Blocked/
// Complete or canonical To Do/In Progress/Done).
type DestStatus = 'To Do' | 'In Progress' | 'Done';

function bucketStatus(statusName: string): DestStatus {
  const s = statusName.toLowerCase();
  if (/active|in.?progress|doing|started|working/.test(s)) return 'In Progress';
  if (/done|complete|closed|resolved|finished/.test(s)) return 'Done';
  return 'To Do'; // Backlog, Up Next, Open, New, etc.
}

// Slack-thread-as-spec detector — surfaces context loss. Captures the URL
// itself; the actual conversation is unreachable from the destination.
const SLACK_URL_RE = /https:\/\/[a-z0-9-]+\.slack\.com\/[^\s)\]]+/gi;

// --- Translation ---------------------------------------------------------

export function translateIssue(
  issue: NormalizedIssue,
  ctx: GrammarContext,
): TranslationResult {
  const losses: LossEntry[] = [];
  const losslessFields: string[] = [];
  const out: Record<string, unknown> = {};

  const platformLabel = labelForPlatform(issue.sourcePlatform);

  // 1. summary → Name. Strings identical; nothing semantic to lose.
  out['Name'] = issue.summary;
  losslessFields.push('summary→Name');

  // 2. description → Description. Rich-text flattened to plain text
  //    (semantic). Also scanned for Slack URLs (context).
  if (issue.description != null) {
    out['Description'] = issue.description;

    if (issue.descriptionRichSource) {
      losses.push({
        kind: 'semantic',
        field: 'description→Description',
        resolution: 'lossy',
        distance: richTextLossDistance(issue.descriptionRichSource, platformLabel),
        source: `(${issue.descriptionRichSource.toUpperCase()} document)`,
        destination: preview(issue.description),
      });
    }

    const slackUrls = Array.from(issue.description.matchAll(SLACK_URL_RE), (m) => m[0]);
    if (slackUrls.length > 0) {
      losses.push({
        kind: 'context',
        field: 'description embeds Slack thread URL',
        resolution: 'annotated',
        distance:
          'The substantive spec for this issue lives in a Slack thread linked from the description. The URL travels with the description text, but the conversational context behind the URL has no destination concept and is not retrievable from Airtable — viewers there see a URL, not the thread.',
        source: slackUrls,
        destination: 'URL retained in Description text',
      });
    }
  }

  // 3. status → Status. Workflow / section semantics (transitions,
  //    permissions, allowed next states) are dropped. Bucketing also
  //    normalizes platform-specific status names.
  if (issue.status) {
    const destStatus = bucketStatus(issue.status);
    out['Status'] = destStatus;
    losses.push({
      kind: 'semantic',
      field: 'status→Status',
      resolution: 'lossy',
      distance: statusLossDistance(platformLabel),
      source: issue.status,
      destination: destStatus,
    });
  }

  // 4. priority → Priority. Names map 1:1, but side-effect parity is lost
  //    (source-platform priorities drive SLAs/notifications; Airtable
  //    selects don't).
  if (issue.priority) {
    const destPriority = PRIORITY_MAP[issue.priority] ?? issue.priority;
    out['Priority'] = destPriority;
    losses.push({
      kind: 'semantic',
      field: 'priority→Priority',
      resolution: 'lossy',
      distance: priorityLossDistance(platformLabel),
      source: issue.priority,
      destination: destPriority,
    });
  }

  // 5. assignee → Assignee. Account identity drops; displayName survives.
  if (issue.assignee) {
    const display = issue.assignee.displayName;
    out['Assignee'] = display;
    losses.push({
      kind: 'provenance',
      field: 'assignee→Assignee',
      resolution: 'lossy',
      distance: assigneeLossDistance(platformLabel, issue.assignee.handle),
      source: { handle: issue.assignee.handle, displayName: display },
      destination: display,
    });
  }

  // 6. parent → Epic. The typed link to a parent (Epic in PM) collapses
  //    to a free-form text label — hierarchy loss.
  if (issue.parent) {
    const parentSummary =
      ctx.parentSummaryByKey.get(issue.parent.sourceKey) ?? issue.parent.summary ?? issue.parent.sourceKey;
    out['Epic'] = parentSummary;
    losses.push({
      kind: 'hierarchy',
      field: 'parent→Epic',
      resolution: 'lossy',
      distance: `Source parent is a typed link to ${issue.parent.sourceKey} on ${platformLabel} — navigable, roll-up-aware, child-completion-tracking. The destination Epic is a free-form text field; the link semantic is gone.`,
      source: { key: issue.parent.sourceKey, summary: parentSummary },
      destination: parentSummary,
    });
  }

  // 7. labels → Labels. Array of strings → multipleSelects. Lossless.
  if (issue.labels.length > 0) {
    out['Labels'] = issue.labels;
    losslessFields.push('labels→Labels');
  }

  // 8. dueDate → Due. ISO date string. Lossless.
  if (issue.dueDate) {
    out['Due'] = issue.dueDate;
    losslessFields.push('dueDate→Due');
  }

  // 9. sprints → Sprint. Object array → first name. Hierarchy loss —
  //    multi-sprint membership, dates, state dropped.
  if (issue.sprints.length > 0) {
    const first = issue.sprints[0];
    out['Sprint'] = first.name;
    losses.push({
      kind: 'hierarchy',
      field: 'sprints→Sprint',
      resolution: 'lossy',
      distance:
        'Source sprints are objects with name, state, start/end/complete dates, and origin board. The destination Sprint is a single string — only the first sprint name survives. Multi-sprint membership, dates, and state are dropped.',
      source: issue.sprints,
      destination: first.name,
    });
  }

  // 10. fixVersions → Fix Version. Array → comma-joined names.
  //     Hierarchy loss — release dates and status dropped.
  if (issue.fixVersions.length > 0) {
    const names = issue.fixVersions.map((v) => v.name).filter(Boolean);
    const joined = names.join(', ');
    out['Fix Version'] = joined;
    losses.push({
      kind: 'hierarchy',
      field: 'fixVersions→Fix Version',
      resolution: 'lossy',
      distance:
        'Source fixVersions are version objects with release dates and release status. The destination Fix Version is a single text field — names are joined with commas; release dates and status are dropped.',
      source: issue.fixVersions,
      destination: joined,
    });
  }

  // 11. Project-specific custom fields → schema loss. Source-platform
  //     system fields (Jira Rank, etc.) are stripped at the normalizer;
  //     anything reaching here is a real schema-loss candidate.
  for (const cf of issue.customFields) {
    losses.push({
      kind: 'schema',
      field: cf.sourceId ? `${cf.name} (${cf.sourceId})` : cf.name,
      resolution: 'dropped',
      distance: `Project-specific custom field "${cf.name}" has no destination concept on the Roadmap shape. Dropped from the Airtable write; preserved here in the manifest so the field can be wired up in a future pass or grammar revision.`,
      source: cf.value,
      destination: null,
    });
  }

  // 12. sourceKey → Source Key + manifest provenance mapping. Lossless via
  //     side channel (the mapping itself lives in the manifest).
  out['Source Key'] = issue.sourceKey;
  losslessFields.push('sourceKey→Source Key (manifest preserves bidirectional mapping)');

  return {
    jiraKey: issue.sourceKey,
    airtableFields: out,
    losses,
    losslessFields,
  };
}

// --- Helpers -------------------------------------------------------------

function labelForPlatform(p: string): string {
  switch (p) {
    case 'jira-cloud': return 'Jira';
    case 'asana': return 'Asana';
    default: return p;
  }
}

function richTextLossDistance(format: NonNullable<NormalizedIssue['descriptionRichSource']>, platform: string): string {
  switch (format) {
    case 'adf':
      return `${platform} description is Atlassian Document Format (paragraphs, lists, mentions, links, embedded media). The destination stores flattened plain text — rich-text structure, @mentions resolved to identities, and any interactive elements are dropped.`;
    case 'html':
      return `${platform} description is HTML. The destination stores flattened plain text — markup, inline styling, and any embedded media are dropped.`;
    case 'markdown':
      return `${platform} description is Markdown. The destination stores flattened plain text — heading levels, lists, emphasis, and link targets collapse to their text content.`;
  }
}

function statusLossDistance(platform: string): string {
  if (platform === 'Jira') {
    return 'Jira status sits inside a workflow with transitions, permissions, and allowed next states. The destination single-select has no transition semantics. The bucketing also normalizes template-specific names (e.g. "Active" → "In Progress", "Backlog" → "To Do").';
  }
  if (platform === 'Asana') {
    return 'Asana status maps to a project section or a custom-field option — section membership and the section\'s position in the board carry meaning the destination single-select cannot. The bucketing also normalizes platform-specific names.';
  }
  return `${platform} status carries platform-specific workflow / section semantics. The destination single-select is a flat label; transition and ordering semantics are dropped.`;
}

function priorityLossDistance(platform: string): string {
  if (platform === 'Jira') {
    return 'Names map 1:1, but Jira priority drives notification rules, SLA timers, and project-level reporting. The destination single-select carries the label only — there is no behavioral parity.';
  }
  return `Names map 1:1, but ${platform} priority can drive notification rules and reporting on the source side. The destination single-select carries the label only — there is no behavioral parity.`;
}

function assigneeLossDistance(platform: string, handle?: string): string {
  const h = handle ? `"${handle}"` : '(unknown)';
  return `${platform} assignee is an account object (source handle ${h}). Only the displayName survives the translation. The destination text field cannot disambiguate two assignees with the same name and has no link back to the source account.`;
}

function preview(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// --- Reverse direction (Airtable → Jira) ---------------------------------

/**
 * Fields the PM grammar will round-trip from Airtable back to a Jira-shape
 * source patch. The set is deliberately narrow: any field whose forward
 * translation lost workflow semantics (Status), typed-link semantics
 * (Epic), or platform-side identity (Sprint, Fix Version, Assignee
 * accountId) is excluded — the round-trip cannot honestly reconstruct
 * what would be needed source-side. The manifest names them as `skipped`
 * with a reason so the choice is visible, not hidden.
 *
 * Each entry pairs the destination field name (Airtable) with the
 * normalized-source field path (so we can read currentSource for delta
 * detection) and a Jira-side patch builder that turns a destination value
 * into the Jira `fields` shape.
 */
interface RoundTripField {
  destField: string;
  normalizedField: keyof NormalizedIssue;
  /** Equality comparator. Defaults to deep-JSON equality. */
  equal?: (a: unknown, b: unknown) => boolean;
  /** Translate a destination value into the Jira `fields` patch shape. */
  toJiraPatch: (destValue: unknown) => { jiraField: string; jiraValue: unknown };
}

const ROUND_TRIP_FIELDS: RoundTripField[] = [
  {
    destField: 'Name',
    normalizedField: 'summary',
    toJiraPatch: (v) => ({ jiraField: 'summary', jiraValue: String(v ?? '') }),
  },
  {
    destField: 'Description',
    normalizedField: 'description',
    toJiraPatch: (v) => ({
      jiraField: 'description',
      jiraValue: textToAdf(String(v ?? '')),
    }),
  },
  {
    destField: 'Priority',
    normalizedField: 'priority',
    toJiraPatch: (v) => ({
      jiraField: 'priority',
      jiraValue: v == null ? null : { name: String(v) },
    }),
  },
  {
    destField: 'Due',
    normalizedField: 'dueDate',
    toJiraPatch: (v) => ({ jiraField: 'duedate', jiraValue: v ?? null }),
  },
  {
    destField: 'Labels',
    normalizedField: 'labels',
    equal: (a, b) => arrayAsSetEqual(a, b),
    toJiraPatch: (v) => ({ jiraField: 'labels', jiraValue: Array.isArray(v) ? v : [] }),
  },
];

/**
 * Fields the PM grammar explicitly refuses to round-trip, with the reason
 * the manifest will record. Kept as a named list (rather than computed
 * from the forward grammar) so the refusal is loud, not silent.
 */
const NON_ROUND_TRIP_REASONS: Record<string, string> = {
  Status:
    'Status round-trip is unsafe: the destination value (e.g. "Done") has no Jira workflow transition semantics, so writing it back would risk skipping required gates. Forward direction owns Status.',
  Epic:
    'Epic round-trip is unsafe: the destination value is the parent\'s display summary, not its Jira issue key. Reconstructing the typed parent link would require an Epic lookup the grammar will not do silently.',
  Sprint:
    'Sprint round-trip is unsafe: the destination value is just a name; Jira needs the sprint ID and originating board. Forward direction owns Sprint.',
  'Fix Version':
    'Fix Version round-trip is unsafe: the destination value is a comma-joined name list; Jira needs version IDs that resolve against the project\'s version catalog.',
  Assignee:
    'Assignee round-trip is unsafe: the destination value is a displayName; Jira needs an accountId, which is not derivable from name alone (collisions are common).',
};

export function reverseTranslateIssue(
  currentDest: Record<string, unknown>,
  currentSource: NormalizedIssue,
  snapshot: SnapshotRecord | null,
): ReverseTranslationResult {
  const sourcePatch: Record<string, unknown> = {};
  const applied: string[] = [];
  const skipped: ReverseTranslationResult['skipped'] = [];
  const conflicts: Conflict[] = [];

  if (!snapshot) {
    return {
      sourcePatch,
      applied,
      skipped: ROUND_TRIP_FIELDS.map((rt) => ({
        field: rt.destField,
        reason:
          'No snapshot from a prior forward pass — reverse-pass deltas cannot be computed. Run a forward pass first.',
      })),
      conflicts,
    };
  }

  for (const rt of ROUND_TRIP_FIELDS) {
    const eq = rt.equal ?? defaultEqual;
    const lastDestVal = snapshot.lastDest[rt.destField];
    const currentDestVal = currentDest[rt.destField];
    const lastSourceVal = snapshot.lastSource[rt.normalizedField as string];
    const currentSourceVal = (currentSource as unknown as Record<string, unknown>)[
      rt.normalizedField as string
    ];

    const destChanged = !eq(currentDestVal, lastDestVal);
    const sourceChanged = !eq(currentSourceVal, lastSourceVal);

    if (!destChanged && !sourceChanged) {
      skipped.push({ field: rt.destField, reason: 'no change on either side' });
      continue;
    }

    if (destChanged && !sourceChanged) {
      const patch = rt.toJiraPatch(currentDestVal);
      sourcePatch[patch.jiraField] = patch.jiraValue;
      applied.push(rt.destField);
      continue;
    }

    if (!destChanged && sourceChanged) {
      skipped.push({
        field: rt.destField,
        reason: 'source-side moved since last snapshot; next forward pass will reconcile',
      });
      continue;
    }

    // Both sides changed → conflict.
    conflicts.push({
      sourceKey: currentSource.sourceKey,
      field: rt.destField,
      sourceCurrent: currentSourceVal,
      destCurrent: currentDestVal,
      lastSnapshot: lastDestVal,
      resolution: 'unresolved',
      notes: `Both ${currentSource.sourcePlatform} and the destination edited "${rt.destField}" since the last snapshot.`,
    });
  }

  // Surface non-round-trippable fields (only when the destination actually
  // carries a value — empty cells aren't worth naming).
  for (const [field, reason] of Object.entries(NON_ROUND_TRIP_REASONS)) {
    if (currentDest[field] != null && currentDest[field] !== '') {
      skipped.push({ field, reason });
    }
  }

  return { sourcePatch, applied, skipped, conflicts };
}

// --- Reverse helpers -----------------------------------------------------

function defaultEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function arrayAsSetEqual(a: unknown, b: unknown): boolean {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  const seen = new Set(aa.map(String));
  return bb.every((x) => seen.has(String(x)));
}

/**
 * Minimal ADF wrapper for writing plaintext back to Jira's description
 * field. Inverse of `flattenAdf` (lossy by construction — any rich
 * structure the forward direction dropped cannot be reconstructed here).
 * Kept local so the grammar does not depend on the Jira adapter module.
 */
function textToAdf(text: string): {
  type: 'doc';
  version: 1;
  content: Array<{
    type: 'paragraph';
    content: Array<{ type: 'text'; text: string }>;
  }>;
} {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n\n')
      .map((para) => ({
        type: 'paragraph' as const,
        content: [{ type: 'text' as const, text: para }],
      })),
  };
}

/**
 * Snapshot helper: extract the source-side fields the reverse direction
 * cares about from a freshly normalized issue. Use this when writing a
 * snapshot at the end of a forward pass so the next reverse pass has the
 * right keys to compare against.
 */
export function extractSnapshotSourceFields(issue: NormalizedIssue): Record<string, unknown> {
  return {
    summary: issue.summary,
    description: issue.description,
    priority: issue.priority,
    dueDate: issue.dueDate,
    labels: issue.labels,
  };
}

