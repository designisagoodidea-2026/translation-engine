// Translation grammar: design-system-ops context → Airtable
// (Component Inventory shape).
//
// Source-agnostic as of v0.2: consumes the same `NormalizedIssue` contract
// the PM grammar does. What differs is the destination schema, the loss
// taxonomy, and the semantic interpretation of common normalized fields:
//
//   - status → Maturity (Experimental / Beta / Stable / Deprecated), not
//     "Status" in the PM sense.
//   - issueType → Type (Component / Token / Pattern / Guideline), not the
//     PM "Task / Story / Bug" axis.
//   - parent → Family, not Epic.
//   - Figma URLs and Storybook URLs embedded in descriptions are the
//     first-class context-loss surface (analogous to Slack URLs in PM).
//   - Token references in descriptions (`theme.color.*`, `--token-*`)
//     are surfaced as their own schema-loss kind — they are semantically
//     meaningful in DSOps and have no destination concept.
//
// Same posture as the PM grammar: deterministic, no LLM in the loop, every
// loss named by regex/map/explicit rule.

import type {
  GrammarContext,
  LossEntry,
  NormalizedIssue,
  TranslationResult,
} from './types.js';

// --- Deterministic maps --------------------------------------------------

/**
 * Source status → DSOps Maturity. Bucketing collapses platform-specific
 * names. Maturity is intentionally a flat four-step lifecycle, not a
 * workflow — downstream-consumer pressure (adoption, deprecation
 * timelines) is not modeled here.
 */
type DestMaturity = 'Experimental' | 'Beta' | 'Stable' | 'Deprecated';

function bucketMaturity(statusName: string): DestMaturity {
  const s = statusName.toLowerCase();
  if (/deprecat|sunset|retire|removed/.test(s)) return 'Deprecated';
  if (/done|complete|closed|resolved|stable|released|ga|shipped/.test(s)) return 'Stable';
  if (/active|in.?progress|doing|beta|preview/.test(s)) return 'Beta';
  return 'Experimental'; // Backlog, To Do, Open, New, Draft, Spike, etc.
}

/**
 * Source issue-type → DSOps Type. Falls back to 'Component' for unknown
 * types so the grammar does not silently drop work.
 */
function bucketType(issueTypeName: string | null): string {
  if (!issueTypeName) return 'Component';
  const t = issueTypeName.toLowerCase();
  if (/token/.test(t)) return 'Token';
  if (/pattern/.test(t)) return 'Pattern';
  if (/guideline|doc(s|umentation)?|guide/.test(t)) return 'Guideline';
  return 'Component';
}

// Figma file/node URLs — the most common context-loss surface in DSOps
// descriptions. Captures the URL; the file content itself is unreachable
// from the destination row.
const FIGMA_URL_RE = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|community)\/[^\s)\]]+/gi;

// Storybook URLs — similar. Often the live reference for component states
// and variants.
const STORYBOOK_URL_RE = /https:\/\/[a-z0-9.-]*storybook[a-z0-9.-]*\/[^\s)\]]+/gi;

// Design token references. Two common conventions:
//   - dotted theme paths: theme.color.primary.500, tokens.spacing.md
//   - CSS custom properties: --color-primary-500, --space-md
// Captured separately so the manifest can name the convention concretely.
const TOKEN_DOTTED_RE = /\b(?:theme|tokens?|ds)\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+/gi;
const TOKEN_CUSTOMPROP_RE = /--[a-z][a-z0-9-]*(?:-[a-z0-9]+)+/gi;

// --- Translation ---------------------------------------------------------

