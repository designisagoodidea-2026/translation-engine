// Thin fetch wrappers around the Worker API. All requests are JSON.

import type {
  AirtablePatBody,
  ConnectionPlatform,
  ConnectionsResponse,
  DecisionsResponse,
  JiraPatBody,
  Proposal,
  PreviewResponse,
  StateResponse,
  UserDecisions,
} from './types.js';

export async function fetchState(): Promise<StateResponse> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`/api/state ${res.status}`);
  return res.json() as Promise<StateResponse>;
}

export async function fetchPreview(
  decisions: UserDecisions,
): Promise<PreviewResponse> {
  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  if (!res.ok) throw new Error(`/api/preview ${res.status}`);
  return res.json() as Promise<PreviewResponse>;
}

/**
 * Persist decisions for the active pair. The Worker returns success even
 * when the KV binding is absent, so the SPA does not need to differentiate
 * "stored" from "no-op stored" for UX. The response's `persistence.enabled`
 * flag tells the SPA whether a real write happened.
 */
export async function saveDecisions(
  decisions: UserDecisions,
): Promise<DecisionsResponse> {
  const res = await fetch('/api/decisions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  if (!res.ok) throw new Error(`/api/decisions ${res.status}`);
  return res.json() as Promise<DecisionsResponse>;
}

// --- Connections ----------------------------------------------------------

export async function fetchConnections(): Promise<ConnectionsResponse> {
  const res = await fetch('/api/connections');
  if (!res.ok) throw new Error(`/api/connections ${res.status}`);
  return res.json() as Promise<ConnectionsResponse>;
}

export async function saveJiraPat(body: JiraPatBody): Promise<unknown> {
  const res = await fetch('/api/connections/jira', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'pat', credentials: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `/api/connections/jira ${res.status}`);
  return json;
}

export async function saveAirtablePat(body: AirtablePatBody): Promise<unknown> {
  const res = await fetch('/api/connections/airtable', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'pat', credentials: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `/api/connections/airtable ${res.status}`);
  return json;
}

export async function disconnectPlatform(platform: ConnectionPlatform): Promise<void> {
  const res = await fetch(`/api/connections/${platform}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`/api/connections/${platform} ${res.status}`);
}

export async function fetchProposal(
  decisionKey: 'slackContextHandling' | 'epicDisplayMode' | 'customerSegmentDestination',
  prompt: string,
): Promise<Proposal> {
  const res = await fetch('/api/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionKey, prompt }),
  });
  if (!res.ok) throw new Error(`/api/propose ${res.status}`);
  return res.json() as Promise<Proposal>;
}
