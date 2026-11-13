import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const leads = src.slice(src.indexOf('function leads() {'), src.indexOf('/* ---------- customers'));

test('filter bar order: search, dates, vehicle, assignment, status, export, add, deleted', () => {
  const at = (k) => leads.indexOf(k);
  const order = ['id="q"', 'id="fd1"', 'id="fv"', 'id="fa"', 'id="fs"', 'data-act="csv"', 'data-act="newLead"', 'data-act="showDeleted"'].map(at);
  assert.ok(order.every((n) => n > 0), 'all controls present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
test('one Add booking button and no duplicate Booked option', () => {
  assert.equal(leads.split('data-act="newLead"').length - 1, 1);
  assert.match(leads, /STATUSES\.filter\(\(s\) => s !== 'scheduled'\)/);
});
test('Booked filter covers paid and scheduled; assignment uses garage or mechanic data; date uses service date', () => {
  const f = src.slice(src.indexOf('function filtered() {'), src.indexOf('function renderList() {'));
  assert.match(f, /\['paid', 'scheduled'\]\.includes/);
  assert.match(f, /l\.preferred_date >= dr\.from/);
  assert.match(f, /isAssigned\(l\)/);
  assert.doesNotMatch(f, /created_at/);
  assert.match(src, /const isAssigned = \(l\) => !!\(l\.mechanic_id \|\| l\.garage_id\)/);
});
test('CSV export uses filtered() so it respects every active filter', () => {
  assert.match(src.slice(src.indexOf('  csv() {'), src.indexOf('  csv() {') + 400), /concat\(filtered\(\)/);
});
test('lead capture: every source has a label, Instagram can be added by hand, uncontacted new leads show waiting time', () => {
  for (const k of ['website', 'whatsapp', 'phone', 'walk_in', 'app', 'instagram']) assert.match(src, new RegExp(`${k}: '`));
  assert.match(src, /\['instagram', 'Instagram'\]/);
  assert.match(src, /l\.status !== 'new' \|\| l\.crm_first_contact_at/);
  assert.match(readFileSync(new URL('../admin/new-booking.js', import.meta.url), 'utf8'), /'walk_in', 'instagram'\]/);
});
test('lead owner name: read-only admin function, shown on the card, tolerant when not installed', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20270147000000_admin_lead_owners.sql', import.meta.url), 'utf8');
  assert.match(sql, /kyc_need_admin\(\)/);
  assert.match(sql, /revoke all on function public\.admin_lead_owners\(\) from public, anon/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop table|alter table)\b/i);
  assert.match(src, /adminRpc\('admin_lead_owners'\)/);
  assert.match(src, /With \$\{esc\(l\.owner_name\)\}/);
});