export function translateIssue(
  issue: NormalizedIssue,
  ctx: GrammarContext,
): TranslationResult {
  const losses: LossEntry[] = [];
  const losslessFields: string[] = [];
  const out: Record<string, unknown> = {};

  const platformLabel = labelForPlatform(issue.sourcePlatform);

  // 1. summary → Component Name. Lossless.
  out['Component Name'] = issue.summary;
  losslessFields.push('summary→Component Name');

  // 2. description → Description + context/schema scans.
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

    // 2a. Embedded Figma URLs → context loss.
    const figmaUrls = Array.from(issue.description.matchAll(FIGMA_URL_RE), (m) => m[0]);
    if (figmaUrls.length > 0) {
      losses.push({
        kind: 'context',
        field: 'description embeds Figma URL',
        resolution: 'annotated',
        distance:
          'The live design reference for this component lives in a Figma file linked from the description. The URL travels with the description text, but the file\'s frames, variants, and component definitions are not retrievable from the destination row — viewers see a URL, not the design.',
        source: figmaUrls,
        destination: 'URL retained in Description text',
      });
      out['Figma URL'] = figmaUrls[0];
    }

    // 2b. Embedded Storybook URLs → context loss.
    const storybookUrls = Array.from(issue.description.matchAll(STORYBOOK_URL_RE), (m) => m[0]);
    if (storybookUrls.length > 0) {
      losses.push({
        kind: 'context',
        field: 'description embeds Storybook URL',
        resolution: 'annotated',
        distance:
          'The live runtime reference (states, variants, props, a11y notes) lives in a Storybook page linked from the description. The URL travels, but the rendered stories themselves are not reachable from the destination — viewers cannot inspect props or interact with states from the Airtable row.',
        source: storybookUrls,
        destination: 'URL retained in Description text',
      });
      out['Storybook URL'] = storybookUrls[0];
    }

    // 2c. Design token references → schema loss. Tokens are semantically
    // meaningful in DSOps (they tie a component to the design system's
    // primitives). The destination has no token-aware field, so we record
    // the references in the manifest and as a plain comma-joined string.
    const tokenRefs = Array.from(
      new Set([
        ...Array.from(issue.description.matchAll(TOKEN_DOTTED_RE), (m) => m[0]),
        ...Array.from(issue.description.matchAll(TOKEN_CUSTOMPROP_RE), (m) => m[0]),
      ]),
    );
    if (tokenRefs.length > 0) {
      out['Tokens Referenced'] = tokenRefs.join(', ');
      losses.push({
        kind: 'schema',
        field: 'description references design tokens',
        resolution: 'lossy',
        distance:
          'The description references design-system tokens (dotted theme paths and/or CSS custom properties). In a token-aware destination these would link to canonical token definitions with values, deprecation status, and downstream usage; here they are flattened to a comma-joined text field with no token-graph semantics.',
        source: tokenRefs,
        destination: tokenRefs.join(', '),
      });
    }
  }

  // 3. status → Maturity. Workflow / section semantics drop. Bucketing
  //    also normalizes platform-specific names.
  if (issue.status) {
    const maturity = bucketMaturity(issue.status);
    out['Maturity'] = maturity;
    losses.push({
      kind: 'semantic',
      field: 'status→Maturity',
      resolution: 'lossy',
      distance:
        `${platformLabel} status sits inside a workflow / section with transitions, review gates, and allowed next states. DSOps Maturity is a flat four-step lifecycle (Experimental → Beta → Stable → Deprecated) carrying no enforcement on downstream consumers — adoption pressure and deprecation timelines are not modeled.`,
      source: issue.status,
      destination: maturity,
    });
  }

  // 4. issueType → Type. Semantic loss (the workflow attached to the
  //    source issuetype drops away).
  if (issue.issueType) {
    const destType = bucketType(issue.issueType);
    out['Type'] = destType;
    losses.push({
      kind: 'semantic',
      field: 'issueType→Type',
      resolution: 'lossy',
      distance:
        `${platformLabel} issue types carry workflows, screens, and permission schemes. The destination Type is a flat categorical label (Component / Token / Pattern / Guideline) with no behavioral parity.`,
      source: issue.issueType,
      destination: destType,
    });
  }

  // 5. assignee → Design Owner. Provenance loss + paired-ownership loss.
  //    In DSOps a component change usually has both a design owner and an
  //    engineering owner; a single-assignee source cannot carry both.
  if (issue.assignee) {
    const display = issue.assignee.displayName;
    out['Design Owner'] = display;
    losses.push({
      kind: 'provenance',
      field: 'assignee→Design Owner',
      resolution: 'lossy',
      distance: `${platformLabel} assignee is an account object (source handle "${issue.assignee.handle ?? '?'}"). Only the displayName survives. Worse for DSOps: design-system work is typically pair-owned (designer + engineer), but the source carries only one assignee — the counterpart side of ownership is structurally unrepresentable in the source and therefore in the destination.`,
      source: { handle: issue.assignee.handle, displayName: display },
      destination: display,
    });
  }

  // 6. parent → Family. Hierarchy loss (typed link → free-form text).
  //    The PM grammar names this "Epic"; in DSOps the same parent relation
  //    is a component family (e.g. "Feeder buttons", "Color tokens").
  if (issue.parent) {
    const parentSummary =
      ctx.parentSummaryByKey.get(issue.parent.sourceKey) ?? issue.parent.summary ?? issue.parent.sourceKey;
    out['Family'] = parentSummary;
    losses.push({
      kind: 'hierarchy',
      field: 'parent→Family',
      resolution: 'lossy',
      distance: `Source parent is a typed link to ${issue.parent.sourceKey} — navigable, child-aware. The destination Family is a free-form text label; the typed-link semantic is gone. Multi-axis membership (a token belonging to several families) cannot be expressed.`,
      source: { key: issue.parent.sourceKey, summary: parentSummary },
      destination: parentSummary,
    });
  }

  // 7. labels → Tags. Lossless.
  if (issue.labels.length > 0) {
    out['Tags'] = issue.labels;
    losslessFields.push('labels→Tags');
  }

  // 8. dueDate → Release Target. Lossless if present.
  if (issue.dueDate) {
    out['Release Target'] = issue.dueDate;
    losslessFields.push('dueDate→Release Target');
  }

  // 9. priority is intentionally NOT mapped. Source priority is a PM
  //    concept (urgency, SLA pressure) without a clean DSOps analogue —
  //    component priority would conflate adoption pressure, deprecation
  //    urgency, and bug severity. Surfaced as a deliberate semantic drop
  //    so the manifest can record the choice.
  if (issue.priority) {
    losses.push({
      kind: 'semantic',
      field: 'priority→(intentionally not mapped)',
      resolution: 'dropped',
      distance:
        `${platformLabel} priority drives PM workflows (SLA pressure, notification rules). DSOps has no single "priority" concept — adoption pressure, deprecation urgency, and bug severity are distinct axes. The grammar drops priority deliberately rather than collapsing them; reintroduce per-axis fields if and when the destination grows them.`,
      source: issue.priority,
      destination: null,
    });
  }

  // 10. Project-specific custom fields → schema loss. The normalizer
  //     strips platform system fields, so anything reaching here is a
  //     real DSOps schema-loss candidate (e.g. "Engineering Owner" would
  //     close the paired-ownership gap surfaced on assignee).
  for (const cf of issue.customFields) {
    losses.push({
      kind: 'schema',
      field: cf.sourceId ? `${cf.name} (${cf.sourceId})` : cf.name,
      resolution: 'dropped',
      distance: `Project-specific custom field "${cf.name}" has no destination concept on the Component Inventory shape. Dropped from the Airtable write; preserved in the manifest so the field can be wired up in a future grammar revision (e.g. an "Engineering Owner" field would close the paired-ownership gap surfaced on assignee).`,
      source: cf.value,
      destination: null,
    });
  }

  // 11. sourceKey → Source Key + manifest provenance mapping. Lossless via
  //     side channel.
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

function preview(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
