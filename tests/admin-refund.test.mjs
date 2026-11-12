import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cf from '../supabase/functions/_shared/cashfree.ts';
import { runRefund, handleRefundWebhook, refundable, MANUAL_MSG } from '../supabase/functions/_shared/admin-refund.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const LEAD = '11111111-2222-3333-4444-555555555555', ORDER = 'mxp_MPABC123_' + 'a'.repeat(20), ADMIN = 'admin-uuid';
const realFetch = globalThis.fetch;
const KEYS = ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV'];
test.beforeEach(() => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, { CASHFREE_APP_ID: 'APP', CASHFREE_SECRET_KEY: 'sek', CASHFREE_ENV: 'sandbox' }); });
test.afterEach(() => { globalThis.fetch = realFetch; for (const k of KEYS) delete process.env[k]; });

/** Mock Cashfree. refunds: Map refund_id -> stored refund. mode: 'ok' | 'reject' (HTTP 400) | 'status:XYZ' */
function mockCf({ mode = 'ok', paid = 349, payId = '1111' } = {}) {
  const calls = [], refunds = new Map();
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null; url = String(url);
    calls.push({ url, method, body, headers: init.headers });
    const J = (s, b) => new Response(JSON.stringify(b), { status: s });
    if (/\/payments$/.test(url)) return J(200, [{ cf_payment_id: payId, payment_status: 'SUCCESS', payment_amount: paid, payment_currency: 'INR' }]);
    let m = url.match(/\/orders\/([^/]+)\/refunds\/([^/]+)$/);
    if (m && method === 'GET') return refunds.has(m[2]) ? J(200, refunds.get(m[2])) : J(404, { message: 'not found' });
    if (/\/refunds$/.test(url) && method === 'POST') {
      if (mode === 'reject') return J(400, { message: 'refund amount is more than the balance', code: 'refund_amount_invalid', type: 'invalid_request_error' });
      if (refunds.has(body.refund_id)) return J(409, { message: 'refund with same id is already present', code: 'refund_already_exists' });
      const status = mode.startsWith('status:') ? mode.slice(7) : 'PENDING';
      const r = { refund_id: body.refund_id, refund_amount: body.refund_amount, refund_status: status, cf_refund_id: '9' };
      refunds.set(body.refund_id, r); return J(200, r);
    }
    throw new Error('unexpected fetch ' + url);
  };
  return { calls, refunds, refundCalls: () => calls.filter((c) => c.method === 'POST') };
}

function fakeDb({ status = 'cancelled', payments, refunds = [], audits } = {}) {
  const t = {
    leads: { [LEAD]: { id: LEAD, ref: 'MP-ABC123', status, deleted_at: null } },
    ledger: [...(payments ?? [{ id: 'p1', lead_id: LEAD, entry_type: 'customer_payment', amount: 349, source: 'gateway', method: 'Cashfree', gateway_txn_id: '1111' }]), ...refunds],
    audit: audits ?? [{ action: 'payment_received', details: { lead: 'MP-ABC123', payment_id: '1111', order_id: ORDER } }], acts: [], seq: 0,
  };
  const q = (table) => {
    const f = {};
    const rows = () => table === 'ledger_entries' ? t.ledger.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)) : table === 'audit_log' ? t.audit.filter((a) => !f['details->>lead'] || a.details?.lead === f['details->>lead']) : [];
    const api = {
      select() { return api; }, eq(k, v) { f[k] = v; return api; },
      maybeSingle: async () => ({ data: table === 'leads' ? t.leads[f.id] ?? null : rows()[0] ?? null }),
      then(res, rej) { return Promise.resolve({ data: rows() }).then(res, rej); },
      insert(row) {
        if (table === 'ledger_entries') {
          if (row.gateway_txn_id && t.ledger.some((r) => r.gateway_txn_id === row.gateway_txn_id)) return Promise.resolve({ error: { code: '23505' } });
          if (row.reverses_id && t.ledger.some((r) => r.reverses_id === row.reverses_id)) return Promise.resolve({ error: { code: '23505' } });
          t.ledger.push({ id: 'e' + ++t.seq, ...row });
        } else if (table === 'audit_log') t.audit.push(row); else if (table === 'crm_activities') t.acts.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return api;
  };
  return { from: q, t };
}
const go = (db, o = {}) => runRefund(db, { adminId: ADMIN, leadId: LEAD, amount: 349, reason: 'Booking cancelled by us', ...o });

