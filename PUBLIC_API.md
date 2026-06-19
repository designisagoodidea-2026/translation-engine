# Translation Engine — Public API

This file names the **public surface** of the Translation Engine library: the exports that downstream consumers (currently Anchor; future: internal CoS tooling, prospect-demo forks, eventual SDK) are entitled to depend on. Anything not listed here is **internal** — refactorable without notice, never imported from outside `src/`.

The rule: if it's in this file, semver applies (see `VERSIONING.md`). If it's not, hands off.

---

## Public exports

### Adapters

Per-platform, read-mostly HTTP surfaces. Thin: no translation logic, no caching, no business rules.

**`src/adapters/jira.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `jiraFetch<T>(path, init?)` | function | Authenticated HTTP escape hatch for endpoints not yet covered by named ops. |
| `listIssues(projectKey, opts?)` | function | Paginated issue list via enhanced JQL search endpoint. |
| `getIssue(key)` | function | Single issue by key. |
| `listEpics(projectKey)` | function | Epics for a project (used by grammar for epic-key → summary resolution). |
| `getProjectId(projectKey)` | function | Resolve numeric project ID from key. |
| `adf(text)` | function | Minimal ADF document constructor for write paths. |
| `JiraIssue` | interface | `{ id, key, fields }`. `fields` is `Record<string, any>` by Jira contract. |
| `JiraSearchResponse` | interface | `{ issues, nextPageToken?, isLast? }`. |

**`src/adapters/airtable.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `airtableFetch<T>(path, init?)` | function | Authenticated HTTP escape hatch. |
| `listRecords<F>(tableId, opts?)` | function | Paginated record list. |
| `getRecord<F>(tableId, recordId)` | function | Single record. |
| `createRecord<F>(tableId, fields)` | function | Create one record. |
| `AirtableRecord<F>` | interface | `{ id, createdTime, fields }`. Generic over `F`. |
| `AirtableListResponse<F>` | interface | `{ records, offset? }`. |

**`src/adapters/asana.ts`**

Type surface only as of v0.2 — HTTP operations are stubbed pending a real Asana source need. The types match the fields the PM grammar's normalizer consumes.

| Export | Kind | Purpose |
|---|---|---|
| `AsanaTask` | interface | One Asana task record (`gid`, `name`, `notes`, `html_notes`, `assignee`, `parent`, `custom_fields`, `memberships`, `tags`, …). |
| `AsanaUser` | interface | Assignee shape (`gid`, `name`). |
| `AsanaTaskRef` | interface | Parent reference (`gid`, `name`). |
| `AsanaCustomField` | interface | Asana custom field (`enum`, `multi_enum`, `text`, `number`, `date`). |
| `AsanaMembership` | interface | Project + section pair. |
| `AsanaTag` | interface | Tag (`gid`, `name`). |

### Normalizers

Per-platform `<platform> → NormalizedIssue` translators. Grammars consume the normalized shape; adding a new source platform means writing a sibling normalizer, not touching grammars.

**`src/adapters/jira-normalize.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `normalizeJiraIssue(issue, ctx?)` | function | `JiraIssue → NormalizedIssue`. Filters Jira system custom fields; promotes sprint/fixVersions to typed slots; flattens ADF description. |
| `JiraNormalizeContext` | interface | `{ customFieldNames?: Map<string, string> }`. |
| `flattenAdf(node)` | function | ADF → plain text. Exposed because consumers occasionally need it standalone. (Moved here from `grammars/project-management.ts` in v0.2.) |

**`src/adapters/asana-normalize.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `normalizeAsanaTask(task)` | function | `AsanaTask → NormalizedIssue`. Promotes "Priority" / "Type" custom fields to typed slots; flattens `html_notes` when present. |

### Grammars

Per-context translation logic. Deterministic — regex/map-based, no LLM in the loop. One `translateIssue()` call per source record.

**`src/grammars/types.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `LossKind` | type | Five-kind loss taxonomy: `'schema' \| 'semantic' \| 'hierarchy' \| 'context' \| 'provenance'`. |
| `Resolution` | type | `'lossless' \| 'lossy' \| 'dropped' \| 'annotated'`. |
| `LossEntry` | interface | One classified translation decision. |
| `TranslationResult` | interface | Output of `translateIssue()`: destination fields + losses + lossless field list. |
| `GrammarContext` | interface | Per-pass lookup tables (currently just `parentSummaryByKey: Map<string, string>`). |
| `NormalizedIssue` | interface | Source-agnostic tracker record. Grammars consume this; per-platform normalizers in `adapters/<platform>-normalize.ts` produce it. |
| `NormalizedActor` | interface | `{ handle?, displayName }`. |
| `NormalizedSprint` | interface | `{ id?, name, state?, startDate?, endDate? }`. |
| `NormalizedFixVersion` | interface | `{ name, released?, releaseDate? }`. |
| `NormalizedCustomField` | interface | `{ name, value, sourceId? }`. |
| `Conflict` | interface | One conflict detected during a reverse pass. Both source and destination moved since the last snapshot. |
| `ReverseTranslationResult` | interface | Per-record output of a reverse-pass grammar: source-shape patch, applied/skipped field lists, conflicts. |

**`src/grammars/project-management.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `translateIssue(issue, ctx)` | function | Translate one `NormalizedIssue` to Airtable (Roadmap) fields + classified losses under the PM grammar. |
| `reverseTranslateIssue(currentDest, currentSource, snapshot)` | function | Reverse pass (Airtable → Jira). Diffs against a snapshot, produces a Jira-shape source patch, names skipped fields with reasons, and reports `Conflict[]` when both sides have moved. |
| `extractSnapshotSourceFields(issue)` | function | Pluck the source-side fields the reverse direction needs from a `NormalizedIssue`. Use at the end of a forward pass when writing a snapshot. |

