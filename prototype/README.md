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

## Deploy to Cloudflare

You'll need a Cloudflare account and `wrangler login` once.

```
npm run build        # vite builds the SPA into dist/
npm run deploy       # builds + wrangler deploy
```

The Worker serves both the API and the SPA. After deploy, the prototype lives
at `https://translation-engine-prototype.<your-subdomain>.workers.dev` (or a
custom domain configured in `wrangler.toml`).

## Demo mode notes

- All data is synthetic — the same pet-feeder pretend-product the doctrine
  demo uses.
- No real Jira or Airtable calls are made by the Worker. The fixtures are
  baked at build time.
- The "Commit" button surfaces a confirmation modal but performs no writes.
  Wiring this to live API calls is the next product slice.

## What's deliberately deferred

- OAuth for real connections. Today the prototype demonstrates the wizard
  shape against synthetic data; live connection flows are the next slice.
- Persistence. Decisions live in memory in the SPA. A real product would
  store them per system pair so they survive sessions.
- Multi-tenancy. Single demo pair, hardcoded.
- Scheduling. The doctrine's "discrete snapshots, not continuous sync"
  principle becomes "recurring scheduled passes" in product, with each pass
  still emitting its own manifest. Not implemented here.
