// Jira smoke test — confirms auth works against the configured site/project.
// Usage: npm run smoke:jira

import { config } from '../lib/config.js';
import { listIssues } from '../adapters/jira.js';

const projectKey = config.jira.projectKey;

const result = await listIssues(projectKey, {
  fields: ['summary', 'status', 'priority', 'issuetype'],
  maxResults: 5,
});

const issues = result.issues ?? [];
if (issues.length === 0) {
  console.log(
    `[jira] auth OK. Project ${projectKey} has 0 issues — run \`npm run seed:jira\` next.`,
  );
} else {
  console.log(`[jira] auth OK. First ${issues.length} issue(s) in ${projectKey}:`);
  for (const issue of issues) {
    const summary = issue.fields?.summary ?? '(no summary)';
    const status = issue.fields?.status?.name ?? '?';
    const priority = issue.fields?.priority?.name ?? '?';
    const type = issue.fields?.issuetype?.name ?? '?';
    console.log(`  ${issue.key.padEnd(10)} ${type.padEnd(8)} ${priority.padEnd(8)} ${status.padEnd(12)} ${summary}`);
  }
}
