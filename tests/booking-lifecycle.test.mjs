// One booking, one management screen: status list, one assignment section, estimates, customer approval, approve on behalf, cancellation and refund,
// delivery, activity feed, and the customer tracking and garage panels. RPCs and Edge Functions are stubbed; nothing is called for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../crm/manage-rules.js';
import { createFlow } from '../crm/flow-core.js';
import { createGarageDesk } from '../crm/garage-desk.js';
import track from '../assets/js/track.js';
import garage from '../assets/js/garage.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const LEAD = { id: 'lead-1', status: 'paid', booking_id: 'MP-2611-0001', area: 'HSR Layout', confirm_fee: 49, confirm_paid_at: '2026-11-10T05:00:00Z', name: '[Customer Name]', preferred_date: '2026-11-12' };
const GARAGES = [{ id: 'g-1', name: '[Garage One]', code: 'G-0001', status: 'live' }, { id: 'g-3', name: '[Garage Three]', code: 'G-0003', status: 'paused' }];
const EST = { approval: { status: 'pending', version: 1 }, quotes: [{ version: 1, status: 'sent', quote_no: 'Q-1', total: 944, sent_at: '2026-11-11T05:00:00Z' }],
  garage_estimates: [{ id: 'es-1', garage: '[Garage One]', status: 'submitted', lines: [{ kind: 'parts', name: '[Part]', amount: 800, part_type: 'genuine' }, { kind: 'labour', name: '[Labour]', amount: 400 }], notes: '[Note]', hours: 6, submitted_at: '2026-11-11T04:00:00Z' },
    { id: 'es-0', garage: '[Garage One]', status: 'rejected', lines: [], submitted_at: '2026-11-10T04:00:00Z', reviewed_at: '2026-11-10T06:00:00Z', reviewed_by_name: '[Admin Name]', review_note: '[too high]' }] };
const INFO = { garage: { id: 'g-1', name: '[Garage One]', code: 'G-0001', status: 'sent', seen_at: null, eta: '2026-11-13T10:00:00Z', notes: '[note]', assigned_at: '2026-11-11T03:00:00Z', assigned_by_name: '[Admin Name]', phone_for_admin: '+91 83106 21498' }, outside: null, history: [{ garage: '[Garage Two]', status: 'cancelled', at: '2026-11-10T03:00:00Z' }] };
const REFUNDS = { paid: 349, refunded: 100, refundable: 249, refund_due: 249, rows: [{ id: 'r1', kind: 'gateway', amount: 100, method: 'Cashfree', reference: 'CF-REF-PLACEHOLDER', status: 'processing', reason: '[why]', created_by_name: '[Admin Name]', created_at: '2026-11-11T05:00:00Z' }] };

function setup({ fail = {}, replies = {}, can = () => true, admin = false, notifyFail = false, garageVisible = true } = {}) {
  const calls = [], toasts = [], dialogs = [], invokes = [];
  const base = { crm_confirmation: { fee: 49, paid: true, stage: 'started', door: 'verified' }, crm_quote_get: { latest: { version: 1, status: 'sent', total: 944, balance: 895, eta_text: '6 hours' }, versions: [] }, crm_booking_state: { state: 'paid', label: 'Booked' },
    crm_assignment_info: INFO, crm_booking_estimates: EST, crm_booking_refunds: REFUNDS, crm_garage_picker: GARAGES, crm_assign_booking: { ok: true, garage: '[Garage One]' }, crm_garage_assignments_list: [], crm_garage_estimate_review: { quote: { version: 2 } } };
  const rpc = async (n, a) => { calls.push([n, a]); if (fail[n]) throw new Error(fail[n]); const r = n in replies ? replies[n] : base[n]; return typeof r === 'function' ? r(a || {}) : r === undefined ? (n.startsWith('crm_') ? [] : null) : r; };
  const invoke = async (fn, body) => { invokes.push([fn, body]); if (notifyFail && ['approval_notice', 'delivery_update'].includes(body.action)) throw new Error('whatsapp down'); return { version: 3 }; };
  const dialogImpl = (o) => { dialogs.push(o); return { close() {} }; };
  const gd = createGarageDesk({ rpc, toast: (m, b) => toasts.push({ m, b }), can: () => garageVisible, canSettle: () => false, dialog: dialogImpl, sendQuote: async (id) => invoke('booking-notify', { action: 'quote_send', lead_id: id }), reload: async () => {}, now: () => Date.parse('2026-11-12T05:00:00Z') });
  const deps = { rpc, invoke, toast: (m, b) => toasts.push({ m, b }), can, garageDesk: gd, dialogImpl, reload() { calls.push(['reload']); }, me: () => ({ name: '[Admin Name]' }), now: () => new Date('2026-11-12T05:00:00Z') };
  if (admin) Object.assign(deps, { adminView: true, openRefund: () => calls.push(['openRefund']), refundNow: async () => calls.push(['refundNow']), canOverrideRefund: () => true });
  const fl = createFlow(deps);
  return { fl, calls, toasts, dialogs, invokes, gd, last: () => dialogs[dialogs.length - 1], rpcCalls: (n) => calls.filter((c) => c[0] === n).map((c) => c[1]) };
}
const fakeForm = (fields = {}) => { const f = { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v }])) }; const err = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, firstChild: { textContent: '' }, querySelector: () => ({ addEventListener() {} }) };
  f.querySelector = (sel) => (sel === '.flow-err' ? err : sel === 'button[type=submit]' ? { remove() {}, textContent: '' } : sel === '[name=mode]:checked' ? { value: fields.mode || 'full' } : null); f.err = err; return f; };
