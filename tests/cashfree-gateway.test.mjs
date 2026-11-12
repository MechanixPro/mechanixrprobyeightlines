import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as cf from '../supabase/functions/_shared/cashfree.ts';
import { gateway, paymentsReady, createPaymentLink } from '../supabase/functions/_shared/gateway.ts';
import { settleCashfreeOrder } from '../supabase/functions/_shared/cashfree-settle.ts';
import { cleanCashfreeVerify } from '../supabase/functions/_shared/checkout.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const KEYS = ['PAYMENT_GATEWAY', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_ENV', 'CASHFREE_API_VERSION', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const SECRET = 'test_secret_value';
function setEnv(o = {}) { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o); }
const realFetch = globalThis.fetch;
function mockFetch(routes) {   // routes: [[regex, status, body]]
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = routes.find(([re, , , m]) => re.test(String(url)) && (!m || m === (init.method ?? 'GET')));
    if (!r) throw new Error('unexpected fetch ' + url);
    return new Response(JSON.stringify(r[2]), { status: r[1] });
  };
  return calls;
}
test.afterEach(() => { globalThis.fetch = realFetch; setEnv(); });

/* ---------- the switch ---------- */
test('PAYMENT_GATEWAY defaults to razorpay when unset or empty, and accepts cashfree', () => {
  setEnv(); assert.equal(gateway(), 'razorpay');
  setEnv({ PAYMENT_GATEWAY: '' }); assert.equal(gateway(), 'razorpay');
  setEnv({ PAYMENT_GATEWAY: 'razorpay' }); assert.equal(gateway(), 'razorpay');
  setEnv({ PAYMENT_GATEWAY: ' Cashfree ' }); assert.equal(gateway(), 'cashfree');
});
test('a mistyped PAYMENT_GATEWAY is an error and counts as not ready, never a silent guess', () => {
  setEnv({ PAYMENT_GATEWAY: 'cashfre', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' });
  assert.throws(() => gateway(), /razorpay or cashfree/); assert.equal(paymentsReady(), false);
});
test('paymentsReady checks the keys of the active gateway only', () => {
  setEnv({ RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }); assert.equal(paymentsReady(), true);
  setEnv({ PAYMENT_GATEWAY: 'cashfree', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' }); assert.equal(paymentsReady(), false, 'Razorpay keys do not make Cashfree ready');
  setEnv({ PAYMENT_GATEWAY: 'cashfree', CASHFREE_APP_ID: 'x', CASHFREE_SECRET_KEY: 'y' }); assert.equal(paymentsReady(), true);
});
test('cashfree selected with no keys fails closed: clear error, no network call, no Razorpay fallback', async () => {
  setEnv({ PAYMENT_GATEWAY: 'cashfree', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b' });
  const calls = mockFetch([[/./, 200, {}]]);
  await assert.rejects(createPaymentLink({ amount: 100, ref: 'MP-ABC123', leadId: 'l1', name: 'Asha K', phone: '9876543210', description: 'x' }), /Cashfree keys are not configured/);
  await assert.rejects(cf.createCashfreeOrder({ leadId: 'l1', ref: 'MP-ABC123', rupees: 99, phone: '9876543210' }), /Cashfree keys are not configured/);
  assert.equal(calls.length, 0);
});

/* ---------- orders ---------- */
test('the order body has the amount in RUPEES, INR, a unique order_id, the booking in the tags and our webhook', () => {
  setEnv({ SUPABASE_URL: 'https://mejdxsbpyscujpvbwvmg.supabase.co' });
  const a = cf.orderPayload({ leadId: 'aaaa-bbbb-cccc', ref: 'MP-ABC123', rupees: 349, phone: '+91 98765 43210', email: 'x@example.com', name: 'Asha K', now: 1_800_000_000_000 });
  const b = cf.orderPayload({ leadId: 'aaaa-bbbb-cccc', ref: 'MP-ABC123', rupees: 349, phone: '9876543210', now: 1_800_000_000_000 });
  assert.equal(a.order_amount, 349); assert.equal(typeof a.order_amount, 'number'); assert.equal(a.order_currency, 'INR');
  assert.notEqual(a.order_id, b.order_id); assert.ok(cf.isCashfreeOrderId(a.order_id)); assert.ok(a.order_id.length <= 45);
  assert.deepEqual(a.order_tags, { lead_id: 'aaaa-bbbb-cccc', ref: 'MP-ABC123' });
  assert.equal(a.customer_details.customer_phone, '9876543210'); assert.equal(a.customer_details.customer_email, 'x@example.com'); assert.match(a.customer_details.customer_id, /^[A-Za-z0-9]{3,50}$/);
  assert.equal(a.order_meta.notify_url, 'https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/cashfree-webhook');
  assert.match(a.order_meta.return_url, /^https:\/\/mechanixpro\.in\/pay\/\?cf_order=\{order_id\}$/);
  assert.equal(cf.orderPayload({ leadId: 'l', ref: 'MP-1', rupees: 12.34, phone: '1' }).order_amount, 12.34, 'two decimals');
  assert.equal(b.customer_details.customer_phone, '9876543210'); assert.equal(cf.orderPayload({ leadId: 'l', ref: 'MP-1', rupees: 5, phone: 'bad' }).customer_details.customer_phone, '8310621498');
  assert.throws(() => cf.orderPayload({ leadId: 'l', ref: 'MP-1', rupees: 0.5, phone: '9876543210' }), /minimum/);
  assert.throws(() => cf.orderPayload({ leadId: 'l', ref: 'MP-1', rupees: 100001, phone: '9876543210' }), /limit/);
});
test('createCashfreeOrder posts to the right base with the key headers; sandbox and production differ', async () => {
  setEnv({ CASHFREE_APP_ID: 'APPID', CASHFREE_SECRET_KEY: SECRET, CASHFREE_ENV: 'sandbox' });
  const calls = mockFetch([[/\/orders$/, 200, { order_id: 'ECHO', payment_session_id: 'session_abc' }, 'POST']]);
  // the mock echoes the id we sent
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url: String(url), headers: init.headers, body }); return new Response(JSON.stringify({ order_id: body.order_id, payment_session_id: 'session_abc' }), { status: 200 }); };
  const r = await cf.createCashfreeOrder({ leadId: 'l1', ref: 'MP-ABC123', rupees: 349, phone: '9876543210' });
  assert.equal(r.payment_session_id, 'session_abc'); assert.equal(r.amount, 349);
  assert.equal(calls[0].url, 'https://sandbox.cashfree.com/pg/orders');
  assert.equal(calls[0].headers['x-client-id'], 'APPID'); assert.equal(calls[0].headers['x-client-secret'], SECRET); assert.equal(calls[0].headers['x-api-version'], '2026-01-01');
  assert.equal(calls[0].body.order_amount, 349);
  setEnv({ CASHFREE_APP_ID: 'APPID', CASHFREE_SECRET_KEY: SECRET });
  await cf.createCashfreeOrder({ leadId: 'l1', ref: 'MP-ABC123', rupees: 349, phone: '9876543210' });
  assert.equal(calls[1].url, 'https://api.cashfree.com/pg/orders');
  assert.notEqual(calls[0].body.order_id, calls[1].body.order_id, 'a new order id for every attempt');
});
test('an API error from Cashfree never carries the keys, and a response without a session is refused', async () => {
  setEnv({ CASHFREE_APP_ID: 'APPID', CASHFREE_SECRET_KEY: SECRET });
  mockFetch([[/\/orders$/, 401, { message: 'authentication failed' }, 'POST']]);
  await assert.rejects(cf.createCashfreeOrder({ leadId: 'l1', ref: 'MP-ABC123', rupees: 99, phone: '9876543210' }), (e) => !String(e.message).includes(SECRET));
  mockFetch([[/\/orders$/, 200, { order_id: 'other' }, 'POST']]);
  await assert.rejects(cf.createCashfreeOrder({ leadId: 'l1', ref: 'MP-ABC123', rupees: 99, phone: '9876543210' }), /payment session/);
});

/* ---------- payment links ---------- */
test('the payment link body: unique link_id, amount in rupees, INR, purpose, expiry within 3 days, no notifications, notes', () => {
  setEnv({ SUPABASE_URL: 'https://mejdxsbpyscujpvbwvmg.supabase.co' });
  const now = 1_800_000_000_000;
  const a = cf.linkPayload({ amount: 1081.5, ref: 'MP-ABC123', leadId: 'l1', name: 'Asha K', phone: '9876543210', description: 'Mechanix Pro balance', notes: { purpose: 'final' }, now });
  const b = cf.linkPayload({ amount: 1081.5, ref: 'MP-ABC123', leadId: 'l1', name: 'Asha K', phone: '9876543210', description: 'x', now });
  assert.notEqual(a.link_id, b.link_id); assert.ok(a.link_id.length <= 50); assert.ok(cf.isOurLinkId(a.link_id)); assert.match(a.link_id, /^[A-Za-z0-9_-]+$/);
  assert.equal(a.link_amount, 1081.5); assert.equal(a.link_currency, 'INR'); assert.equal(a.link_purpose, 'Mechanix Pro balance');
  assert.deepEqual(a.link_notify, { send_sms: false, send_email: false });
  assert.ok(Date.parse(a.link_expiry_time) - now <= 3 * 24 * 3600_000 && Date.parse(a.link_expiry_time) > now);
  assert.deepEqual(a.link_notes, { lead_id: 'l1', ref: 'MP-ABC123', purpose: 'final' }); assert.ok(Object.keys(a.link_notes).length <= 5);
  assert.equal(a.link_meta.notify_url, 'https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/cashfree-webhook');
  assert.equal(a.customer_details.customer_phone, '9876543210');
});
test('createPaymentLink on cashfree returns { id, url } and the remittance notes ride along', async () => {
  setEnv({ PAYMENT_GATEWAY: 'cashfree', CASHFREE_APP_ID: 'APPID', CASHFREE_SECRET_KEY: SECRET });
  const calls = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url: String(url), body }); return new Response(JSON.stringify({ link_id: body.link_id, link_url: 'https://payments.cashfree.com/links/abc', link_status: 'ACTIVE' }), { status: 200 }); };
  const l = await createPaymentLink({ amount: 880, ref: 'MP-ABC123', leadId: 'l1', name: 'Ravi M', phone: '9876543210', description: 'Company share', notes: { purpose: 'remittance', mechanic_id: 'm1' } });
  assert.deepEqual(Object.keys(l).sort(), ['id', 'url']); assert.equal(l.url, 'https://payments.cashfree.com/links/abc'); assert.equal(l.id, calls[0].body.link_id);
  assert.equal(calls[0].url, 'https://api.cashfree.com/pg/links'); assert.equal(calls[0].body.link_notes.mechanic_id, 'm1');
});

