// Translation Engine prototype — SPA entry.
//
// IA: issue-centric. The primary navigator is a horizontal strip of issue
// tabs. Each tab opens a split view — source (Jira) on the left, destination
// (Airtable preview) on the right. Translation runs row by row. Loss kinds
// are inline tags on the rows they affect. Decisions live inline at the rows
// whose translation they mediate — the user sees the decision intermediating
// before and after.
//
// Each decision panel offers:
//   - the grammar's Recommended option (badge)
//   - alternative options
//   - a Skip pill that defers the decision and surfaces it as unresolved
//   - a free-form chat input that calls /api/propose for an AI-sketched
//     mapping into one of the existing options

import './styles.css';
import { fetchPreview, fetchProposal, fetchState } from './api.js';
import { esc } from './dom.js';
import { Store } from './state.js';
import type {
  EnhancedResult,
  LossKind,
  PairConfig,
  StateResponse,
  TranslationResult,
  UserDecisions,
  JiraIssue,
  Proposal,
} from './types.js';
import type { DecisionCatalog } from './types.js';

const LOSS_KINDS: LossKind[] = ['schema', 'semantic', 'hierarchy', 'context', 'provenance'];

interface AppState {
  loading: boolean;
  pair: PairConfig | null;
  sourceIssues: JiraIssue[];
  baseline: TranslationResult[];
  decisionCatalog: DecisionCatalog | null;
  decisions: UserDecisions | null;
  enhanced: EnhancedResult[];
  currentKey: string;
  previewing: boolean;
  showCommit: boolean;
  proposals: Record<string, Proposal | null>;
  proposing: Record<string, boolean>;
}

const store = new Store<AppState>({
  loading: true,
  pair: null,
  sourceIssues: [],
  baseline: [],
  decisionCatalog: null,
  decisions: null,
  enhanced: [],
  currentKey: 'SCRUM-5',
  previewing: false,
  showCommit: false,
  proposals: {},
  proposing: {},
});

// Per-decision text-input values. Kept outside the Store so typing doesn't
// trigger a re-render on every keystroke (which would steal focus).
const proposalInputs = new Map<string, string>();

// --- Boot -----------------------------------------------------------------

bootstrap();

async function bootstrap() {
  try {
    const data: StateResponse = await fetchState();
    store.set({
      loading: false,
      pair: data.pair,
      sourceIssues: data.sourceIssues,
      baseline: data.baseline,
      decisionCatalog: data.decisionCatalog,
      decisions: data.defaultDecisions,
    });
    await refreshPreview();
  } catch (e) {
    console.error(e);
    document.getElementById('app')!.innerHTML =
      `<div class="loading">Failed to load state. Is the worker running? <pre>${esc((e as Error).message)}</pre></div>`;
  }
}

async function refreshPreview() {
  const decisions = store.get().decisions;
  if (!decisions) return;
  store.set({ previewing: true });
  try {
    const data = await fetchPreview(decisions);
    store.set({ enhanced: data.enhanced, previewing: false });
  } catch (e) {
    console.error(e);
    store.set({ previewing: false });
  }
}

// --- Render ---------------------------------------------------------------

store.subscribe(render);
render();

function render() {
  const s = store.get();
  const app = document.getElementById('app')!;

  if (s.loading) {
    app.innerHTML = `<div class="loading">Loading…</div>`;
    return;
  }

  app.innerHTML = `
    <main>
      ${renderHeader(s.pair!)}
      ${renderSummaryBand(s)}
      ${renderIssueTabs(s)}
      ${renderSplitView(s)}
      ${renderCommitRow(s)}
      ${renderFooter()}
    </main>
    ${s.showCommit ? renderCommitModal(s) : ''}
  `;

  wireEvents();
}

// --- Header --------------------------------------------------------------

