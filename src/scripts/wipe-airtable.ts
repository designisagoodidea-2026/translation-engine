// Iteration helper. Deletes every record in the destination Airtable table
// so repeated `npm run translate` runs don't accumulate duplicates.
//
// Dry by default. Re-run with `--yes` to actually delete.
//
// Usage:
//   npm run wipe:airtable          # report what would be deleted
//   npm run wipe:airtable -- --yes # actually delete

import { config } from '../lib/config.js';
import { airtableFetch, listRecords } from '../adapters/airtable.js';

const YES = process.argv.includes('--yes');

const tableId = config.airtable.tableId;
const baseId = config.airtable.baseId;

console.log(`[wipe] reading records from table ${tableId}…`);

const ids: string[] = [];
let offset: string | undefined;
do {
  const page = await listRecords(tableId, { pageSize: 100, offset });
  for (const r of page.records ?? []) ids.push(r.id);
  offset = page.offset;
} while (offset);

if (ids.length === 0) {
  console.log('[wipe] table is empty — nothing to do.');
  process.exit(0);
}

console.log(`[wipe] found ${ids.length} record(s).`);

if (!YES) {
  console.log('[wipe] dry run. Re-run with `-- --yes` to delete them.');
  process.exit(0);
}

// Airtable allows deleting up to 10 records per call via repeated `records[]=`.
let deleted = 0;
for (let i = 0; i < ids.length; i += 10) {
  const batch = ids.slice(i, i + 10);
  const qs = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join('&');
  await airtableFetch(`/${baseId}/${tableId}?${qs}`, { method: 'DELETE' });
  deleted += batch.length;
  console.log(`  deleted ${deleted}/${ids.length}`);
}

console.log('[wipe] done.');