/* ---------- webhook signature ---------- */
const sign = (ts, raw, secret = SECRET) => createHmac('sha256', secret).update(ts + raw).digest('base64');
test('webhook signature: good passes; bad, tampered, wrong secret, missing parts and stale timestamps fail', async () => {
  const now = Date.now(), ts = String(now), raw = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_amount":170.00}}}';
  assert.equal(await cf.webhookValid(raw, ts, sign(ts, raw), SECRET, now), true);
  assert.equal(await cf.webhookValid(raw, ts, sign(ts, raw, 'other'), SECRET, now), false);
  assert.equal(await cf.webhookValid(raw.replace('170.00', '1.00'), ts, sign(ts, raw), SECRET, now), false, 'a changed body');
  assert.equal(await cf.webhookValid(raw, String(now + 1), sign(ts, raw), SECRET, now), false, 'a changed timestamp');
  assert.equal(await cf.webhookValid(raw, ts, null, SECRET, now), false); assert.equal(await cf.webhookValid(raw, null, sign(ts, raw), SECRET, now), false);
  assert.equal(await cf.webhookValid(raw, ts, sign(ts, raw), '', now), false, 'no secret configured');
  assert.equal(await cf.webhookValid(raw, ts, 'AAAA', SECRET, now), false);
  const old = String(now - 11 * 60_000); assert.equal(await cf.webhookValid(raw, old, sign(old, raw), SECRET, now), false, 'stale');
  const fresh = String(now - 9 * 60_000); assert.equal(await cf.webhookValid(raw, fresh, sign(fresh, raw), SECRET, now), true);
  const future = String(now + 11 * 60_000); assert.equal(await cf.webhookValid(raw, future, sign(future, raw), SECRET, now), false);
});

