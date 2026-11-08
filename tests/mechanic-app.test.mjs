import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMechanic, ACTIONS } from '../supabase/functions/_shared/mechanic-handler.ts';
import { signMechanicSession, verifyMechanicSession } from '../supabase/functions/_shared/mechanic.ts';
import { signSession as signGarageSession } from '../supabase/functions/_shared/garage.ts';
import { fakeDb } from './helpers/fake-db.mjs';

const NOW = Date.parse('2026-11-07T06:00:00Z'), TODAY = '2026-11-07', SECRET = 'test-secret-0123456789abcdef';
const TOK = 'ab12'.repeat(12), PIN = '4821', MECH = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', ACCESS = '33333333-3333-4333-8333-333333333333';
const PHONE = '9876543210', ADDRESS = '42 Secret Lane, Test Nagar', EMAIL = 'private.person@example.invalid', PIN_CODE = '560102';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A lead that carries the customer's phone, address and email in every text field a careless query could return. */
const lead = (n, extra = {}) => ({ id: U(n), ref: 'REF' + n, booking_id: 'MP-26-27-000' + n, mechanic_id: MECH, name: 'Asha Rao', phone: PHONE, email: EMAIL, address: ADDRESS, landmark: ADDRESS, pincode: PIN_CODE, area: 'HSR Layout',
  notes: `${PHONE} ${EMAIL}`, alt_phone: '9000000000', lat: 12.9, lng: 77.6, preferred_date: TODAY, preferred_slot: 'morning', status: 'paid', visit_stage: null, vehicle: 'bike', service_id: 'svc1', bike_id: 'b1',
  paid_amount: 0, created_at: '2026-11-01T05:00:00Z', commission_adjust: 0, ...extra });

