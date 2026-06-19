// Offline reverse-pass runner. Reads a self-contained bidirectional
// fixture (snapshot + current Jira state + current Airtable state),
// applies the PM grammar's `reverseTranslateIssue` to each pair, and
// emits a reverse-pass manifest naming patches, skipped fields, and
// conflicts.
//
// Mirrors the architecture of `translate-from-fixture.ts` for the forward
// direction: the live Airtable → Jira write path is deferred to Phase C
// OAuth work; this script proves the library behavior end-to-end against
// synthetic data.
//
// Usage:
//   tsx src/scripts/translate-reverse-from-fixture.ts \
//     --fixture demo/fixtures/scrum-bidirectional.json [--project SCRUM]

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { normalizeJiraIssue } from '../adapters/jira-normalize.js';
import { reverseTranslateIssue } from '../grammars/project-management.js';
import type { JiraIssue } from '../adapters/jira.js';
import type { PairSnapshot, SnapshotRecord } from '../snapshot.js';
import {
  buildReverseManifest,
  writeManifest,
  type ReverseManifestEntry,
} from '../manifest.js';

interface BidirectionalFixture {
  snapshot: PairSnapshot;
  currentJira: { issues: JiraIssue[] };
  currentAirtable: { records: Array<{ id: string; fields: Record<string, unknown> }> };
  fields?: Array<{ id: string; name: string }>;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fixturePath = argValue('--fixture');
  const projectKey = argValue('--project') ?? 'SCRUM';

  if (!fixturePath) {
    console.error('usage: --fixture <path> [--project KEY]');
    process.exit(2);
  }

  const raw = await fs.readFile(fixturePath, 'utf8');
  const fixture = JSON.parse(raw) as BidirectionalFixture;

  // Custom-field display names (for the normalizer); usually empty for the
  // reverse demo.
  const customFieldNames = new Map<string, string>();
  for (const fld of fixture.fields ?? []) {
    if (fld.id.startsWith('customfield_')) customFieldNames.set(fld.id, fld.name);
  }

  // Build lookups by sourceKey / destRecordId.
  const snapshotBySourceKey = new Map<string, SnapshotRecord>();
  for (const r of fixture.snapshot.records) {
    snapshotBySourceKey.set(r.sourceKey, r);
  }

  const jiraBySourceKey = new Map<string, JiraIssue>();
  for (const issue of fixture.currentJira.issues) {
    jiraBySourceKey.set(issue.key, issue);
  }

  const airtableByDestId = new Map<string, Record<string, unknown>>();
  for (const rec of fixture.currentAirtable.records) {
    airtableByDestId.set(rec.id, rec.fields);
  }

  // Drive the reverse pass off the snapshot — each prior pass record is
  // one candidate for round-trip.
  const entries: ReverseManifestEntry[] = [];
  for (const snap of fixture.snapshot.records) {
    const jira = jiraBySourceKey.get(snap.sourceKey);
    const destFields = airtableByDestId.get(snap.destRecordId);
    if (!jira || !destFields) {
      console.warn(
        `  ! ${snap.sourceKey} skipped: missing ${!jira ? 'Jira state' : 'Airtable record'}`,
      );
      continue;
    }
    const normalized = normalizeJiraIssue(jira, { customFieldNames });
    const r = reverseTranslateIssue(destFields, normalized, snap);

    const tag =
      r.conflicts.length > 0
        ? `${r.conflicts.length} conflict(s)`
        : Object.keys(r.sourcePatch).length > 0
          ? `patch: ${r.applied.join(', ')}`
          : 'no-op';
    console.log(`  ${snap.sourceKey.padEnd(10)} ${tag}`);

    entries.push({ sourceKey: snap.sourceKey, ...r });
  }

  const pass = {
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: 'Jira Cloud',
    destination: 'Airtable',
    context: 'project-management',
    projectKey,
    dryRun: true,
    direction: 'reverse' as const,
  };
  const manifest = buildReverseManifest(
    pass,
    entries,
    fixture.snapshot.records.map((r) => ({
      sourceKey: r.sourceKey,
      destRecordId: r.destRecordId,
    })),
  );
  const manifestsDir = path.resolve('manifests');
  const { markdownPath, jsonPath } = await writeManifest(manifest, manifestsDir);

  console.log(`\n[translate-reverse-from-fixture] manifest written:`);
  console.log(`  ${path.relative(process.cwd(), markdownPath)}`);
  console.log(`  ${path.relative(process.cwd(), jsonPath)}`);

  console.log(`\n[translate-reverse-from-fixture] summary:`);
  console.log(`  ${manifest.counts.issues} record(s) compared`);
  console.log(`  ${manifest.counts.patchedRecords ?? 0} record(s) would receive a patch`);
  console.log(`  ${manifest.counts.conflicts ?? 0} conflict(s)`);
}

main().catch((e) => {
  console.error('[translate-reverse-from-fixture] failed:', e);
  process.exit(1);
});
