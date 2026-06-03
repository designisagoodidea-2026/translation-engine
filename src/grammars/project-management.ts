// Translation grammar: Jira (project management context) → Airtable (Roadmap shape).
//
// Deterministic. Pattern-based loss classification per the five-kind taxonomy
// (schema, semantic, hierarchy, context, provenance). No LLM in the loop —
// every loss is named by a regex, map, or explicit rule.
//
// One translateIssue() call per source issue. The aggregate manifest is
// built downstream from many translateIssue() results.

import type { JiraIssue } from '../adapters/jira.js';
import type {
  GrammarContext,
  LossEntry,
  TranslationResult,
} from './types.js';

// --- Deterministic maps --------------------------------------------------

// Jira's priority enum maps to Airtable's single-select with identical names.
// The map exists so future renames or mismatches stay localized to this file.
const PRIORITY_MAP: Record<string, string> = {
  Highest: 'Highest',
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  Lowest: 'Lowest',
};

// Destination status bucket — three values, fuzzily matched from any Jira
// workflow template (Backlog/Up Next/Active/Blocked/Complete or canonical
// To Do/In Progress/Done).
type DestStatus = 'To Do' | 'In Progress' | 'Done';

function bucketStatus(jiraStatusName: string): DestStatus {
  const s = jiraStatusName.toLowerCase();
  if (/active|in.?progress|doing|started|working/.test(s)) return 'In Progress';
  if (/done|complete|closed|resolved|finished/.test(s)) return 'Done';
  return 'To Do'; // Backlog, Up Next, Open, New, etc.
}

// Slack-thread-as-spec detector — surfaces context loss. Captures the URL
// itself; the actual conversation is unreachable from the destination.
const SLACK_URL_RE = /https:\/\/[a-z0-9-]+\.slack\.com\/[^\s)\]]+/gi;

// Jira Cloud's Sprint custom field. Stable across Free/Standard/Premium for
// most installs; we still tolerate it being absent.
const SPRINT_CUSTOM_FIELD = 'customfield_10020';

// Custom fields we recognize and translate explicitly. Anything else gets
// surfaced as schema loss (after the system-field filter below).
const HANDLED_CUSTOM_FIELDS = new Set<string>([SPRINT_CUSTOM_FIELD]);

// Jira system custom fields — internal to Jira's product surface, not
// translation candidates. Filtered by display name (resolved at runtime via
// /rest/api/3/field) so the rule travels across Jira instances regardless of
// which customfield_* ID got assigned.
const SYSTEM_FIELD_NAME_RE =
  /^(rank|story points?|story point estimate|epic (link|status|color|name)|issue color|flagged|start date|sprint|team|request type|development|change reason|approvers?|impact|parent link|target start|target end|category)$/i;

// --- Translation ---------------------------------------------------------

