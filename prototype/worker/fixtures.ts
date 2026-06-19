// Baked demo fixtures. The prototype Worker serves these instead of hitting
// live Jira / Airtable. The shape mirrors what the existing library reads
// from those systems so the same grammar runs against the fixtures.
//
// Source: a subset of the synthetic pet-feeder SCRUM project we seeded
// during the POC. Destination shape and field names match the Roadmap
// table we built in Airtable.

import type { JiraIssue } from '../../src/adapters/jira.js';

export const PAIR = {
  id: 'jira-airtable-pm',
  source: {
    kind: 'jira' as const,
    label: 'Jira Cloud',
    projectName: 'Pet Feeder App',
    projectKey: 'SCRUM',
  },
  destination: {
    kind: 'airtable' as const,
    label: 'Airtable',
    baseName: 'Translation Engine Demo',
    tableName: 'Roadmap',
  },
  grammar: {
    id: 'project-management',
    label: 'Project management',
    description:
      'Translates engineering-tracker schemas to roadmap shapes. Names workflow, hierarchy, and context losses that arise when issue-level data moves to a flat roadmap row.',
  },
  destinationFields: [
    'Name', 'Description', 'Status', 'Priority', 'Assignee',
    'Epic', 'Labels', 'Due', 'Sprint', 'Fix Version', 'Source Key',
  ],
};

// Custom-field names map (used by the grammar to filter Jira system fields
// and to surface project-specific custom fields by display name).
export const CUSTOM_FIELD_NAMES = new Map<string, string>([
  ['customfield_10019', 'Rank'],
  ['customfield_10020', 'Sprint'],
  ['customfield_10031', 'Story Points'],
  ['customfield_10100', 'Customer Segment'],
]);

// Parent (Epic) key → summary map. Passed into the grammar as
// `parentSummaryByKey` so the parent→Epic hierarchy-loss row can carry the
// human-readable epic name instead of just the key.
export const PARENT_SUMMARIES = new Map<string, string>([
  ['SCRUM-2', 'Pet feeder hardware integration'],
  ['SCRUM-3', 'Mobile app — feed scheduling UX'],
  ['SCRUM-4', 'Cloud telemetry + alerts'],
]);

// A representative slice of source issues with rich loss surfaces.
// SCRUM-5 is the showpiece — has the Slack URL in the description (context
// loss), a parent epic (hierarchy), a sprint (hierarchy), a fix version
// (hierarchy), and a Customer Segment custom field set (schema).
export const SOURCE_ISSUES: JiraIssue[] = [
  {
    id: '10005',
    key: 'SCRUM-5',
    fields: {
      summary: 'Bluetooth pairing flow',
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Spec lives in this Slack thread: ' },
              {
                type: 'text',
                text: 'https://acme.slack.com/archives/C0HARDWARE/p1700000000001',
              },
              {
                type: 'text',
                text: ' — pairing should auto-reconnect on app foreground.',
              },
            ],
          },
        ],
      },
      status: { name: 'Active' },
      priority: { name: 'High' },
      assignee: null,
      parent: {
        key: 'SCRUM-2',
        fields: { summary: 'Pet feeder hardware integration' },
      },
      labels: ['hardware'],
      duedate: null,
      fixVersions: [{ name: 'v0.1', released: false }],
      customfield_10020: [
        {
          id: 34,
          name: 'Sprint 1 — Demo',
          state: 'active',
          startDate: '2026-06-02',
          endDate: '2026-06-16',
        },
      ],
      customfield_10019: '0|hzzzz5:',
      customfield_10100: { value: 'Enterprise' },
      issuetype: { name: 'Task' },
    },
  },
  {
    id: '10006',
    key: 'SCRUM-6',
    fields: {
      summary: 'Battery telemetry endpoint',
      description: null,
      status: { name: 'Active' },
      priority: { name: 'Medium' },
      assignee: null,
      parent: {
        key: 'SCRUM-2',
        fields: { summary: 'Pet feeder hardware integration' },
      },
      labels: ['hardware', 'telemetry'],
      duedate: null,
      fixVersions: [{ name: 'v0.1', released: false }],
      customfield_10020: [
        { id: 34, name: 'Sprint 1 — Demo', state: 'active' },
      ],
      customfield_10019: '0|hzzzz6:',
      issuetype: { name: 'Task' },
    },
  },
  {
    id: '10008',
    key: 'SCRUM-8',
    fields: {
      summary: 'Schedule editor screen',
      description: null,
      status: { name: 'Active' },
      priority: { name: 'High' },
      assignee: null,
      parent: {
        key: 'SCRUM-3',
        fields: { summary: 'Mobile app — feed scheduling UX' },
      },
      labels: ['mobile', 'ux'],
      duedate: null,
      fixVersions: [],
      customfield_10020: [
        { id: 34, name: 'Sprint 1 — Demo', state: 'active' },
      ],
      customfield_10019: '0|hzzzz8:',
      customfield_10100: { value: 'Mid-market' },
      issuetype: { name: 'Task' },
    },
  },
  {
    id: '10012',
    key: 'SCRUM-12',
    fields: {
      summary: 'Feed event ingest worker',
      description: null,
      status: { name: 'Complete' },
      priority: { name: 'High' },
      assignee: null,
      parent: {
        key: 'SCRUM-4',
        fields: { summary: 'Cloud telemetry + alerts' },
      },
      labels: ['cloud', 'telemetry'],
      duedate: null,
      fixVersions: [{ name: 'v0.1', released: false }],
      customfield_10020: [
        { id: 34, name: 'Sprint 1 — Demo', state: 'active' },
      ],
      customfield_10019: '0|hzzzzC:',
      customfield_10100: { value: 'Enterprise' },
      issuetype: { name: 'Task' },
    },
  },
  {
    id: '10015',
    key: 'SCRUM-15',
    fields: {
      summary: 'Anomaly dashboard prototype',
      description: null,
      status: { name: 'Backlog' },
      priority: { name: 'Medium' },
      assignee: null,
      parent: {
        key: 'SCRUM-4',
        fields: { summary: 'Cloud telemetry + alerts' },
      },
      labels: ['cloud', 'dashboard'],
      duedate: null,
      fixVersions: [],
      customfield_10020: null,
      customfield_10019: '0|hzzzzF:',
      customfield_10100: { value: 'SMB' },
      issuetype: { name: 'Task' },
    },
  },
];
