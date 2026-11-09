// The partner-garage desk (crm/garage-desk.js, shared by Crew and the Admin): every action calls the right crm_garage_* function with the right arguments,
// failures are shown, the screen is hidden without Manage garages, and the private link and PIN are shown once. Placeholders only: no real garage, PIN or customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../crm/garage-desk.js';
import { createFlow } from '../crm/flow-core.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-07T10:00:00Z');
const PIN = '482915', LINK = 'https://example.invalid/garage/?g=PLACEHOLDERTOKEN';

const GARAGES = [{ id: 'g-1', name: '[Garage One]', code: 'G-0001', pincode: '560102', status: 'live' }, { id: 'g-2', name: '[Garage Two]', code: 'G-0002', pincode: '560038', status: 'applied' }, { id: 'g-3', name: '[Garage Three]', code: 'G-0003', pincode: '560066', status: 'paused' }];
const ACCESS = [{ id: 'acc-1', garage_id: 'g-1', garage: '[Garage One]', label: 'Owner', active: true, revoked_at: null, locked_until: null, last_login_at: '2026-11-06T08:30:00Z', created_at: '2026-11-01T00:00:00Z' }];
const ASSIGN = [
  { id: 'as-1', lead_id: 'lead-1', booking_id: 'MP-2611-0001', garage_id: 'g-1', garage: '[Garage One]', status: 'sent', eta: null, notes: '[Work needed]', assigned_at: '2026-11-06T09:00:00Z', progress: [], settlement: null },
  { id: 'as-2', lead_id: 'lead-2', booking_id: 'MP-2611-0002', garage_id: 'g-1', garage: '[Garage One]', status: 'ready', eta: null, notes: null, assigned_at: '2026-11-05T09:00:00Z', progress: [{ event: 'ready', at: '2026-11-06T12:00:00Z' }], settlement: { amount: 1850, settled: false, note: null } },
  { id: 'as-3', lead_id: 'lead-3', booking_id: 'MP-2611-0003', garage_id: 'g-2', garage: '[Garage Two]', status: 'cancelled', eta: null, notes: null, assigned_at: '2026-11-04T09:00:00Z', progress: [], settlement: null },
];
const EST = [{ id: 'es-1', assignment_id: 'as-1', lead_id: 'lead-1', booking_id: 'MP-2611-0001', garage: '[Garage One]', status: 'submitted', lines: [{ kind: 'parts', name: '[Part]', amount: 800 }, { kind: 'labour', name: '[Labour]', amount: 400 }], notes: '[Estimate note]', hours: 6, return_day: null, subtotal: 1200, gst: 216, submitted_at: '2026-11-06T10:00:00Z' }];
const BOOKINGS = [{ id: 'lead-9', booking_id: 'MP-2611-0009', first_name: '[Customer Name]', area: 'HSR Layout', bike: '[Vehicle]' }];

