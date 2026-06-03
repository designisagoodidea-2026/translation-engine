// User-decision overlay on top of the grammar's baseline translation.
//
// The grammar is deliberately opinionated — it ships a default resolution for
// every loss it surfaces. Some losses, though, have legitimate options the
// grammar can't decide unilaterally: should a Slack-URL context loss keep the
// URL only or fetch a thread snapshot? Should a parent epic display as
// summary, key, or both? Those choices live in user space, expressed here as
// a `UserDecisions` value and applied as a post-processing pass over the
// baseline result.
//
// This separation keeps the doctrine intact (grammar is opinionated, not
// configurable) while giving the product surface a place to live.

import type { LossEntry, TranslationResult } from '../../src/grammars/types.js';

export type SlackContextHandling = 'keep-url' | 'fetch-thread' | 'drop' | 'skip';
export type EpicDisplayMode = 'summary' | 'key' | 'both' | 'skip';
export type CustomerSegmentDestination = 'drop' | 'append-to-description' | 'create-field' | 'skip';

export interface UserDecisions {
  slackContextHandling: SlackContextHandling;
  epicDisplayMode: EpicDisplayMode;
  customerSegmentDestination: CustomerSegmentDestination;
}

export const DEFAULT_DECISIONS: UserDecisions = {
  slackContextHandling: 'keep-url',
  epicDisplayMode: 'summary',
  customerSegmentDestination: 'drop',
};

/**
 * Each decision option carries a label, a one-line description, and a
 * `recommended` flag that surfaces the grammar's preferred resolution in
 * the UI. Skip is always available — it defers the loss to a later pass.
 */
export const DECISION_CATALOG = {
  slackContextHandling: {
    title: 'Slack context loss',
    body: 'Some Jira descriptions embed a Slack thread URL where the substantive spec lives. The URL travels by default, but the thread itself is unreachable from the destination.',
    options: [
      {
        value: 'keep-url' as const,
        label: 'Keep URL only',
        description:
          'Default. The link travels with the description text. Readers in the destination see a URL but cannot fetch the thread.',
        recommended: true,
      },
      {
        value: 'fetch-thread' as const,
        label: 'Fetch thread snapshot',
        description:
          'On commit, fetch the linked Slack thread once and embed a timestamped snapshot in the description. Snapshot is point-in-time; later edits in Slack are not reflected.',
        recommended: false,
      },
      {
        value: 'drop' as const,
        label: 'Drop URL',
        description:
          'Strip the URL from the destination description entirely. Surfaces a context loss in the manifest with no destination representation.',
        recommended: false,
      },
      {
        value: 'skip' as const,
        label: 'Skip — don\'t map',
        description:
          'Don\'t map the Slack URL to the destination at all. The URL is stripped from the destination description and the loss is recorded in the manifest as intentionally not mapped.',
        recommended: false,
      },
    ],
  },
  epicDisplayMode: {
    title: 'Parent epic representation',
    body: 'Jira parent links to an Epic issue. The destination Epic field is free-form text — there is no link semantic to preserve. Choose what text the destination row should carry.',
    options: [
      {
        value: 'summary' as const,
        label: 'Epic summary',
        description:
          'Default. The destination Epic field holds the epic\'s summary text (e.g. "Pet feeder hardware integration").',
        recommended: true,
      },
      {
        value: 'key' as const,
        label: 'Epic key',
        description:
          'The destination Epic field holds the source key (e.g. "SCRUM-2"). Preserves source-side identity at the cost of human readability.',
        recommended: false,
      },
      {
        value: 'both' as const,
        label: 'Both — "SCRUM-2 — Pet feeder hardware integration"',
        description:
          'Combine key and summary. Maximizes information density at the cost of field length.',
        recommended: false,
      },
      {
        value: 'skip' as const,
        label: 'Skip — don\'t map',
        description:
          'Don\'t map the parent epic to the destination at all. The Epic field on the destination row is left empty and the loss is recorded as intentionally not mapped.',
        recommended: false,
      },
    ],
  },
  customerSegmentDestination: {
    title: 'Customer Segment custom field',
    body: 'The source has a project-specific "Customer Segment" custom field with no destination equivalent. Choose how to handle it.',
    options: [
      {
        value: 'drop' as const,
        label: 'Drop',
        description:
          'Default. The field is excluded from the destination write. Surfaced in the manifest as schema loss so the absence is recorded.',
        recommended: true,
      },
      {
        value: 'append-to-description' as const,
        label: 'Append to description',
        description:
          'Add a "Customer Segment: <value>" line at the end of the destination Description. Preserves the data at the cost of field tidiness.',
        recommended: false,
      },
      {
        value: 'create-field' as const,
        label: 'Create field in destination',
        description:
          'On commit, create a new "Customer Segment" single-select in the destination table and write the value. Resolves the schema loss permanently.',
        recommended: false,
      },
      {
        value: 'skip' as const,
        label: 'Skip — don\'t map',
        description:
          'Don\'t map this field to the destination schema. No destination representation, no append, no field creation. The loss is recorded as intentionally not mapped.',
        recommended: false,
      },
    ],
  },
} as const;

