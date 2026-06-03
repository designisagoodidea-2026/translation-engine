// Shape mirrors what the Worker returns. Kept in a tiny shared file so the
// SPA and the API stay aligned without importing Worker code into the
// browser bundle.

import type {
  UserDecisions,
  EnhancedResult,
} from '../worker/decisions.js';
import type { Proposal } from '../worker/propose.js';
import type { TranslationResult, LossKind } from '../../src/grammars/types.js';
import type { JiraIssue } from '../../src/adapters/jira.js';

export interface PairConfig {
  id: string;
  source: {
    kind: 'jira';
    label: string;
    projectName: string;
    projectKey: string;
  };
  destination: {
    kind: 'airtable';
    label: string;
    baseName: string;
    tableName: string;
  };
  grammar: {
    id: string;
    label: string;
    description: string;
  };
  destinationFields: string[];
}

export interface DecisionOption<V> {
  value: V;
  label: string;
  description: string;
  recommended: boolean;
}

export interface DecisionEntry<V> {
  title: string;
  body: string;
  options: ReadonlyArray<DecisionOption<V>>;
}

export interface DecisionCatalog {
  slackContextHandling: DecisionEntry<UserDecisions['slackContextHandling']>;
  epicDisplayMode: DecisionEntry<UserDecisions['epicDisplayMode']>;
  customerSegmentDestination: DecisionEntry<UserDecisions['customerSegmentDestination']>;
}

export interface StateResponse {
  pair: PairConfig;
  sourceIssues: JiraIssue[];
  baseline: TranslationResult[];
  decisionCatalog: DecisionCatalog;
  defaultDecisions: UserDecisions;
}

export interface PreviewResponse {
  decisions: UserDecisions;
  enhanced: EnhancedResult[];
}

export type { JiraIssue, TranslationResult, LossKind, UserDecisions, EnhancedResult, Proposal };
