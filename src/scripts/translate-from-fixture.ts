// Offline translate: read pre-fetched (or synthetic) source records from
// disk, normalize them via the platform-specific normalizer, run the
// chosen grammar, and emit a manifest. Mirrors the live `translate.ts`
// path but takes its inputs from local files instead of HTTP, so any
// (source × grammar) combination can be exercised without network access.
//
// Usage:
//   tsx src/scripts/translate-from-fixture.ts \
//     --fixture demo/fixtures/dsops-jira-issues.json \
//     --source jira [--grammar pm|dsops] [--project SCRUM]
//
//   tsx src/scripts/translate-from-fixture.ts \
//     --fixture demo/fixtures/asana-pm-tasks.json \
//     --source asana --grammar pm --project FEEDER
//
//   tsx src/scripts/translate-from-fixture.ts \
//     --issues path/to/issues.json --fields path/to/fields.json \
//     --source jira [--grammar pm|dsops]
//
// Always emits a dry-run manifest — no destination writes.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as grammarPM from '../grammars/project-management.js';
import * as grammarDSOps from '../grammars/design-system-ops.js';
import type {
  GrammarContext,
  NormalizedIssue,
  TranslationResult,
} from '../grammars/types.js';
import type { JiraIssue } from '../adapters/jira.js';
import { normalizeJiraIssue } from '../adapters/jira-normalize.js';
import type { AsanaTask } from '../adapters/asana.js';
import { normalizeAsanaTask } from '../adapters/asana-normalize.js';
import { buildManifest, writeManifest } from '../manifest.js';

interface GrammarRegistryEntry {
  /** Identifier used in `--grammar` and in the manifest's `context` field. */
  context: string;
  /** Display label for the destination column in the manifest. */
  destinationLabel: string;
  translateIssue: (issue: NormalizedIssue, ctx: GrammarContext) => TranslationResult;
}

const GRAMMARS: Record<string, GrammarRegistryEntry> = {
  pm: {
    context: 'project-management',
    destinationLabel: 'Airtable',
    translateIssue: grammarPM.translateIssue,
  },
  dsops: {
    context: 'design-system-ops',
    destinationLabel: 'Airtable (Component Inventory)',
    translateIssue: grammarDSOps.translateIssue,
  },
};

type SourcePlatform = 'jira' | 'asana';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, 'utf8')) as T;
}

interface FixturePayload {
  issues?: JiraIssue[];
  tasks?: AsanaTask[];
  fields?: Array<{ id: string; name: string }>;
}

async function main() {
  const fixturePath = argValue('--fixture');
  const issuesPath = argValue('--issues');
  const fieldsPath = argValue('--fields');
  const projectKey = argValue('--project') ?? 'SCRUM';
  const grammarKey = (argValue('--grammar') ?? 'pm').toLowerCase();
  const sourceKey = (argValue('--source') ?? 'jira').toLowerCase() as SourcePlatform;

  const grammar = GRAMMARS[grammarKey];
  if (!grammar) {
    console.error(
      `unknown grammar "${grammarKey}". registered: ${Object.keys(GRAMMARS).join(', ')}`,
    );
    process.exit(2);
  }

  if (sourceKey !== 'jira' && sourceKey !== 'asana') {
    console.error(`unknown source "${sourceKey}". supported: jira, asana`);
    process.exit(2);
  }

  // Load fixture or split files.
  let payload: FixturePayload = {};
  if (fixturePath) {
    payload = await readJson<FixturePayload>(fixturePath);
  } else if (issuesPath) {
    const issuesResp = await readJson<{ issues: JiraIssue[] }>(issuesPath);
    payload.issues = issuesResp.issues ?? [];
    if (fieldsPath) {
      payload.fields = await readJson<Array<{ id: string; name: string }>>(fieldsPath);
    }
  } else {
    console.error(
      'usage: --fixture <path>  OR  --issues <path> [--fields <path>]  [--source jira|asana] [--grammar pm|dsops] [--project KEY]',
    );
    process.exit(2);
  }

  const customFieldNames = new Map<string, string>();
  for (const fld of payload.fields ?? []) {
    if (fld.id.startsWith('customfield_')) customFieldNames.set(fld.id, fld.name);
  }

  // Normalize.
  const normalized: NormalizedIssue[] = [];
  const sourceLabel = sourceKey === 'asana' ? 'Asana' : 'Jira Cloud';
  if (sourceKey === 'jira') {
    for (const issue of payload.issues ?? []) {
      normalized.push(normalizeJiraIssue(issue, { customFieldNames }));
    }
  } else {
    for (const task of payload.tasks ?? []) {
      normalized.push(normalizeAsanaTask(task));
    }
  }

  // Build parentSummaryByKey from normalized issues (any record that
  // appears as another record's parent — and as its own row — provides
  // its summary here). Also exclude parents from the translatable set.
  const referencedParentKeys = new Set<string>();
  for (const n of normalized) {
    if (n.parent) referencedParentKeys.add(n.parent.sourceKey);
  }
  const parentSummaryByKey = new Map<string, string>();
  for (const n of normalized) {
    if (referencedParentKeys.has(n.sourceKey)) {
      parentSummaryByKey.set(n.sourceKey, n.summary);
    }
  }
  // Per-grammar policy: PM treats Epics as parents; DSOps treats Patterns
  // as parents. Either way, parents themselves don't become destination rows.
  const parentTypeRe = grammar.context === 'project-management' ? /^epic$/i : /^(pattern|epic)$/i;
  const translatable = normalized.filter(
    (n) => !(n.issueType && parentTypeRe.test(n.issueType) && referencedParentKeys.has(n.sourceKey)),
  );

  const ctx: GrammarContext = { parentSummaryByKey };

  console.log(
    `[translate-from-fixture] source=${sourceLabel}  grammar=${grammar.context}  parents=${parentSummaryByKey.size}  issues=${translatable.length}`,
  );

  const enriched: Array<TranslationResult & { airtableRecordId: string | null }> = [];
  for (const n of translatable) {
    const tr = grammar.translateIssue(n, ctx);
    console.log(`  ${n.sourceKey.padEnd(10)} ${String(tr.losses.length).padStart(2)} loss(es)`);
    enriched.push({ ...tr, airtableRecordId: null });
  }

  const pass = {
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: sourceLabel,
    destination: grammar.destinationLabel,
    context: grammar.context,
    projectKey,
    dryRun: true,
  };
  const manifest = buildManifest(pass, enriched);
  const manifestsDir = path.resolve('manifests');
  const { markdownPath, jsonPath } = await writeManifest(manifest, manifestsDir);

  console.log(`\n[translate-from-fixture] manifest written:`);
  console.log(`  ${path.relative(process.cwd(), markdownPath)}`);
  console.log(`  ${path.relative(process.cwd(), jsonPath)}`);

  console.log(`\n[translate-from-fixture] summary:`);
  console.log(`  ${manifest.counts.issues} issue(s) translated`);
  console.log(`  ${manifest.counts.total} total loss(es)`);
  for (const [kind, n] of Object.entries(manifest.counts.lossesByKind)) {
    console.log(`    ${kind.padEnd(10)} ${n}`);
  }
}

main().catch((e) => {
  console.error('[translate-from-fixture] failed:', e);
  process.exit(1);
});
