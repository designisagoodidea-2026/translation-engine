// Map an "intended" canonical status (To Do / In Progress / Done) to whatever
// the project's Jira workflow actually exposes. Necessary because Scrum
// templates ship different status names: a Free/Scrum board may have
// "Backlog / Up Next / Active / Blocked / Complete" rather than the
// canonical workflow.
//
// Pure functions, no I/O — composes well with both the seed pass and the
// fix-statuses one-off catch-up script.

export type CanonicalStatus = 'To Do' | 'In Progress' | 'Done';

const MATCHERS: Record<CanonicalStatus, RegExp[]> = {
  'To Do': [/^to.?do$/i, /\bbacklog\b/i, /\bopen\b/i, /\bnew\b/i, /\bcreated\b/i, /\bup.?next\b/i],
  'In Progress': [/in.?progress/i, /\bactive\b/i, /\bdoing\b/i, /\bworking\b/i, /\bstarted\b/i],
  'Done': [/\bdone\b/i, /\bcomplete\b/i, /\bclosed\b/i, /\bresolved\b/i, /\bfinished\b/i],
};

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

/** Pick a transition whose destination matches the canonical target. */
export function pickTransition(
  intended: CanonicalStatus,
  transitions: JiraTransition[],
): JiraTransition | null {
  for (const re of MATCHERS[intended]) {
    const hit = transitions.find((t) => re.test(t.to.name));
    if (hit) return hit;
  }
  return null;
}

/** True if `actual` is already a member of the canonical bucket. */
export function statusMatches(actual: string, intended: CanonicalStatus): boolean {
  return MATCHERS[intended].some((re) => re.test(actual));
}