/* ---------- confirming with Cashfree ---------- */
const ORDER = 'mxp_MP-ABC123_0123456789abcdef0123';
const order = (o = {}) => ({ order_id: ORDER, order_amount: 349, order_currency: 'INR', order_status: 'PAID', order_tags: { lead_id: 'lead-1', ref: 'MP-ABC123' }, ...o });
const pay = (o = {}) => ({ cf_payment_id: 1111, payment_status: 'SUCCESS', payment_amount: 349, payment_currency: 'INR', ...o });
const routes = (ord, pays, extra = []) => [[new RegExp('/orders/' + ORDER + '/payments$'), 200, pays], [new RegExp('/orders/' + ORDER + '$'), 200, ord], ...extra];

test('a payment counts only when Cashfree says SUCCESS and the amount equals the order', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  mockFetch(routes(order(), [pay({ payment_status: 'FAILED' }), pay()]));
  const ok = await cf.confirmOrderPayment(ORDER, 349); assert.equal(ok.state, 'paid'); assert.equal(ok.paymentId, '1111'); assert.equal(ok.amount, 349);
  mockFetch(routes(order(), [pay({ payment_amount: 1 })])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'mismatch');
  mockFetch(routes(order(), [pay()])); assert.equal((await cf.confirmOrderPayment(ORDER, 100)).state, 'mismatch', 'not what the server expected');
  mockFetch(routes(order(), [pay({ payment_currency: 'USD' })])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'mismatch');
  mockFetch(routes(order(), [pay({ payment_status: 'PENDING' })])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'pending');
  for (const s of ['FAILED', 'USER_DROPPED', 'NOT_ATTEMPTED', 'CANCELLED', 'VOID']) { mockFetch(routes(order(), [pay({ payment_status: s })])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'unpaid', s); }
  mockFetch(routes(order(), [])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'unpaid');
  mockFetch(routes(order({ order_tags: null }), [pay()])); assert.equal((await cf.confirmOrderPayment(ORDER)).state, 'foreign', 'not one of our orders');
});
test('verify input: only our own unguessable order id is accepted from the browser', () => {
  assert.equal(cleanCashfreeVerify({ cashfree_order_id: ORDER }).ok, true);
  for (const bad of ['', 'order_AAA111', 'mxp_MP-ABC123_short', ORDER + 'x', '../x']) assert.equal(cleanCashfreeVerify({ cashfree_order_id: bad }).ok, false, bad);
  assert.equal(cleanCashfreeVerify({}).ok, false);
});

