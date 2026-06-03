// Airtable smoke test — confirms PAT + base/table IDs work.
// Usage: npm run smoke:airtable

import { config } from '../lib/config.js';
import { listRecords } from '../adapters/airtable.js';

const tableId = config.airtable.tableId;

const result = await listRecords(tableId, { maxRecords: 5 });
const records = result.records ?? [];

if (records.length === 0) {
  console.log(`[airtable] auth OK. Table ${tableId} is empty (expected on Day 1).`);
} else {
  console.log(`[airtable] auth OK. First ${records.length} record(s):`);
  for (const r of records) {
    const name = (r.fields as any).Name ?? '(no Name field)';
    console.log(`  ${r.id}  ${name}`);
  }
}
