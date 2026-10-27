import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the mechanic link function is admin-only, needs a mechanic on the booking, and tags the link as a remittance', () => {
  const fn = read('supabase/functions/mechanic-pay-link/index.ts');
  assert.match(fn, /from\('admins'\)/); assert.match(fn, /Assign a mechanic to this booking first/);
  assert.match(fn, /purpose: 'remittance', mechanic_id: mech\.id/); assert.match(fn, /amount >= 1 && amount <= 100000/);
});
test('the webhook records a mechanic payment as a remittance and leaves the booking status alone', () => {
  const w = read('supabase/functions/razorpay-webhook/index.ts');
  const i = w.indexOf("purpose === 'remittance'"), j = w.indexOf("status: 'paid'");
  assert.ok(i > 0 && i < j, 'remittance branch comes before the booking is marked paid');
  assert.match(w.slice(i, j), /entry_type: 'remittance'/); assert.match(w.slice(i, j), /gateway_txn_id: pay\?\.id/); assert.match(w.slice(i, j), /return new Response\('ok'\)/);
});
test('the booking money card offers the link only when the mechanic owes the company', () => {
  const a = read('admin/admin.js');
  assert.match(a, /a\.remitDue > 0\.005 && l\.mechanic_id/); assert.match(a, /data-act="mechPayLink"/); assert.match(a, /mechanic-pay-link/);
});