const submit = (dlg, fields) => dlg.onSubmit(fakeForm(fields), { close() {}, say() {} });
const lead = (o) => ({ ...LEAD, ...o });
const card = async (t, l = LEAD) => { const flow = await t.fl.load(l.id); return { flow, html: t.fl.card(t.fl.withFlow(l, flow), flow) }; };

/* ---------- 1. status list ---------- */
test('the Status list has exactly the twelve options, in order, with the client labels', () => {
  assert.deepEqual(R.statusOptions('new').map((o) => o.label), ['New', 'Contacted', 'Quote sent', 'Advance link sent', 'Booked', 'Booked (visit scheduled)', 'Customer cancelled', 'Lost', 'Done', 'Vehicle ready for delivery', 'Vehicle delivered', 'Booking closed']);
  assert.deepEqual(R.statusOptions('new').map((o) => o.value), ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'cancelled_customer', 'lost', 'completed', 'ready_for_delivery', 'delivered', 'closed']);
  const x = R.statusOptions('cancelled_company'); assert.equal(x.length, 13); assert.deepEqual(x[12], { value: 'cancelled_company', label: 'Cancelled by us', disabled: true });
});
test('plain statuses save with the bar; statuses with side effects open a dialog; invalid jumps are explained', () => {
  for (const s of ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'lost']) assert.deepEqual(R.statusJump('new', s).action ?? null, null, s);
  assert.deepEqual(R.PLAIN_STATES, ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'lost']);
  assert.equal(R.statusJump('scheduled', 'cancelled_customer').action, 'cancel'); assert.equal(R.statusJump('paid', 'completed').action, 'done');
  assert.equal(R.statusJump('completed', 'ready_for_delivery').action, 'ready'); assert.equal(R.statusJump('ready_for_delivery', 'delivered').action, 'delivered'); assert.equal(R.statusJump('delivered', 'closed').action, 'closed');
  const bad = R.statusJump('paid', 'delivered'); assert.equal(bad.ok, false); assert.match(bad.error, /Mark the service done/);
  assert.match(R.statusJump('completed', 'closed').error, /delivered before closing/); assert.match(R.statusJump('cancelled_customer', 'completed').error, /already cancelled/);
});
test('the Update form saves only plain statuses, and the Status select reroutes the rest', () => {
  const a = read('admin/admin.js');
  assert.match(a, /status: PLAIN_STATES\.includes\(sv\) \? sv : l\.status/); assert.match(a, /flow\.statusJump\(cur, sel\.value\)/); assert.match(a, /flow\.actions\.cancel\(l\) : flow\.deliveryDialog\(l, j\.action\)/);
  assert.match(a, /crm_booking_state|paintStatus/);
});

