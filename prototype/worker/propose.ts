// AI proposal endpoint logic.
//
// Two implementations live here:
//
//   - `proposeLLM` calls Anthropic's Messages API with the decision context +
//     user prompt and parses a strict-JSON response. Used when
//     ANTHROPIC_API_KEY is bound (production / local dev with secret set).
//   - `proposeStub` is a deterministic keyword matcher that returns a plausible
//     suggestion without an API call. Used when no key is bound, and as a
//     fallback when the LLM call fails for any reason.
//
// The dispatcher `propose(req, apiKey, catalogEntry)` picks the right one and
// always returns a `Proposal`. The `isStub` flag lets the UI tell the user
// whether they're seeing real model output or the offline fallback.

import type { DECISION_CATALOG } from './decisions.js';

export interface ProposalRequest {
  decisionKey: 'slackContextHandling' | 'epicDisplayMode' | 'customerSegmentDestination';
  prompt: string;
}

export interface Proposal {
  text: string;
  suggestedValue: string | null;
  isStub: boolean;
}

type CatalogEntry = (typeof DECISION_CATALOG)[ProposalRequest['decisionKey']];

const KEYWORDS = {
  slackContextHandling: [
    { value: 'fetch-thread', re: /\b(snapshot|fetch|embed|copy|capture|archive|save)\b/i },
    { value: 'drop', re: /\b(drop|remove|ignore|strip|hide|delete|omit)\b/i },
    { value: 'keep-url', re: /\b(keep|preserve|retain|leave|link)\b/i },
  ],
  epicDisplayMode: [
    { value: 'both', re: /\b(both|combined|key and|summary and|all|everything)\b/i },
    { value: 'key', re: /\b(key|id|identifier|code|reference)\b/i },
    { value: 'summary', re: /\b(summary|name|title|description|label|readable)\b/i },
  ],
  customerSegmentDestination: [
    { value: 'create-field', re: /\b(new field|create field|add field|new column|separate field|first.class)\b/i },
    { value: 'append-to-description', re: /\b(append|description|notes|add to|inline)\b/i },
    { value: 'drop', re: /\b(drop|skip|ignore|remove|omit)\b/i },
  ],
} as const;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = [
  'You are an advisor inside the Translation Engine prototype. The user is',
  'resolving a translation loss — a place where the source schema does not map',
  'cleanly to the destination schema. They describe in their own words what',
  'they want; you pick the best matching option from a fixed catalog (or none,',
  'if nothing in the catalog fits).',
  '',
  'Respond with strict JSON of the shape:',
  '{"suggestedValue": <one of the listed option values, or null>, "text": <1-2 sentence explanation grounded in the user\'s description>}',
  '',
  'Rules:',
  '- suggestedValue MUST be exactly one of the option `value` strings, or null. Never invent a new value.',
  '- text references the user\'s wording, not generic boilerplate.',
  '- If the user\'s description is too vague to commit to one option, return null and explain what would help.',
  '- Output the JSON object only. No markdown fences, no preamble, no trailing text.',
].join('\n');

function buildUserMessage(req: ProposalRequest, catalog: CatalogEntry): string {
  const optionLines = catalog.options
    .map((o) => `- ${o.value}: ${o.label} — ${o.description}`)
    .join('\n');
  return [
    `Decision: ${catalog.title}`,
    `Context: ${catalog.body}`,
    '',
    'Options:',
    optionLines,
    '',
    `User's description: "${req.prompt.trim()}"`,
  ].join('\n');
}

/**
 * Top-level dispatcher. Tries the LLM if a key is present; falls back to the
 * deterministic stub on missing key, parse failure, or network error.
 */
export async function propose(
  req: ProposalRequest,
  apiKey: string | undefined,
  catalog: CatalogEntry,
): Promise<Proposal> {
  const prompt = req.prompt.trim();
  if (prompt.length === 0) {
    return {
      text: 'No prompt provided. Describe what you\'d like to happen and the engine will propose a resolution.',
      suggestedValue: null,
      isStub: !apiKey,
    };
  }
  if (!apiKey) {
    return proposeStub(req);
  }
  try {
    return await proposeLLM(req, apiKey, catalog);
  } catch {
    return proposeStub(req);
  }
}

/**
 * Anthropic Messages API call. Returns a `Proposal` with `isStub: false`.
 * Throws on network failure, non-OK status, or unparsable response so the
 * dispatcher can fall back to the stub.
 */
export async function proposeLLM(
  req: ProposalRequest,
  apiKey: string,
  catalog: CatalogEntry,
): Promise<Proposal> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserMessage(req, catalog) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) {
    throw new Error('Anthropic response had no text content');
  }

  // Strip accidental markdown fences just in case the model wraps the JSON.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as {
    suggestedValue?: unknown;
    text?: unknown;
  };

  const allowed = new Set(catalog.options.map((o) => o.value));
  const suggestedValue =
    typeof parsed.suggestedValue === 'string' && allowed.has(parsed.suggestedValue as never)
      ? (parsed.suggestedValue as string)
      : null;
  const explanation =
    typeof parsed.text === 'string' && parsed.text.trim().length > 0
      ? parsed.text.trim()
      : 'The model returned a proposal but no explanatory text.';

  return {
    text: explanation,
    suggestedValue,
    isStub: false,
  };
}

/**
 * Deterministic keyword fallback. Always returns a `Proposal` with
 * `isStub: true` so the UI can label it as the offline path.
 */
export function proposeStub(req: ProposalRequest): Proposal {
  const list = KEYWORDS[req.decisionKey] ?? [];
  const prompt = req.prompt.trim();

  if (prompt.length === 0) {
    return {
      text: 'No prompt provided. Describe what you\'d like to happen and the engine will propose a resolution.',
      suggestedValue: null,
      isStub: true,
    };
  }

  for (const { value, re } of list) {
    if (re.test(prompt)) {
      return {
        text: `Based on your description, the engine would map this to the existing option "${value}". Click that option above to apply, or refine your description if a different resolution is intended.`,
        suggestedValue: value,
        isStub: true,
      };
    }
  }

  return {
    text: `No existing option clearly matches your description. In production, the engine would propose a custom override here — either by extending the option list for this decision kind or by emitting a one-time exception captured in the manifest. (Offline fallback — set ANTHROPIC_API_KEY via \`wrangler secret put\` to get live model proposals.)`,
    suggestedValue: null,
    isStub: true,
  };
}
