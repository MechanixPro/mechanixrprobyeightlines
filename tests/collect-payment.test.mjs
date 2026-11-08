import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { amountDue, cashAllowed, isArrived, cleanCash, reusable, linkMessage, collectAction } from '../supabase/functions/_shared/collect-payment.ts';
import PAY from '../assets/js/collect-pay.js';

const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('amount due is the final bill minus the confirmation fee, never negative', () => {
  assert.equal(amountDue(1180, 99), 1081);
  assert.equal(amountDue(99, 99), 0);
  assert.equal(amountDue(50, 99), 0);
  assert.equal(amountDue('1180.456', 0), 1180.46);
  assert.equal(amountDue(null, null), 0);
});
test('cash is available only when arrived AND inspect-first', () => {
  assert.equal(cashAllowed({ arrived: true, inspectFirst: true }), true);
  assert.equal(cashAllowed({ arrived: true, inspectFirst: false }), false);
  assert.equal(cashAllowed({ arrived: false, inspectFirst: true }), false);
  assert.equal(cashAllowed({ arrived: false, inspectFirst: false }), false);
  assert.equal(PAY.cashAvailable({ arrived: true, inspect_first: true }), true);
  assert.equal(PAY.cashAvailable({ arrived: false, inspect_first: true }), false);
});
test('arrival from the visit stage or garage status', () => {
  for (const s of ['arrived', 'started', 'repair_doorstep', 'picked_up', 'ready', 'returned']) assert.equal(isArrived(s), true, s);
  for (const s of [null, undefined, 'on_the_way']) assert.equal(isArrived(s), false);
  assert.equal(isArrived(null, 'received'), true);
  assert.equal(isArrived(null, 'sent'), false);
});
test('cash input is cleaned', () => {
  assert.deepEqual(cleanCash({ amount: '500', method: 'UPI' }, 600), { ok: true, amount: 500, method: 'upi' });
  assert.equal(cleanCash({ amount: 500, method: 'card' }, 600).ok, false);
  assert.equal(cleanCash({ amount: 0, method: 'cash' }, 600).ok, false);
  assert.equal(cleanCash({ amount: 900, method: 'cash' }, 600).ok, false);
});
test('message text and link reuse', () => {
  assert.match(linkMessage('Asha', 1081, 'https://rzp.io/x'), /Hi Asha.*Rs 1,081.*https:\/\/rzp\.io\/x/);
  assert.match(PAY.waText('Asha', 1081, 'https://rzp.io/x'), /₹1,081/);
  assert.match(PAY.waLink('+91 98765 43210', 'hi'), /^https:\/\/wa\.me\/919876543210\?text=hi$/);
  assert.equal(PAY.waLink('', 'hi'), null);
  assert.equal(reusable({ final_link_id: 'plink_1', final_link_url: 'u', final_link_amount: '1081.00' }, 1081), true);
  assert.equal(reusable({ final_link_id: 'plink_1', final_link_url: 'u', final_link_amount: 1081 }, 1000), false);
  assert.equal(reusable({ final_link_id: 'plink_1', final_link_url: 'u', final_link_amount: 1081, final_paid_at: 'x' }, 1081), false);
});

// A tiny in-memory stand-in for the database client.
function fake(lead, quote = { total: 1180 }) {
  const log = { ledger: [], updates: [], notes: [] };
  const chain = (table) => {
    const q = { _u: null, _guard: null };
    const self = new Proxy(q, { get: (t, k) => {
      if (k === 'maybeSingle') return async () => table === 'job_quotes' ? { data: quote } : table === 'invoices' ? { data: null } : table === 'leads' && t._u ? { data: t._guard === 'final_paid_at' && lead.final_paid_at ? null : (Object.assign(lead, t._u), { id: lead.id }) } : { data: null };
      if (k === 'update') return (u) => { t._u = u; log.updates.push(u); return self; };
      if (k === 'insert') return async (row) => { if (table === 'ledger_entries') log.ledger.push(row); if (table === 'crm_activities') log.notes.push(row.body); return { error: null }; };
      if (k === 'is') return (c) => { t._guard = c; return self; };
      if (k === 'then') return undefined;
      return () => self;
    } });
    return self;
  };
  return { db: { from: chain }, log };
}
const ops = (calls) => ({ razorpayReady: () => true, createLink: async (o) => { calls.push(o); return { id: 'plink_' + calls.length, url: 'https://rzp.io/l/' + calls.length }; } });
const lead = (extra = {}) => ({ id: 'L1', ref: 'MX1', name: 'Asha K', phone: '9876543210', confirm_fee: 99, confirm_paid_at: 'x', inspect_first: false, ...extra });
const who = { kind: 'mechanic', name: 'Ravi', mechanicId: 'M1' };

