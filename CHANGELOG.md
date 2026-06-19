# Changelog

All notable changes to Translation Engine's **public surface** (per `PUBLIC_API.md`) are recorded here.

This project follows the semver posture in `VERSIONING.md`. Pre-1.0, breaking changes are allowed in MINOR bumps and are called out explicitly below.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_Nothing yet._

## [0.3.0] — 2026-06-03

Bidirectional pass support — reverse direction (Airtable → Jira) with snapshot-based conflict detection. Additive on the public surface; no breaking changes.

### Added

- **Reverse-translate function** (`src/grammars/project-management.ts`): `reverseTranslateIssue(currentDest, currentSource, snapshot)`. Compares against a snapshot to distinguish dest-only moves (round-tripped as a source patch), source-only moves (skipped — next forward catches), and bilateral moves (reported as `Conflict`). Refuses non-round-trippable fields (Status, Epic, Sprint, Fix Version, Assignee) with explicit reasons in the manifest.
- **Snapshot module** (`src/snapshot.ts`): `PairSnapshot`, `SnapshotRecord`, `readSnapshot`, `writeSnapshot`, `defaultSnapshotPath`. JSON-on-disk for v0.3; KV/D1 persistence is a Phase C concern.
- **Reverse types** (`src/grammars/types.ts`): `Conflict`, `ReverseTranslationResult`.
- **Reverse manifest builder** (`src/manifest.ts`): `buildReverseManifest(pass, entries, provenance)`, `ReverseManifestEntry`. The forward `Manifest` interface gains optional `patches?` and `conflicts?` fields; `ManifestPass.direction` discriminates forward vs reverse rendering.
- **Helper** (`src/grammars/project-management.ts`): `extractSnapshotSourceFields(issue)` for forward-pass-to-snapshot wiring.
- npm script `translate:reverse` plus synthetic bidirectional fixture (`demo/fixtures/scrum-bidirectional.json`) covering all four delta states (no-change, dest-only, source-only, conflict).

### Changed

- **`buildManifest` return** now sets `pass.direction = 'forward'` when not provided, so older callers automatically discriminate correctly.
- **Markdown rendering** is direction-aware: reverse passes emit `Reverse-pass patches`, `Reverse-pass skipped fields`, and `Conflicts` sections; forward passes emit `Lossless mappings` and `Losses by kind`. The provenance table renames its header to `Source Key` / `Destination Record ID` (cosmetic).

### Notes