// --- Application -----------------------------------------------------------

export interface EnhancedResult extends TranslationResult {
  /** The decisions that were applied to produce this result. */
  appliedDecisions: UserDecisions;
  /** Decision keys the user explicitly chose not to map to the destination.
   *  Recorded in the manifest as intentional non-mappings (distinct from
   *  grammar-default drops, which are a chosen resolution). */
  skipped: string[];
}

/**
 * Apply user decisions to a baseline translation. Returns a new result with
 * possibly-modified airtableFields and updated losses (resolutions changed,
 * destinations updated, sometimes a loss removed entirely). When a decision
 * is 'skip', the field is intentionally not mapped to the destination — the
 * destination value is cleared and the decision key is recorded in `skipped`
 * so the manifest can distinguish intentional non-mapping from grammar-
 * default drops.
 */
export function applyDecisions(
  baseline: TranslationResult,
  decisions: UserDecisions,
): EnhancedResult {
  const fields = { ...baseline.airtableFields };
  const losses: LossEntry[] = baseline.losses.map((l) => ({ ...l }));
  const skipped: string[] = [];

  // 1. Slack context handling --------------------------------------------
  const slackIdx = losses.findIndex(
    (l) => l.kind === 'context' && /slack/i.test(l.field),
  );
  if (slackIdx >= 0) {
    const slack = losses[slackIdx];
    const desc = (fields['Description'] as string) ?? '';
    switch (decisions.slackContextHandling) {
      case 'keep-url': {
        slack.resolution = 'annotated';
        slack.destination = 'URL retained in Description text';
        break;
      }
      case 'fetch-thread': {
        slack.resolution = 'annotated';
        slack.destination =
          'URL + fetched thread snapshot appended to Description (on commit)';
        fields['Description'] =
          desc + '\n\n[On commit: Slack thread snapshot will be fetched and appended here.]';
        break;
      }
      case 'drop': {
        slack.resolution = 'dropped';
        slack.destination = '(URL stripped from destination Description)';
        fields['Description'] = desc.replace(
          /https:\/\/[a-z0-9-]+\.slack\.com\/[^\s)\]]+/gi,
          '',
        ).replace(/\s+/g, ' ').trim();
        break;
      }
      case 'skip': {
        // Intentionally not mapped: URL stripped, loss recorded as such.
        slack.resolution = 'dropped';
        slack.destination = '(intentionally not mapped)';
        fields['Description'] = desc.replace(
          /https:\/\/[a-z0-9-]+\.slack\.com\/[^\s)\]]+/gi,
          '',
        ).replace(/\s+/g, ' ').trim();
        skipped.push('slackContextHandling');
        break;
      }
    }
  }

  // 2. Parent epic representation ----------------------------------------
  const epicIdx = losses.findIndex((l) => l.field === 'parent→Epic');
  if (epicIdx >= 0) {
    const epicLoss = losses[epicIdx];
    const src = epicLoss.source as { key: string; summary: string };
    if (decisions.epicDisplayMode === 'skip') {
      // Intentionally not mapped: Epic field cleared, loss recorded.
      epicLoss.resolution = 'dropped';
      epicLoss.destination = '(intentionally not mapped)';
      delete fields['Epic'];
      skipped.push('epicDisplayMode');
    } else {
      let destValue: string;
      switch (decisions.epicDisplayMode) {
        case 'summary': destValue = src.summary; break;
        case 'key': destValue = src.key; break;
        case 'both': destValue = `${src.key} — ${src.summary}`; break;
      }
      fields['Epic'] = destValue;
      epicLoss.destination = destValue;
    }
  }

  // 3. Customer Segment handling -----------------------------------------
  const csIdx = losses.findIndex((l) => /customer segment/i.test(l.field));
  if (csIdx >= 0) {
    const cs = losses[csIdx];
    const sourceValue =
      (cs.source as any)?.value ?? String(cs.source ?? '');
    const desc = (fields['Description'] as string) ?? '';
    switch (decisions.customerSegmentDestination) {
      case 'drop': {
        cs.resolution = 'dropped';
        cs.destination = null;
        break;
      }
      case 'append-to-description': {
        cs.resolution = 'lossy';
        cs.destination = `Appended to Description: "Customer Segment: ${sourceValue}"`;
        fields['Description'] =
          (desc ? desc + '\n\n' : '') + `Customer Segment: ${sourceValue}`;
        break;
      }
      case 'create-field': {
        cs.kind = 'semantic';
        cs.resolution = 'lossless';
        cs.destination = `New destination field "Customer Segment" = ${sourceValue}`;
        fields['Customer Segment'] = sourceValue;
        break;
      }
      case 'skip': {
        // Intentionally not mapped. Distinct from Drop: drop is a chosen
        // resolution recorded as such; skip is an explicit refusal to engage
        // with this loss for this pass.
        cs.resolution = 'dropped';
        cs.destination = '(intentionally not mapped)';
        skipped.push('customerSegmentDestination');
        break;
      }
    }
  }

  return {
    ...baseline,
    airtableFields: fields,
    losses,
    appliedDecisions: decisions,
    skipped,
  };
}
