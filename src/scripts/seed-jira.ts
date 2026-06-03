// Seed the Jira SCRUM project with synthetic data for the Slice 1 demo.
// Theme: a throwaway pet-feeder app — deliberately not resembling real work.
//
// Creates: 3 epics, 12 child tasks across varied priorities + statuses,
// one fix version, a sprint (best-effort), and one description with a
// fake Slack URL (the context-loss demo hook).
//
// Custom field ("Customer Segment") is intentionally not API-created on
// Jira Free; the script prints a one-time manual setup note.
//
// Usage: npm run seed:jira
//        npm run seed:jira -- --force      # seed even if project already has issues

import { config } from '../lib/config.js';
import { jiraFetch, adf, listIssues, getProjectId } from '../adapters/jira.js';
import { transitionToCanonical } from '../lib/jira-transitions.js';

const PROJECT_KEY = config.jira.projectKey;
const FORCE = process.argv.includes('--force');

const EPICS = [
  {
    summary: 'Pet feeder hardware integration',
    description: 'Bluetooth pairing, feed-schedule sync, battery telemetry.',
  },
  {
    summary: 'Mobile app — feed scheduling UX',
    description: 'Schedule editor, push notifications, household sharing.',
  },
  {
    summary: 'Cloud telemetry + alerts',
    description: 'Ingest feed events, surface anomalies, alert owners on missed feeds.',
  },
];

type Priority = 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
type Status = 'To Do' | 'In Progress' | 'Done';

interface IssueSeed {
  summary: string;
  description?: string;
  priority: Priority;
  status: Status;
  labels: string[];
  epicIdx: number;
  sprint?: boolean;
  fixVersion?: boolean;
}

const ISSUES: IssueSeed[] = [
  // Epic 0 — hardware
  {
    summary: 'Bluetooth pairing flow',
    description:
      'Spec lives in this Slack thread: https://acme.slack.com/archives/C0HARDWARE/p1700000000001 — pairing should auto-reconnect on app foreground.',
    priority: 'High',
    status: 'In Progress',
    labels: ['hardware'],
    epicIdx: 0,
    sprint: true,
    fixVersion: true,
  },
  {
    summary: 'Battery telemetry endpoint',
    priority: 'Medium',
    status: 'In Progress',
    labels: ['hardware', 'telemetry'],
    epicIdx: 0,
    sprint: true,
    fixVersion: true,
  },
  {
    summary: 'Feed-schedule sync protocol',
    priority: 'Highest',
    status: 'To Do',
    labels: ['hardware', 'protocol'],
    epicIdx: 0,
    fixVersion: true,
  },
  // Epic 1 — mobile
  {
    summary: 'Schedule editor screen',
    priority: 'High',
    status: 'In Progress',
    labels: ['mobile', 'ux'],
    epicIdx: 1,
    sprint: true,
  },
  {
    summary: 'Push notification scaffolding',
    priority: 'Medium',
    status: 'Done',
    labels: ['mobile'],
    epicIdx: 1,
    sprint: true,
  },
  {
    summary: 'Household sharing invite flow',
    priority: 'Low',
    status: 'To Do',
    labels: ['mobile'],
    epicIdx: 1,
  },
  {
    summary: 'Onboarding empty-state polish',
    priority: 'Lowest',
    status: 'To Do',
    labels: ['mobile', 'polish'],
    epicIdx: 1,
  },
  // Epic 2 — cloud
  {
    summary: 'Feed event ingest worker',
    priority: 'High',
    status: 'Done',
    labels: ['cloud', 'telemetry'],
    epicIdx: 2,
    sprint: true,
    fixVersion: true,
  },
  {
    summary: 'Missed-feed anomaly detector',
    priority: 'Medium',
    status: 'In Progress',
    labels: ['cloud', 'telemetry'],
    epicIdx: 2,
    sprint: true,
  },
  {
    summary: 'Owner alert email template',
    priority: 'Low',
    status: 'Done',
    labels: ['cloud', 'comms'],
    epicIdx: 2,
  },
  {
    summary: 'Anomaly dashboard prototype',
    priority: 'Medium',
    status: 'To Do',
    labels: ['cloud', 'dashboard'],
    epicIdx: 2,
  },
  {
    summary: 'Daily digest cron',
    priority: 'Low',
    status: 'To Do',
    labels: ['cloud'],
    epicIdx: 2,
  },
];

const FIX_VERSION_NAME = 'v0.1';
const SPRINT_NAME = 'Sprint 1 — Demo';
const DEFAULT_ISSUE_TYPE = 'Task';