/* ---------- 2. one assignment section ---------- */
test('the card has one "Garage or partner" section and no Assign mechanic anywhere', async () => {
  const t = setup({ admin: true }), { html } = await card(t);
  assert.equal((html.match(/<h4>Garage or partner<\/h4>/g) || []).length, 1); assert.match(html, /\[Garage One\]/); assert.match(html, /G-0001/); assert.match(html, /Sent/); assert.match(html, /Assigned by \[Admin Name\]/);
  assert.match(html, /Garage phone \(Admin only\)/); assert.match(html, /Reassign/); assert.match(html, /Assignment history/);
  for (const f of ['crm/flow-core.js', 'admin/admin.js', 'crm/garage-desk.js']) assert.doesNotMatch(read(f), /Assign mechanic|Reassign mechanic|id="lm"|id="la"/, f);
});
test('Crew does not see the garage phone; the section says could not load with Retry when the function is missing', async () => {
  const crew = await card(setup({ admin: false })); assert.doesNotMatch(crew.html, /Garage phone/);
  const t = setup({ fail: { crm_assignment_info: 'function does not exist' } }), { html } = await card(t); assert.match(html, /could not load/); assert.match(html, /data-flow="reloadFlow"/); assert.match(html, /Paid confirmation/);
});
test('Reassign calls crm_assign_booking once with garage xor outside', async () => {
  const t = setup({ admin: true }); await t.gd.assignDialog({ lead: LEAD, moveFrom: 'g-1', reassign: true });
  assert.match(t.last().body, /Other \/ outside partner/); assert.doesNotMatch(t.last().body, /Garage Three/, 'paused garage excluded'); assert.equal(t.last().submit, 'Reassign');
  await t.last().onSubmit({ garage: { value: '__other__' }, outside: { value: ' [Outside Partner] ' }, note: { value: '[n]' }, eta: { value: '2026-11-13T10:00' } }, { close() {} });
  assert.equal(t.rpcCalls('crm_assign_booking').length, 1); const a = t.rpcCalls('crm_assign_booking')[0];
  assert.deepEqual({ ...a, p_eta: typeof a.p_eta }, { p_lead: 'lead-1', p_garage: null, p_outside: '[Outside Partner]', p_note: '[n]', p_eta: 'string' });
  const t2 = setup(); await t2.gd.assignDialog({ lead: LEAD }); await t2.last().onSubmit({ garage: { value: 'g-1' }, outside: { value: '' }, note: { value: '' }, eta: { value: '' } }, { close() {} });
  assert.deepEqual(t2.rpcCalls('crm_assign_booking')[0], { p_lead: 'lead-1', p_garage: 'g-1', p_outside: null, p_note: null, p_eta: null });
});
test('an assignment refusal is shown in plain words in the dialog', async () => {
  const t = setup({ fail: { crm_assign_booking: 'customer has not paid the confirmation fee' } }); await t.gd.assignDialog({ lead: LEAD });
  await assert.rejects(() => t.last().onSubmit({ garage: { value: 'g-1' }, outside: { value: '' }, note: { value: '' }, eta: { value: '' } }, { close() {} }), /has not paid/);
});

/* ---------- 3. estimates ---------- */
test('a submitted garage estimate shows its lines and Approve, Reject, Edit; history lists every version', async () => {
  const t = setup({ admin: true }), { html } = await card(t);
  assert.match(html, /Garage estimate/); assert.match(html, /\[Part\]/); assert.match(html, /About 6 hours/); for (const a of ['estApprove', 'estReject', 'estEdit']) assert.match(html, new RegExp('data-flow="' + a + '"'));
  assert.match(html, /View estimate history \(3\)/); assert.match(html, /\[too high\]/); assert.match(html, /\[Admin Name\]/);
});
test('Approve uses the existing review then sends the quote; Reject needs remarks; Edit opens the builder filled from the estimate', async () => {
  const t = setup({ admin: true }), { flow } = await card(t), btn = { dataset: { est: 'es-1' } };
  await t.fl.actions.estApprove(LEAD, flow, btn); await t.last().onSubmit(fakeForm({ note: '' }), { close() {} });
  assert.deepEqual(t.rpcCalls('crm_garage_estimate_review')[0], { p_id: 'es-1', p_approve: true, p_note: null }); assert.deepEqual(t.invokes[0], ['booking-notify', { action: 'quote_send', lead_id: 'lead-1' }]);
  await t.fl.actions.estReject(LEAD, flow, btn); await assert.rejects(() => t.last().onSubmit(fakeForm({ note: 'x' }), { close() {} }), /short reason|at least 3/);
  await t.last().onSubmit(fakeForm({ note: 'Price too high' }), { close() {} }); assert.deepEqual(t.rpcCalls('crm_garage_estimate_review')[1], { p_id: 'es-1', p_approve: false, p_note: 'Price too high' });
  await t.fl.actions.estEdit(LEAD, flow, btn); assert.match(t.last().title, /Edit the garage estimate/); assert.match(t.last().body, /\[Part\]/); assert.match(t.last().body, /value="6"/);
});
test('a draft quote gets Send approved estimate to customer (booking-notify quote_send)', async () => {
  const t = setup({ replies: { crm_quote_get: { latest: { version: 2, status: 'draft', total: 1, balance: 1 } } } }), { html, flow } = await card(t); assert.match(html, /Send approved estimate to customer/);
  await t.fl.actions.sendDraft(LEAD, flow); assert.deepEqual(t.invokes[0], ['booking-notify', { action: 'quote_send', lead_id: 'lead-1' }]);
});

