// Cloudflare Worker for the Translation Engine prototype.
//
// Routes:
//   GET  /api/state        — return pair config + baseline translation results
//   POST /api/preview      — body: { decisions }, return enhanced results
//   POST /api/propose      — body: { decisionKey, prompt }, return AI proposal
//   *                     — fall through to static SPA assets
//
// The translation grammar is imported from the existing library at
// `../src/grammars/project-management.ts` — the Worker IS the library wrapped
// in HTTP.

import { translateIssue } from '../../src/grammars/project-management.js';
import type { GrammarContext, TranslationResult } from '../../src/grammars/types.js';

import {
  CUSTOM_FIELD_NAMES,
  EPIC_SUMMARIES,
  PAIR,
  SOURCE_ISSUES,
} from './fixtures.js';
import {
  applyDecisions,
  DECISION_CATALOG,
  DEFAULT_DECISIONS,
  type EnhancedResult,
  type UserDecisions,
} from './decisions.js';
import { proposeStub, type ProposalRequest } from './propose.js';

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const GRAMMAR_CTX: GrammarContext = {
  epicSummaryByKey: EPIC_SUMMARIES,
  customFieldNames: CUSTOM_FIELD_NAMES,
};

function runBaseline(): TranslationResult[] {
  return SOURCE_ISSUES.map((issue) => translateIssue(issue, GRAMMAR_CTX));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- API routes --------------------------------------------------
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const baseline = runBaseline();
      return jsonResponse({
        pair: PAIR,
        sourceIssues: SOURCE_ISSUES,
        baseline,
        decisionCatalog: DECISION_CATALOG,
        defaultDecisions: DEFAULT_DECISIONS,
      });
    }

    if (url.pathname === '/api/preview' && request.method === 'POST') {
      let body: { decisions?: UserDecisions };
      try {
        body = (await request.json()) as { decisions?: UserDecisions };
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      const decisions = { ...DEFAULT_DECISIONS, ...(body.decisions ?? {}) };
      const baseline = runBaseline();
      const enhanced: EnhancedResult[] = baseline.map((b) =>
        applyDecisions(b, decisions),
      );
      return jsonResponse({ decisions, enhanced });
    }

    if (url.pathname === '/api/propose' && request.method === 'POST') {
      let body: ProposalRequest;
      try {
        body = (await request.json()) as ProposalRequest;
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }
      if (!body?.decisionKey || typeof body.prompt !== 'string') {
        return jsonResponse({ error: 'missing decisionKey or prompt' }, 400);
      }
      return jsonResponse(proposeStub(body));
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not found' }, 404);
    }

    // --- Static SPA assets ------------------------------------------
    return env.ASSETS.fetch(request);
  },
};
