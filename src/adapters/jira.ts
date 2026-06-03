// Read-mostly Jira Cloud adapter for Slice 1 (Jira → Airtable, PM context).
// Auth: Basic (email + API token). HTTP plumbing lives in ../lib/http.
// Env access lives in ../lib/config. This file is just the Jira-specific
// surface: types, operations, and one helper for ADF description bodies.

import { config } from '../lib/config.js';
import { createHttpClient } from '../lib/http.js';

const cfg = config.jira;
const auth = 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');

const http = createHttpClient({
  baseUrl: cfg.siteUrl,
  defaultHeaders: { Authorization: auth },
  label: 'jira',
});

export function jiraFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  return http.fetch<T>(path, init);
}

// --- Types ----------------------------------------------------------------

export interface JiraSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

// --- Operations -----------------------------------------------------------

/**
 * List issues for a project using the enhanced JQL search endpoint
 * (`/rest/api/3/search/jql`, POST). The legacy `/rest/api/3/search` endpoint
 * is deprecated on Jira Cloud.
 */
export async function listIssues(
  projectKey: string,
  opts: { fields?: string[]; maxResults?: number; nextPageToken?: string } = {},
): Promise<JiraSearchResponse> {
  return jiraFetch<JiraSearchResponse>('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `project = ${projectKey} ORDER BY created ASC`,
      fields: opts.fields ?? ['*all'],
      maxResults: opts.maxResults ?? 50,
      ...(opts.nextPageToken ? { nextPageToken: opts.nextPageToken } : {}),
    }),
  });
}

export async function getIssue(key: string): Promise<JiraIssue> {
  return jiraFetch<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}`);
}

export async function listEpics(projectKey: string): Promise<JiraSearchResponse> {
  return jiraFetch<JiraSearchResponse>('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `project = ${projectKey} AND issuetype = Epic ORDER BY created ASC`,
      fields: ['summary', 'status', 'priority', 'description'],
      maxResults: 50,
    }),
  });
}

/**
 * Resolve the numeric project ID for a project key. Some downstream APIs
 * (versions, board lookup) need the ID rather than the key.
 */
export async function getProjectId(projectKey: string): Promise<string> {
  const project = await jiraFetch<{ id: string }>(
    `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
  );
  return project.id;
}

/**
 * Wrap a plain string as a minimal Atlassian Document Format (ADF) node.
 * Jira v3 description / comment bodies expect ADF, not raw text.
 */
export function adf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n\n')
      .map((para) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: para }],
      })),
  };
}
