# Manifests

Per-pass translation manifests land here.

Each translation pass writes two files:

- `<timestamp>-<source>-to-<destination>.md` — human-readable manifest.
- `<timestamp>-<source>-to-<destination>.json` — JSON sidecar for downstream tooling.

The manifest is the deliverable. The destination-system write is secondary.

Per `.gitignore`, the manifest files themselves are not committed by default — only this README and `.gitkeep`. If you want a representative manifest in the public artifact, copy it into `demo/` and reference it from there.