/** A desk wired to fakes: rpc calls, toasts, dialogs and copied text are recorded. `fail` maps an rpc name to an error message; `can` is the permission set. */
function desk({ fail = {}, can = ['manage_garages'], settle = false, replies = {}, openLead = true } = {}) {
  const calls = [], toasts = [], dialogs = [], copied = [];
  const base = { crm_garage_picker: GARAGES, crm_garage_access_list: ACCESS, crm_garage_assignments_list: (a) => (a.p_lead ? ASSIGN.filter((x) => x.lead_id === a.p_lead) : ASSIGN), crm_garage_estimates_inbox: EST, crm_dispatch_list: BOOKINGS,
    crm_garage_access_create: { access_id: 'acc-9', garage: '[Garage Two]', link: LINK }, crm_garage_link_new: { link: LINK }, crm_garage_pin_reset: { ok: true }, crm_garage_revoke: { ok: true }, crm_garage_enable: { ok: true },
    crm_garage_assign: { assignment_id: 'as-9', status: 'sent', garage: '[Garage One]' }, crm_garage_estimate_review: { ok: true, status: 'converted', quote: { version: 2 } }, crm_garage_settlement_set: { ok: true } };
  const rpc = async (name, args) => { calls.push([name, args]); if (fail[name]) throw new Error(fail[name]); const r = name in replies ? replies[name] : base[name]; return typeof r === 'function' ? r(args || {}) : r; };
  const gd = G.createGarageDesk({ rpc, toast: (m, bad) => toasts.push({ m, bad: !!bad }), can: (a) => can.includes(a), canSettle: () => settle, dialog: (o) => { dialogs.push(o); return { form: null, close() {} }; },
    copy: async (t) => { copied.push(t); }, random: (() => { let i = 0; return () => [4, 8, 2, 9, 1, 5][i++ % 6]; })(), now: () => NOW, openLead: openLead ? () => {} : undefined });
  return { gd, calls, toasts, dialogs, copied, last: () => dialogs[dialogs.length - 1], names: () => calls.map((c) => c[0]), rpcCalls: (n) => calls.filter((c) => c[0] === n).map((c) => c[1]) };
}
/** A stand-in form: fields are { name: value }, checkboxes { name: true }. querySelectorAll gives the copy buttons found in the dialog body. */
const form = (fields = {}, body = '') => {
  const f = {}; for (const [k, v] of Object.entries(fields)) f[k] = typeof v === 'boolean' ? { checked: v } : { value: v };
  const clicks = [];
  f.querySelectorAll = (sel) => (sel === '[data-copy]' ? [...body.matchAll(/data-copy="(\w+)"/g)].map((m) => ({ dataset: { copy: m[1] }, addEventListener: (ev, fn) => clicks.push([m[1], fn]) })) : []);
  f.clicks = clicks; return f;
};
const submit = async (dlg, fields) => { const closed = []; await dlg.onSubmit(form(fields), { close: () => closed.push(1), say() {} }); return closed.length; };
const fakeRoot = () => { const r = { innerHTML: '', handlers: {}, isConnected: true, addEventListener(t, f) { this.handlers[t] = f; }, querySelector() { return null; } }; return r; };
const click = (root, attrs) => root.handlers.click({ target: { closest: (sel) => (sel === '[data-gd]' ? { dataset: { ...attrs } } : null) } });

/* ---------- rules ---------- */
test('garage status, access state, open jobs and last seen', () => {
  assert.equal(G.garageStatus('applied').label, 'Applied'); assert.equal(G.garageStatus('kyc_done').label, 'Applied'); assert.equal(G.garageStatus('live').label, 'Active'); assert.equal(G.garageStatus('pilot').label, 'Active'); assert.equal(G.garageStatus('paused').label, 'Paused');
  assert.equal(G.accessState([], NOW).key, 'none');
  const on = G.accessState(ACCESS, NOW); assert.equal(on.key, 'on'); assert.equal(on.last, '2026-11-06T08:30:00Z');
  assert.equal(G.accessState([{ ...ACCESS[0], active: false }], NOW).key, 'off'); assert.equal(G.accessState([{ ...ACCESS[0], active: false }], NOW).label, 'Revoked');
  assert.equal(G.accessState([{ ...ACCESS[0], locked_until: '2026-11-07T10:10:00Z' }], NOW).key, 'locked');
  assert.equal(G.accessState([{ ...ACCESS[0], locked_until: '2026-11-07T09:00:00Z' }], NOW).key, 'on', 'a lock in the past has cleared');
  assert.equal(G.openJobs(ASSIGN, 'g-1'), 2); assert.equal(G.openJobs(ASSIGN, 'g-2'), 0, 'a moved job is not open');
});
test('PIN rules match the database, and a generated PIN is always valid', () => {
  assert.equal(G.pinError('4829'), null); assert.equal(G.pinError('482915'), null);
  for (const bad of ['123', '1234567', '12a4', '', '0000', '555555']) assert.ok(G.pinError(bad), bad);
});
test('makePin retries until the PIN is not all the same digit', () => {
  const seq = [3, 3, 3, 3, 3, 3, 1, 2, 3, 4, 5, 6]; let i = 0;
  assert.equal(G.makePin(() => seq[i++]), '123456');
  const real = G.makePin(); assert.match(real, /^\d{6}$/); assert.equal(G.pinError(real), null);
});
test('estimate totals use the server sums, GST 18%; settlement amounts are checked', () => {
  assert.deepEqual(G.estimateTotals(EST[0]), { subtotal: 1200, gst: 216 });
  assert.deepEqual(G.estimateTotals({ lines: [{ amount: 100 }, { amount: 50.5 }] }), { subtotal: 150.5, gst: 27.09 });
  assert.equal(G.settleError('1850'), null); assert.equal(G.settleError('0'), null);
  for (const bad of ['', '-1', 'abc', '1000001']) assert.ok(G.settleError(bad), bad);
});

