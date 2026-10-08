import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('only the owner can delete bookings, and the change is safe to repeat', () => {
  const sql = read('../supabase/migrations/20261020000000_delete_bookings.sql');
  assert.match(sql, /drop policy if exists leads_owner_delete/); assert.match(sql, /create policy leads_owner_delete on public\.leads for delete to authenticated using \(public\.is_owner\(\)\)/);
  assert.doesNotMatch(sql, /to anon/);
});
test('admin can delete one booking from its sheet, with a confirmation and an activity record', () => {
  const a = read('../admin/admin.js');
  assert.match(a, /data-act="deleteLead"/); assert.match(a, /from\('leads'\)\.delete\(\)/); assert.match(a, /booking_deleted/);
  assert.match(a, /isOwner\(\)[^;]*deleteLead|deleteLead[^;]*isOwner\(\)/);
});
test('admin can select several bookings and delete them together', () => {
  const a = read('../admin/admin.js');
  for (const act of ['selectMode', 'selectAll', 'deleteSelected', 'selectDone']) assert.ok(a.includes(act), act);
  assert.match(a, /\.in\('id'/);
  assert.match(a, /confirm\(`Delete \$\{/);
});