/* ---------- effects: a fake database, double delivery, amount mismatch ---------- */
function fakeDb(leadOver = {}) {
  const t = { ledger: [], audit: [], leads: { 'lead-1': { id: 'lead-1', ref: 'MP-ABC123', status: 'payment_sent', booking_id: null, confirm_fee: 349, final_paid_at: null, ...leadOver } }, updates: [] };
  const q = (table) => {
    const st = { table, filters: {} };
    const api = {
      select() { return api; }, eq(k, v) { st.filters[k] = v; return api; }, is() { return api; }, limit() { return api; },
      maybeSingle: async () => ({ data: table === 'leads' ? t.leads[st.filters.id] ?? null : null }),
      then(res, rej) { if (st.pending) { t.updates.push({ table, row: st.pending, ...st.filters }); if (table === 'leads') Object.assign(t.leads[st.filters.id] ?? {}, st.pending); st.pending = null; return Promise.resolve({ error: null }).then(res, rej); }
        return Promise.resolve(table === 'audit_log' ? { data: t.audit.filter((a) => a.action === st.filters.action && a.details?.payment_id === st.filters['details->>payment_id']) } : { data: [] }).then(res, rej); },
      insert(row) {
        if (table === 'ledger_entries') { if (t.ledger.some((r) => r.gateway_txn_id === row.gateway_txn_id)) return Promise.resolve({ error: { code: '23505' } }); t.ledger.push(row); return Promise.resolve({ error: null }); }
        if (table === 'audit_log') t.audit.push(row);
        return Promise.resolve({ error: null });
      },
      update(row) { st.pending = row; return api; },
    };
    return api;
  };
  return Object.assign({ from: q }, { t });
}
const deps = () => { const log = { msgs: 0, after: 0 }; return { log, paidMessage: async () => { log.msgs++; }, afterPaid: async () => { log.after++; } }; };