test('request payload to Cashfree: refund_amount in rupees, alphanumeric refund_id, note, STANDARD speed, right URL and headers', async () => {
  const m = mockCf(), db = fakeDb();
  const r = await go(db, { amount: 100.5 });
  assert.equal(r.status, 200);
  const p = m.refundCalls()[0];
  assert.equal(p.url, `https://sandbox.cashfree.com/pg/orders/${ORDER}/refunds`);
  assert.equal(p.body.refund_amount, 100.5); assert.equal(typeof p.body.refund_amount, 'number');
  assert.match(p.body.refund_id, /^[A-Za-z0-9]{3,40}$/); assert.equal(p.body.refund_id, 'rf111111112222n1');
  assert.equal(p.body.refund_speed, 'STANDARD'); assert.ok(p.body.refund_note.length >= 3 && p.body.refund_note.length <= 100);
  assert.equal(p.headers['x-client-id'], 'APP'); assert.equal(p.headers['x-api-version'], '2026-01-01');
  assert.throws(() => cf.refundPayload({ orderId: 'o', refundId: 'bad_id', rupees: 5 }), /refund id/);
  assert.throws(() => cf.refundPayload({ orderId: 'o', refundId: 'abc', rupees: 0 }), /above zero/);
});

test('ledger row has the right fields; one refund = one row; the audit row and booking note exist', async () => {
  mockCf(); const db = fakeDb();
  const r = await go(db); assert.equal(r.body.ok, true);
  const rows = db.t.ledger.filter((x) => x.entry_type === 'refund'); assert.equal(rows.length, 1);
  const x = rows[0];
  assert.deepEqual([x.lead_id, x.amount, x.collected_by, x.method, x.source, x.created_by], [LEAD, 349, 'company_portal', 'cashfree', 'gateway', ADMIN]);
  assert.equal(x.reference, 'rf111111112222n1'); assert.equal(x.gateway_txn_id, 'cfr_rf111111112222n1'); assert.equal(x.reason, 'Booking cancelled by us'); assert.match(x.note, /order mxp_/);
  assert.ok(db.t.audit.some((a) => a.action === 'refund_to_customer')); assert.equal(db.t.acts.length, 1);
});

test('amount over what was paid through Cashfree is rejected before any refund call', async () => {
  const m = mockCf(), db = fakeDb();
  const r = await go(db, { amount: 350 }); assert.equal(r.status, 400); assert.match(r.body.error, /most.*349/);
  assert.equal(m.refundCalls().length, 0); assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 0);
  for (const bad of [0, -5, 'abc', 10.123, NaN, null]) assert.equal((await go(db, { amount: bad })).status, 400, String(bad));
  assert.equal((await go(db, { reason: 'x' })).status, 400);
  assert.equal(m.refundCalls().length, 0);
});

test('partial refund works and a second refund cannot exceed the remainder', async () => {
  const m = mockCf(), db = fakeDb();
  assert.equal((await go(db, { amount: 100 })).status, 200);
  const over = await go(db, { amount: 250 }); assert.equal(over.status, 400); assert.match(over.body.error, /249/);
  const r2 = await go(db, { amount: 249 }); assert.equal(r2.status, 200);
  const ids = m.refundCalls().map((c) => c.body.refund_id); assert.equal(new Set(ids).size, 2, 'a new refund id per refund');
  assert.equal((await go(db, { amount: 1 })).status, 400, 'nothing left');
  assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 2);
});

test('a manual refund already on the ledger counts against the cap', async () => {
  mockCf(); const db = fakeDb({ refunds: [{ id: 'm1', lead_id: LEAD, entry_type: 'refund', amount: 300, source: 'admin', method: 'cash', gateway_txn_id: null }] });
  assert.equal((await go(db, { amount: 100 })).status, 400);
  assert.equal((await go(db, { amount: 49 })).status, 200);
});

test('a reversed refund frees its amount again', () => {
  const rows = [{ id: 'p1', entry_type: 'customer_payment', amount: 349, source: 'gateway', method: 'Cashfree', gateway_txn_id: '1111' }, { id: 'r1', entry_type: 'refund', amount: 349, source: 'gateway' }, { id: 'v1', entry_type: 'reversal', reverses_id: 'r1', amount: 349 }];
  assert.equal(refundable(rows, [{ action: 'payment_received', details: { payment_id: '1111', order_id: ORDER } }]).cap, 349);
});

test('Razorpay, cash, or an unknown order: manual-refund message and nothing is called', async () => {
  const cases = [
    { payments: [{ id: 'p', lead_id: LEAD, entry_type: 'customer_payment', amount: 349, source: 'gateway', method: 'Razorpay', gateway_txn_id: 'pay_X' }] },
    { payments: [{ id: 'p', lead_id: LEAD, entry_type: 'customer_payment', amount: 349, source: 'admin', method: 'cash' }] },
    { audits: [] },   // a Cashfree payment whose order we cannot find: never guess
    { audits: [{ action: 'payment_received', details: { lead: 'MP-ABC123', payment_id: '1111', order_id: 'order_RZP123' } }] },
    { payments: [] },
  ];
  for (const c of cases) {
    const m = mockCf(), db = fakeDb(c); const r = await go(db);
    assert.equal(r.status, 409); assert.equal(r.body.error, MANUAL_MSG); assert.equal(r.body.manual, true); assert.equal(m.calls.length, 0);
  }
});