/* ---------- access: onboard, PIN reset, new link, revoke, enable ---------- */
test('onboarding calls crm_garage_access_create with the garage, PIN and label, then shows the link and PIN', async () => {
  const d = desk(); const dlg = d.gd.actions.onboard(GARAGES[1]);
  assert.match(d.last().body, /value="482915"/, 'a valid random PIN is filled in');
  await submit(d.last(), { label: ' Owner ', pin: '4829' });
  assert.deepEqual(d.rpcCalls('crm_garage_access_create'), [{ p_garage: 'g-2', p_pin: '4829', p_label: 'Owner' }]);
  assert.equal(d.dialogs.length, 2); assert.match(d.last().title, /Private link and PIN/); assert.ok(d.last().body.includes(LINK)); assert.ok(d.last().body.includes('4829'));
});
test('a bad PIN is refused on screen before anything is sent', async () => {
  const d = desk(); d.gd.actions.onboard(GARAGES[1]);
  await assert.rejects(() => submit(d.last(), { label: 'Owner', pin: '1111' }), /not all the same digit/);
  await assert.rejects(() => submit(d.last(), { label: 'Owner', pin: '12' }), /4 to 6 digits/);
  assert.equal(d.rpcCalls('crm_garage_access_create').length, 0);
});
test('the private link and PIN are shown once, with copy buttons and a warning, and are kept nowhere else', async () => {
  const d = desk(); d.gd.actions.onboard(GARAGES[1]); await submit(d.last(), { label: 'Owner', pin: PIN });
  const secret = d.last();
  assert.match(secret.body, /Shown once/); assert.match(secret.body, /role="alert"/); assert.match(secret.body, /data-copy="link"[^>]*>Copy link/); assert.match(secret.body, /data-copy="pin"[^>]*>Copy PIN/);
  assert.match(secret.body, /two separate messages/);
  const f = form({}, secret.body); secret.onOpen(f); assert.equal(f.clicks.length, 2);
  for (const [which, fn] of f.clicks) fn(); await new Promise((r) => setTimeout(r));
  assert.deepEqual(d.copied, [LINK, PIN]);
  assert.ok(d.toasts.every((t) => !t.m.includes(PIN) && !t.m.includes('PLACEHOLDERTOKEN')), 'never in a toast');
  assert.ok(d.dialogs.slice(0, -1).every((o) => !String(o.body).includes('PLACEHOLDERTOKEN')), 'the link was in no earlier dialog');
  const root = fakeRoot(); await d.gd.mount(root);
  assert.ok(!root.innerHTML.includes(PIN) && !root.innerHTML.includes('PLACEHOLDERTOKEN'), 'the screen after reload never shows them again');
  assert.ok(!JSON.stringify(d.gd.state.data).includes(PIN), 'not kept in the desk state');
});
test('the shown-once dialog for a PIN reset has the PIN and no link; for a new link it has the link and no PIN', async () => {
  const d = desk(); d.gd.actions.pinReset(ACCESS[0], '[Garage One]');
  await submit(d.last(), { pin: PIN, reason: 'Garage lost the phone' });
  assert.deepEqual(d.rpcCalls('crm_garage_pin_reset'), [{ p_access: 'acc-1', p_pin: PIN }]);
  assert.ok(d.last().body.includes(PIN)); assert.doesNotMatch(d.last().body, /data-copy="link"/); assert.match(d.last().body, /Shown once/);
  d.gd.actions.newLink(ACCESS[0], '[Garage One]'); await submit(d.last(), { reason: 'Link was shared by mistake' });
  assert.deepEqual(d.rpcCalls('crm_garage_link_new'), [{ p_access: 'acc-1' }]);
  assert.ok(d.last().body.includes(LINK)); assert.doesNotMatch(d.last().body, /data-copy="pin"/); assert.match(d.last().body, /Shown once/);
});
test('PIN reset, new link and revoke each ask for a reason first and call nothing without one', async () => {
  const d = desk();
  d.gd.actions.pinReset(ACCESS[0], 'x'); await assert.rejects(() => submit(d.last(), { pin: PIN, reason: ' ' }), /short reason/);
  d.gd.actions.newLink(ACCESS[0], 'x'); await assert.rejects(() => submit(d.last(), { reason: 'a' }), /short reason/);
  d.gd.actions.revoke(ACCESS[0], 'x'); await assert.rejects(() => submit(d.last(), { reason: '' }), /short reason/);
  assert.deepEqual(d.names().filter((n) => /pin_reset|link_new|revoke/.test(n)), []);
  assert.match(d.last().intro, /server does not keep the reason/i, 'honest about where the reason goes');
});
test('revoke and switch-on call crm_garage_revoke and crm_garage_enable, and say so', async () => {
  const d = desk(); d.gd.actions.revoke(ACCESS[0], '[Garage One]'); assert.match(d.last().title, /Revoke/);
  assert.equal(await submit(d.last(), { reason: 'Left the programme' }), 1); assert.deepEqual(d.rpcCalls('crm_garage_revoke'), [{ p_access: 'acc-1' }]); assert.ok(d.toasts.some((t) => /revoked/i.test(t.m)));
  d.gd.actions.enable({ ...ACCESS[0], active: false }, '[Garage One]'); await submit(d.last(), {}); assert.deepEqual(d.rpcCalls('crm_garage_enable'), [{ p_access: 'acc-1' }]); assert.ok(d.toasts.some((t) => /switched on/i.test(t.m)));
});