function world(over = {}) {
  const leads = over.leads ?? [
    lead(1, { preferred_slot: 'evening' }),
    lead(2, { status: 'scheduled', preferred_slot: 'asap', visit_stage: 'on_the_way' }),
    lead(3, { status: 'completed', completed_at: '2026-11-07T04:00:00Z', paid_amount: 1180, preferred_slot: 'morning' }),
    lead(4, { mechanic_id: OTHER, name: 'Vikram Shah' }),
    lead(5, { status: 'lost' }),
    lead(6, { preferred_date: '2026-11-08' }),
    lead(7, { status: 'completed', completed_at: '2026-11-03T04:00:00Z', paid_amount: 590, preferred_date: '2026-11-03', created_at: '2026-11-02T05:00:00Z' }),
  ];
  const tables = {
    audit_log: [], leads, services: [{ id: 'svc1', kind: 'service', name: 'Full bike service', price: 999 }],
    bikes: [{ id: 'b1', brand: 'Honda', model: 'Activa 6G', reg_no: 'ka01ab1234', big_bike: false, engine_class: null, owner_phone: PHONE }],
    mechanics: [{ id: MECH, name: 'Test Mechanic', phone: '9000000001', payout_rate: 30 }],
    invoices: [{ lead_id: U(3), ref: 'REF3', issued_at: '2026-11-07T04:30:00Z', total: 1180, taxable: 1000, revision: 1, voided_at: null, customer_phone: PHONE, customer_gstin: 'PLACEHOLDER' },
      { lead_id: U(7), ref: 'REF7', issued_at: '2026-11-03T05:00:00Z', total: 590, taxable: 500, revision: 1, voided_at: null }],
    ledger_entries: [
      { id: 'e1', lead_id: U(3), mechanic_id: MECH, entry_type: 'customer_payment', amount: 1180, collected_by: 'mechanic' },
      { id: 'e2', lead_id: U(7), mechanic_id: null, entry_type: 'customer_payment', amount: 590, collected_by: 'company_portal' }],
    tech_job_links: over.links ?? [], ...over.tables,
  };
  const access = { id: ACCESS, version: 1, active: true, fails: 0, availability: 'available' }, calls = { status: [], open: [], login: [] };
  const rpcs = {
    mechanic_login: async ({ p_token, p_pin }) => {
      calls.login.push(p_token);
      if (over.off) return { ok: false, error: 'off' };
      if (p_token !== TOK) return { ok: false, error: 'link' };
      if (access.fails >= 5) return { ok: false, error: 'locked' };
      if (p_pin !== PIN) { access.fails++; return access.fails >= 5 ? { ok: false, error: 'locked' } : { ok: false, error: 'pin', left: 5 - access.fails }; }
      return { ok: true, access_id: ACCESS, mechanic_id: MECH, mechanic_name: 'Test Mechanic', area: 'HSR Layout', session_version: access.version };
    },
    mechanic_session_check: async ({ p_access, p_ver }) => (p_access === ACCESS && p_ver === access.version && access.active ? { ok: true, access_id: ACCESS, mechanic_id: MECH, mechanic_name: 'Test Mechanic', area: 'HSR Layout', payout_rate: 30, availability: access.availability } : { ok: false }),
    partner_selfie_latest: async () => new Date(NOW).toISOString(),
    mechanic_status_set: async (a) => { calls.status.push(a); access.availability = a.p_status; return { ok: true, availability: a.p_status, located: a.p_status === 'available' && a.p_lat != null }; },
    mechanic_open_job: async ({ p_mechanic, p_lead }) => { calls.open.push([p_mechanic, p_lead]); const l = tables.leads.find((x) => x.id === p_lead); if (!l || l.mechanic_id !== p_mechanic || !['paid', 'scheduled'].includes(l.status)) return { ok: false, error: 'gone' }; if (tables.tech_job_links.some((k) => k.lead_id === p_lead && k.reported_at)) return { ok: false, error: 'reported' }; return { ok: true, token: 'f'.repeat(64) }; },
  };
  const db = fakeDb(tables, rpcs, () => NOW), pays = [];
  const deps = { db, env: (k, f = '') => ({ GARAGE_SESSION_SECRET: over.noSecret ? '' : SECRET, IP_SALT: 's', GARAGE_TEAM_WHATSAPP: '910000000001', GARAGE_TEAM_PHONE: '+91 00000 00002' })[k] ?? f, sha256Hex: sha,
    json: (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }), cors: () => ({ 'Access-Control-Allow-Origin': 'https://mechanixpro.in' }),
    createPaymentLink: async (o) => { if (over.payFails) throw new Error('Razorpay secret key rzp_live_SECRET failed'); pays.push(o); return { url: 'https://rzp.io/i/test' + pays.length }; }, buildInvoice: () => ({ lines: [], total: 0, taxable: 0 }),
    getSetting: async (_d, _k, fb) => fb, now: () => NOW };
  const call = async (body, headers = {}) => { const res = await handleMechanic(new Request('https://x.test/functions/v1/mechanic-app', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), deps); return { status: res.status, json: await res.json(), text: '' }; };
  const login = async () => (await call({ action: 'login', token: TOK, pin: PIN })).json.session;
  return { tables, db, deps, call, login, pays, calls, access };
}
const noLeak = (out, extra = []) => { for (const bad of [ADDRESS, EMAIL, 'Secret Lane', 'Test Nagar', 'private.person', PIN_CODE, 'Asha Rao', 'Vikram', '9000000000', 'PLACEHOLDER', 'password', 'pin_hash', 'link_hash', ...extra]) assert.ok(!out.includes(bad), `leaked ${bad}`); };

test('the function knows exactly these actions, and refuses everything else', async () => {
  // Why: the offer flow (M1a) adds offers/accept/decline; the list is pinned so a new action cannot slip in without a session check.
  assert.deepEqual(ACTIONS, ['login', 'me', 'dashboard', 'jobs', 'offers', 'accept', 'decline', 'dues', 'job_link', 'status_set', 'selfie_upload_url', 'selfie_record', 'terms_accept', 'pay_link', 'team_contact']);
  const w = world();
  assert.equal((await w.call({ action: 'delete_everything' })).status, 400); assert.equal((await w.call({})).status, 400);
  const get = await handleMechanic(new Request('https://x.test/', { method: 'GET' }), w.deps); assert.equal(get.status, 405);
  const opt = await handleMechanic(new Request('https://x.test/', { method: 'OPTIONS' }), w.deps); assert.equal(opt.status, 200);
  assert.equal((await w.call({ action: 'me' }, { origin: 'https://evil.example' })).status, 403, 'a foreign website cannot call it from a browser');
  assert.equal((await world({ noSecret: true }).call({ action: 'login', token: TOK, pin: PIN })).status, 503);
});