function renderHeader(pair: PairConfig): string {
  return `
    <header class="hero">
      <div class="hero-row">
        <h1>Translation Engine — prototype</h1>
        <span class="tag">Demo mode · synthetic data · no real writes</span>
      </div>
      <div class="pair-strip">
        <span class="pair-side">
          <span class="pair-label">Source</span>
          <strong>${esc(pair.source.label)}</strong>
          <span class="muted">· ${esc(pair.source.projectName)} (<code>${esc(pair.source.projectKey)}</code>)</span>
        </span>
        <span class="pair-arrow">→</span>
        <span class="pair-side">
          <span class="pair-label">Destination</span>
          <strong>${esc(pair.destination.label)}</strong>
          <span class="muted">· ${esc(pair.destination.baseName)} / ${esc(pair.destination.tableName)}</span>
        </span>
        <span class="pair-grammar">
          <span class="pair-label">Grammar</span>
          <strong>${esc(pair.grammar.label)}</strong>
        </span>
      </div>
    </header>
  `;
}

// --- Summary band --------------------------------------------------------

function renderSummaryBand(s: AppState): string {
  const counts: Record<LossKind, number> = {
    schema: 0, semantic: 0, hierarchy: 0, context: 0, provenance: 0,
  };
  for (const r of s.baseline) for (const l of r.losses) counts[l.kind]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const skippedCount = s.enhanced.reduce((sum, e) => sum + e.skipped.length, 0);

  const chips = LOSS_KINDS.map((k) =>
    `<span class="chip chip-${k}"><span class="chip-n">${counts[k]}</span><span class="chip-k">${k}</span></span>`
  ).join('');

  return `
    <section class="summary-strip">
      <span class="summary-lead">
        <strong>${s.baseline.length}</strong> source issue(s) ·
        <strong>${total}</strong> loss(es) surfaced
        ${skippedCount > 0 ? `· <strong class="skipped-count">${skippedCount}</strong> intentionally not mapped` : ''}
      </span>
      <span class="summary-chips">${chips}</span>
    </section>
  `;
}

// --- Issue tabs ----------------------------------------------------------

function renderIssueTabs(s: AppState): string {
  const chips = s.sourceIssues.map((issue) => {
    const baseline = s.baseline.find((b) => b.jiraKey === issue.key);
    const lossCount = baseline?.losses.length ?? 0;
    const summary = issue.fields?.summary ?? '';
    const active = issue.key === s.currentKey ? 'active' : '';
    return `
      <button class="issue-tab ${active}" data-key="${esc(issue.key)}">
        <span class="issue-key">${esc(issue.key)}</span>
        <span class="issue-summary">${esc(summary)}</span>
        <span class="issue-loss-badge">${lossCount}</span>
      </button>
    `;
  }).join('');

  return `
    <section class="issue-tabs-wrap">
      <div class="issue-tabs">${chips}</div>
    </section>
  `;
}

// --- Split view: the main thing -----------------------------------------

interface FieldRow {
  field: string;
  losses: import('./types.js').TranslationResult['losses'];
  sourceHtml: string;
  destHtml: string;
  decisionKey?: keyof UserDecisions;
}

function renderSplitView(s: AppState): string {
  const issue = s.sourceIssues.find((i) => i.key === s.currentKey);
  const enhanced = s.enhanced.find((e) => e.jiraKey === s.currentKey);
  const baseline = s.baseline.find((b) => b.jiraKey === s.currentKey);

  if (!issue || !enhanced || !baseline) {
    return `<section class="loading">No data for ${esc(s.currentKey)}.</section>`;
  }

  const rows = buildFieldRows(issue, enhanced, baseline);
  const rowsHtml = rows.map((r) => renderFieldRow(r, s, enhanced)).join('');

  return `
    <section class="split-section">
      <div class="split-headers">
        <div class="split-h split-h-source">
          <span class="split-h-eyebrow">Source</span>
          <span class="split-h-title">Jira <code>${esc(issue.key)}</code></span>
        </div>
        <div class="split-h split-h-dest">
          <span class="split-h-eyebrow">Destination preview${s.previewing ? ' · recomputing…' : ''}</span>
          <span class="split-h-title">Airtable Roadmap row</span>
        </div>
      </div>
      <div class="split-rows">
        ${rowsHtml}
      </div>
    </section>
  `;
}