/* ---------- 4. approval chips ---------- */
test('the customer approval chip and line for every state', () => {
  assert.equal(R.approvalInfo({ status: 'none' }), null);
  assert.equal(R.approvalInfo({ status: 'pending' }).text, 'Pending customer approval'); assert.equal(R.approvalInfo({ status: 'approved_self' }).text, 'Customer approved (self)');
  const ad = R.approvalInfo({ status: 'approved_admin', decided_by_name: '[Admin Name]', method: 'phone' }); assert.equal(ad.text, 'Customer approved (by admin)'); assert.match(ad.detail, /\[Admin Name\]/); assert.match(ad.detail, /phone call/);
  assert.equal(R.approvalInfo({ status: 'rejected' }).text, 'Customer rejected'); const ch = R.approvalInfo({ status: 'changes_requested', remarks: 'Cheaper pads' }); assert.equal(ch.text, 'Customer asked for changes'); assert.equal(ch.remarks, 'Cheaper pads');
});
test('the card shows the approval chip with who and when for an admin approval', async () => {
  const t = setup({ replies: { crm_booking_estimates: { ...EST, approval: { status: 'approved_admin', decided_by_name: '[Admin Name]', method: 'whatsapp', decided_at: '2026-11-11T06:00:00Z', remarks: 'said yes' } } } }), { html } = await card(t);
  assert.match(html, /Customer approved \(by admin\)/); assert.match(html, /\[Admin Name\]/); assert.match(html, /said yes/); assert.doesNotMatch(html, /APPROVE ON BEHALF/);
});

/* ---------- 5. approve on behalf ---------- */
test('APPROVE ON BEHALF shows when pending, validates method and remarks (min 5), calls the RPC then notify', async () => {
  const t = setup(), { html, flow } = await card(t); assert.match(html, /APPROVE ON BEHALF OF CUSTOMER/); assert.doesNotMatch(html, /Record phone approval|Record approval/);
  await t.fl.actions.approveOnBehalf(LEAD, flow); const d = t.last(); assert.match(d.body, /\[Admin Name\]/); assert.match(d.body, /A confirmation is sent to the customer and the garage is notified/); assert.match(d.body, /Phone call/); assert.match(d.body, /WhatsApp/);
  await assert.rejects(() => submit(d, { method: 'carrier', remarks: 'said yes ok' }), /phone call or WhatsApp/); await assert.rejects(() => submit(d, { method: 'phone', remarks: 'yes' }), /at least 5/);
  assert.equal(t.rpcCalls('crm_quote_admin_approve').length, 0);
  await submit(d, { method: 'whatsapp', remarks: 'said yes on chat' });
  assert.deepEqual(t.rpcCalls('crm_quote_admin_approve')[0], { p_lead: 'lead-1', p_method: 'whatsapp', p_remarks: 'said yes on chat', p_version: null });
  assert.deepEqual(t.invokes, [['booking-notify', { action: 'approval_notice', lead_id: 'lead-1' }]]);
  const order = t.calls.map((c) => c[0]).filter((n) => n === 'crm_quote_admin_approve'); assert.equal(order.length, 1);
});
test('a failed notice keeps the approval and says the notice could not be sent, with Resend', async () => {
  const t = setup({ notifyFail: true }), { flow } = await card(t); await t.fl.actions.approveOnBehalf(LEAD, flow); const f = fakeForm({ method: 'phone', remarks: 'said yes on call' });
  await t.last().onSubmit(f, { close() {}, say() {} });
  assert.equal(t.rpcCalls('crm_quote_admin_approve').length, 1); assert.ok(t.calls.some((c) => c[0] === 'reload')); assert.match(f.err.html, /Approved, but the notice could not be sent/); assert.match(f.err.html, /Resend/);
});