test('if Cashfree does not show a SUCCESS payment of that amount, nothing is refunded', async () => {
  const m = mockCf({ paid: 100 }), db = fakeDb(); const r = await go(db);
  assert.equal(r.status, 409); assert.equal(m.refundCalls().length, 0); assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 0);
});

test('Cashfree rejection records no ledger row and returns its message in plain words', async () => {
  mockCf({ mode: 'reject' }); const db = fakeDb(); const r = await go(db);
  assert.equal(r.status, 400); assert.match(r.body.error, /Cashfree did not accept the refund: refund amount is more than the balance/); assert.match(r.body.error, /Nothing was recorded/);
  assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 0);
  mockCf({ mode: 'status:REJECTED' }); const r2 = await go(db); assert.equal(r2.status, 400); assert.equal(db.t.ledger.length, 1);
  // after a rejected refund_id, the next attempt uses a new id
  const m = mockCf(); const r3 = await go(db); assert.equal(r3.status, 200); assert.match(m.refundCalls()[0].body.refund_id, /n2$/);
});

test('a network failure records nothing and says the retry is safe', async () => {
  globalThis.fetch = async (u) => { if (/payments$/.test(u)) return new Response(JSON.stringify([{ cf_payment_id: '1111', payment_status: 'SUCCESS', payment_amount: 349 }])); throw new Error('timeout'); };
  const db = fakeDb(); const r = await go(db); assert.equal(r.status, 502); assert.match(r.body.error, /safe to press the button again/); assert.equal(db.t.ledger.length, 1);
});

test('duplicate refund_id: a retry after Cashfree accepted but the ledger failed records once and never refunds twice', async () => {
  const m = mockCf(); const db = fakeDb();
  const real = db.from; let failOnce = true;
  db.from = (t) => { const a = real(t); if (t === 'ledger_entries') { const ins = a.insert; a.insert = (row) => { if (failOnce) { failOnce = false; return Promise.resolve({ error: { code: 'XX000' } }); } return ins(row); }; } return a; };
  const r1 = await go(db); assert.equal(r1.status, 500); assert.match(r1.body.error, /press the button again/i);
  const r2 = await go(db); assert.equal(r2.status, 200);
  assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 1);
  assert.equal(m.refunds.size, 1, 'Cashfree holds exactly one refund');
  const ids = m.refundCalls().map((c) => c.body.refund_id); assert.equal(ids[0], ids[1], 'same refund_id on the retry');
});

test('a double click (23505 on the ledger) is "already", not a second row', async () => {
  mockCf(); const db = fakeDb();
  await go(db);
  const again = await go(db, { amount: 349 });   // second press: only 0 remains
  assert.equal(again.status, 400);
  assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 1);
});

test('recovery refuses when the refund at Cashfree has a different amount', async () => {
  const m = mockCf(); const db = fakeDb();
  m.refunds.set('rf111111112222n1', { refund_id: 'rf111111112222n1', refund_amount: 10, refund_status: 'SUCCESS' });
  const r = await go(db, { amount: 50 }); assert.equal(r.status, 409); assert.equal(db.t.ledger.filter((x) => x.entry_type === 'refund').length, 0);
});

test('booking rules: non-cancelled needs an explicit service-issue flag and a real reason; junk and lost never', async () => {
  const m = mockCf();
  assert.equal((await go(fakeDb({ status: 'completed' }))).status, 409);
  assert.equal((await go(fakeDb({ status: 'completed' }), { serviceIssue: 'yes' })).status, 409);
  assert.equal((await go(fakeDb({ status: 'completed' }), { serviceIssue: true, reason: 'short' })).status, 409);
  assert.equal((await go(fakeDb({ status: 'junk' }), { serviceIssue: true, reason: 'Work was not done properly' })).status, 409);
  assert.equal(m.refundCalls().length, 0);
  assert.equal((await go(fakeDb({ status: 'completed' }), { serviceIssue: true, reason: 'Work was not done properly' })).status, 200);
  assert.equal((await go(fakeDb(), { leadId: 'nope' })).status, 404);
});