export function translateIssue(
  issue: JiraIssue,
  ctx: GrammarContext,
): TranslationResult {
  const f = issue.fields ?? {};
  const losses: LossEntry[] = [];
  const losslessFields: string[] = [];
  const out: Record<string, unknown> = {};

  // 1. summary → Name. Strings identical; nothing semantic to lose.
  out['Name'] = f.summary ?? '';
  losslessFields.push('summary→Name');

  // 2. description → Description. ADF flattened to plain text (semantic).
  //    Also scanned for Slack URLs (context).
  if (f.description != null) {
    const plain = flattenAdf(f.description);
    out['Description'] = plain;
    losses.push({
      kind: 'semantic',
      field: 'description→Description',
      resolution: 'lossy',
      distance:
        'Jira description is Atlassian Document Format (paragraphs, lists, mentions, links, embedded media). The destination stores flattened plain text — rich-text structure, @mentions resolved to identities, and any interactive elements are dropped.',
      source: '(ADF document)',
      destination: preview(plain),
    });

    const slackUrls = Array.from(plain.matchAll(SLACK_URL_RE), (m) => m[0]);
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

  // 3. status → Status. Workflow semantics (transitions, permissions,
  //    allowed next states) are dropped. Bucketing also normalizes
  //    template-specific status names.
  const srcStatus = f.status?.name;
  if (srcStatus) {
    const destStatus = bucketStatus(srcStatus);
    out['Status'] = destStatus;
    losses.push({
      kind: 'semantic',
      field: 'status→Status',
      resolution: 'lossy',
      distance:
        'Jira status sits inside a workflow with transitions, permissions, and allowed next states. The destination single-select has no transition semantics. The bucketing also normalizes template-specific names (e.g. "Active" → "In Progress", "Backlog" → "To Do").',
      source: srcStatus,
      destination: destStatus,
    });
  }

  // 4. priority → Priority. Names map 1:1, but side-effect parity is lost
  //    (Jira priorities drive SLAs/notifications; Airtable selects don't).
  const srcPriority = f.priority?.name;
  if (srcPriority) {
    const destPriority = PRIORITY_MAP[srcPriority] ?? srcPriority;
    out['Priority'] = destPriority;
    losses.push({
      kind: 'semantic',
      field: 'priority→Priority',
      resolution: 'lossy',
      distance:
        'Names map 1:1, but Jira priority drives notification rules, SLA timers, and project-level reporting. The destination single-select carries the label only — there is no behavioral parity.',
      source: srcPriority,
      destination: destPriority,
    });
  }

  // 5. assignee → Assignee. Account identity drops; displayName survives.
  const a = f.assignee;
  if (a) {
    const display = a.displayName ?? '';
    out['Assignee'] = display;
    losses.push({
      kind: 'provenance',
      field: 'assignee→Assignee',
      resolution: 'lossy',
      distance: `Jira assignee is an account object (accountId "${a.accountId ?? '?'}"). Only the displayName survives the translation. The destination text field cannot disambiguate two assignees with the same name and has no link back to the source account.`,
      source: { accountId: a.accountId, displayName: display },
      destination: display,
    });
  }

  // 6. parent (epic) → Epic. The typed link to an Epic issue collapses to
  //    a free-form text label — hierarchy loss.
  if (f.parent?.key) {
    const parentKey: string = f.parent.key;
    const parentSummary =
      ctx.epicSummaryByKey.get(parentKey) ?? f.parent.fields?.summary ?? parentKey;
    out['Epic'] = parentSummary;
    losses.push({
      kind: 'hierarchy',
      field: 'parent→Epic',
      resolution: 'lossy',
      distance: `Jira parent is a typed link to Epic ${parentKey} — navigable, roll-up-aware, child-completion-tracking. The destination Epic is a free-form text field; the link semantic is gone.`,
      source: { key: parentKey, summary: parentSummary },
      destination: parentSummary,
    });
  }

  // 7. labels → Labels. Array of strings → multipleSelects. Lossless.
  if (Array.isArray(f.labels) && f.labels.length > 0) {
    out['Labels'] = f.labels;
    losslessFields.push('labels→Labels');
  }

  // 8. duedate → Due. ISO date string. Lossless.
  if (f.duedate) {
    out['Due'] = f.duedate;
    losslessFields.push('duedate→Due');
  }

  // 9. sprint (customfield_10020) → Sprint. Object array → first name.
  //    Hierarchy loss — multi-sprint membership, dates, state dropped.
  const sprintField = (f as any)[SPRINT_CUSTOM_FIELD];
  if (Array.isArray(sprintField) && sprintField.length > 0) {
    const first = sprintField[0];
    const sprintName: string = first?.name ?? '';
    out['Sprint'] = sprintName;
    losses.push({
      kind: 'hierarchy',
      field: 'sprint→Sprint',
      resolution: 'lossy',
      distance:
        'Jira sprint is an object (name, state, startDate, endDate, completeDate, originBoardId). The destination Sprint is a single string — only the first sprint name survives. Multi-sprint membership, dates, and state are dropped.',
      source: sprintField.map((s: any) => ({
        id: s?.id,
        name: s?.name,
        state: s?.state,
        startDate: s?.startDate,
        endDate: s?.endDate,
      })),
      destination: sprintName,
    });
  }

  // 10. fixVersions → Fix Version. Array → comma-joined names.
  //     Hierarchy loss — release dates and status dropped.
  if (Array.isArray(f.fixVersions) && f.fixVersions.length > 0) {
    const names = f.fixVersions
      .map((v: any) => v?.name)
      .filter(Boolean) as string[];
    const joined = names.join(', ');
    out['Fix Version'] = joined;
    losses.push({
      kind: 'hierarchy',
      field: 'fixVersions→Fix Version',
      resolution: 'lossy',
      distance:
        'Jira fixVersions is an array of version objects with release dates and release status. The destination Fix Version is a single text field — names are joined with commas; release dates and status are dropped.',
      source: f.fixVersions.map((v: any) => ({
        name: v?.name,
        released: v?.released,
        releaseDate: v?.releaseDate,
      })),
      destination: joined,
    });
  }

  // 11. Any unhandled, non-system custom field → schema loss. This is the
  //     canonical surface for project-specific fields with no destination
  //     concept (e.g. "Customer Segment" once it's added to the Jira project).
  //     Jira's own system fields (Rank, Story Points, Flagged, etc.) are
  //     filtered out — they are not translation candidates.
  const customFieldNames = ctx.customFieldNames ?? new Map<string, string>();
  for (const [key, value] of Object.entries(f)) {
    if (!key.startsWith('customfield_')) continue;
    if (HANDLED_CUSTOM_FIELDS.has(key)) continue;
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    const fieldName = customFieldNames.get(key);
    if (fieldName && SYSTEM_FIELD_NAME_RE.test(fieldName)) continue;

    const displayField = fieldName ? `${fieldName} (${key})` : key;
    losses.push({
      kind: 'schema',
      field: displayField,
      resolution: 'dropped',
      distance: `Project-specific custom field "${fieldName ?? key}" has no destination concept on the Roadmap shape. Dropped from the Airtable write; preserved here in the manifest so the field can be wired up in a future pass or grammar revision.`,
      source: value,
      destination: null,
    });
  }

  // 12. Jira key → Jira Key + manifest provenance mapping. Lossless via
  //     side channel (the mapping itself lives in the manifest).
  out['Jira Key'] = issue.key;
  losslessFields.push('key→Jira Key (manifest preserves bidirectional mapping)');

  return {
    jiraKey: issue.key,
    airtableFields: out,
    losses,
    losslessFields,
  };
}

// --- Helpers -------------------------------------------------------------

/**
 * Flatten an Atlassian Document Format (ADF) node to plain text. Preserves
 * paragraph breaks but drops formatting, marks, lists, mentions, etc.
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

function preview(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