/* ---------- jobs: assign, list, move ---------- */
test('assigning from a booking card calls crm_garage_assign with lead, garage, note and the return time', async () => {
  const d = desk(); await d.gd.assignDialog({ lead: { id: 'lead-9', booking_id: 'MP-2611-0009', area: 'HSR Layout' } });
  assert.match(d.last().body, /\[Garage One\]/); assert.match(d.last().body, /\[Garage Two\]/); assert.doesNotMatch(d.last().body, /Garage Three/, 'a paused garage is not offered'); assert.doesNotMatch(d.last().body, /id="gd-lead"/);
  assert.equal(await submit(d.last(), { garage: 'g-1', note: ' brake noise ', eta: '2026-11-08T17:30' }), 1);
  const a = d.rpcCalls('crm_garage_assign')[0]; assert.equal(a.p_lead, 'lead-9'); assert.equal(a.p_garage, 'g-1'); assert.equal(a.p_note, 'brake noise'); assert.equal(a.p_eta, new Date('2026-11-08T17:30').toISOString());
  const b = (await submit(d.last(), { garage: 'g-1', note: '', eta: '' }), d.rpcCalls('crm_garage_assign')[1]); assert.equal(b.p_note, null); assert.equal(b.p_eta, null);
  assert.ok(d.toasts.some((t) => /Sent to/.test(t.m)));
});
test('assigning from the Garages screen picks the booking from the paid bookings, by booking id, first name and area only', async () => {
  const d = desk(); await d.gd.assignDialog({ garageId: 'g-1' });
  assert.deepEqual(d.rpcCalls('crm_dispatch_list'), [{ p_days: 7 }]); assert.match(d.last().body, /MP-2611-0009 · \[Customer Name\] · HSR Layout/); assert.match(d.last().body, /<option value="g-1" selected>/);
  await assert.rejects(() => submit(d.last(), { lead: '', garage: 'g-1', note: '', eta: '' }), /Choose a booking/);
  await assert.rejects(() => submit(d.last(), { lead: 'lead-9', garage: '', note: '', eta: '' }), /Choose a garage/);
  assert.equal(d.rpcCalls('crm_garage_assign').length, 0);
  await submit(d.last(), { lead: 'lead-9', garage: 'g-1', note: '', eta: '' }); assert.equal(d.rpcCalls('crm_garage_assign')[0].p_lead, 'lead-9');
});
test('moving a job to another garage leaves out the current garage, and a server refusal is shown in the dialog', async () => {
  const d = desk({ fail: { crm_garage_assign: 'the garage has already started this job' } }); await d.gd.assignDialog({ lead: { id: 'lead-1' }, moveFrom: 'g-1', screen: true });
  assert.doesNotMatch(d.last().body, /\[Garage One\]/); assert.match(d.last().title, /Move/);
  await assert.rejects(() => submit(d.last(), { garage: 'g-2', note: '', eta: '' }), /already started/);
});
test('a booking card shows where the job is, offers a move only before the garage starts, and offers Send when there is no job', () => {
  const d = desk(); const L = d.gd.leadHtml;
  assert.equal(L(null), '', 'a failed load shows nothing here (the card has the error banner)');
  const sent = L([ASSIGN[0]]); assert.match(sent, /\[Garage One\]/); assert.match(sent, /data-flow="garageAssign" data-move="g-1"/);
  assert.doesNotMatch(L([{ ...ASSIGN[0], status: 'in_work' }]), /data-flow="garageAssign"/); assert.match(L([{ ...ASSIGN[0], status: 'in_work' }]), /cannot be moved/);
  const none = L([ASSIGN[2]]); assert.match(none, /Send to a partner garage/); assert.match(none, /Moved or removed/);
  assert.match(L([]), /Send to a partner garage/);
});
test('the booking card loads the partner-garage part only for someone who may manage garages, and its button reaches the dialog', async () => {
  const mk = (can) => { const d = desk({ can }); const fl = createFlow({ rpc: async (n, a) => { d.calls.push([n, a]); return n === 'crm_confirmation' ? { fee: 49, paid: true, stage: 'started', door: 'open' } : n === 'crm_quote_get' ? { latest: null, versions: [] } : n === 'crm_booking_updates' ? { details: {}, photos: [], issues: [] } : n === 'crm_garage_assignments_list' ? [] : []; }, invoke: async () => ({}), toast() {}, can: () => true, reload() {}, garageDesk: d.gd }); return { d, fl }; };
  const a = mk(['manage_garages']); const flow = await a.fl.load('lead-1'); assert.deepEqual(a.d.rpcCalls('crm_garage_assignments_list'), [{ p_status: null, p_lead: 'lead-1' }]);
  const lead = { id: 'lead-1', status: 'paid', booking_id: 'MP-2611-0001', confirm_fee: 49, confirm_paid_at: 'x', name: '[Customer Name]' };
  assert.match(a.fl.card(lead, flow), /data-flow="garageAssign"/);
  await a.fl.actions.garageAssign(lead, flow, { dataset: { move: 'g-1' } }); assert.match(a.d.last().title, /Move/);
  const b = mk([]); const flow2 = await b.fl.load('lead-1'); assert.equal(b.d.rpcCalls('crm_garage_assignments_list').length, 0);
  assert.doesNotMatch(b.fl.card(lead, flow2), /Partner garage|garageAssign/);
});

