// Shared types for translation grammars. The five-kind loss taxonomy comes
// from the translation doctrine (see REFERENCES.md). Every grammar produces
// one TranslationResult per source record.

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
 * relationships (e.g. epic key → epic summary so the Airtable Epic field
 * can carry a human-readable label instead of an opaque key) and to
 * distinguish Jira's system custom fields (Rank, Story Points, etc.) from
 * project-specific ones that are the real schema-loss surface.
 */
export interface GrammarContext {
  epicSummaryByKey: Map<string, string>;
  /** customfield_* id → display name (e.g. customfield_10019 → "Rank"). */
  customFieldNames?: Map<string, string>;
}
