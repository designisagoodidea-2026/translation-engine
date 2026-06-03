// Centralized env access. Loads .env once via dotenv at import; throws fast
// on missing keys. Everything else in the codebase imports `config` instead of
// touching process.env directly — keeps env handling deterministic and
// auditable in one place.

import 'dotenv/config';

function get(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key} in .env`);
  return v;
}

export const config = {
  get jira() {
    return {
      siteUrl: get('JIRA_SITE_URL'),
      email: get('JIRA_EMAIL'),
      apiToken: get('JIRA_API_TOKEN'),
      projectKey: get('JIRA_PROJECT_KEY'),
    };
  },
  get airtable() {
    return {
      apiToken: get('AIRTABLE_API_TOKEN'),
      baseId: get('AIRTABLE_BASE_ID'),
      tableId: get('AIRTABLE_TABLE_ID'),
    };
  },
};