/* ---------- estimates inbox ---------- */
test('approving an estimate calls crm_garage_estimate_review and says a DRAFT quote was made', async () => {
  const d = desk(); d.gd.actions.review(EST[0], true); assert.match(d.last().intro, /draft/i);
  await submit(d.last(), { note: ' looks fair ' });
  assert.deepEqual(d.rpcCalls('crm_garage_estimate_review'), [{ p_id: 'es-1', p_approve: true, p_note: 'looks fair' }]); assert.ok(d.toasts.some((t) => /Draft quote v2/.test(t.m)));
});
test('rejecting needs a reason, then calls crm_garage_estimate_review with approve false and the reason', async () => {
  const d = desk(); d.gd.actions.review(EST[0], false);
  await assert.rejects(() => submit(d.last(), { note: '' }), /short reason/); assert.equal(d.rpcCalls('crm_garage_estimate_review').length, 0);
  await submit(d.last(), { note: 'Labour is too high' }); assert.deepEqual(d.rpcCalls('crm_garage_estimate_review'), [{ p_id: 'es-1', p_approve: false, p_note: 'Labour is too high' }]);
});
test('a refused approval shows the database message in the dialog (already a draft quote)', async () => {
  const d = desk({ fail: { crm_garage_estimate_review: 'there is already a draft quote for this booking: send or edit it first' } }); d.gd.actions.review(EST[0], true);
  await assert.rejects(() => submit(d.last(), { note: '' }), /already a draft quote/);
});
test('the inbox lists lines, totals with GST and the two buttons, and no customer contact', async () => {
  const d = desk(); const root = fakeRoot(); await d.gd.mount(root); await click(root, { gd: 'tab', id: 'estimates' });
  const h = root.innerHTML; assert.match(h, /\[Part\]/); assert.match(h, /₹800\.00/); assert.match(h, /GST 18% ₹216\.00/); assert.match(h, /Total ₹1,416\.00/); assert.match(h, /data-gd="approve"/); assert.match(h, /data-gd="reject"/); assert.match(h, /Estimates \(1\)/);
  await click(root, { gd: 'approve', id: 'es-1' }); assert.match(d.last().title, /Approve/);
  await click(root, { gd: 'est', id: 'converted' }); assert.deepEqual(d.rpcCalls('crm_garage_estimates_inbox').pop(), { p_status: 'converted' });
});

