import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

const sql = ['20261007000000_lead_details.sql', '20261008000000_lead_location.sql', '20261011000000_email.sql', '20261013000000_ikea.sql', '20261015000000_preferred_time.sql'].map((f) => readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');

test('migration adds a column for every field the validator returns', () => {
  for (const key of Object.keys(cleanLeadFields({}))) {
    assert.match(sql, new RegExp('add column if not exists ' + key + '\\b'), 'missing column ' + key);
  }
});
test('migration is idempotent (only "if not exists" forms)', () => {
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
  assert.doesNotMatch(sql, /create index (?!if not exists)/);
});
test('migration does not weaken row level security', () => {
  assert.doesNotMatch(sql, /disable row level security/i);
});