function renderFieldRow(r: FieldRow, s: AppState, enhanced: EnhancedResult): string {
  const tags = r.losses.map((l) =>
    `<span class="kind-tag kind-${l.kind}" title="${esc(l.distance)}">${l.kind}</span>`
  ).join('');

  const isSkipped = r.decisionKey && enhanced.skipped.includes(r.decisionKey);
  const decisionHtml = r.decisionKey
    ? renderInlineDecision(r.decisionKey, s)
    : '';

  return `
    <div class="field-row ${isSkipped ? 'is-skipped' : ''}">
      <div class="field-meta">
        <span class="field-name">${esc(r.field)}</span>
        ${tags ? `<span class="field-tags">${tags}</span>` : ''}
        ${isSkipped ? '<span class="skipped-pill">Not mapped</span>' : ''}
      </div>
      <div class="field-source">${r.sourceHtml}</div>
      <div class="field-arrow">→</div>
      <div class="field-dest">${r.destHtml}</div>
      ${decisionHtml}
    </div>
  `;
}

function renderInlineDecision(key: keyof UserDecisions, s: AppState): string {
  const cat = s.decisionCatalog!;
  const dec = s.decisions!;
  const entry = (cat as any)[key];
  const currentValue = dec[key];

  const opts = entry.options.map((o: any) => {
    const sel = o.value === currentValue;
    const recBadge = o.recommended ? '<span class="rec-badge">Recommended</span>' : '';
    const skipCls = o.value === 'skip' ? 'is-skip' : '';
    return `
      <label class="inline-option ${sel ? 'selected' : ''} ${skipCls}">
        <input type="radio" name="${esc(key)}" value="${esc(o.value)}" ${sel ? 'checked' : ''} data-decision="${esc(key)}">
        <span class="inline-option-lbl">${esc(o.label)}</span>
        ${recBadge}
      </label>
    `;
  }).join('');

  const cur = entry.options.find((o: any) => o.value === currentValue);
  const curDesc = cur ? esc(cur.description) : '';

  // AI chat input
  const inputValue = proposalInputs.get(key) ?? '';
  const proposal = s.proposals[key];
  const proposing = s.proposing[key];

  const proposalHtml = proposal ? `
    <div class="proposal-response">
      ${esc(proposal.text)}
      ${proposal.suggestedValue ? `
        <button class="apply-suggested" data-key="${esc(key)}" data-value="${esc(proposal.suggestedValue)}">
          Apply "${esc(proposal.suggestedValue)}"
        </button>
      ` : ''}
    </div>
  ` : '';

  return `
    <div class="inline-decision">
      <div class="inline-decision-head">
        <span class="inline-decision-title">Decision · ${esc(entry.title)}</span>
        <span class="inline-decision-body">${esc(entry.body)}</span>
      </div>
      <div class="inline-options">${opts}</div>
      <div class="inline-decision-desc">${curDesc}</div>
      <div class="inline-chat">
        <span class="chat-label">Or describe what you'd like →</span>
        <input
          type="text"
          class="chat-input"
          placeholder="e.g. 'embed the Slack thread as a snapshot' or 'add to the description'"
          value="${esc(inputValue)}"
          data-chat-key="${esc(key)}">
        <button class="chat-go ${proposing ? 'is-loading' : ''}" data-chat-key="${esc(key)}" ${proposing ? 'disabled' : ''}>
          ${proposing ? 'Thinking…' : 'Propose'}
        </button>
      </div>
      ${proposalHtml}
    </div>
  `;
}

