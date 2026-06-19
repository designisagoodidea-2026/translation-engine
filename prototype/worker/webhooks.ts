// Webhook receivers — near-real-time pass triggers.
//
// Jira and Airtable both support outbound webhooks: a source-side event
// (issue updated, record changed) fires an HTTP POST to a URL we register.
// This module verifies the signature on incoming requests and turns them
// into the same "run a pass for this pair" invocation the cron handler
// uses. Each webhook-triggered run still produces a discrete-snapshot
// manifest — the doctrine principle holds.
//
// Signing-secret bindings:
//
//   - `JIRA_WEBHOOK_SECRET`     — Wrangler secret. Jira webhooks include
//     an `X-Hub-Signature` header containing `sha256=<hex>` over the raw
//     request body, keyed by this secret. Configured when registering
//     the webhook at the Jira side.
//   - `AIRTABLE_WEBHOOK_SECRET` — Wrangler secret. Airtable webhook
//     payloads include an `X-Airtable-Content-Mac` header containing
//     `hmac-sha256=<hex>` over the raw body.
//
// Without a secret configured, signature verification is skipped. The
// log line is loud about the choice so a misconfigured production deploy
// is easy to spot.

export type WebhookSourcePlatform = 'jira' | 'airtable';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** True when no secret was configured; caller decides whether to accept. */
  secretMissing?: boolean;
}

/**
 * Verify an HMAC-SHA256 signature header against the raw body.
 *
 *   headerFormat: 'sha256=<hex>' (Jira's `X-Hub-Signature`) or
 *                 'hmac-sha256=<hex>' (Airtable's `X-Airtable-Content-Mac`).
 */
export async function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<VerifyResult> {
  if (!secret) {
    return { ok: false, secretMissing: true, reason: 'no signing secret configured' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'missing signature header' };
  }
  const eq = signatureHeader.indexOf('=');
  const hex = eq >= 0 ? signatureHeader.slice(eq + 1).trim() : signatureHeader.trim();

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const computedHex = bytesToHex(new Uint8Array(sig));
    if (!constantTimeEqual(computedHex, hex.toLowerCase())) {
      return { ok: false, reason: 'signature mismatch' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `verification error: ${(e as Error).message}` };
  }
}

/**
 * Constant-time string compare. Avoids early-exit timing leaks when the
 * computed and supplied signatures differ.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Extract the signature header per platform. Both platforms use a
 * single header today but the abstraction protects against future
 * platform-specific divergence (Airtable v2 webhooks, etc.).
 */
export function signatureHeader(
  request: Request,
  platform: WebhookSourcePlatform,
): string | null {
  if (platform === 'jira') {
    return request.headers.get('X-Hub-Signature') ?? request.headers.get('x-hub-signature');
  }
  return (
    request.headers.get('X-Airtable-Content-Mac') ??
    request.headers.get('x-airtable-content-mac')
  );
}
