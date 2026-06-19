# Translation Engine — Versioning

Semver, applied to the public surface defined in `PUBLIC_API.md`. Anything not in that file is internal and exempt.

## Semver mapping

- **MAJOR** — any change in the "What changes count as breaking" section of `PUBLIC_API.md`. Removed exports, renamed fields, narrowed parameters, broadened returns, or changed translation semantics that produce different `TranslationResult`s for the same input.
- **MINOR** — new public exports; new optional fields on public interfaces; new grammars or adapters; new manifest sections that are additive.
- **PATCH** — bug fixes, doc-only changes, internal refactors that don't touch `PUBLIC_API.md`, performance work that preserves observable behavior.

## Current state

- Version: `0.3.0` (per `package.json`).
- Pre-1.0 posture: breaking changes are allowed in MINOR bumps while the surface stabilizes against real downstream use (Anchor). Once Anchor pins TE and the surface holds across a Cowork + Figma adapter pass, cut `1.0.0` and the rules above harden.
- The 0.x freedom is not a license to churn — each break still gets a `CHANGELOG.md` entry and a heads-up to Anchor before merging.

## Downstream pinning expectation

- **Anchor** pins TE to a minor version (e.g. `^0.1.0` under 0.x; `^1.2.0` post-1.0). It does not pin to `*` or a git SHA.
- Other downstream consumers (future internal CoS tooling, prospect demo forks, eventual SDK) follow the same rule.

## Breaking-change protocol

When a public-surface change is needed:

1. **Open the change here first.** TE owns the decision. Don't fork inside Anchor.
2. **Write the change up.** A short note in `CHANGELOG.md` naming: what broke, why, the migration path.
3. **Coordinate the version bump.** Anchor moves its pin in a dedicated commit, separate from feature work, so the upgrade is auditable.
4. **Cut the release.** Local file dep today; npm publish once that path is live (see `PUBLIC_API.md` — Consumption).

## What stays internal

`src/lib/*`, `src/scripts/*`, and any helper not listed in `PUBLIC_API.md` is internal. Internal modules can change in any direction in any release. If a downstream consumer reaches into internals, that's a signal to promote the symbol to public — not to freeze the internal.

## Doctrine vs. code

The translation **doctrine** (five-kind loss taxonomy, loss-manifest-as-deliverable, deterministic-grammar rule) is conceptual IP, not versioned code. Doctrine evolution is documented in CoS memory and reflected in TE only when it changes the public surface or the manifest schema. A doctrine refinement that doesn't move code is not a TE release.