function buildFieldRows(
  issue: JiraIssue,
  enhanced: EnhancedResult,
  baseline: TranslationResult,
): FieldRow[] {
  const f = issue.fields ?? {};
  const destFields = enhanced.airtableFields as Record<string, unknown>;
  const lossesByField = new Map<string, typeof baseline.losses>();
  for (const l of baseline.losses) {
    const arr = lossesByField.get(l.field) ?? [];
    arr.push(l);
    lossesByField.set(l.field, arr);
  }

  const rows: FieldRow[] = [];

  rows.push({
    field: 'Name',
    losses: [],
    sourceHtml: textCell(f.summary),
    destHtml: textCell(destFields['Name']),
  });

  const hasDescription = f.description != null;
  const descLosses = [
    ...(lossesByField.get('description→Description') ?? []),
    ...(lossesByField.get('description embeds Slack thread URL') ?? []),
  ];
  if (hasDescription) {
    const adfPreview = flattenAdfPreview(f.description);
    rows.push({
      field: 'Description',
      losses: descLosses,
      sourceHtml: `<div class="value-block">${esc(adfPreview)}</div><div class="meta-line">(stored as ADF document)</div>`,
      destHtml: `<div class="value-block">${esc(String(destFields['Description'] ?? ''))}</div>`,
      decisionKey: descLosses.some((l) => l.kind === 'context') ? 'slackContextHandling' : undefined,
    });
  }

  if (f.status?.name) {
    rows.push({
      field: 'Status',
      losses: lossesByField.get('status→Status') ?? [],
      sourceHtml: textCell(f.status.name),
      destHtml: statusPill(String(destFields['Status'] ?? '')),
    });
  }

  if (f.priority?.name) {
    rows.push({
      field: 'Priority',
      losses: lossesByField.get('priority→Priority') ?? [],
      sourceHtml: textCell(f.priority.name),
      destHtml: priorityPill(String(destFields['Priority'] ?? '')),
    });
  }

  if (f.parent?.key) {
    const src = f.parent;
    rows.push({
      field: 'Epic',
      losses: lossesByField.get('parent→Epic') ?? [],
      sourceHtml: `<div class="value-block"><code>${esc(src.key)}</code><div class="meta-line">${esc(src.fields?.summary ?? '')}</div></div>`,
      destHtml: textCell(destFields['Epic']),
      decisionKey: 'epicDisplayMode',
    });
  }

  if (Array.isArray(f.labels) && f.labels.length) {
    rows.push({
      field: 'Labels',
      losses: [],
      sourceHtml: f.labels.map((l: string) => `<code>${esc(l)}</code>`).join(' '),
      destHtml: Array.isArray(destFields['Labels'])
        ? (destFields['Labels'] as string[]).map((l) => `<code>${esc(l)}</code>`).join(' ')
        : '<em class="muted">(empty)</em>',
    });
  }

  const sprintField = (f as any).customfield_10020;
  if (Array.isArray(sprintField) && sprintField.length) {
    const first = sprintField[0];
    rows.push({
      field: 'Sprint',
      losses: lossesByField.get('sprint→Sprint') ?? [],
      sourceHtml: `<div class="value-block">${esc(first?.name ?? '')}<div class="meta-line">(object: id, state, dates)</div></div>`,
      destHtml: textCell(destFields['Sprint']),
    });
  }

  if (Array.isArray(f.fixVersions) && f.fixVersions.length) {
    rows.push({
      field: 'Fix Version',
      losses: lossesByField.get('fixVersions→Fix Version') ?? [],
      sourceHtml: `<div class="value-block">${esc(JSON.stringify(f.fixVersions.map((v: any) => v?.name).filter(Boolean)))}</div><div class="meta-line">(array of version objects)</div>`,
      destHtml: textCell(destFields['Fix Version']),
    });
  }

  const csValue = (f as any).customfield_10100?.value;
  const csLoss = baseline.losses.find((l) => /customer segment/i.test(l.field));
  if (csValue || csLoss) {
    const destHas = destFields['Customer Segment'] !== undefined;
    rows.push({
      field: 'Customer Segment',
      losses: csLoss ? [csLoss] : [],
      sourceHtml: textCell(csValue),
      destHtml: destHas
        ? textCell(destFields['Customer Segment'])
        : '<em class="muted">(dropped per decision)</em>',
      decisionKey: 'customerSegmentDestination',
    });
  }

  rows.push({
    field: 'Jira Key',
    losses: [],
    sourceHtml: `<code>${esc(issue.key)}</code>`,
    destHtml: `<code>${esc(String(destFields['Jira Key'] ?? issue.key))}</code>`,
  });

  return rows;
}

function textCell(value: unknown): string {
  if (value == null || value === '') return '<em class="muted">(empty)</em>';
  return esc(String(value));
}

