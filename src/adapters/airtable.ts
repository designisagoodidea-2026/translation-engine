// Read/write Airtable adapter for Slice 1.
// Auth: Personal Access Token (PAT) via bearer header.
// HTTP plumbing lives in ../lib/http; env access in ../lib/config.

import { config } from '../lib/config.js';
import { createHttpClient } from '../lib/http.js';

const cfg = config.airtable;

const http = createHttpClient({
  baseUrl: 'https://api.airtable.com/v0',
  defaultHeaders: { Authorization: `Bearer ${cfg.apiToken}` },
  label: 'airtable',
});

export function airtableFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  return http.fetch<T>(path, init);
}

// --- Types ----------------------------------------------------------------

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: F;
}

export interface AirtableListResponse<F = Record<string, unknown>> {
  records: AirtableRecord<F>[];
  offset?: string;
}

// --- Operations -----------------------------------------------------------

export async function listRecords<F = Record<string, unknown>>(
  tableId: string,
  opts: { maxRecords?: number; offset?: string; pageSize?: number } = {},
): Promise<AirtableListResponse<F>> {
  const params = new URLSearchParams();
  if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords));
  if (opts.offset) params.set('offset', opts.offset);
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  return airtableFetch<AirtableListResponse<F>>(
    `/${cfg.baseId}/${tableId}${qs ? `?${qs}` : ''}`,
  );
}

export async function getRecord<F = Record<string, unknown>>(
  tableId: string,
  recordId: string,
): Promise<AirtableRecord<F>> {
  return airtableFetch<AirtableRecord<F>>(`/${cfg.baseId}/${tableId}/${recordId}`);
}

export async function createRecord<F = Record<string, unknown>>(
  tableId: string,
  fields: F,
  opts: { typecast?: boolean } = {},
): Promise<AirtableRecord<F>> {
  return airtableFetch<AirtableRecord<F>>(`/${cfg.baseId}/${tableId}`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: opts.typecast ?? true }),
  });
}
