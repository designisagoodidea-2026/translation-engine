# Translation Engine — prototype

Web prototype demonstrating the **analyze → decide → preview → commit** trust loop. This is the productization sketch sitting on top of the doctrine that the static demo at `/demo` introduces.

Where `/demo` ships the doctrine as a public-facing artifact, `/prototype` shows what a connected, opinionated wizard looks like — the surface that takes the pattern out of the library and into a thing a non-engineer could use.

## What's here

```
prototype/
  index.html              # Vite entry (loads src/main.ts)
  src/                    # SPA — vanilla TS + DOM, tiny Store class
    main.ts               # entry + render loop
    state.ts              # reactive store
    api.ts                # fetch wrappers
    dom.ts                # h() + esc() helpers
    types.ts              # shared shapes
    styles.css            # all styling, no external font/asset loads
  worker/                 # Cloudflare Worker
    index.ts              # /api/state + /api/preview, falls through to assets
    fixtures.ts           # baked SCRUM source + grammar context
    decisions.ts          # post-grammar overlay (the user-decidable surface)
  wrangler.toml           # Cloudflare deploy config
  vite.config.ts          # SPA build config (proxies /api to Worker in dev)
  package.json            # own deps (separate from the library)
```

## How it works

The Worker imports the existing translation grammar at
`../src/grammars/project-management.ts`. Each request to `/api/state` runs the
grammar against baked source fixtures and returns the baseline translation
plus the decision catalog. `/api/preview` accepts a `UserDecisions` body and
returns the enhanced result — the same baseline with `decisions.ts` applied as
a post-processing pass.

This keeps the grammar pure and opinionated (the doctrine stays intact) while
exposing a product surface for the small set of choices the grammar
deliberately cedes to the user — Slack context handling, epic display mode,
and Customer Segment destination.

## Run locally

```
cd prototype
npm install
npm run dev:worker   # Cloudflare Worker on :8787
# new terminal:
npm run dev:app      # Vite SPA on :5173 (proxies /api → :8787)
```

Open `http://localhost:5173`.

### Enabling real-model proposals locally

`/api/propose` calls Anthropic's Messages API when `ANTHROPIC_API_KEY` is
bound. With no key, it falls back to a deterministic keyword stub (the
`isStub: true` flag in responses signals which path ran). To wire the real
model in local dev:

```
cd prototype
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste your key after ANTHROPIC_API_KEY=
npm run dev:worker   # wrangler picks up .dev.vars automatically
```

`.dev.vars` is gitignored. For production, see the deploy section below.

## Deploy to Cloudflare

You'll need a Cloudflare account and `wrangler login` once.

```
npm run build        # vite builds the SPA into dist/
npm run deploy       # builds + wrangler deploy
```

The Worker serves both the API and the SPA. After deploy, the prototype lives
at `https://translation-engine-prototype.<your-subdomain>.workers.dev` (or a
custom domain configured in `wrangler.toml`).

To enable real-model proposals in production, bind the Anthropic key as a
Wrangler secret once per environment:

```
wrangler secret put ANTHROPIC_API_KEY
# paste the key when prompted
```

Without the secret, `/api/propose` still works — it returns the keyword stub.

### Decision persistence (Cloudflare KV)

User decisions (Slack handling, Epic display mode, Customer Segment
destination) are persisted per system pair via a KV namespace. To enable
in production:

```
cd prototype
wrangler kv namespace create DECISIONS_KV
# wrangler returns an `id` — paste it into wrangler.toml under the
# kv_namespaces block (uncomment the block first).
npm run deploy
```

Without the binding, `/api/decisions` GET returns defaults and PUT is a
no-op. The SPA continues to work; choices simply do not survive across
Worker invocations. Local `wrangler dev` provides emulated KV persistence
backed by a local SQLite file, so decisions persist within a dev session
even without a production namespace.

## Demo mode notes

- All data is synthetic — the same pet-feeder pretend-product the doctrine
  demo uses.
- No real Jira or Airtable calls are made by the Worker. The fixtures are
  baked at build time.
- The "Commit" button surfaces a confirmation modal but performs no writes.
  Wiring this to live API calls is the next product slice.

### Webhooks (near-real-time triggers)

Both Jira and Airtable can POST to a public URL when source-side records
change. The Worker exposes signed receive endpoints that verify the HMAC
on each payload and trigger a pass for the addressed pair.

```
POST /api/webhooks/jira/<pairId>      # X-Hub-Signature: sha256=<hex>
POST /api/webhooks/airtable/<pairId>  # X-Airtable-Content-Mac: hmac-sha256=<hex>
```

Configure signing secrets once per environment:

```
wrangler secret put JIRA_WEBHOOK_SECRET
wrangler secret put AIRTABLE_WEBHOOK_SECRET
```

Without the secret, the corresponding endpoint returns 503 (the deploy
is signaling that webhook receiving is disabled). With the secret but
no signature header, it returns 401. With a valid signature, the Worker
records a `ScheduleRun` against the addressed pair and (today) returns
ok — the actual data-fetch + diff path is downstream of the
connection-aware live pass that lands after OAuth ships end-to-end.

Doctrine note: webhooks shorten the discrete-snapshot cadence to
near-real-time but do *not* turn the engine into a continuous syncer.
Every webhook still produces a discrete pass with its own manifest.

### Scheduling (recurring passes)

Each pair can carry a `frequency` (`hourly` / `daily` / `weekly` /
`manual`) that controls whether the Worker's `scheduled()` handler runs
a forward pass for it on each cron tick. The cron itself is declared in
`wrangler.toml`'s `[triggers]` block (hourly by default).

```
GET    /api/schedules                 # list all stored schedules
GET    /api/schedules/<pairId>        # one pair's schedule
PUT    /api/schedules/<pairId>        # { "frequency": "hourly|daily|weekly|manual" }
POST   /api/schedules/run?pairId=...  # operator-driven manual run (no waiting)
GET    /api/schedule-runs?pairId=...  # recent run history (newest first)
```

Each cron tick records a `ScheduleRun` to KV so the run history is
auditable. The doctrine principle holds: every scheduled tick produces
a discrete-snapshot pass, not a continuous sync — webhook-driven
near-real-time is a separate substrate (next slice).

To enable scheduling in production, uncomment the `[triggers]` block in
`wrangler.toml` and redeploy. Without cron triggers, schedules can still
be set via the API and run manually via `POST /api/schedules/run`.

### Pairs (multi-pair routing)

Every stateful endpoint accepts `?pairId=` to scope its read/write to one
system pair. Omitted, the seed pair (the hardcoded `jira-airtable-pm`
demo) is the default. Decisions, connections, and snapshots are already
KV-keyed per pair, so multi-pair is just CRUD + routing on top.

```
GET    /api/pairs                  # list seed + stored pairs
GET    /api/pairs/<pairId>         # one pair
POST   /api/pairs                  # create — body matches PairRecord
DELETE /api/pairs/<pairId>         # remove (seed pair is protected)
```

Only the seed pair currently serves baked fixtures. New pairs return
empty state from `/api/state?pairId=<id>` until live-data wiring lands
on top of OAuth connections.

### Connections (Jira / Airtable)

`GET /api/connections` reports per-platform connection status. `PUT
/api/connections/<platform>` accepts a `pat` payload, validates against
the platform's identity endpoint, and stores the credentials under
`DECISIONS_KV` (same namespace as decision persistence; different key
prefix).

Manual paste path — works today, no app registration needed:

```
# Jira
curl -X PUT https://your-worker/api/connections/jira \
  -H 'content-type: application/json' \
  -d '{
    "kind": "pat",
    "credentials": {
      "email": "you@example.com",
      "apiToken": "ATATT3xFfGF0…",
      "siteUrl": "https://your-domain.atlassian.net"
    }
  }'

# Airtable
curl -X PUT https://your-worker/api/connections/airtable \
  -H 'content-type: application/json' \
  -d '{
    "kind": "pat",
    "credentials": { "apiToken": "patXXXXXXXXXXXXXX.YYYYYYYYYYYYYYY" }
  }'
```

OAuth callback handlers are scaffolded at `/api/auth/<platform>/callback`
but return 501 until an Atlassian + Airtable OAuth app is registered for
this Worker's redirect URI and `client_id` / `client_secret` are set as
Wrangler secrets. The connection storage shape is already OAuth-ready
(see `kind: 'oauth'` in `worker/connections.ts`).

## What's deliberately deferred

- OAuth callback handlers — scaffolded as 501-stubs; finishing them
  requires registering Atlassian + Airtable OAuth apps and wiring the
  token exchange. The connection-storage shape is OAuth-ready.
- Live data path. Stored connections are not yet read by `runBaseline` —
  the Worker still serves baked fixtures. Wiring connections into the
  live forward / reverse passes is the next slice once OAuth is in.
- Multi-tenancy. Single demo pair, hardcoded.
- Scheduling. The doctrine's "discrete snapshots, not continuous sync"
  principle becomes "recurring scheduled passes" in product, with each pass
  still emitting its own manifest. Not implemented here.

(`/api/propose` was on this list at ship time. It is now wired to Anthropic
when `ANTHROPIC_API_KEY` is bound and falls back to the keyword stub
otherwise — see the local dev and deploy sections above.)