test('server refuses cash unless arrived AND inspect-first, and never writes the ledger then', async () => {
  for (const [arrived, inspect_first] of [[false, false], [true, false], [false, true]]) {
    const { db, log } = fake(lead({ inspect_first }));
    const r = await collectAction(db, ops([]), 'payment_cash', lead({ inspect_first }), who, arrived, { amount: 1081, method: 'cash' }, async () => 0);
    assert.equal(r.status, 403); assert.equal(log.ledger.length, 0);
  }
});
test('server records cash at the door in the existing ledger as collected by the mechanic', async () => {
  const l = lead({ inspect_first: true }); const { db, log } = fake(l);
  const r = await collectAction(db, ops([]), 'payment_cash', l, who, true, { amount: 1081, method: 'upi' }, async () => 0);
  assert.equal(r.status, 200); assert.equal(log.ledger.length, 1);
  assert.equal(log.ledger[0].entry_type, 'customer_payment'); assert.equal(log.ledger[0].collected_by, 'mechanic'); assert.equal(log.ledger[0].mechanic_id, 'M1'); assert.equal(log.ledger[0].amount, 1081);
  assert.ok(log.notes.some((n) => /collected at the door by Ravi/.test(n)));
});
test('payment_request makes a link for bill minus fee and reuses it for the same amount', async () => {
  const calls = []; const l = lead(); const { db } = fake(l);
  const a = await collectAction(db, ops(calls), 'payment_request', l, who, true, {}, async () => 0);
  assert.equal(a.body.amount, 1081); assert.equal(calls.length, 1); assert.equal(calls[0].notes.purpose, 'final');
  Object.assign(l, { final_link_id: 'plink_1', final_link_url: 'https://rzp.io/l/1', final_link_amount: 1081 });
  const b = await collectAction(db, ops(calls), 'payment_request', l, who, true, {}, async () => 0);
  assert.equal(calls.length, 1); assert.equal(b.body.reused, true); assert.equal(b.body.url, 'https://rzp.io/l/1');
});
test('inspect_first_set is logged with who', async () => {
  const l = lead(); const { db, log } = fake(l);
  const r = await collectAction(db, ops([]), 'inspect_first_set', l, who, true, { on: true }, async () => 0);
  assert.equal(r.body.cash_available, true); assert.ok(log.notes.some((n) => /Ravi ticked/.test(n)));
  assert.equal((await collectAction(db, ops([]), 'inspect_first_set', l, who, true, { on: 'yes' }, async () => 0)).status, 400);
});

test('source patterns: no card fields, rule server-side, wired in both functions, webhook branch', () => {
  const all = src('supabase/functions/_shared/collect-payment.ts') + src('assets/js/collect-pay.js') + src('supabase/migrations/20270117000000_collect_payment.sql');
  assert.doesNotMatch(all, /card_number|cvv|cvc|expiry|account_number|ifsc|aadhaar|pan_no/i);
  assert.match(src('supabase/functions/_shared/collect-payment.ts'), /if \(!cashAllowed\(\{ arrived, inspectFirst: lead\.inspect_first === true \}\)\) return \{ status: 403/);
  for (const f of ['tech-job', 'garage-app']) { const s = src(`supabase/functions/${f}/index.ts`); assert.match(s, /collectAction/); assert.match(s, /payment_cash/); assert.match(s, /inspect_first_set/); assert.match(s, /payment_request/); }
  assert.match(src('supabase/functions/razorpay-webhook/index.ts'), /purpose === 'final'/);
  assert.match(src('supabase/functions/_shared/collect-payment.ts'), /reusable\(lead, due\)/);
  assert.match(src('supabase/functions/_shared/collect-payment.ts'), /collected_by: 'mechanic'[^]*source: 'technician'/);
  assert.match(src('garage/index.html'), /collect-pay\.js/); assert.match(src('garage/index.html'), /qr\.js/); assert.match(src('job/index.html'), /collect-pay\.js/);
});
