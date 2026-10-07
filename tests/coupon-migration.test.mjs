import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261010000000_coupons.sql', import.meta.url), 'utf8');

test('coupons table has the fields the rules need', () => {
  assert.match(sql, /create table if not exists public\.coupons/);
  for (const c of ['code', 'kind', 'value', 'min_amount', 'active', 'starts_on', 'ends_on', 'max_uses']) assert.match(sql, new RegExp('\\b' + c + '\\b'), c);
  assert.match(sql, /code\s+text not null unique/);
  assert.match(sql, /kind\s+text not null check \(kind in \('percent','flat'\)\)/);
});
test('coupons are private: row level security on, admins read, only owners write, nothing for the public', () => {
  assert.match(sql, /alter table public\.coupons enable row level security/);
  assert.match(sql, /coupons_admin_read[\s\S]*is_admin\(\)/);
  assert.match(sql, /coupons_owner_write[\s\S]*is_owner\(\)[\s\S]*with check \(public\.is_owner\(\)\)/);
  assert.doesNotMatch(sql, /to anon/);
});
test('leads record the coupon code and the discount worked out on the server', () => {
  assert.match(sql, /add column if not exists coupon_code text/);
  assert.match(sql, /add column if not exists coupon_discount integer not null default 0/);
});
test('migration is repeatable', () => {
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
  assert.match(sql, /drop policy if exists coupons_admin_read/);
});