/* ---------- settlement ---------- */
test('the owner enters what we owe a garage with crm_garage_settlement_set', async () => {
  const d = desk({ settle: true }); d.gd.actions.settle(ASSIGN[1]); assert.match(d.last().body, /value="1850"/);
  await assert.rejects(() => submit(d.last(), { amount: '-5', settled: false, note: '' }), /0 to 10,00,000/); assert.equal(d.rpcCalls('crm_garage_settlement_set').length, 0);
  await submit(d.last(), { amount: '2100.5', settled: true, note: ' paid by UPI ' });
  assert.deepEqual(d.rpcCalls('crm_garage_settlement_set'), [{ p_assignment: 'as-2', p_amount: 2100.5, p_settled: true, p_note: 'paid by UPI' }]);
});
test('Crew sees the amount read only: no Enter amount button, and the action refuses', async () => {
  const d = desk({ settle: false }); const root = fakeRoot(); await d.gd.mount(root); await click(root, { gd: 'tab', id: 'jobs' });
  assert.match(root.innerHTML, /We owe: <b>₹1,850\.00 · not paid yet/); assert.doesNotMatch(root.innerHTML, /data-gd="settle"/);
  assert.throws(() => d.gd.actions.settle(ASSIGN[1]), /Only the owner/); assert.equal(d.rpcCalls('crm_garage_settlement_set').length, 0);
  const o = desk({ settle: true }); const r2 = fakeRoot(); await o.gd.mount(r2); await click(r2, { gd: 'tab', id: 'jobs' }); assert.match(r2.innerHTML, /data-gd="settle" data-id="as-2">Change amount/);
  assert.doesNotMatch(r2.innerHTML, /data-gd="settle" data-id="as-1"/, 'only finished jobs');
});

