// AI proposal endpoint logic.
//
// In production this would call an LLM with the loss context + user prompt
// and return a structured proposal: which existing option (if any) the user's
// description matches, or a sketch of a new override the engine could
// support. For this demo the implementation is a deterministic stub that
// keyword-matches the prompt to a likely option, so the UI flow is
// demonstrable without an API key or runtime cost.
//
// To wire to a real model: replace `proposeStub` with a call to your LLM of
// choice (Anthropic Claude, OpenAI, etc.) using `ANTHROPIC_API_KEY` or
// equivalent stored via `wrangler secret put`.

export interface ProposalRequest {
  decisionKey: 'slackContextHandling' | 'epicDisplayMode' | 'customerSegmentDestination';
  prompt: string;
}

export interface Proposal {
  text: string;
  suggestedValue: string | null;
  isStub: boolean;
}

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
    text: `No existing option clearly matches your description. In production, the engine would propose a custom override here — either by extending the option list for this decision kind or by emitting a one-time exception captured in the manifest. (Stubbed for demo — wire \`worker/propose.ts\` to a real model to get live proposals.)`,
    suggestedValue: null,
    isStub: true,
  };
}
