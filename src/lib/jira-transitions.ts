// Shared "look up the available transitions for an issue, pick a fuzzy match
// against a canonical target, apply it" helper. Used by both the seed pass
// and the fix-statuses catch-up so the logic lives in exactly one place.

import { jiraFetch } from '../adapters/jira.js';
import { pickTransition, type CanonicalStatus, type JiraTransition } from './status-match.js';

export type TransitionResult =
  | { ok: true; to: string }
  | { ok: false; available: string[] };

export async function listTransitions(issueKey: string): Promise<JiraTransition[]> {
  const { transitions } = await jiraFetch<{ transitions: JiraTransition[] }>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  return transitions;
}

export async function transitionToCanonical(
  issueKey: string,
  target: CanonicalStatus,
): Promise<TransitionResult> {
  const transitions = await listTransitions(issueKey);
  const t = pickTransition(target, transitions);
  if (!t) return { ok: false, available: transitions.map((x) => x.to.name) };

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  return { ok: true, to: t.to.name };
}