/* ---------- the list ---------- */
test('the garages list shows status, access, last opened and open jobs, and the right buttons for each access state', async () => {
  const d = desk(); const root = fakeRoot(); await d.gd.mount(root);
  assert.deepEqual(d.names().sort(), ['crm_announcement_list', 'crm_garage_access_list', 'crm_garage_assignments_list', 'crm_garage_estimates_inbox', 'crm_garage_picker', 'crm_garage_requests_list']);   // changed on purpose (client BRD): requests and announcements load with the screen
  const h = root.innerHTML; assert.match(h, /\[Garage One\][\s\S]*Active[\s\S]*Access on[\s\S]*2 open jobs/); assert.match(h, /Last opened the app/); assert.match(h, /\[Garage Two\][\s\S]*Applied[\s\S]*No access yet[\s\S]*No open jobs/);
  assert.match(h, /data-gd="onboard" data-id="g-2"/); for (const a of ['pinReset', 'newLink', 'revoke', 'assignTo']) assert.match(h, new RegExp(`data-gd="${a}" data-id="g-1"`));
  assert.doesNotMatch(h, /data-gd="onboard" data-id="g-1"/);
  const r2 = fakeRoot(); const off = desk({ replies: { crm_garage_access_list: [{ ...ACCESS[0], active: false }] } }); await off.gd.mount(r2);
  assert.match(r2.innerHTML, /Revoked/); assert.match(r2.innerHTML, /data-gd="enable" data-id="g-1"/); assert.doesNotMatch(r2.innerHTML, /data-gd="revoke"/);
});
test('buttons on the list start the right action with the right access', async () => {
  const d = desk(); const root = fakeRoot(); await d.gd.mount(root);
  await click(root, { gd: 'onboard', id: 'g-2' }); assert.match(d.last().title, /Create garage app access/);
  await click(root, { gd: 'pinReset', id: 'g-1' }); await submit(d.last(), { pin: PIN, reason: 'lost phone' }); assert.equal(d.rpcCalls('crm_garage_pin_reset')[0].p_access, 'acc-1');
  await click(root, { gd: 'revoke', id: 'g-1' }); await submit(d.last(), { reason: 'closed shop' }); assert.equal(d.rpcCalls('crm_garage_revoke')[0].p_access, 'acc-1');
  await click(root, { gd: 'tab', id: 'jobs' }); await click(root, { gd: 'move', id: 'as-1' }); assert.match(d.last().title, /Move/);
  await click(root, { gd: 'assignTo', id: 'g-1' }); assert.match(d.last().title, /Send to a partner garage/);
});

/* ---------- errors are shown, never swallowed ---------- */
test('a list that cannot load says which part failed, why, and offers Retry', async () => {
  const d = desk({ fail: { crm_garage_assignments_list: 'Could not reach the server. Check your connection and try again.' } }); const root = fakeRoot(); await d.gd.mount(root);
  assert.match(root.innerHTML, /role="alert"/); assert.match(root.innerHTML, /Could not load: jobs sent to garages/); assert.match(root.innerHTML, /Could not reach the server/); assert.match(root.innerHTML, /data-gd="retry"/);
  assert.match(root.innerHTML, /\[Garage One\]/, 'the parts that did load still show');
  await click(root, { gd: 'retry' }); assert.equal(d.rpcCalls('crm_garage_picker').length, 2);
});
test('a permission refusal from the database is shown as it is', async () => {
  const d = desk({ fail: { crm_garage_picker: 'you do not have permission to do this', crm_garage_access_list: 'you do not have permission to do this' } }); const root = fakeRoot(); await d.gd.mount(root);
  assert.match(root.innerHTML, /Could not load: garages, app access/); assert.match(root.innerHTML, /you do not have permission to do this/);
});
test('an action that fails on the list gives a visible "That did not work" message', async () => {
  const d = desk({ fail: { crm_dispatch_list: 'Could not reach the server.' } }); const root = fakeRoot(); await d.gd.mount(root);
  const was = console.error; console.error = () => {}; try { await click(root, { gd: 'assignTo', id: 'g-1' }); } finally { console.error = was; }
  assert.deepEqual(d.toasts.pop(), { m: 'That did not work: Could not reach the server.', bad: true });
});
test('a rejected save inside a dialog reaches the dialog, whose wrapper shows it (the flow-core dialog prints the thrown message)', async () => {
  const d = desk({ fail: { crm_garage_access_create: 'this garage already has access: reset the PIN or revoke it first' } }); d.gd.actions.onboard(GARAGES[1]);
  await assert.rejects(() => submit(d.last(), { label: 'Owner', pin: PIN }), /already has access/); assert.equal(d.dialogs.length, 1, 'no shown-once dialog opens after a failure');
  assert.match(read('crm/flow-core.js'), /catch \(x\) \{ err\.textContent = cleanErr\(x\); \}/);
});