/* ---------- webhook ---------- */
const evt = (id) => ({ type: 'REFUND_STATUS_WEBHOOK', data: { refund: { refund_id: id, order_id: ORDER, refund_status: 'CANCELLED' } } });
test('webhook: a failed refund adds a reversal row (nothing edited or deleted) and a note and audit row, once', async () => {
  const m = mockCf(); const db = fakeDb(); await go(db);
  const rid = [...m.refunds.keys()][0]; m.refunds.get(rid).refund_status = 'CANCELLED';
  const before = db.t.ledger.length;
  assert.equal(await handleRefundWebhook(db, evt(rid)), 'ok');
  assert.equal(db.t.ledger.length, before + 1); const rev = db.t.ledger.at(-1);
  assert.equal(rev.entry_type, 'reversal'); assert.equal(rev.amount, 349); assert.ok(rev.reason); assert.equal(rev.reverses_id, db.t.ledger.find((x) => x.entry_type === 'refund').id);
  assert.ok(db.t.audit.some((a) => a.action === 'refund_failed_at_gateway')); assert.match(db.t.acts.at(-1).body, /Refund Rs 349 failed at the gateway: pay it another way/);
  const acts = db.t.acts.length; assert.equal(await handleRefundWebhook(db, evt(rid)), 'ok'); assert.equal(db.t.ledger.length, before + 1); assert.equal(db.t.acts.length, acts, 'redelivery adds nothing');
  assert.equal(refundable(db.t.ledger, db.t.audit).cap, 349, 'the money can be refunded again');
});
test('webhook: SUCCESS changes nothing; unknown refunds are ignored; the payload status is never trusted', async () => {
  const m = mockCf(); const db = fakeDb(); await go(db); const rid = [...m.refunds.keys()][0]; const n = db.t.ledger.length;
  m.refunds.get(rid).refund_status = 'SUCCESS';
  assert.equal(await handleRefundWebhook(db, evt(rid)), 'ok'); assert.equal(db.t.ledger.length, n);   // payload says CANCELLED, Cashfree says SUCCESS
  assert.equal(await handleRefundWebhook(db, evt('rfunknown1')), 'ignored');
  assert.equal(await handleRefundWebhook(db, { type: 'REFUND_STATUS_WEBHOOK', data: {} }), 'ignored');
  globalThis.fetch = async () => { throw new Error('down'); }; assert.equal(await handleRefundWebhook(db, evt(rid)), 'retry');
});
test('the webhook function routes REFUND_STATUS_WEBHOOK to the handler and stays signature-checked', () => {
  const w = read('supabase/functions/cashfree-webhook/index.ts');
  assert.match(w, /REFUND_STATUS_WEBHOOK/); assert.match(w, /handleRefundWebhook/); assert.ok(w.indexOf('webhookValid') < w.indexOf('REFUND_STATUS_WEBHOOK'));
});

/* ---------- who can press it ---------- */
test('the function checks is_admin() through the database with the caller token, 403 otherwise, and is deployed with verify_jwt', () => {
  const f = read('supabase/functions/admin-refund/index.ts');
  assert.match(f, /rpc\('is_admin'\)/); assert.match(f, /isAdmin !== true/); assert.match(f, /403/); assert.match(f, /Authorization/);
  assert.ok(f.indexOf("rpc('is_admin')") < f.indexOf('runRefund('), 'admin check before any refund logic');
  assert.match(read('supabase/config.toml'), /\[functions\.admin-refund\]\s+verify_jwt = true/);
});
test('Crew has no refund button: crm.js never references refundNow; only the Admin host provides it', () => {
  assert.doesNotMatch(read('crm/crm.js'), /refundNow|admin-refund/);
  assert.match(read('admin/admin.js'), /refundNow:/);
  const core = read('crm/flow-core.js'); assert.equal(read('admin/flow-core.js'), core);
  // changed on purpose: the card's two refund buttons became one Refund button (Admin host only) opening the dialog, which keeps the Cashfree path and adds Full / Partial
  assert.match(core, /if \(!deps\.refundNow\) return;/); assert.match(core, /Refund to customer now/);
  assert.match(core, /Money goes back to the customer's original payment method within 5 to 7 working days\. This cannot be undone\./);
  assert.match(core, /refundCheck\(/);   // changed on purpose: the cap is checked by refundCheck (manage-rules.js)
  const page = read('crm/pages/cancellations.js'); assert.match(page, /typeof ctx\.refundNow === 'function'/); assert.match(page, /Refund to customer now/);
});
test('cancelling never triggers a refund call; the manual Record refund button stays', () => {
  assert.doesNotMatch(read('supabase/migrations/20270143000000_cancellations.sql'), /admin-refund|http/i);
  assert.match(read('crm/flow-core.js'), /Record refund/);
  const priv = ['privacy', 'terms', 'refund-policy'].map((p) => { try { return read(p + '/index.html'); } catch { return ''; } }).join('');
  assert.doesNotMatch(priv, /admin-refund/);
});