function statusPill(v: string): string {
  if (!v) return '<em class="muted">(empty)</em>';
  const cls = v === 'In Progress' ? 'pill-active' : v === 'Done' ? 'pill-done' : 'pill-todo';
  return `<span class="pill ${cls}">${esc(v)}</span>`;
}
function priorityPill(v: string): string {
  if (!v) return '<em class="muted">(empty)</em>';
  const map: Record<string, string> = {
    Highest: 'pill-highest', High: 'pill-high', Medium: 'pill-medium',
    Low: 'pill-low', Lowest: 'pill-lowest',
  };
  return `<span class="pill ${map[v] ?? 'pill-lowest'}">${esc(v)}</span>`;
}

function flattenAdfPreview(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  if (Array.isArray(node.content)) return node.content.map(flattenAdfPreview).join('');
  return '';
}

// --- Commit row + modal --------------------------------------------------

function renderCommitRow(s: AppState): string {
  const skippedCount = s.enhanced.reduce((sum, e) => sum + e.skipped.length, 0);
  return `
    <section class="commit-row">
      <div class="commit-why">
        When you commit, the destination receives the previewed rows and a manifest of this pass is archived.
        ${skippedCount > 0 ? `<strong>${skippedCount} field(s)</strong> are intentionally not mapped to the destination and recorded as such in the manifest.` : ''}
        Demo mode performs no real writes — confirmation only.
      </div>
      <button class="primary" id="commit-btn">Commit this pass</button>
    </section>
  `;
}

function renderCommitModal(s: AppState): string {
  return `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <h3>Pass committed (demo mode)</h3>
        <p>In production this would write ${s.enhanced.length} record(s) to the destination, archive the manifest, and (optionally) schedule the next pass. Decisions applied:</p>
        <pre class="modal-pre">${esc(JSON.stringify(s.decisions, null, 2))}</pre>
        <div class="modal-row">
          <button class="secondary" id="modal-close">Close</button>
        </div>
      </div>
    </div>
  `;
}

function renderFooter(): string {
  return `
    <footer>
      Translation Engine prototype — built by Jason Armstrong.
      <a href="/demo/">Static doctrine demo</a> ·
      Source on <a href="https://github.com/designisagoodidea-2026/translation-engine">GitHub</a>.
    </footer>
  `;
}

// --- Event wiring ---------------------------------------------------------

function wireEvents() {
  // Issue tabs
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.issue-tab')) {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key!;
      store.set({ currentKey: k });
    });
  }

  // Inline decision radios
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-decision]')) {
    input.addEventListener('change', async () => {
      const key = input.dataset.decision as keyof UserDecisions;
      const value = input.value;
      const cur = store.get().decisions!;
      store.set({ decisions: { ...cur, [key]: value } as UserDecisions });
      await refreshPreview();
    });
  }

  // Chat input typing (doesn't trigger re-render)
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-chat-key]')) {
    input.addEventListener('input', () => {
      const key = input.dataset.chatKey!;
      proposalInputs.set(key, input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const key = input.dataset.chatKey!;
        runPropose(key);
      }
    });
  }

  // Propose buttons
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-chat-key]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chatKey!;
      runPropose(key);
    });
  }

  // Apply suggested button (jumps from AI proposal into a real decision)
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.apply-suggested')) {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key! as keyof UserDecisions;
      const value = btn.dataset.value!;
      const cur = store.get().decisions!;
      store.set({ decisions: { ...cur, [key]: value } as UserDecisions });
      await refreshPreview();
    });
  }

  // Commit
  const commit = document.getElementById('commit-btn');
  if (commit) commit.addEventListener('click', () => store.set({ showCommit: true }));
  const close = document.getElementById('modal-close');
  if (close) close.addEventListener('click', () => store.set({ showCommit: false }));
  const bg = document.getElementById('modal-bg');
  if (bg) bg.addEventListener('click', (e) => {
    if (e.target === bg) store.set({ showCommit: false });
  });
}

async function runPropose(key: string) {
  const prompt = proposalInputs.get(key) ?? '';
  const s = store.get();
  store.set({ proposing: { ...s.proposing, [key]: true } });
  try {
    const proposal = await fetchProposal(key as any, prompt);
    const s2 = store.get();
    store.set({
      proposals: { ...s2.proposals, [key]: proposal },
      proposing: { ...s2.proposing, [key]: false },
    });
  } catch (e) {
    console.error(e);
    const s2 = store.get();
    store.set({ proposing: { ...s2.proposing, [key]: false } });
  }
}
