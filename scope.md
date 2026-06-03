# Translation Engine — POC scope

## What this is

A library-based, extensible **schema-translation engine** for heterogeneous design + cross-functional tracking systems. Given a source system + destination system + context, produce a translation pass that names schema losses, semantic losses, hierarchy losses, context losses, and provenance losses — and either resolves them automatically (lossless) or surfaces them for human review (lossy).

Grounded in the translation doctrine (see `REFERENCES.md` → translation doctrine):

- **Four diagnostic questions:** why translating, what's being translated, source-side context, destination-side goal.
- **Five-kind loss taxonomy:** schema, semantic, hierarchy, context, provenance.
- **Per-context translation grammars:** project management, design system operations, roadmapping/prioritization, critique rituals — opinionated per context, not generic-across-all.

## Slice 1 — Jira → Airtable, project management context

Smallest pattern-proving slice. Target ship: end of week, 2026-06-05.

### System pair

- **Source:** Jira Cloud (Free tier). Site: `designisagoodidea.atlassian.net`. Project key: `SCRUM`.
- **Destination:** Airtable. Synthetic "Roadmap" base seeded for the demo.
- **Direction:** Jira → Airtable, one-way first. Bidirectional after pattern stabilizes (v0.2+).

### Schema scope (in)

- Summary (title)
- Description
- Status
- Priority
- Assignee
- Parent epic (epic-link)
- Labels
- Due date
- Sprint
- Fix version
- 1-2 custom fields (TBD based on what Jira ships with on Free)

### Schema scope (out)

- Attachments
- Comments
- Sub-tasks (children)
- Links (blocked-by, relates-to, etc.)

Excluded for slice 1 to keep the loss surface tractable. Each could become its own slice later.

### Loss surface (the substance)

The whole point of the POC is that this list is interesting:

- **Semantic loss:** Jira's `Highest/High/Medium/Low/Lowest` priority enum vs. Airtable's free-form `Priority` field.
- **Semantic loss:** Jira's status workflow with custom statuses + transitions vs. Airtable's single-select status (no transition semantics).
- **Hierarchy loss:** Jira's epic-link + sprint hierarchy vs. Airtable's flat-record model.
- **Schema loss:** Jira's custom field metadata vs. no corresponding destination concept.
- **Provenance loss:** Jira issue keys (e.g. `SCRUM-123`) vs. Airtable record IDs (`rec...`). The translation manifest must preserve the bidirectional mapping.
- **Context loss:** Slack-thread-as-spec linked in Jira description vs. nothing in Airtable. (Surfaces only if the synthetic data includes linked context.)

### Output

A per-pass **translation manifest** in `manifests/` as a markdown file. The manifest names:

- What was lossless (mapped 1:1).
- What was lossy (mapped with semantic distance — and the distance is named).
- What was dropped (no destination concept exists — and why).
- What was annotated (loss flagged for human review).
- The bidirectional ID mapping (Jira key ↔ Airtable record ID).

The destination-system write is secondary; the manifest is the deliverable.

## What this POC is NOT

- **Not a sync integration.** Discrete, manifest-producing passes. No webhooks, no continuous mirroring.
- **Not a generic schema translator.** Per-context grammars are opinionated.
- **Not a Linear, Asana, or Notion adapter.** Jira-first because it has the richest schema (best loss surface) and the strongest prospect-facing signal. Asana is the fallback if Jira setup stalls; Linear was explicitly ruled out as too clean.

## Open scoping questions (resolve in Day 1 build)

1. **Public artifact form:** standalone HTML demo on GitHub Pages, or hosted on Cloudflare Workers (reuses cos-server infra)? Lean: HTML on GitHub Pages — simpler, no auth, lower risk.
2. **Manifest output format:** markdown only, or markdown + JSON sidecar? Lean: both — markdown for humans, JSON for downstream tooling.
3. **First context published:** PM only first, or PM + design-system-ops? Lean: PM only. Ship narrow, expand after.

## Build plan (this week)

- **Tue 6/2** *(today)*: Project scaffolding stood up. Jira instance live + seeded. Adapters started.
- **Wed 6/3**: Project-management grammar v1. First translation pass on synthetic data; manifest output validates.
- **Thu 6/4**: HTML demo surface. Iterate on real synthetic data.
- **Fri 6/5**: Public ship via GitHub Pages. README. LinkedIn post drafted (not posted — Jason's call).

## Future slices (parking lot)

- **Slice 2:** bidirectional (Jira ↔ Airtable). Resolve conflict semantics.
- **Slice 3:** second context (design-system-ops). Same adapters, new grammar.
- **Slice 4:** third platform pair (e.g. Asana → Notion, PM context). Proves the library shape.
- **v0.2:** webhooks for near-real-time. Cloudflare Workers host.
