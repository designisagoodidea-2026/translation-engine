// First-pass translation orchestrator. Reads all issues in the configured
// Jira project, runs them through the project-management grammar, writes
// destination records to Airtable, and emits a manifest pair (markdown +
// JSON sidecar) into manifests/.
//
// Epics are used as grammar context (epic key → summary lookup) but are
// not themselves written as Roadmap records.
//
// Usage:
//   npm run translate              # write Airtable records + manifest
//   npm run translate -- --dry-run # manifest only, no Airtable writes
//
// Idempotency: this script always creates new Airtable records. Re-running
// will create duplicates. Wipe the destination table or implement an
// upsert path (future slice) before re-running against a non-empty table.

import * as path from 'node:path';

import { config } from '../lib/config.js';
import { jiraFetch, listIssues, type JiraIssue } from '../adapters/jira.js';
import { createRecord, listRecords } from '../adapters/airtable.js';
import { translateIssue } from '../grammars/project-management.js';
import type { GrammarContext, TranslationResult } from '../grammars/types.js';
import { buildManifest, writeManifest } from '../manifest.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const projectKey = config.jira.projectKey;
  const tableId = config.airtable.tableId;

  console.log(`[translate] reading issues from Jira project ${projectKey}…`);
  const result = await listIssues(projectKey, { fields: ['*all'], maxResults: 100 });
  const issues: JiraIssue[] = result.issues ?? [];
  console.log(`[translate] fetched ${issues.length} issue(s)`);

  // Build grammar context: epic key → summary, plus customfield_* → display
  // name so the schema-loss surface can name fields humanly and filter Jira's
  // system custom fields.
  const epicSummaryByKey = new Map<string, string>();
  for (const issue of issues) {
    if (issue.fields?.issuetype?.name === 'Epic') {
      epicSummaryByKey.set(issue.key, issue.fields?.summary ?? issue.key);
    }
  }

  console.log(`[translate] resolving custom field display names…`);
  const allFields = await jiraFetch<Array<{ id: string; name: string }>>('/rest/api/3/field');
  const customFieldNames = new Map<string, string>();
  for (const fld of allFields) {
    if (fld.id.startsWith('customfield_')) customFieldNames.set(fld.id, fld.name);
  }

  const ctx: GrammarContext = { epicSummaryByKey, customFieldNames };

  // Epics inform context but don't become Roadmap rows.
  const translatable = issues.filter((i) => i.fields?.issuetype?.name !== 'Epic');
  console.log(
    `[translate] ${epicSummaryByKey.size} epic(s) used as context, ${translatable.length} non-Epic issue(s) to translate`,
  );

  // Friendly pre-flight warning if the destination already has rows —
  // this script creates new records, so re-running causes duplicates.
  if (!DRY_RUN) {
    const existing = await listRecords(tableId, { maxRecords: 1 });
    if ((existing.records ?? []).length > 0) {
      console.warn(
        `[translate] warning: destination table is not empty. New records will be appended (possible duplicates).`,
      );
    }
  }

  // Run grammar per issue, optionally write to Airtable.
  console.log(`[translate] running grammar…`);
  const enriched: Array<TranslationResult & { airtableRecordId: string | null }> = [];

  for (const issue of translatable) {
    const tr = translateIssue(issue, ctx);
    let recordId: string | null = null;

    if (!DRY_RUN) {
      try {
        const record = await createRecord(tableId, tr.airtableFields, { typecast: true });
        recordId = record.id;
      } catch (e) {
        console.warn(
          `  ! ${issue.key} Airtable write failed: ${truncate((e as Error).message, 200)}`,
        );
      }
    }

    const lossCount = tr.losses.length;
    const tag = DRY_RUN ? '(dry run)' : recordId ?? '(write failed)';
    console.log(`  ${issue.key.padEnd(10)} ${String(lossCount).padStart(2)} loss(es) → ${tag}`);
    enriched.push({ ...tr, airtableRecordId: recordId });
  }

  // Build + write manifest.
  const pass = {
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: 'Jira Cloud',
    destination: 'Airtable',
    context: 'project-management',
    projectKey,
    dryRun: DRY_RUN,
  };
  const manifest = buildManifest(pass, enriched);
  const manifestsDir = path.resolve('manifests');
  const { markdownPath, jsonPath } = await writeManifest(manifest, manifestsDir);

  console.log(`\n[translate] manifest written:`);
  console.log(`  ${path.relative(process.cwd(), markdownPath)}`);
  console.log(`  ${path.relative(process.cwd(), jsonPath)}`);

  console.log(`\n[translate] summary:`);
  console.log(`  ${manifest.counts.issues} issue(s) translated`);
  console.log(`  ${manifest.counts.total} total loss(es)`);
  for (const [kind, n] of Object.entries(manifest.counts.lossesByKind)) {
    console.log(`    ${kind.padEnd(10)} ${n}`);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

main().catch((e) => {
  console.error('[translate] failed:', e);
  process.exit(1);
});
