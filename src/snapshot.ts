// Per-pair snapshot — the engine's memory of what each pair looked like at
// the last successful pass. Reverse passes use this to distinguish
// "destination side changed" from "source side changed" from "both
// changed" (the latter is a conflict).
//
// v1 is a JSON file on disk, one snapshot per system pair, written by the
// runner script. Cloudflare KV / D1 persistence is task #7; until that
// lands, the file path is the substrate.
//
// The snapshot stores both sides of every round-tripped record so reverse
// passes can compute field-level deltas on either side without re-fetching.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * One record in a pair snapshot. Stores both source-side and destination-
 * side field values as they stood at the last forward pass. Reverse
 * passes compare against `lastSource` (to detect source moves) and
 * `lastDest` (to detect destination moves).
 *
 * Field naming inside `lastSource` matches the normalized shape grammars
 * consume (e.g. `summary`, `priority`, `dueDate`); `lastDest` uses the
 * destination's field names (e.g. `Name`, `Priority`, `Due`). The
 * reverse-translate function knows how to align the two.
 */
export interface SnapshotRecord {
  sourceKey: string;
  destRecordId: string;
  lastSource: Record<string, unknown>;
  lastDest: Record<string, unknown>;
}

export interface PairSnapshot {
  /** Stable identifier for the system pair (e.g. `jira-cloud:SCRUM↔airtable:Roadmap`). */
  pairId: string;
  /** ISO timestamp of the forward pass that produced this snapshot. */
  lastPass: string;
  records: SnapshotRecord[];
}

/**
 * Read a snapshot file. Returns `null` if the file is absent (legitimate
 * first-pass case) and throws on any other read/parse error.
 */
export async function readSnapshot(filePath: string): Promise<PairSnapshot | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as PairSnapshot;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Write a snapshot file. Creates the directory if needed. Returns the
 * path written.
 */
export async function writeSnapshot(
  snapshot: PairSnapshot,
  filePath: string,
): Promise<string> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * Default snapshot path for a pair under `manifests/snapshots/<pairId>.json`.
 * Pair IDs are slugified to be filesystem-safe.
 */
export function defaultSnapshotPath(manifestsDir: string, pairId: string): string {
  const slug = pairId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return path.join(manifestsDir, 'snapshots', `${slug}.json`);
}