- Live Airtable → Jira write path is deferred to Phase C (task #8, OAuth). The reverse runner emits manifests against fixtures only; no source-side writes are performed.
- Conflict resolution is intentionally not automated. The manifest's `Conflicts` section names the three values (snapshot, source-now, dest-now) and leaves the resolution choice to a downstream tool or a human.

## [0.2.0] — 2026-06-03

Source-platform normalization layer + second grammar + second source platform. Breaks the v0.1 `translateIssue` signature.

### Added

- **Normalized source contract** (`src/grammars/types.ts`): `NormalizedIssue` and supporting types (`NormalizedActor`, `NormalizedSprint`, `NormalizedFixVersion`, `NormalizedCustomField`). Source-agnostic representation grammars consume.
- **Jira normalizer** (`src/adapters/jira-normalize.ts`): `normalizeJiraIssue`, `JiraNormalizeContext`. Filters Jira system custom fields; promotes Sprint and fixVersions to typed slots; flattens ADF.
- **Asana adapter type surface** (`src/adapters/asana.ts`): `AsanaTask`, `AsanaUser`, `AsanaTaskRef`, `AsanaCustomField`, `AsanaMembership`, `AsanaTag`. HTTP ops deferred until a real Asana source is needed.
- **Asana normalizer** (`src/adapters/asana-normalize.ts`): `normalizeAsanaTask`. Promotes "Priority" / "Type" custom fields to typed slots; flattens `html_notes`.
- **Design-system-ops grammar** (`src/grammars/design-system-ops.ts`): second context grammar. Same `NormalizedIssue` input; different destination (Component Inventory); first-class Figma URL, Storybook URL, and design-token loss surfaces.
- Synthetic fixtures in `demo/fixtures/` for the new (source × grammar) combinations: `dsops-jira-issues.json`, `asana-pm-tasks.json`.
- npm scripts `translate:from-fixture`, `translate:dsops`, `translate:asana-pm`.

### Changed

- **`translateIssue` input type** is now `NormalizedIssue`, not `JiraIssue`. Callers normalize first via `normalizeJiraIssue` (or `normalizeAsanaTask`, etc.) and pass the result to the grammar.
- **`GrammarContext.epicSummaryByKey`** renamed to **`parentSummaryByKey`**. Same `Map<string, string>` type; both PM (Epic) and DSOps (Family) parent lookups go through this field.
- **`GrammarContext.customFieldNames`** removed. That responsibility moved into the normalizer (`JiraNormalizeContext.customFieldNames`) since custom-field display names are source-specific.
- **Destination field `"Jira Key"` renamed to `"Source Key"`** in PM grammar output. Same value (the source-side stable identifier); the field name no longer implies a specific source platform. Downstream Airtable bases need a `Source Key` field (the `Jira Key` field can stay alongside or be removed).
- **`flattenAdf`** moved from `src/grammars/project-management.ts` to `src/adapters/jira-normalize.ts`. Still exported; consumers update their import path.

### Migration

For downstream consumers (Anchor first):

```ts
// v0.1
import { translateIssue } from 'translation-engine/src/grammars/project-management.js';
const result = translateIssue(jiraIssue, { epicSummaryByKey, customFieldNames });

// v0.2
import { normalizeJiraIssue } from 'translation-engine/src/adapters/jira-normalize.js';
import { translateIssue } from 'translation-engine/src/grammars/project-management.js';
const normalized = normalizeJiraIssue(jiraIssue, { customFieldNames });
const result = translateIssue(normalized, { parentSummaryByKey });
```

The `result.airtableFields` map gains `Source Key` and loses `Jira Key`. The `result.jiraKey` top-level field is preserved (still the source-side stable identifier — rename to `sourceKey` deferred to v0.3 so consumers can stage the migration).

### Notes

- Web prototype updated in-place to use the normalizer; no behavioral change to the demo loop.
- Static doctrine demo (`/demo/index.html`) updated to name the second grammar.

## [0.1.0] — 2026-06-02

Initial public release. Slice 1 of the translation doctrine, attributed under Jason Armstrong via `designisagoodidea-2026`.

### Added

- **Jira adapter** (`src/adapters/jira.ts`): `jiraFetch`, `listIssues`, `getIssue`, `listEpics`, `getProjectId`, `adf`, plus `JiraIssue` and `JiraSearchResponse` types.
- **Airtable adapter** (`src/adapters/airtable.ts`): `airtableFetch`, `listRecords`, `getRecord`, `createRecord`, plus `AirtableRecord<F>` and `AirtableListResponse<F>` types.
- **Project-management grammar** (`src/grammars/project-management.ts`): `translateIssue`, `flattenAdf`. Deterministic, regex/map-based loss classification per the five-kind taxonomy. Pet-feeder synthetic fixtures.
- **Shared grammar types** (`src/grammars/types.ts`): `LossKind`, `Resolution`, `LossEntry`, `TranslationResult`, `GrammarContext`.
- **Manifest builder** (`src/manifest.ts`): `buildManifest`, `renderMarkdown`, `renderJson`, `writeManifest`, plus `Manifest` and `ManifestPass` shapes. Manifest-as-deliverable; destination writes are secondary.
- **Static doctrine demo** under `demo/` (deployed to GitHub Pages).
- **Web prototype** under `prototype/` (deployed to Cloudflare Workers): issue-centric split view, per-decision overlay, stubbed AI proposal endpoint.

### Notes

- This release predates the public-API and versioning docs (added 2026-06-03 as part of the Anchor-composition alignment). The exports above retroactively define the 0.1.0 public surface; any future change to that surface follows `VERSIONING.md`.
- Internal modules (`src/lib/*`, `src/scripts/*`) are not part of the public surface and may change without a release entry.