test('the same Cashfree payment delivered twice (browser verify and webhook) is recorded once and messaged once', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  mockFetch(routes(order(), [pay()]));
  const db = fakeDb(), d = deps();
  const r1 = await settleCashfreeOrder(db, ORDER, 'webhook', d);
  const r2 = await settleCashfreeOrder(db, ORDER, 'checkout', d);
  assert.equal(r1.kind, 'paid'); assert.equal(r1.effect.already, false); assert.equal(r2.kind, 'paid'); assert.equal(r2.effect.already, true);
  assert.equal(db.t.ledger.length, 1); const row = db.t.ledger[0];
  assert.equal(row.source, 'gateway'); assert.equal(row.collected_by, 'company_portal'); assert.equal(row.entry_type, 'customer_payment'); assert.equal(row.gateway_txn_id, '1111'); assert.equal(row.amount, 349); assert.equal(row.gateway_fee, 0); assert.equal(row.method, 'Cashfree');
  assert.equal(d.log.msgs, 1, 'one WhatsApp'); assert.equal(db.t.leads['lead-1'].status, 'paid');
  assert.equal(db.t.audit.filter((a) => a.action === 'payment_received').length, 1);
});
test('a ledger unique-violation from a racing delivery counts as already recorded and sends no second message', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  mockFetch(routes(order(), [pay()]));
  const db = fakeDb(); db.t.ledger.push({ gateway_txn_id: '1111' }); const d = deps();
  const r = await settleCashfreeOrder(db, ORDER, 'webhook', d);
  assert.equal(r.kind, 'paid'); assert.equal(r.effect.already, true); assert.equal(d.log.msgs, 0); assert.equal(db.t.ledger.length, 1);
});
test('an amount that differs from the order is rejected: nothing recorded, nothing marked paid, an audit row says why', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  mockFetch(routes(order(), [pay({ payment_amount: 1 })]));
  const db = fakeDb(), d = deps();
  const r = await settleCashfreeOrder(db, ORDER, 'webhook', d);
  assert.equal(r.kind, 'rejected'); assert.equal(db.t.ledger.length, 0); assert.equal(db.t.leads['lead-1'].status, 'payment_sent'); assert.equal(d.log.msgs, 0);
  assert.ok(db.t.audit.some((a) => a.action === 'payment_rejected'));
});
test('an unreachable Cashfree API asks for a retry and records nothing', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  globalThis.fetch = async () => { throw new Error('network'); };
  const db = fakeDb(); const r = await settleCashfreeOrder(db, ORDER, 'webhook', deps());
  assert.equal(r.kind, 'retry'); assert.equal(db.t.ledger.length, 0);
});
test('payment-link payments: the final bill, a mechanic remittance, and a link whose amount differs from what was paid', async () => {
  setEnv({ CASHFREE_APP_ID: 'A', CASHFREE_SECRET_KEY: SECRET });
  const LID = 'mxp-MP-ABC123-lq1w2e3r-0123456789', CFO = 'CFPay_abc_123';
  const linkOrder = { order_id: CFO, order_amount: 880, order_currency: 'INR', order_tags: { cf_link_id: '77', link_id: LID } };
  const run = (notes, linkAmount = 880) => {
    globalThis.fetch = async (url) => { const u = String(url);
      if (u.endsWith('/orders/' + CFO + '/payments')) return new Response(JSON.stringify([{ cf_payment_id: 2222, payment_status: 'SUCCESS', payment_amount: 880, payment_currency: 'INR' }]), { status: 200 });
      if (u.endsWith('/orders/' + CFO)) return new Response(JSON.stringify(linkOrder), { status: 200 });
      if (u.endsWith('/links/' + LID)) return new Response(JSON.stringify({ link_id: LID, link_amount: linkAmount, link_notes: notes }), { status: 200 });
      throw new Error('unexpected ' + u); };
  };
  run({ lead_id: 'lead-1', ref: 'MP-ABC123', purpose: 'final' });
  let db = fakeDb(); const d = deps();
  let r = await settleCashfreeOrder(db, CFO, 'webhook', d);
  assert.equal(r.kind, 'paid'); assert.equal(r.purpose, 'final'); assert.equal(db.t.leads['lead-1'].final_paid_method, 'online'); assert.equal(d.log.msgs, 0, 'no slot-confirmed message for the final bill');
  assert.equal((await settleCashfreeOrder(db, CFO, 'webhook', d)).effect.already, true); assert.equal(db.t.ledger.length, 1);
  run({ lead_id: 'lead-1', ref: 'MP-ABC123', purpose: 'remittance', mechanic_id: 'mech-1' }); db = fakeDb();
  r = await settleCashfreeOrder(db, CFO, 'webhook', d);
  assert.equal(r.kind, 'paid'); assert.equal(db.t.ledger[0].entry_type, 'remittance'); assert.equal(db.t.ledger[0].mechanic_id, 'mech-1'); assert.equal(db.t.leads['lead-1'].status, 'payment_sent', 'the booking stays as it is');
  run({ lead_id: 'lead-1', purpose: 'final' }, 500); db = fakeDb();
  r = await settleCashfreeOrder(db, CFO, 'webhook', d); assert.equal(r.kind, 'rejected'); assert.equal(db.t.ledger.length, 0);
  linkOrder.order_tags = { link_id: 'someone-elses-link' }; db = fakeDb(); assert.equal((await settleCashfreeOrder(db, CFO, 'webhook', d)).kind, 'ignored');
});

