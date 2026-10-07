import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261009000000_customers_mechanics.sql', import.meta.url), 'utf8');

test('customers can be blocked and carry notes', () => {
  for (const c of ['blocked', 'blocked_reason', 'notes']) assert.match(sql, new RegExp('add column if not exists ' + c + '\\b'), c);
});
test('mechanics table exists with row level security on', () => {
  assert.match(sql, /create table if not exists public\.mechanics/);
  assert.match(sql, /alter table public\.mechanics enable row level security/);
});
test('only owners can change mechanics, any admin can read them', () => {
  assert.match(sql, /mechanics_admin_read[\s\S]*is_admin\(\)/);
  assert.match(sql, /mechanics_owner_write[\s\S]*is_owner\(\)[\s\S]*with check \(public\.is_owner\(\)\)/);
});
test('payout rate defaults to zero so no pay rate is assumed', () => assert.match(sql, /payout_rate integer not null default 0/));
test('leads can be assigned to a mechanic', () => assert.match(sql, /add column if not exists mechanic_id uuid references public\.mechanics/));
test('migration is repeatable', () => {
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
  assert.doesNotMatch(sql, /create policy (?!.*\n)/);
  assert.match(sql, /drop policy if exists mechanics_admin_read/);
});
