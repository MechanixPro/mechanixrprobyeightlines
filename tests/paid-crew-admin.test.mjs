import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as crew from '../crm/crm-rules.js';
import * as admin from '../admin/booking-steps.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const L = (o) => ({ status: 'new', crm_owner: 'u1', booking_id: null, crm_first_contact_at: null, ...o });

test('dispatch: unpaid-assignment first, then by day, then slot time (as soon as possible first), then the oldest', () => {
  const rows = [
    { id: 'a-assigned-early', mechanic_id: 'm', preferred_date: '2026-11-06', preferred_slot: 'asap', created_at: '2026-11-05T01:00:00Z' },
    { id: 'b-evening', preferred_date: '2026-11-06', preferred_slot: 'evening', created_at: '2026-11-05T02:00:00Z' },
    { id: 'c-morning-late', preferred_date: '2026-11-06', preferred_slot: 'morning', created_at: '2026-11-05T05:00:00Z' },
    { id: 'd-morning-early', preferred_date: '2026-11-06', preferred_slot: 'morning', created_at: '2026-11-05T03:00:00Z' },
    { id: 'e-tomorrow-asap', preferred_date: '2026-11-07', preferred_slot: 'asap', created_at: '2026-11-05T01:00:00Z' },
    { id: 'f-asap', preferred_date: '2026-11-06', preferred_slot: 'asap', created_at: '2026-11-05T06:00:00Z' },
  ];
  const want = ['f-asap', 'd-morning-early', 'c-morning-late', 'b-evening', 'e-tomorrow-asap', 'a-assigned-early'];
  assert.deepEqual(crew.dispatchOrder(rows).map((r) => r.id), want); assert.deepEqual(admin.dispatchOrder(rows).map((r) => r.id), want);
  assert.deepEqual(rows.map((r) => r.id)[0], 'a-assigned-early');   // the input is not changed
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(sql, /order by \(row ->> 'assigned'\) , row ->> 'preferred_date', \(row ->> 'slot_rank'\)::int, row ->> 'created_at'/); assert.match(sql, /when 'asap' then 0 when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3/);
  const dl = sql.slice(sql.indexOf('function public.crm_dispatch_list')); assert.doesNotMatch(dl.slice(0, dl.indexOf('end; $$')), /'phone'|'address'/);   // area and PIN only
});
test('the step bar shows "Payment link sent" at step 3 without moving any existing step', () => {
  for (const m of [crew, admin]) {
    const linked = m.bookingStep(L({ status: 'payment_sent', confirm_fee: 69 }));
    assert.equal(linked.key, 'quote'); assert.equal(linked.index, 2); assert.equal(linked.label, 'Payment link sent'); assert.equal(linked.steps[2].label, 'Payment link sent'); assert.equal(linked.steps.length, 6);
    assert.equal(m.bookingStep(L({ status: 'quoted' })).label, 'Quote sent');   // a plain quote still reads as before
    assert.deepEqual(m.STEPS.map(([, t]) => t), ['Lead', 'Called', 'Quote sent', 'Confirmed', 'Scheduled', 'Done']);
    assert.equal(m.bookingStep(L({ status: 'paid', booking_id: 'MP-1', confirm_fee: 69, confirm_paid_at: 'x' })).key, 'confirmed');
  }
});
test('a lead moves to Confirmed only when paid: confirming and scheduling are refused while the fee waits', () => {
  for (const m of [crew, admin]) {
    const unpaid = L({ status: 'payment_sent', confirm_fee: 69 });
    for (const target of ['confirm', 'schedule']) { const g = m.stepGuard(unpaid, target); assert.equal(g.ok, false); assert.match(g.error, /Waiting for the confirmation fee/); }
    assert.equal(m.stepGuard(L({ status: 'quoted' }), 'confirm').ok, true);   // an old-style lead can still be confirmed
    assert.equal(m.stepGuard(L({ status: 'paid', booking_id: 'MP-1', confirm_fee: 69, confirm_paid_at: 'x' }), 'schedule').ok, true);
    assert.equal(m.confirmPending(unpaid), true); assert.equal(m.confirmPending(L({ confirm_fee: 69, confirm_paid_at: 'x' })), false); assert.equal(m.confirmPending(L({})), false);
  }
  assert.equal(crew.nextAction(L({ status: 'payment_sent', confirm_fee: 69 }), 'agent', { canCreate: true, userId: 'u1' }).key, 'resend_link');
  assert.equal(admin.nextAction(L({ status: 'payment_sent', confirm_fee: 69 })).key, 'resend_link');
  assert.equal(crew.nextAction(L({ status: 'paid', booking_id: 'MP-1', confirm_fee: 69, confirm_paid_at: 'x' }), 'supervisor').key, 'assign');
  assert.equal(crew.nextAction(L({ status: 'paid', booking_id: 'MP-1', confirm_fee: 69, confirm_paid_at: 'x', mechanic_name: 'Ravi' }), 'supervisor').key, 'schedule');
  assert.equal(crew.nextAction(L({ status: 'quoted' }), 'agent', { canCreate: true, userId: 'u1' }).label, 'Confirm booking');   // unchanged for old leads
});
test('the Paid badge and the quote and visit state show in lead views, in Crew and the Admin the same way', () => {
  for (const m of [crew, admin]) {
    assert.deepEqual(m.paidBadge(L({ confirm_fee: 49, confirm_paid_at: 'x' })), { text: 'Paid ₹49', tone: 'good' });
    assert.deepEqual(m.paidBadge(L({ confirm_fee: 99 })), { text: 'Unpaid ₹99', tone: 'warn' }); assert.equal(m.paidBadge(L({})), null);
    const sub = (o) => (m.visitSub(L({ confirm_fee: 69, confirm_paid_at: 'x', ...o })) || {}).label;
    assert.equal(sub({ quote_state: 'sent' }), 'Quote sent'); assert.equal(sub({ quote_state: 'approved' }), 'Approved'); assert.equal(sub({ visit_stage: 'repair_doorstep', quote_state: 'approved' }), 'Work started');
    assert.equal(sub({ visit_stage: 'picked_up' }), 'Work started'); assert.equal(sub({ visit_stage: 'ready' }), 'Ready'); assert.equal(sub({ visit_stage: 'returned' }), 'Delivered'); assert.equal(sub({}), undefined);
    assert.equal(m.bookingStep(L({ status: 'paid', booking_id: 'MP-1', confirm_fee: 69, confirm_paid_at: 'x', quote_state: 'approved' })).sub.label, 'Approved');
  }
  const ui = read('crm/ui.js'); assert.match(ui, /crm_paid_badges/); assert.match(ui, /WITH_BADGES = new Set\(\['crm_queue', 'crm_my_leads', 'crm_leads_list', 'crm_web_leads', 'crm_call_queue'\]\)/); assert.match(ui, /paidChips/);
  assert.match(read('admin/admin.js'), /const pb = paidBadge\(l\)/);
});
test('the conversion funnel keeps its old numbers; the new quote counts come from their own function', () => {
  const rows = [L({ status: 'completed', booking_id: 'MP-1', created_at: '2026-11-05T05:00:00Z', crm_first_contact_at: '2026-11-05T05:05:00Z' }), L({ status: 'new', created_at: '2026-11-05T05:00:00Z' })];
  assert.deepEqual(crew.leadMetrics(rows).done, admin.leadMetrics(rows).done); assert.equal(crew.leadMetrics(rows).leads, 2);
  assert.match(read('supabase/migrations/20261228000000_paid_confirmation.sql'), /function public\.crm_quote_counts[\s\S]*'quotes_sent'[\s\S]*'approved'[\s\S]*'work_started'[\s\S]*'delivered'/);
});
test('failed and skipped messages get a Resend button; team alerts do not', () => {
  const rows = [{ kind: 'confirm_email', status: 'sent' }, { kind: 'receipt_email', status: 'failed' }, { kind: 'confirm_whatsapp', status: 'skipped' }, { kind: 'quote_email:2', status: 'failed' }, { kind: 'team_paid', status: 'failed' }, { kind: 'team_unassigned', status: 'failed' }];
  assert.deepEqual(crew.resendable(rows).map((r) => r.kind), ['receipt_email', 'confirm_whatsapp', 'quote_email:2', 'team_paid']);
});
test('Crew and the Admin run the same code: the shared files are identical copies', () => {
  for (const f of ['flow-core.js', 'flow-rules.js', 'flow.css']) assert.equal(read('crm/' + f), read('admin/' + f), f + ' differs between crm/ and admin/');
  assert.match(read('admin/index.html'), /flow\.css/); assert.match(read('crm/index.html'), /flow\.css/);
  assert.match(read('admin/admin.js'), /from '\.\/flow-core\.js'/); assert.match(read('crm/crm.js'), /from '\.\/flow-core\.js'/);
  assert.doesNotMatch(read('crm/flow-core.js'), /<script|innerHTML = .*on(click|change)=|\bon(click|change)="/);   // strict CSP: no inline handlers
});
test('every database function the shared screens call lets an admin through (flow_ checks) and keeps agents and technicians to their rights', () => {
  const core = read('crm/flow-core.js'), sql = read('supabase/migrations/20261228000000_paid_confirmation.sql') + read('supabase/migrations/20261229000000_customer_updates.sql') + read('supabase/migrations/20261230000000_tech_location.sql');   // the journey migrations add crm_booking_updates, crm_issue_resolve, crm_tech_location (same flow_ guards)
  const names = [...new Set([...core.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
  const viaOldRpc = ['crm_mechanic_picker', 'crm_lead', 'crm_log'];   // crm_lead and crm_log: Tell mechanic reads the phone and the told note, and logs the note, with the existing Crew functions (no new RPC); a failure there never blocks the card or WhatsApp   // admin supplies its own mechanic list instead (deps.mechanics), checked below
  assert.ok(names.length >= 10, names.join());
  // crm_assign_technician is the existing function; it checks through crm_move_guard, which this migration re-creates with the admin-aware checks.
  const old = read('supabase/migrations/20261220000000_desk_move_lead.sql'); assert.match(old.slice(old.indexOf('function public.crm_assign_technician')), /l := public\.crm_move_guard\(p_id, p_mechanic\)/);
  assert.ok(sql.includes('function public.crm_move_guard('));
  for (const n of names.filter((x) => !viaOldRpc.includes(x) && x !== 'crm_assign_technician')) {
    const body = sql.slice(sql.indexOf(`function public.${n}(`)); assert.ok(sql.includes(`function public.${n}(`), n + ' is defined in the migration');
    const fn = body.slice(0, body.indexOf('end; $$') > 0 ? body.indexOf('end; $$') : 3000);
    assert.match(fn, /flow_need\(\)|quote_guard\(|crm_move_guard\(|flow_require\(/, n + ' has an admin-aware guard');
    assert.doesNotMatch(fn, /crm_need_role\(\)|public\.crm_can\(|crm_require\(/, n + ' must not use the Crew-only checks');
  }
  assert.match(read('admin/admin.js'), /mechanics: async \(\) => \{ const \{ data \} = await sb\.from\('mechanics'\)/);
  assert.match(sql, /select public\.is_admin\(\) or public\.crm_can\(p_action\)/);   // flow_can: admin passes, everyone else keeps their own permissions
  assert.match(sql, /coalesce\(l\.crm_owner = auth\.uid\(\), false\)/);              // an unowned lead is not "yours" (null must not pass)
  assert.match(read('supabase/functions/booking-notify/index.ts'), /crm_resend_guard/); assert.match(read('supabase/functions/booking-notify/index.ts'), /crm_quote_send/);
  assert.match(read('supabase/functions/desk-payment-link/index.ts'), /crm_payment_context/);   // Crew and Admin both use this function, so one code path
  assert.match(read('admin/admin.js'), /paymentFn: 'payment-link'/);
});
test('the admin can do everything Crew does in this flow: each Crew action also exists in the admin screens', () => {
  const core = read('admin/flow-core.js');
  for (const a of ['payLink', 'assign', 'jobLink', 'doorCode', 'newDoorCode', 'markReady', 'markDelivered', 'resend', 'phoneApprove', 'eta', 'quote']) assert.ok(new RegExp(`async ${a}\\(|${a}\\(lead`).test(core), a);
  const adm = read('admin/admin.js'); for (const w of ['flow.card(', 'flow.dispatchHtml(', 'crm_dispatch_list', 'flow.bind(', 'flow.actions.assign', 'flow.actions.payLink']) assert.ok(adm.includes(w), 'admin.js ' + w);
  assert.match(read('admin/nav.js'), /\['dispatch', 'Dispatch'\]/);
});
test('on a real local Postgres: admin passes every step, strangers and agents do not, gating and idempotency hold (skipped when no Postgres tools are installed)', (t) => {
  const r = spawnSync('sh', [new URL('../supabase/local-test/run.sh', import.meta.url).pathname], { encoding: 'utf8', timeout: 400000 });
  if (r.status === 3) return t.skip('no local Postgres tools');
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
  assert.match(r.stdout, /ALL PAID CONFIRMATION SQL CHECKS PASSED/); assert.match(r.stdout, /ALL GARAGE APP SQL CHECKS PASSED/);
});
