# Translation Engine

> Schema translation for heterogeneous tracking systems used in design and
> cross-functional work. Every pass produces a manifest naming what was
> preserved, what was lost, and how.

**Live demo:** [`demo/index.html`](demo/index.html) — or visit the [GitHub Pages site](https://designisagoodidea.github.io/translation-engine/demo/) once it's live.

**Status:** Slice 1 — Jira → Airtable, project management context.

## What this is

Most teams run multiple trackers — Jira for engineering, Airtable for
roadmap, Notion for OKRs, Figma comments for design critique. Keeping work
in sync between them typically results in some kind of loss in data
quality. Priorities mean different things in different systems.
Hierarchies flatten. Custom fields evaporate. Context lives in one place
and is invisible in the next.

Most attempts to bridge these systems either pretend the loss isn't
happening or hide it behind one-off engineering work that papers over the
gap. Translation Engine takes a different approach: it names the loss
explicitly, the same way every time, and ships that naming as the
deliverable. The destination write is secondary; the artifact is a record
of what survived translation, what didn't, and why.

## The doctrine

Every translation decision lands in one of five buckets:

- **Schema** — a data field in one system has no clear equivalent in the
  other.
- **Semantic** — names match across systems, but behavior doesn't.
- **Hierarchy** — parent-child or membership relationships flatten in
  transit.
- **Context** — the substantive spec lives outside the source (e.g. a
  Slack thread linked from a Jira description), and the link travels but
  the content does not.
- **Provenance** — source-side identity (Jira keys, account IDs) is
  preserved through a bidirectional mapping inside the manifest itself.

See the [live demo](demo/index.html) for the full taxonomy with worked
examples and one Jira issue translated end to end.

## The pattern

Two composable layers carry the work, and the file-system shape matches
one-to-one:

- **Per-platform adapters** (`src/adapters/`) — typed clients for each
  system. Auth, HTTP plumbing, env access, and error formatting live in
  shared `src/lib/` modules, so adding a new platform is one adapter file
  with zero new plumbing.
- **Per-context grammars** (`src/grammars/`) — opinionated translation
  rules for one work-context. Adding a new context (design system
  operations, critique rituals, roadmapping) is one grammar file.

Every pass is a discrete snapshot, not a continuous sync. The manifest is
the deliverable; the destination write is secondary. That order forces
every translation decision to be named before it's executed.

## Running locally

You'll need a Jira Cloud instance and an Airtable workspace. Node 20 or
later. Copy `.env.example` to `.env` and fill in credentials (see
`KICKOFF.md` for setup detail, including the Airtable schema and the Jira
custom-field manual step).

```
npm install
npm run smoke:jira              # confirm Jira auth
npm run smoke:airtable          # confirm Airtable auth
npm run seed:jira               # synthetic seed data for the demo
npm run fix:statuses            # one-off, only if your project workflow
                                # uses non-canonical status names
npm run translate -- --dry-run  # manifest only, no destination writes
npm run translate               # write to Airtable + manifest
npm run wipe:airtable -- --yes  # clear the destination table between
                                # iteration runs
```

Per-pass manifests land in `manifests/` (gitignored by default). A
representative example is embedded in the demo page.

## Repo layout

```
src/
  adapters/                # per-platform clients (jira.ts, airtable.ts)
  grammars/
    project-management.ts  # the translation grammar
    types.ts               # five-kind loss taxonomy + result shape
  lib/                     # shared plumbing
    http.ts                # HTTP client factory
    config.ts              # env access (single dotenv load)
    status-match.ts        # canonical-status fuzzy matcher
    jira-transitions.ts    # fetch + pick + apply
  scripts/                 # smoke tests, seeder, translator, wiper
  manifest.ts              # manifest builder + markdown/JSON renderer
demo/
  index.html               # self-contained demo page (GitHub Pages target)
manifests/                 # per-pass output (gitignored)
```

## What this isn't

- **Not a sync product.** Each pass is a snapshot. No webhooks, no
  continuous mirroring.
- **Not a generic schema translator.** Per-context grammars are
  opinionated by design. Adding a new context is a deliberate scoping
  pass, not configuration.
- **Not a hosted service.** A TypeScript library plus a self-contained
  demo. Run it against your own systems.

## License

MIT.

## Attribution

Built by Jason Armstrong as a proof point for the translation doctrine —
a portable pattern for design and cross-functional operations work where
heterogeneous tracking systems need to be reconciled.
