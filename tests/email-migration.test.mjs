import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261011000000_email.sql', import.meta.url), 'utf8');

test('customers keep an email, a marketing consent and an unsubscribe time', () => {
  for (const c of ['email', 'email_marketing_consent', 'email_unsubscribed_at']) assert.match(sql, new RegExp('add column if not exists ' + c + '\\b'), c);
});
test('an email log records every email sent, for admins only', () => {
  assert.match(sql, /create table if not exists public\.email_log/);
  for (const c of ['lead_id', 'to_email', 'template', 'status', 'provider_id', 'error']) assert.match(sql, new RegExp('\\b' + c + '\\b'), c);
  assert.match(sql, /alter table public\.email_log enable row level security/);
  assert.match(sql, /email_log_admin_read[\s\S]*is_admin\(\)/);
  assert.doesNotMatch(sql, /to anon/);
});
test('the email address format is checked in the database too', () => assert.match(sql, /check \(email ~\*/));
test('migration is repeatable', () => {
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
  assert.doesNotMatch(sql, /create index (?!if not exists)/);
  assert.match(sql, /drop policy if exists email_log_admin_read/);
});
