// Shared types for translation grammars. The five-kind loss taxonomy comes
// from the translation doctrine (see REFERENCES.md). Grammars consume a
// `NormalizedIssue` (produced by a per-platform normalizer in `adapters/`)
// and emit one `TranslationResult` per source record.

/** Five-kind loss taxonomy from the translation doctrine. */
export type LossKind = 'schema' | 'semantic' | 'hierarchy' | 'context' | 'provenance';

/** What the grammar decided to do with a given loss. */
export type Resolution = 'lossless' | 'lossy' | 'dropped' | 'annotated';

/**
 * One observed translation decision. Always named (`field`) and always
 * classified by `kind`. `distance` is the human-readable explanation that
 * lands in the manifest — keep it specific and concrete, never generic.
 */
export interface LossEntry {
  kind: LossKind;
  field: string;
  resolution: Resolution;
  distance: string;
  source: unknown;
  destination: unknown;
}

export interface TranslationResult {
  /** Stable source identifier (Jira issue key, Asana gid, etc.). Carried
   *  through as the manifest's bidirectional-ID key. The field name kept
   *  for v0.1 wire-compat is `jiraKey`; a future release will rename to
   *  `sourceKey` once downstream consumers have moved. */
  jiraKey: string;
  airtableFields: Record<string, unknown>;
  losses: LossEntry[];
  /**
   * Names of fields that mapped 1:1 with no semantic distance. Kept as a
   * lightweight list rather than full LossEntry records — the manifest
   * summarizes losslessness in aggregate, not per-issue.
   */
  losslessFields: string[];
}

/**
 * Per-pass lookup tables the grammar needs to resolve cross-record
 * relationships. Currently just parent-summary lookup (PM grammar names
 * this "Epic"; DSOps grammar names it "Family" — same map). Empty Map is
 * acceptable when no parent linking is expected.
 */
export interface GrammarContext {
  parentSummaryByKey: Map<string, string>;
}

// --- Normalized source record --------------------------------------------

/**
 * Source-agnostic representation of one tracker record (Jira issue, Asana
 * task, future Linear/Notion analogue, etc.). Produced by a per-platform
 * normalizer in `src/adapters/<platform>-normalize.ts`. Grammars consume
 * this shape and never reach back into platform-specific fields.
 *
 * Design notes:
 * - `description` is pre-flattened to plaintext at normalization time;
 *   `descriptionRichSource` lets grammars still report the rich-text
 *   semantic loss accurately.
 * - `sprints` and `fixVersions` are first-class because both grammars use
 *   them as hierarchy-loss surfaces; the normalizer extracts them from
 *   wherever the source platform stores them.
 * - `customFields` carries only project-specific fields the normalizer did
 *   not promote to a typed slot. Source-platform system fields (Jira Rank,
 *   Story Points, etc.) are stripped at the normalizer so grammars don't
 *   have to.
 */
export interface NormalizedIssue {
  /** Stable source identifier. Jira: issue key (`SCRUM-5`). Asana: gid. */
  sourceKey: string;
  /** Platform identifier — `jira-cloud`, `asana`, etc. */
  sourcePlatform: string;

  summary: string;
  /** Plaintext rendition of the source description, or null. */
  description: string | null;
  /** Source-side rich-text format if any (so grammars can report flatten loss). */
  descriptionRichSource: 'adf' | 'html' | 'markdown' | null;

  /** Source-side issue type name (`Task`, `Story`, `Component`, etc.) or null. */
  issueType: string | null;
  /** Source-side status / section / column name, or null. */
  status: string | null;
  /** Source-side priority label, or null. */
  priority: string | null;

  assignee: NormalizedActor | null;
  parent: { sourceKey: string; summary?: string } | null;
  labels: string[];
  dueDate: string | null;

  sprints: NormalizedSprint[];
  fixVersions: NormalizedFixVersion[];

  customFields: NormalizedCustomField[];

  /** Verbatim source record. Available for grammars that genuinely need
   *  source-specific signal; using it is a smell — prefer extending the
   *  normalized shape over reaching here. */
  sourceRaw?: unknown;
}

export interface NormalizedActor {
  /** Stable source-side handle if available (Jira `accountId`, Asana `gid`). */
  handle?: string;
  displayName: string;
}

export interface NormalizedSprint {
  id?: string;
  name: string;
  state?: string;
  startDate?: string;
  endDate?: string;
}

export interface NormalizedFixVersion {
  name: string;
  released?: boolean;
  releaseDate?: string;
}

export interface NormalizedCustomField {
  /** Display name (e.g. "Customer Segment", "Engineering Owner"). */
  name: string;
  value: unknown;
  /** Source-side identifier for round-trip (`customfield_10042`, Asana gid). */
  sourceId?: string;
}

// --- Reverse direction ---------------------------------------------------

/**
 * A conflict detected during a reverse pass. Both the source side and the
 * destination side have moved relative to the last snapshot — the engine
 * does not auto-resolve; the conflict is surfaced in the manifest with
 * enough context for a downstream tool (or human) to decide.
 *
 * Distinct from a `LossEntry`: losses are translation-time and per-record;
 * conflicts are pass-time and require comparing three values (current
 * source, current dest, and the snapshot taken at the previous pass).
 */
export interface Conflict {
  /** Source-side stable identifier for the record. */
  sourceKey: string;
  /** Field name as it appears on the destination (e.g. `Name`, `Priority`). */
  field: string;
  /** Value on the source side at reverse-pass time. */
  sourceCurrent: unknown;
  /** Value on the destination side at reverse-pass time. */
  destCurrent: unknown;
  /** Value at the last successful forward pass (from the snapshot). */
  lastSnapshot: unknown;
  /** Resolution hint. v1 grammars set this to `'unresolved'`; downstream
   *  tooling or a human picks. */
  resolution: 'source-wins' | 'dest-wins' | 'unresolved';
  /** Optional human-readable note about why the field is a conflict. */
  notes?: string;
}

/**
 * Output of a reverse pass per record. `sourcePatch` is the partial
 * source-shape update body to apply (e.g. a Jira `fields` patch). `applied`
 * names the fields that round-tripped cleanly; `skipped` names fields the
 * grammar refused to round-trip with a reason; `conflicts` names fields
 * where both sides moved since the last snapshot.
 */
export interface ReverseTranslationResult {
  /** Source-platform-shaped patch body. Empty object means no update needed. */
  sourcePatch: Record<string, unknown>;
  applied: string[];
  skipped: Array<{ field: string; reason: string }>;
  conflicts: Conflict[];
}
