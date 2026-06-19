// Asana adapter — type surface for v0.2.
//
// HTTP operations are stubbed for the prototype/POC: the fixture-driven
// runner exercises the normalizer against synthetic JSON in
// `demo/fixtures/asana-*.json`. The real fetch path (Personal Access
// Token, `https://app.asana.com/api/1.0/...`, pagination via `next_page`)
// will land when a real Asana source is needed — at which point
// `asanaFetch` here follows the same shape as `jiraFetch` in `jira.ts`.
//
// Source: Asana docs (https://developers.asana.com/reference/tasks).
// Fields included here are the minimum the PM grammar's normalizer needs.

export interface AsanaTask {
  /** Stable identifier. Asana calls this `gid`. */
  gid: string;
  resource_type?: 'task';

  /** Task title. Maps to NormalizedIssue.summary. */
  name: string;
  /** Plaintext notes. Maps to NormalizedIssue.description when html_notes
   *  is not present. */
  notes?: string | null;
  /** Optional HTML version of notes. Asana returns both when requested via
   *  `opt_fields=notes,html_notes`. */
  html_notes?: string | null;

  completed?: boolean;
  due_on?: string | null;

  assignee?: AsanaUser | null;
  parent?: AsanaTaskRef | null;

  custom_fields?: AsanaCustomField[];
  memberships?: AsanaMembership[];
  tags?: AsanaTag[];

  /** Source-side timestamps preserved for normalizer use if it grows them. */
  created_at?: string;
  modified_at?: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  resource_type?: 'user';
}

export interface AsanaTaskRef {
  gid: string;
  name?: string;
  resource_type?: 'task';
}

/**
 * Asana custom fields are richly typed (text, number, enum, multi_enum,
 * date, people). `display_value` is the rendered string Asana shows in its
 * UI; the typed value lives in one of the `*_value` fields. The normalizer
 * prefers the typed value and falls back to display_value.
 */
export interface AsanaCustomField {
  gid: string;
  name: string;
  type?: 'text' | 'number' | 'enum' | 'multi_enum' | 'date' | 'people';
  display_value?: string | null;
  text_value?: string | null;
  number_value?: number | null;
  enum_value?: { gid: string; name: string } | null;
  multi_enum_values?: Array<{ gid: string; name: string }> | null;
  date_value?: { date: string } | null;
}

export interface AsanaMembership {
  project?: { gid: string; name: string };
  /** Section within the project. Asana's closest analogue to Jira status. */
  section?: { gid: string; name: string } | null;
}

export interface AsanaTag {
  gid: string;
  name: string;
}