test('login: wrong link, bad PIN format, wrong PIN counts down, 5th wrong PIN locks, switched off, success', async () => {
  const w = world();
  let r = await w.call({ action: 'login', token: 'nope', pin: PIN }); assert.equal(r.status, 404); assert.equal(r.json.code, 'link');
  r = await w.call({ action: 'login', token: TOK, pin: '12' }); assert.equal(r.status, 400);
  r = await w.call({ action: 'login', token: TOK, pin: '1111' }); assert.equal(r.status, 401); assert.equal(r.json.left, 4); assert.match(r.json.error, /not right/);
  for (let i = 0; i < 3; i++) await w.call({ action: 'login', token: TOK, pin: '1111' });
  r = await w.call({ action: 'login', token: TOK, pin: '1111' }); assert.equal(r.status, 423); assert.match(r.json.error, /15 minutes/);
  r = await w.call({ action: 'login', token: TOK, pin: PIN }); assert.equal(r.status, 423, 'even the right PIN waits while locked');
  assert.equal((await world({ off: true }).call({ action: 'login', token: TOK, pin: PIN })).status, 403);
  const ok = await world().call({ action: 'login', token: TOK.toUpperCase(), pin: PIN });
  assert.equal(ok.status, 200); assert.equal(ok.json.mechanic.name, 'Test Mechanic'); assert.ok(ok.json.session && ok.json.expires_at);
  assert.deepEqual(Object.keys(ok.json).sort(), ['expires_at', 'mechanic', 'ok', 'session']);
});

test('login is rate limited per address and per link, and the tries are logged without the link or the PIN', async () => {
  const w = world();
  for (let i = 0; i < 20; i++) await w.call({ action: 'login', token: i.toString(16).padStart(48, '0'), pin: PIN });   // 20 different links from one address
  assert.equal((await w.call({ action: 'login', token: TOK, pin: PIN })).status, 429, 'per address');
  const v = world(); for (let i = 0; i < 15; i++) await v.call({ action: 'login', token: TOK, pin: '1111' });
  assert.equal((await v.call({ action: 'login', token: TOK, pin: PIN })).status, 429, 'per link');
  const logged = JSON.stringify(w.tables.audit_log); assert.ok(!logged.includes(TOK) && !logged.includes(PIN));
});

test('sessions: valid works; a garage session, a tampered one, an expired one, or one after a PIN reset or switch-off is refused', async () => {
  const w = world(), s = await w.login();
  assert.equal((await w.call({ action: 'me', session: s })).status, 200);
  const claims = await verifyMechanicSession(SECRET, s, NOW); assert.equal(claims.m, MECH);
  assert.equal((await w.call({ action: 'me', session: (await signGarageSession(SECRET, { access: ACCESS, garage: MECH, version: 1 }, NOW)).token })).status, 401, 'a garage session cannot open the mechanic app, even with matching ids');
  assert.equal((await w.call({ action: 'me', session: s.slice(0, -2) + 'xx' })).status, 401); assert.equal((await w.call({ action: 'me', session: 'a.b' })).status, 401); assert.equal((await w.call({ action: 'me' })).status, 401);
  const old = (await signMechanicSession(SECRET, { access: ACCESS, mechanic: MECH, version: 1 }, NOW - 13 * 3600e3)).token; assert.equal((await w.call({ action: 'me', session: old })).status, 401);
  assert.equal((await w.call({ action: 'me', session: (await signMechanicSession(SECRET, { access: ACCESS, mechanic: OTHER, version: 1 }, NOW)).token })).status, 401, 'claims must match the access');
  // Why: offers/accept/decline are private too: no session, no answer.
  for (const a of ['dashboard', 'jobs', 'offers', 'accept', 'decline', 'dues', 'job_link', 'status_set', 'selfie_upload_url', 'selfie_record', 'terms_accept', 'pay_link', 'team_contact']) assert.equal((await w.call({ action: a })).status, 401, a + ' needs a session');
  w.access.version = 2; assert.equal((await w.call({ action: 'me', session: s })).status, 401, 'PIN reset or new link ends old sessions');
  w.access.version = 1; w.access.active = false; assert.equal((await w.call({ action: 'jobs', session: s })).status, 401, 'revoked');
});

