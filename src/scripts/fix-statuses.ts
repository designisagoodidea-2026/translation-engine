// One-off catch-up: applies intended status diversity to the seeded issues
// even when the project's workflow uses non-canonical status names
// (e.g. Backlog / Up Next / Active / Blocked / Complete).
//
// Usage: npm run fix:statuses

import { config } from '../lib/config.js';
import { listIssues } from '../adapters/jira.js';
import { statusMatches, type CanonicalStatus } from '../lib/status-match.js';
import { transitionToCanonical } from '../lib/jira-transitions.js';

// Summary → intended canonical status. Mirrors the seed script.
const INTENDED: Record<string, CanonicalStatus> = {
  'Bluetooth pairing flow': 'In Progress',
  'Battery telemetry endpoint': 'In Progress',
  'Schedule editor screen': 'In Progress',
  'Push notification scaffolding': 'Done',
  'Feed event ingest worker': 'Done',
  'Missed-feed anomaly detector': 'In Progress',
  'Owner alert email template': 'Done',
};

const projectKey = config.jira.projectKey;
const all = await listIssues(projectKey, {
  fields: ['summary', 'status'],
  maxResults: 100,
});

console.log(`[fix-statuses] inspecting ${all.issues?.length ?? 0} issue(s)…`);

let moved = 0;
let alreadyOk = 0;
let skipped = 0;

for (const issue of all.issues ?? []) {
  const summary: string | undefined = issue.fields?.summary;
  if (!summary) continue;

  const intended = INTENDED[summary];
  if (!intended) {
    skipped++;
    continue;
  }

  const currentStatus = issue.fields?.status?.name ?? '';
  if (statusMatches(currentStatus, intended)) {
    console.log(`  ${issue.key.padEnd(10)} already ${currentStatus} (~${intended})`);
    alreadyOk++;
    continue;
  }

  const result = await transitionToCanonical(issue.key, intended);
  if (!result.ok) {
    console.warn(
      `  ! ${issue.key} no transition for "${intended}". Available: ${result.available.join(', ')}`,
    );
    continue;
  }
  console.log(`  ${issue.key.padEnd(10)} ${currentStatus} → ${result.to}`);
  moved++;
}

console.log(`[fix-statuses] moved ${moved}, already-OK ${alreadyOk}, skipped (not seeded) ${skipped}.`);
