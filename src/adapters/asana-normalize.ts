// Asana → NormalizedIssue normalizer.
//
// Sibling to `jira-normalize.ts`. Produces the same `NormalizedIssue`
// contract from a different platform's record shape. Grammars consume
// either output transparently — that's the doctrine claim being tested
// here.

import type {
  NormalizedActor,
  NormalizedCustomField,
  NormalizedIssue,
} from '../grammars/types.js';
import type { AsanaTask, AsanaCustomField } from './asana.js';

/**
 * Asana custom-field names the normalizer recognizes and promotes to
 * typed slots on NormalizedIssue (instead of leaving them in customFields
 * to be reported as schema loss). Matched case-insensitively.
 *
 *   "Priority"     → NormalizedIssue.priority
 *   "Type"         → NormalizedIssue.issueType
 *
 * Anything else stays in customFields and surfaces as schema loss.
 */
const PROMOTED_FIELD_NAMES = new Set(['priority', 'type']);

export function normalizeAsanaTask(task: AsanaTask): NormalizedIssue {
  // Description: Asana returns plaintext `notes` and optionally HTML
  // `html_notes`. Prefer flattened HTML when present so the grammar can
  // report the rich-text loss; otherwise use plaintext notes verbatim.
  let description: string | null = null;
  let descriptionRichSource: NormalizedIssue['descriptionRichSource'] = null;
  if (task.html_notes) {
    description = flattenHtml(task.html_notes);
    descriptionRichSource = 'html';
  } else if (task.notes != null && task.notes !== '') {
    description = task.notes;
    descriptionRichSource = null;
  }

  // Status: first project membership's section name is the closest
  // Asana analogue to Jira status. If a task is in multiple projects the
  // first one wins; cross-project section divergence would be its own
  // hierarchy-loss surface (deferred).
  const firstSection = task.memberships?.find((m) => m.section)?.section;
  const status: string | null = firstSection?.name ?? null;

  // Custom-field handling: promote "Priority" / "Type" to typed slots;
  // everything else goes to customFields.
  let promotedPriority: string | null = null;
  let promotedType: string | null = null;
  const customFields: NormalizedCustomField[] = [];

  for (const cf of task.custom_fields ?? []) {
    const value = extractCustomFieldValue(cf);
    if (value == null || (Array.isArray(value) && value.length === 0)) continue;

    const lowerName = cf.name.toLowerCase();
    if (PROMOTED_FIELD_NAMES.has(lowerName)) {
      if (lowerName === 'priority' && typeof value === 'string') {
        promotedPriority = value;
      } else if (lowerName === 'type' && typeof value === 'string') {
        promotedType = value;
      }
      continue;
    }

    customFields.push({
      name: cf.name,
      value,
      sourceId: cf.gid,
    });
  }

  // Assignee.
  const assignee: NormalizedActor | null = task.assignee
    ? { handle: task.assignee.gid, displayName: task.assignee.name }
    : null;

  // Parent — keep as a ref. Whether the parent itself is also translated
  // depends on the runner's policy (parents are normally excluded from the
  // translatable set).
  const parent: NormalizedIssue['parent'] = task.parent
    ? { sourceKey: task.parent.gid, summary: task.parent.name }
    : null;

  // Tags → labels (label semantic).
  const labels = (task.tags ?? []).map((t) => t.name);

  return {
    sourceKey: task.gid,
    sourcePlatform: 'asana',
    summary: task.name,
    description,
    descriptionRichSource,
    issueType: promotedType,
    status,
    priority: promotedPriority,
    assignee,
    parent,
    labels,
    dueDate: task.due_on ?? null,
    sprints: [],
    fixVersions: [],
    customFields,
    sourceRaw: task,
  };
}

/**
 * Extract the most usable value from an Asana custom field. Asana's typed
 * value lives in a per-type `*_value` field; `display_value` is the
 * UI-rendered fallback.
 */
function extractCustomFieldValue(cf: AsanaCustomField): unknown {
  switch (cf.type) {
    case 'enum':
      return cf.enum_value?.name ?? cf.display_value ?? null;
    case 'multi_enum':
      return (cf.multi_enum_values ?? []).map((v) => v.name);
    case 'text':
      return cf.text_value ?? cf.display_value ?? null;
    case 'number':
      return cf.number_value ?? null;
    case 'date':
      return cf.date_value?.date ?? null;
    default:
      return cf.display_value ?? null;
  }
}

/**
 * Minimal HTML-to-plaintext flatten. Asana's html_notes uses a small subset
 * (<body>, <p>, <ul>, <li>, <strong>, <em>, <a>, <br>). We strip tags and
 * collapse whitespace; downstream grammar reports the semantic loss against
 * descriptionRichSource='html'.
 */
function flattenHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