test('jobs: only this mechanic, only that day, no lost jobs, ordered by slot, and the whitelist holds', async () => {
  const w = world(), s = await w.login(), r = await w.call({ action: 'jobs', session: s });
  assert.equal(r.status, 200); assert.equal(r.json.date, TODAY);
  assert.deepEqual(r.json.jobs.map((j) => j.booking_id), ['MP-26-27-0002', 'MP-26-27-0003', 'MP-26-27-0001'], 'asap, morning, evening; not the other mechanic, the lost lead, or tomorrow');
  const j2 = r.json.jobs[0]; assert.deepEqual(Object.keys(j2).sort(), ['area', 'booking_id', 'can_open', 'customer_first_name', 'customer_phone', 'date', 'id', 'open', 'reg_no', 'service', 'slot', 'status', 'status_label', 'vehicle'].sort());
  assert.equal(j2.customer_first_name, 'Asha'); assert.equal(j2.status_label, 'On the way'); assert.equal(j2.vehicle, 'Honda Activa 6G'); assert.equal(j2.reg_no, 'KA01AB1234'); assert.equal(j2.service, 'Full bike service'); assert.equal(j2.slot, 'As soon as possible');
  assert.equal(j2.customer_phone, PHONE, 'the number for an open job'); assert.equal(r.json.jobs[2].customer_phone, PHONE);
  const done = r.json.jobs[1]; assert.equal(done.status, 'completed'); assert.equal(done.customer_phone, undefined, 'no number once the job is completed'); assert.equal(done.can_open, false);
  assert.equal(JSON.stringify(r.json).split(PHONE).length - 1, 2, 'the number appears only as customer_phone on the two open jobs');
  noLeak(JSON.stringify(r.json), ['MP-26-27-0004']);
  const sel = w.db.log.filter((x) => x.table === 'leads' && x.cols !== '*').map((x) => x.cols).join(' '); assert.ok(!/address|email|landmark|pincode|alt_phone/.test(sel), 'the day list never selects address, email or pincode from the database');
  assert.equal((await w.call({ action: 'jobs', session: s, date: '2026-11-08' })).json.jobs.length, 1, 'the date picker shows another day');
  assert.equal((await w.call({ action: 'jobs', session: s, date: 'garbage' })).json.date, TODAY, 'a bad date falls back to today');
});

test('jobs: a job whose link was already reported cannot be opened from the app', async () => {
  const w = world({ links: [{ lead_id: U(1), mechanic_id: MECH, reported_at: '2026-11-07T05:00:00Z' }] }), s = await w.login();
  const r = await w.call({ action: 'jobs', session: s }); assert.equal(r.json.jobs.find((j) => j.id === U(1)).can_open, false); assert.equal(r.json.jobs.find((j) => j.id === U(2)).can_open, true);
});

