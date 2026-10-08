import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the owner can delete a customer, a mechanic, a coupon or an issue, each with a confirmation and an activity record', () => {
  const a = read('../admin/admin.js');
  for (const act of ['deleteCustomer', 'deleteMechanic', 'deleteCoupon', 'deleteIssue']) assert.ok(a.includes(`data-act="${act}"`), act + ' button');
  for (const t of ['customers', 'mechanics', 'coupons', 'issues']) assert.match(a, new RegExp(`from\\('${t}'\\)\\.delete\\(\\)`), t);
  for (const ev of ['customer_deleted', 'mechanic_deleted', 'coupon_deleted', 'issue_deleted']) assert.ok(a.includes(ev), ev);
  assert.match(a, /confirm\(`Delete \$\{/);
});
test('deleting a customer asks whether their bookings go too, and bookings are deleted first', () => {
  const a = read('../admin/admin.js');
  const fn = a.slice(a.indexOf('async deleteCustomer()'), a.indexOf('async deleteMechanic()'));
  assert.match(fn, /Also delete their/); assert.ok(fn.indexOf("from('leads').delete()") < fn.indexOf("from('customers').delete()"));
});
test('only the owner can delete customers and issues in the database too', () => {
  const sql = read('../supabase/migrations/20261024000000_owner_deletes.sql');
  assert.match(sql, /create policy customers_owner_delete on public\.customers for delete to authenticated using \(public\.is_owner\(\)\)/);
  assert.match(sql, /create policy issues_owner_delete on public\.issues for delete to authenticated using \(public\.is_owner\(\)\)/);
  assert.match(sql, /drop policy if exists customers_admin on public\.customers/); assert.match(sql, /drop policy if exists issues_admin_all on public\.issues/);
  assert.match(sql, /for select to authenticated using \(public\.is_admin\(\)\)/); assert.doesNotMatch(sql, /to anon/);
});
