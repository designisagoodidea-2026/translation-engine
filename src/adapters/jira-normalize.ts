// Jira → NormalizedIssue normalizer. The adapter (`jira.ts`) fetches raw
// records over HTTP; this file converts them into the source-agnostic
// `NormalizedIssue` shape that grammars consume.
//
// The split exists so grammars can stay platform-agnostic. Add a new source
// platform (Asana, Linear, etc.) by writing a sibling `<platform>-normalize.ts`
// that produces the same `NormalizedIssue` shape — no grammar changes.

import type { JiraIssue } from './jira.js';
import type {
  NormalizedActor,
  NormalizedCustomField,
  NormalizedFixVersion,
  NormalizedIssue,
  NormalizedSprint,
} from '../grammars/types.js';

/**
 * Jira's built-in system custom fields. Stripped at normalization time so
 * grammars don't have to filter them out. These are platform-internal
 * meta-fields (Rank, Story Points, Flagged, etc.), not project-specific
 * schema-loss candidates.
 */
const JIRA_SYSTEM_FIELD_NAME_RE =
  /^(rank|story points?|story point estimate|epic (link|status|color|name)|issue color|flagged|start date|team|request type|development|change reason|approvers?|impact|parent link|target start|target end|category)$/i;

/** Default Sprint custom-field ID on Jira Cloud. Used as fallback when the
 *  display-name lookup ("Sprint") does not resolve a customfield_* ID. */
const DEFAULT_SPRINT_CUSTOM_FIELD = 'customfield_10020';

export interface JiraNormalizeContext {
  /** customfield_* id → display name (from `/rest/api/3/field`). Drives
   *  display-name extraction for `customFields` and identifies the Sprint
   *  field by name when its ID is non-default. */
  customFieldNames?: Map<string, string>;
}

export function normalizeJiraIssue(
  issue: JiraIssue,
  ctx: JiraNormalizeContext = {},
): NormalizedIssue {
  const f = issue.fields ?? {};
  const customFieldNames = ctx.customFieldNames ?? new Map<string, string>();

  // Resolve sprint custom-field ID: prefer display-name lookup over
  // hardcoded default so non-standard Jira instances still work.
  let sprintFieldId = DEFAULT_SPRINT_CUSTOM_FIELD;
  for (const [id, name] of customFieldNames) {
    if (/^sprint$/i.test(name)) {
      sprintFieldId = id;
      break;
    }
  }

  // Description: flatten ADF to plaintext + record source format.
  let description: string | null = null;
  let descriptionRichSource: NormalizedIssue['descriptionRichSource'] = null;
  if (f.description != null) {
    description = flattenAdf(f.description);
    descriptionRichSource = 'adf';
  }

  // Assignee → NormalizedActor.
  const assignee: NormalizedActor | null = f.assignee
    ? {
        handle: f.assignee.accountId,
        displayName: f.assignee.displayName ?? '',
      }
    : null;

  // Parent (epic in PM, family in DSOps — same shape either way).
  const parent: NormalizedIssue['parent'] = f.parent?.key
    ? {
        sourceKey: f.parent.key,
        summary: f.parent.fields?.summary,
      }
    : null;

  // Sprints — Jira returns an array of sprint objects on the sprint custom field.
  const sprintsRaw = (f as any)[sprintFieldId];
  const sprints: NormalizedSprint[] = Array.isArray(sprintsRaw)
    ? sprintsRaw.map((s: any) => ({
        id: s?.id != null ? String(s.id) : undefined,
        name: s?.name ?? '',
        state: s?.state,
        startDate: s?.startDate,
        endDate: s?.endDate,
      }))
    : [];

  // Fix versions.
  const fixVersions: NormalizedFixVersion[] = Array.isArray(f.fixVersions)
    ? f.fixVersions.map((v: any) => ({
        name: v?.name ?? '',
        released: v?.released,
        releaseDate: v?.releaseDate,
      }))
    : [];

  // Custom fields — everything else under customfield_* that isn't a Jira
  // system field and isn't the sprint field (already handled).
  const customFields: NormalizedCustomField[] = [];
  for (const [key, value] of Object.entries(f)) {
    if (!key.startsWith('customfield_')) continue;
    if (key === sprintFieldId) continue;
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    const name = customFieldNames.get(key);
    if (name && JIRA_SYSTEM_FIELD_NAME_RE.test(name)) continue;

    customFields.push({
      name: name ?? key,
      value: extractCustomFieldValue(value),
      sourceId: key,
    });
  }

  return {
    sourceKey: issue.key,
    sourcePlatform: 'jira-cloud',
    summary: f.summary ?? '',
    description,
    descriptionRichSource,
    issueType: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee,
    parent,
    labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
    dueDate: f.duedate ?? null,
    sprints,
    fixVersions,
    customFields,
    sourceRaw: issue,
  };
}

/**
 * Unwrap Jira's common custom-field value shapes into a plain value so
 * grammars don't have to know about `{ value: "..." }` vs `{ name: "..." }`
 * vs raw scalars. Returns the original value if no known wrapper matches.
 */
function extractCustomFieldValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.name === 'string') return obj.name;
  return value;
}

/**
 * Flatten an Atlassian Document Format (ADF) node to plain text. Preserves
 * paragraph breaks but drops formatting, marks, lists, mentions, etc.
 *
 * Exposed because consumers occasionally need it standalone (e.g. a
 * downstream tool wants to preview a Jira description without going
 * through the full normalize/translate path).
 */
export function flattenAdf(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (Array.isArray(node.content)) {
    if (node.type === 'doc') {
      return node.content.map(flattenAdf).join('\n\n').trim();
    }
    return node.content.map(flattenAdf).join('');
  }
  return '';
}