/* ---------- wiring and CSP ---------- */
test('the webhook function is public, checks the signature first and ignores failed and dropped payments', () => {
  assert.match(read('supabase/config.toml'), /\[functions\.cashfree-webhook\]\nverify_jwt = false/);
  const w = read('supabase/functions/cashfree-webhook/index.ts');
  assert.ok(w.indexOf('webhookValid') < w.indexOf('JSON.parse'), 'signature before parsing');
  assert.match(w, /PAYMENT_SUCCESS_WEBHOOK/); assert.match(w, /PAYMENT_LINK_EVENT/); assert.match(w, /status: 401/); assert.match(w, /status: 500/);
  assert.doesNotMatch(w, /PAYMENT_FAILED_WEBHOOK'\)\s*orderId/);
});
test('every function that makes a Payment Link goes through the gateway switch, and none imports Razorpay directly', () => {
  for (const f of ['payment-link', 'desk-payment-link', 'mechanic-pay-link', 'tech-job', 'garage-app', 'whatsapp-webhook', 'mechanic-app']) {
    const s = read(`supabase/functions/${f}/index.ts`); assert.match(s, /_shared\/gateway\.ts/, f); assert.doesNotMatch(s, /_shared\/razorpay\.ts/, f);
  }
  for (const f of ['create-order', 'book-start']) { const s = read(`supabase/functions/${f}/index.ts`); assert.match(s, /gateway\(\)/, f); assert.match(s, /gateway: 'cashfree'/, f); assert.match(s, /gateway: 'razorpay'/, f); assert.match(s, /Cashfree keys are not configured|NOT_CONFIGURED/, f); }
});
test('the browser pages pick the SDK from the gateway field and never send a Cashfree result as proof', () => {
  for (const f of ['assets/js/pay.js', 'assets/js/book-pay.js']) {
    const j = read(f); assert.match(j, /sdk\.cashfree\.com\/js\/v3\/cashfree\.js/, f); assert.match(j, /gateway === 'cashfree'/, f); assert.match(j, /redirectTarget: '_modal'/, f); assert.match(j, /cashfree_order_id/, f); assert.match(j, /checkout\.razorpay\.com/, f);
    assert.doesNotMatch(j, /CASHFREE_SECRET|x-client-secret/i, f);
  }
});
test('the site policy allows Cashfree checkout and keeps Razorpay', () => {
  const h = read('_headers'), csp = h.split('\n').find((l) => /Content-Security-Policy: default-src 'self'/.test(l));
  const dir = (n) => (csp.match(new RegExp(n + ' ([^;]*)')) || [])[1] || '';
  assert.match(dir('script-src'), /https:\/\/sdk\.cashfree\.com/); assert.match(dir('script-src'), /https:\/\/checkout\.razorpay\.com/);
  for (const u of ['https://api.cashfree.com', 'https://sandbox.cashfree.com']) assert.ok(dir('connect-src').includes(u), 'connect-src ' + u);
  for (const u of ['https://payments.cashfree.com', 'https://sdk.cashfree.com', 'https://sandbox.cashfree.com', 'https://payments-test.cashfree.com']) { assert.ok(dir('frame-src').includes(u), 'frame-src ' + u); assert.ok(dir('form-action').includes(u), 'form-action ' + u); }
  assert.match(dir('connect-src'), /https:\/\/api\.razorpay\.com/); assert.match(dir('frame-src'), /https:\/\/checkout\.razorpay\.com/);
  assert.match(dir('form-action'), /'self'/);
});
test('no Cashfree secret value is written in the project files, and the owner wording is gateway-neutral', () => {
  for (const f of ['supabase/functions/_shared/cashfree.ts', 'supabase/functions/cashfree-webhook/index.ts', 'assets/js/pay.js', 'docs/CASHFREE-CUTOVER.md']) assert.doesNotMatch(read(f), /cfsk_(ma|test)_[A-Za-z0-9_]{8,}/, f);
  assert.doesNotMatch(read('admin/admin.js'), /Refund (it )?in Razorpay/); assert.match(read('admin/admin.js'), /Refund it in the payment gateway dashboard/);
  assert.doesNotMatch(read('crm/pages/cancellations.js'), /Razorpay/);
});