test('dashboard: greeting, counts for the date, month figures and the cash due', async () => {
  const w = world(), s = await w.login(), r = await w.call({ action: 'dashboard', session: s });
  assert.equal(r.status, 200); assert.equal(r.json.mechanic.name, 'Test Mechanic'); assert.equal(r.json.mechanic.area, 'HSR Layout'); assert.equal(r.json.mechanic.availability, 'available');
  assert.equal(r.json.bookings_count, 3); assert.equal(r.json.open_count, 2);
  assert.equal(r.json.month.bookings, 5, 'leads for November that are not lost or junk (1,2,3,6,7)'); assert.equal(r.json.month.completions, 2);
  assert.equal(r.json.month.avg_ticket, 885, '(1180 + 590) / 2');
  // job 3: the mechanic took Rs 1,180 in cash, 30% of 1000 is his, so he owes 880. Job 7 was paid to the company.
  assert.deepEqual(r.json.cash, { total_due: 880, company_owes: 150, unsettled_count: 1 });
  noLeak(JSON.stringify(r.json));
  assert.equal((await w.call({ action: 'dashboard', session: s, date: '2026-11-08' })).json.bookings_count, 1);
});

test('dues: the unsettled job with the three figures, and nothing else about the customer', async () => {
  const w = world(), s = await w.login(), r = await w.call({ action: 'dues', session: s });
  assert.equal(r.status, 200); assert.equal(r.json.dues.total_due, 880); assert.equal(r.json.dues.unsettled.length, 1);
  assert.deepEqual(r.json.dues.unsettled[0], { id: U(3), booking_id: 'MP-26-27-0003', service: 'Full bike service', date: '2026-11-07', total_collected: 1180, mechanic_payout: 300, due_to_platform: 880 });
  noLeak(JSON.stringify(r.json));
  const paid = world({ tables: { ledger_entries: [{ id: 'e1', lead_id: U(3), mechanic_id: MECH, entry_type: 'customer_payment', amount: 1180, collected_by: 'mechanic' }, { id: 'r1', lead_id: U(3), mechanic_id: MECH, entry_type: 'remittance', amount: 880 }] } });
  assert.equal((await paid.call({ action: 'dues', session: await paid.login() })).json.dues.total_due, 0, 'after the Razorpay webhook records the remittance, the due is gone');
});

test('job_link: a fresh /job/ link for the mechanic\'s own open job only', async () => {
  const w = world(), s = await w.login();
  const r = await w.call({ action: 'job_link', session: s, id: U(1) }); assert.equal(r.status, 200); assert.match(r.json.url, /^\/job\/\?t=[0-9a-f]{64}$/);
  assert.equal((await w.call({ action: 'job_link', session: s, id: U(4) })).status, 404, 'another mechanic\'s job'); assert.equal((await w.call({ action: 'job_link', session: s, id: U(3) })).status, 404, 'a completed job');
  assert.equal((await w.call({ action: 'job_link', session: s, id: 'not-a-uuid' })).status, 404);
  const rep = world({ links: [{ lead_id: U(1), mechanic_id: MECH, reported_at: '2026-11-07T05:00:00Z' }] }); const rr = await rep.call({ action: 'job_link', session: await rep.login(), id: U(1) });
  assert.equal(rr.status, 409); assert.equal(rr.json.code, 'reported');
  for (let i = 0; i < 40; i++) await w.call({ action: 'job_link', session: s, id: U(1) }); assert.equal((await w.call({ action: 'job_link', session: s, id: U(1) })).status, 429);
});

test('status_set: Available or Busy; Available may carry a location; nonsense is dropped, never trusted', async () => {
  const w = world(), s = await w.login();
  assert.equal((await w.call({ action: 'status_set', session: s, status: 'sleeping' })).status, 400);
  let r = await w.call({ action: 'status_set', session: s, status: 'available', lat: 12.9716, lng: 77.5946, acc: 35.6 }); assert.equal(r.status, 200); assert.equal(r.json.located, true);
  assert.deepEqual(w.calls.status.at(-1), { p_access: ACCESS, p_status: 'available', p_lat: 12.9716, p_lng: 77.5946, p_acc: 36 });
  r = await w.call({ action: 'status_set', session: s, status: 'busy' }); assert.equal(r.json.availability, 'busy'); assert.equal(w.calls.status.at(-1).p_lat, null);
  await w.call({ action: 'status_set', session: s, status: 'available', lat: 'x', lng: {} }); assert.equal(w.calls.status.at(-1).p_lat, null, 'garbage becomes no location (the database also checks the range)');
  assert.equal((await w.call({ action: 'me', session: s })).json.mechanic.availability, 'available');
});