async function main() {
  console.log(`[seed] project: ${PROJECT_KEY}`);

  // 1. Pre-flight — bail if project already has issues unless --force
  const existing = await listIssues(PROJECT_KEY, {
    fields: ['summary'],
    maxResults: 1,
  });
  if ((existing.issues?.length ?? 0) > 0 && !FORCE) {
    console.error(
      `[seed] Project ${PROJECT_KEY} already has issues. ` +
        `Re-run with \`--force\` to seed anyway (will create duplicates).`,
    );
    process.exit(1);
  }

  // 2. Epics
  console.log(`[seed] creating ${EPICS.length} epics…`);
  const epicKeys: string[] = [];
  for (const epic of EPICS) {
    const created = await createIssueResilient({
      project: { key: PROJECT_KEY },
      summary: epic.summary,
      issuetype: { name: 'Epic' },
      ...(epic.description ? { description: adf(epic.description) } : {}),
    });
    console.log(`  + ${created.key}  ${epic.summary}`);
    epicKeys.push(created.key);
  }

  // 3. Fix version
  let fixVersionAvailable = false;
  console.log(`[seed] creating fix version "${FIX_VERSION_NAME}"…`);
  try {
    const projectId = await getProjectId(PROJECT_KEY);
    await jiraFetch(`/rest/api/3/version`, {
      method: 'POST',
      body: JSON.stringify({ name: FIX_VERSION_NAME, projectId }),
    });
    fixVersionAvailable = true;
    console.log(`  + ${FIX_VERSION_NAME}`);
  } catch (e) {
    console.warn(`  ! could not create fix version: ${truncate((e as Error).message)}`);
    console.warn(
      `    fallback: Project Settings → Releases → create "${FIX_VERSION_NAME}" by hand.`,
    );
  }

  // 4. Issues
  console.log(`[seed] creating ${ISSUES.length} issues…`);
  const created: { key: string; spec: IssueSeed }[] = [];
  for (const spec of ISSUES) {
    const fields: Record<string, any> = {
      project: { key: PROJECT_KEY },
      summary: spec.summary,
      issuetype: { name: DEFAULT_ISSUE_TYPE },
      priority: { name: spec.priority },
      labels: spec.labels,
      parent: { key: epicKeys[spec.epicIdx] },
    };
    if (spec.description) fields.description = adf(spec.description);
    if (spec.fixVersion && fixVersionAvailable) {
      fields.fixVersions = [{ name: FIX_VERSION_NAME }];
    }

    const issue = await createIssueResilient(fields);
    console.log(
      `  + ${issue.key.padEnd(10)} ${spec.priority.padEnd(8)} ${spec.status.padEnd(12)} ${spec.summary}`,
    );
    created.push({ key: issue.key, spec });
  }

  // 5. Status transitions (deterministic fuzzy match via lib/jira-transitions)
  console.log(`[seed] transitioning statuses…`);
  for (const { key, spec } of created) {
    if (spec.status === 'To Do') continue;
    const result = await transitionToCanonical(key, spec.status);
    if (result.ok) {
      console.log(`  ${key} → ${result.to}`);
    } else {
      console.warn(
        `  ! ${key} no transition matching "${spec.status}". Available: ${result.available.join(', ')}`,
      );
    }
  }

  // 6. Sprint (best-effort — Agile API needs a Scrum board on the project)
  console.log(`[seed] creating sprint (best-effort)…`);
  try {
    const boards = await jiraFetch<{ values: { id: number; name: string; type: string }[] }>(
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(PROJECT_KEY)}`,
    );
    const board = boards.values?.find((b) => b.type === 'scrum') ?? boards.values?.[0];
    if (!board) throw new Error('no board found for project');

    const sprint = await jiraFetch<{ id: number; name: string }>(`/rest/agile/1.0/sprint`, {
      method: 'POST',
      body: JSON.stringify({ name: SPRINT_NAME, originBoardId: board.id }),
    });
    console.log(`  + sprint #${sprint.id} "${sprint.name}" on board "${board.name}"`);

    const sprintIssues = created.filter((c) => c.spec.sprint).map((c) => c.key);
    if (sprintIssues.length > 0) {
      await jiraFetch(`/rest/agile/1.0/sprint/${sprint.id}/issue`, {
        method: 'POST',
        body: JSON.stringify({ issues: sprintIssues }),
      });
      console.log(`    attached ${sprintIssues.length} issue(s) to sprint`);
    }
  } catch (e) {
    console.warn(`  ! could not create/populate sprint: ${truncate((e as Error).message)}`);
    console.warn(
      `    fallback: Backlog view in Jira UI → create "${SPRINT_NAME}" and drag in the issues marked sprint:true.`,
    );
  }

  // 7. Custom field — manual note
  console.log(`[seed] custom field "Customer Segment":`);
  console.log(`  ! Jira Free + team-managed projects don't expose custom-field creation via API.`);
  console.log(`    Add it manually:`);
  console.log(`      Project Settings → Issue types → Task → "+ Add field" → Custom → Dropdown (single select)`);
  console.log(`      Name: "Customer Segment"`);
  console.log(`      Options: Enterprise, Mid-market, SMB`);
  console.log(`      Then set it on 3–4 issues. The grammar pass will surface it as schema loss.`);

  console.log(`\n[seed] done. Run \`npm run smoke:jira\` to verify.`);
}

/**
 * Issue creation that tolerates field-config differences across Jira project
 * styles. If a single optional field (priority / fixVersions / parent) is
 * rejected by the project's screens, log and retry without it once.
 */
async function createIssueResilient(
  fields: Record<string, any>,
): Promise<{ key: string }> {
  const candidates = ['priority', 'fixVersions', 'parent'];
  try {
    return await jiraFetch<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  } catch (e) {
    const msg = (e as Error).message.toLowerCase();
    const offender = candidates.find((f) => msg.includes(f.toLowerCase()));
    if (!offender || !(offender in fields)) throw e;
    const { [offender]: _dropped, ...rest } = fields;
    console.warn(`  ! dropped "${offender}" field on retry (project rejected it)`);
    return await jiraFetch<{ key: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields: rest }),
    });
  }
}

function truncate(s: string, n = 180): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

main().catch((e) => {
  console.error(`[seed] failed:`, e);
  process.exit(1);
});
