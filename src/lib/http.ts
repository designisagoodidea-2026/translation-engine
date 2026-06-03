// Tiny shared HTTP client factory. Adapters create one per service.
// Handles: header merging, error formatting, JSON parsing of (possibly empty)
// response bodies. Deliberately thin — no retries, no rate limiting, no
// dependencies. Add those at the adapter level when an actual need shows up.

export interface HttpClient {
  fetch<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  /** Short label included in error messages (e.g. "jira", "airtable"). */
  label: string;
}

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  return {
    async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
      const res = await fetch(opts.baseUrl + path, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(opts.defaultHeaders ?? {}),
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `${opts.label} ${init.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}: ${body}`,
        );
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
  };
}