test('pay_link: the amount is the server\'s figure from the ledger, per job or for all, and the phone cannot change it', async () => {
  const w = world(), s = await w.login();
  let r = await w.call({ action: 'pay_link', session: s, id: U(3), amount: 1 }); assert.equal(r.status, 200); assert.equal(r.json.amount, 880); assert.match(r.json.url, /^https:\/\/rzp\.io\//);
  assert.equal(w.pays[0].amount, 880); assert.equal(w.pays[0].leadId, U(3)); assert.deepEqual(w.pays[0].notes, { purpose: 'remittance', mechanic_id: MECH }); assert.equal(w.pays[0].phone, '9000000001');
  r = await w.call({ action: 'pay_link', session: s, all: true, amount: 99999 }); assert.equal(r.status, 200); assert.equal(r.json.amount, 880); assert.equal(w.pays[1].leadId, U(3), 'Pay all names the oldest unsettled job');
  assert.equal((await w.call({ action: 'pay_link', session: s, id: U(7) })).status, 404, 'a job with nothing due'); assert.equal((await w.call({ action: 'pay_link', session: s, id: U(4) })).status, 404, 'another mechanic\'s job');
  assert.equal((await w.call({ action: 'pay_link', session: s, id: 'x' })).status, 404);
  for (let i = 0; i < 8; i++) await w.call({ action: 'pay_link', session: s, id: U(3) }); assert.equal((await w.call({ action: 'pay_link', session: s, id: U(3) })).status, 429);
  const zero = world({ tables: { ledger_entries: [] } }); assert.equal((await zero.call({ action: 'pay_link', session: await zero.login(), all: true })).status, 404);
});

test('pay_link: a Razorpay failure gives a plain message and never the provider\'s text', async () => {
  const w = world({ payFails: true }), r = await w.call({ action: 'pay_link', session: await w.login(), id: U(3) });
  assert.equal(r.status, 502); assert.ok(!JSON.stringify(r.json).includes('rzp_live') && !JSON.stringify(r.json).includes('SECRET'));
});

test('team_contact gives only the configured team numbers', async () => {
  const w = world(), r = await w.call({ action: 'team_contact', session: await w.login() }); assert.deepEqual(r.json, { ok: true, whatsapp: '910000000001', call: '910000000002' });
});

test('no response from any action ever holds an address, email, pincode, hash or secret', async () => {
  const w = world(), s = await w.login(), all = [];
  for (const b of [{ action: 'me' }, { action: 'dashboard' }, { action: 'jobs' }, { action: 'jobs', date: '2026-11-03' }, { action: 'dues' }, { action: 'job_link', id: U(1) }, { action: 'pay_link', id: U(3) }, { action: 'status_set', status: 'busy' }, { action: 'team_contact' }]) all.push(JSON.stringify((await w.call({ ...b, session: s })).json));
  const text = all.join('\n'); noLeak(text, ['MP-26-27-0004', 'rzp_live']);
  assert.ok(!/@/.test(text), 'no email-shaped text anywhere');
});

test('the Edge Function file is only wiring, and the session audience is its own', async () => {
  const { readFileSync } = await import('node:fs'); const f = readFileSync(new URL('../supabase/functions/mechanic-app/index.ts', import.meta.url), 'utf8');
  assert.match(f, /handleMechanic\(req/); assert.ok(f.split('\n').length < 15);
  const a = (await signMechanicSession(SECRET, { access: ACCESS, mechanic: MECH, version: 1 }, NOW)).token, g = (await signGarageSession(SECRET, { access: ACCESS, garage: MECH, version: 1 }, NOW)).token;
  assert.equal(await verifyMechanicSession(SECRET, g, NOW), null); assert.ok(await verifyMechanicSession(SECRET, a, NOW));
  assert.equal(await verifyMechanicSession('another-secret-0123456789', a, NOW), null);
});