/* ---------- 6. cancellation and refund ---------- */
test('refund Full fills the refundable amount, Partial is capped', () => {
  assert.deepEqual(R.refundCheck({ mode: 'full', amount: '1', max: 249 }), { ok: true, amount: 249 }); assert.deepEqual(R.refundCheck({ mode: 'partial', amount: '100.50', max: 249 }), { ok: true, amount: 100.5 });
  assert.equal(R.refundCheck({ mode: 'partial', amount: '250', max: 249 }).ok, false); assert.equal(R.refundCheck({ mode: 'partial', amount: '', max: 249 }).ok, false); assert.equal(R.refundCheck({ mode: 'full', max: 0 }).ok, false);
  assert.deepEqual(R.refundStatus('processing'), ['Processing', 'info']); assert.deepEqual(R.refundStatus('failed'), ['Failed', 'bad']);
});
test('cancelled booking: history table with status chips; Refund button for Admin only, none for Crew and no gateway reference', async () => {
  const L = lead({ status: 'cancelled' }), mk = (admin) => setup({ admin, replies: { crm_cancel_info: { kind: 'customer', reason: '[changed mind]', at: '2026-11-11T05:00:00Z', by_name: '[Crew Name]', refund_outstanding: 249 } } });
  const a = await card(mk(true), L); assert.match(a.html, /Cancellation and refund/); assert.match(a.html, /\[changed mind\]/); assert.match(a.html, /\[Crew Name\]/); assert.match(a.html, /Processing/); assert.match(a.html, /data-flow="refundOpen"/); assert.match(a.html, /CF-REF-PLACEHOLDER/);
  const c = await card(mk(false), L); assert.match(c.html, /Processing/); assert.doesNotMatch(c.html, /refundOpen|data-flow="refund/); assert.doesNotMatch(c.html, /CF-REF-PLACEHOLDER/);
});
test('the refund dialog: Partial above refundable is refused, Full sends the refundable amount to admin-refund', async () => {
  const t = setup({ admin: true }), { flow } = await card(t, lead({ status: 'cancelled' })); await t.fl.actions.refundOpen(LEAD, flow); const d = t.last(); assert.match(d.body, /Full refund/); assert.match(d.body, /Partial refund/);
  await assert.rejects(() => submit(d, { mode: 'partial', amount: '300', why: 'goodwill' }), /cannot be more than ₹249/);
  await submit(d, { mode: 'full', amount: '1', why: 'goodwill' }); assert.deepEqual(t.invokes[0], ['admin-refund', { lead_id: 'lead-1', amount: 249, reason: 'goodwill' }]);
});
test('crm/crm.js never mentions the Admin-only refund hooks', () => { assert.doesNotMatch(read('crm/crm.js'), /refundNow|openRefund|canOverrideRefund|recordRefund|adminView/); });

/* ---------- 7. delivery ---------- */
test('delivery buttons by state', async () => {
  assert.deepEqual(R.deliveryStages('paid'), ['done']); assert.deepEqual(R.deliveryStages('scheduled'), ['done']); assert.deepEqual(R.deliveryStages('completed'), ['ready', 'delivered']); assert.deepEqual(R.deliveryStages('ready_for_delivery'), ['delivered']); assert.deepEqual(R.deliveryStages('delivered'), ['closed']); assert.deepEqual(R.deliveryStages('cancelled_customer'), []);
  const html = (st) => card(setup({ replies: { crm_booking_state: { state: st } } }), lead({ status: st === 'completed' ? 'completed' : 'paid' })).then((x) => x.html);
  const h = await html('completed'); assert.match(h, /Mark vehicle ready for delivery/); assert.match(h, /MARK VEHICLE DELIVERED/); assert.doesNotMatch(h, /Mark service completed/);
  assert.match(await html('paid'), /Mark service completed \(Done\)/); assert.match(await html('delivered'), /Close booking/);
  assert.doesNotMatch(await card(setup(), lead({ status: 'cancelled' })).then((x) => x.html), /Delivery management/);
});
test('delivery dialogs call crm_delivery_set then notify for ready and delivered only; delivered needs remarks', async () => {
  const t = setup(); await t.fl.deliveryDialog(LEAD, 'delivered'); const d = t.last(); assert.match(d.body, /\[Admin Name\]/);
  await assert.rejects(() => submit(d, { remarks: 'k' }), /at least 3/); assert.equal(t.rpcCalls('crm_delivery_set').length, 0);
  await submit(d, { remarks: 'Handed over' }); assert.deepEqual(t.rpcCalls('crm_delivery_set')[0], { p_lead: 'lead-1', p_stage: 'delivered', p_remarks: 'Handed over' }); assert.deepEqual(t.invokes[0], ['booking-notify', { action: 'delivery_update', lead_id: 'lead-1', stage: 'delivered' }]);
  await t.fl.deliveryDialog(LEAD, 'ready'); await submit(t.last(), { remarks: '' }); assert.deepEqual(t.rpcCalls('crm_delivery_set')[1], { p_lead: 'lead-1', p_stage: 'ready', p_remarks: null }); assert.equal(t.invokes[1][1].stage, 'ready');
  for (const s of ['done', 'closed']) { await t.fl.deliveryDialog(LEAD, s); await submit(t.last(), { remarks: '' }); } assert.equal(t.invokes.length, 2, 'done and closed send nothing'); assert.deepEqual(t.rpcCalls('crm_delivery_set').map((a) => a.p_stage), ['delivered', 'ready', 'done', 'closed']);
  const f = setup({ notifyFail: true }); await f.fl.deliveryDialog(LEAD, 'ready'); const form = fakeForm({ remarks: '' }); await f.last().onSubmit(form, { close() {}, say() {} }); assert.equal(f.rpcCalls('crm_delivery_set').length, 1); assert.match(form.err.html, /could not be sent/);
});
test('the step bar Mark done and the card Ready and Delivered use the one delivery dialog', () => {
  const a = read('admin/admin.js'), c = read('crm/flow-core.js'); assert.match(a, /if \(key === 'done'\) return flow\.deliveryDialog\(l, 'done'\)/);
  assert.match(c, /markReady\(lead\) \{ return deliveryDialog\(lead, 'ready'\)/); assert.match(c, /markDelivered\(lead\) \{ return deliveryDialog\(lead, 'delivered'\)/); assert.doesNotMatch(c, /crm_visit_mark/);
});

/* ---------- 8. activity feed ---------- */
test('the activity feed shows date, India time, what happened and who, with a tone per kind; falls back to the old history', async () => {
  const rows = [{ at: '2026-11-12T05:30:00Z', kind: 'delivery', title: 'Vehicle delivered', detail: 'Handed over', by_name: '[Admin Name]' }, { at: '2026-11-11T05:30:00Z', kind: 'refund', title: 'Refund sent', by_name: '[Admin Name]' }];
  const t = setup({ replies: { crm_booking_timeline: rows } }); const el = { innerHTML: '', addEventListener() {} }; await t.fl.mountTimeline(el, 'lead-1');
  assert.deepEqual(t.rpcCalls('crm_booking_timeline')[0], { p_lead: 'lead-1', p_limit: 20 }); assert.match(el.innerHTML, /Vehicle delivered/); assert.match(el.innerHTML, /11:00 am/); assert.match(el.innerHTML, /12 Nov 2026/); assert.match(el.innerHTML, /\[Admin Name\]/); assert.match(el.innerHTML, /data-kind="refund"/);
  assert.equal(R.istStamp('2026-11-12T05:30:00Z').time, '11:00 am');
  const f = setup({ fail: { crm_booking_timeline: 'does not exist' } }); f.fl = createFlow({ rpc: async () => { throw new Error('does not exist'); }, invoke: async () => ({}), toast() {}, can: () => true, reload() {}, timelineFallback: async () => [{ created_at: '2026-11-10T05:00:00Z', kind: 'note', body: 'Old note', actor: '[Crew Name]' }] });
  const el2 = { innerHTML: '', addEventListener() {} }; await f.fl.mountTimeline(el2, 'lead-1'); assert.match(el2.innerHTML, /Old note/); assert.match(el2.innerHTML, /\[Crew Name\]/);
});

/* ---------- 9. tracking page ---------- */
test('the tracking page shows delivery stages and a cancelled card with the refund in plain words, never a gateway id', () => {
  assert.equal(track.deliveryHtml({ stage: 'none' }), ''); assert.match(track.deliveryHtml({ stage: 'ready' }), /Your vehicle is ready for delivery/); assert.match(track.deliveryHtml({ stage: 'delivered', at: '2026-11-12T05:00:00Z' }), /Delivered on 12 Nov 2026/); assert.match(track.deliveryHtml({ stage: 'closed' }), /Booking closed/);
  assert.equal(track.cancelHtml({ cancelled: false }), '');
  for (const [s, w] of [['none', /No refund is due/], ['pending', /being arranged/], ['processing', /5 to 7 working days/], ['refunded', /paid back/], ['failed', /could not be completed yet/]]) assert.match(track.cancelHtml({ cancelled: true, kind: 'customer', refund: { status: s, amount: 249 } }), w);
  assert.match(track.cancelHtml({ cancelled: true, kind: 'customer', refund: { status: 'processing', amount: 249 } }), /₹249\.00/);
  assert.doesNotMatch(track.cancelHtml({ cancelled: true, refund: { status: 'processing', amount: 1, cf_refund_id: 'CF99' } }), /CF99/); assert.match(track.cancelHtml({ cancelled: true, refund: { status: 'none' }, kind: '<b>' }), /cancelled/);
  const src = read('assets/js/track.js'); assert.match(src, /Reject the quote/); assert.match(src, /data-sure/); assert.match(src, /quote-decision/); assert.match(src, /'trDelivery'/);
});

/* ---------- 10. garage panel ---------- */
test('the garage job shows approval, cancellation and delivery lines and blocks nothing', () => {
  const n = (j) => garage.lifecycleNotes(j).map((x) => x.text);
  assert.deepEqual(n({ approval: { status: 'approved', by: 'customer' } }), ['Customer approved the estimate']); assert.deepEqual(n({ approval: { status: 'approved', by: 'admin' } }), ['Approved by Mechanix Pro on behalf of the customer']);
  assert.deepEqual(n({ approval: { status: 'pending' } }), ['Waiting for the customer to approve']); assert.deepEqual(n({ customer_cancelled: true }), ['Booking cancelled by the customer']);
  assert.deepEqual(n({ delivery: { stage: 'ready' } }), ['Vehicle marked ready for delivery']); assert.deepEqual(n({}), []); assert.deepEqual(n(null), []);
  assert.match(read('assets/js/garage.js'), /lifecycleNotes\(j\)\.map\(function \(n\) \{ return notice\(n\.tone, n\.text\); \}\)/);   // rendered through el(), which sets text (escaped)
});

/* ---------- shared files ---------- */
test('the new shared file is copied byte for byte and uses no inline handlers', () => {
  assert.equal(read('admin/manage-rules.js'), read('crm/manage-rules.js')); assert.equal(read('admin/flow-core.js'), read('crm/flow-core.js')); assert.match(read('scripts/shared-files.txt'), /manage-rules\.js/);
  assert.doesNotMatch(read('crm/flow-core.js'), /\bon(click|change)="/);
});

test('Edit estimate approves a waiting garage estimate first, then the edited lines overwrite the draft; the Dispatch heading says garage or partner', () => {
  const core = read('crm/flow-core.js'); assert.equal(read('admin/flow-core.js'), core);
  const i = core.indexOf("if (ge && ge.status === 'submitted')"), j = core.indexOf("await rpc('crm_quote_save'", i);
  assert.ok(i > 0 && j > i, 'approval comes before the quote save');
  assert.match(core.slice(i, j), /crm_garage_estimate_review', \{ p_id: ge\.id, p_approve: true/); assert.match(core.slice(i, j), /already reviewed\|already a draft quote/);
  assert.match(core, /head\('Paid, needs a garage or partner'/); assert.doesNotMatch(core, /Paid, needs a mechanic/);
});