**`src/grammars/design-system-ops.ts`**

Second context grammar. Same `NormalizedIssue` input contract as the PM grammar; different destination schema (Airtable Component Inventory), different semantic interpretation (status→Maturity, issueType→Type, parent→Family), different loss surface (Figma URLs, Storybook URLs, and design-token references become first-class).

| Export | Kind | Purpose |
|---|---|---|
| `translateIssue(issue, ctx)` | function | Translate one `NormalizedIssue` to Airtable (Component Inventory) fields + classified losses under the DSOps grammar. |

### Manifest

Aggregate-and-render layer. The manifest is the deliverable; destination writes are secondary.

**`src/manifest.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `buildManifest(pass, results)` | function | Aggregate many `TranslationResult`s into one forward-pass `Manifest`. |
| `buildReverseManifest(pass, entries, provenance)` | function | Aggregate many `ReverseManifestEntry`s into one reverse-pass `Manifest` (patches + conflicts sections). |
| `renderMarkdown(manifest)` | function | Markdown rendering (human-readable). Direction-aware: omits forward-only sections on reverse, omits reverse-only sections on forward. |
| `renderJson(manifest)` | function | JSON rendering (tooling sidecar). |
| `writeManifest(manifest, dir)` | function | Write both renderings to disk; returns paths. |
| `Manifest` | interface | Top-level manifest shape. `patches?` and `conflicts?` are populated on reverse passes. |
| `ManifestPass` | interface | Per-pass metadata (timestamp, source, destination, context, projectKey, dryRun, direction). |
| `ReverseManifestEntry` | interface | `ReverseTranslationResult & { sourceKey }`. Input shape to `buildReverseManifest`. |

### Snapshot

Per-pair memory that reverse passes diff against to distinguish destination-side moves from source-side moves and to detect conflicts.

**`src/snapshot.ts`**

| Export | Kind | Purpose |
|---|---|---|
| `readSnapshot(filePath)` | function | Read a `PairSnapshot` from disk. Returns `null` if the file is absent (first reverse). |
| `writeSnapshot(snapshot, filePath)` | function | Persist a snapshot. Creates the directory if needed. |
| `defaultSnapshotPath(manifestsDir, pairId)` | function | Conventional snapshot path: `<manifestsDir>/snapshots/<pairId-slug>.json`. |
| `PairSnapshot` | interface | `{ pairId, lastPass, records }`. |
| `SnapshotRecord` | interface | `{ sourceKey, destRecordId, lastSource, lastDest }`. |

---

## Internal — do NOT import from outside `src/`

Reserved as internal even though some are `export`-ed for cross-module use within TE:

- `src/lib/http.ts` — `createHttpClient`, `HttpClient`, `HttpClientOptions`. HTTP plumbing detail.
- `src/lib/config.ts` — `config`. Env-bound singleton; consumers wire their own credentials.
- `src/lib/status-match.ts` — `CanonicalStatus`, `JiraTransition`, `pickTransition`, `statusMatches`. Used by transition handling.
- `src/lib/jira-transitions.ts` — `listTransitions`, `transitionToCanonical`, `TransitionResult`. Internal write-path helper.
- `src/scripts/*` — CLI runners (`seed-jira`, `smoke-*`, `translate`, `fix-statuses`, `wipe-airtable`). Not library surface.

If a downstream consumer needs something from `lib/`, the right move is to discuss promoting it to public — not to import it as-is.

---

## Consumption — current path

Translation Engine is not yet published to a registry. Downstream consumers (Anchor first) import via **local file dependency**:

```jsonc
// In Anchor's package.json
{
  "dependencies": {
    "translation-engine": "file:../Translation Engine"
  }
}
```

Imports use the source paths directly (TypeScript-to-TypeScript across a workspace):

```ts
import { translateIssue } from 'translation-engine/src/grammars/project-management.js';
import { buildManifest, writeManifest } from 'translation-engine/src/manifest.js';
import type { JiraIssue } from 'translation-engine/src/adapters/jira.js';
```

## Consumption — intended path

Once Anchor is initialized and stable, TE will publish to npm under a scoped package (likely `@designisagoodidea-2026/translation-engine`). At that point:

- The local file dep gets swapped for a real version range.
- A package `exports` map will be added so consumers import from `translation-engine/grammars` / `translation-engine/adapters/jira` rather than reaching into `src/`.
- Semver discipline (see `VERSIONING.md`) becomes enforceable rather than aspirational.

The current file-dep arrangement is a placeholder for the package surface, not a different shape.

---

## What changes count as breaking

A breaking change is any of:

- Removing or renaming a public export listed above.
- Removing or renaming a field on a public interface.
- Tightening a parameter type (narrowing what callers can pass).
- Loosening a return type (broadening what callers must handle).
- Changing the runtime semantics of `translateIssue()` such that the same input produces a meaningfully different `TranslationResult` (different loss classification, different destination fields).

See `VERSIONING.md` for the full semver posture.
