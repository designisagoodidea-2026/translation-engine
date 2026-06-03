// Thin fetch wrappers around the Worker API. All requests are JSON.

import type {
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
