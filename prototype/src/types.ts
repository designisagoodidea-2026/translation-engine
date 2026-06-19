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

export interface StoredDecisions {
  pairId: string;
  decisions: UserDecisions;
  savedAt: string;
}

export interface PersistenceStatus {
  /** True when the Worker has a KV binding for decision persistence.
   *  False on cold deploys without setup — UI continues to work but
   *  decisions are not written through. */
  enabled: boolean;
}

export interface StateResponse {
  pair: PairConfig;
  sourceIssues: JiraIssue[];
  baseline: TranslationResult[];
  decisionCatalog: DecisionCatalog;
  defaultDecisions: UserDecisions;
  /** Stored decisions for the active pair, or `null` on first visit. */
  storedDecisions: StoredDecisions | null;
  /** Decisions merged over defaults — what the SPA should use as initial state. */
  effectiveDecisions: UserDecisions;
  persistence: PersistenceStatus;
}

export interface PreviewResponse {
  decisions: UserDecisions;
  enhanced: EnhancedResult[];
}

export interface DecisionsResponse {
  pairId: string;
  stored: StoredDecisions | null;
  effective?: UserDecisions;
  persistence: PersistenceStatus;
}

export type ConnectionPlatform = 'jira' | 'airtable';
export type ConnectionKind = 'pat' | 'oauth';

export interface ConnectionSummary {
  pairId: string;
  platform: ConnectionPlatform;
  kind: ConnectionKind;
  identity: { displayName: string; handle?: string };
  addedAt: string;
  validatedAt: string;
}

export interface ConnectionsResponse {
  pairId: string;
  connections: {
    jira: ConnectionSummary | null;
    airtable: ConnectionSummary | null;
  };
  persistence: PersistenceStatus;
}

export interface JiraPatBody {
  email: string;
  apiToken: string;
  siteUrl: string;
}

export interface AirtablePatBody {
  apiToken: string;
}

export type { JiraIssue, TranslationResult, LossKind, UserDecisions, EnhancedResult, Proposal };