/* ---------- permissions ---------- */
test('without Manage garages the screen makes no calls, shows a plain message, and every action refuses', async () => {
  const d = desk({ can: [] }); assert.equal(d.gd.visible(), false); const root = fakeRoot(); await d.gd.mount(root);
  assert.equal(d.calls.length, 0); assert.match(root.innerHTML, /do not have access/); assert.doesNotMatch(root.innerHTML, /data-gd="onboard"/);
  assert.throws(() => d.gd.actions.onboard(GARAGES[0]), /permission/); assert.throws(() => d.gd.actions.revoke(ACCESS[0], 'x'), /permission/); await assert.rejects(() => d.gd.assignDialog({ lead: { id: 'x' } }), /permission/);
  assert.equal(d.calls.length, 0);
});
test('Crew hides the tab without Manage garages (not even for a login that can only assign leads), and the Admin shows it to the owner only', () => {
  const crm = read('crm/crm.js');
  assert.match(crm, /\{ id: 'garageapp', title: 'Garage app', page: 'garages', need: 'manage_garages', mod: garageapp \}/);
  assert.match(crm, /\(!s\.need \|\| can\(s\.need\)\)/, 'a strict check: can(assign_leads) does not open it');
  assert.match(crm, /createGarageDesk\(\{ rpc, toast, can, canSettle: \(\) => false/, 'Crew never enters settlement amounts');
  const adm = read('admin/admin.js');
  assert.match(adm, /createGarageDesk\(\{ rpc: adminRpc, toast, can: \(\) => isOwner\(\), canSettle: \(\) => isOwner\(\)/);
  assert.match(adm, /data-tab=garageapp\]'\); if \(ga\) ga\.hidden = !isOwner\(\)/); assert.match(read('admin/index.html'), /data-tab="garageapp" hidden>Garage app/);
  assert.match(adm, /if \(S\.tab === 'garageapp'\) garageDesk\.mount\(\$\('#gdRoot'\)\)/);
});
test('Crew and the Admin share one copy, and the card wiring is in both flow-core copies', () => {
  assert.equal(read('crm/garage-desk.js'), read('admin/garage-desk.js')); assert.equal(read('crm/flow-core.js'), read('admin/flow-core.js')); assert.equal(read('crm/flow.css'), read('admin/flow.css'));
  assert.match(read('scripts/shared-files.txt'), /^garage-desk\.js$/m);
});

/* ---------- privacy ---------- */
test('nothing on the screen can show a customer address, email or phone', async () => {
  const leaky = (o) => ({ ...o, customer_phone: '9000000001', phone: '9000000002', address: '[Street Address]', email: 'name@example.invalid', customer_email: 'name@example.invalid' });
  const d = desk({ replies: { crm_garage_assignments_list: ASSIGN.map(leaky), crm_garage_estimates_inbox: EST.map(leaky), crm_dispatch_list: BOOKINGS.map(leaky) } });
  const root = fakeRoot(); await d.gd.mount(root); let all = root.innerHTML;
  for (const t of ['jobs', 'estimates']) { await click(root, { gd: 'tab', id: t }); all += root.innerHTML; }
  await d.gd.assignDialog({ garageId: 'g-1' }); all += d.last().body + d.last().intro; all += d.gd.leadHtml(ASSIGN.map(leaky));
  assert.doesNotMatch(all, /9000000001|9000000002|Street Address|example\.invalid/);
  assert.doesNotMatch(read('crm/garage-desk.js').replace(/\/\/.*$/gm, ''), /\.(phone|address|email|customer_phone|customer_email)\b/, 'the module never reads those fields');
});
test('the shared file follows the shared-file rules: no inline handlers or script tags, no DOM globals at load', () => {
  const t = read('crm/garage-desk.js'); assert.doesNotMatch(t, /\son(click|change|input|submit)\s*=/i); assert.doesNotMatch(t, /<script/i); assert.doesNotMatch(t, /javascript:/i);
});
