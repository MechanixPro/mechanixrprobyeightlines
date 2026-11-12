import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvalState, deliveryView, cancelView, refundView, mapRefundStatus, nextRefundStatus, deliveryText, approvalText, garageApprovedText, garageRejectedText } from '../supabase/functions/_shared/lifecycle.ts';
import { syncBookingRefund } from '../supabase/functions/_shared/admin-refund.ts';
import { trackView } from '../supabase/functions/_shared/track.ts';
import { garageJobDetail, garageJobListItem } from '../supabase/functions/_shared/garage.ts';
import { KINDS } from '../supabase/functions/_shared/notify.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SQL = read('supabase/migrations/20270144000000_booking_lifecycle.sql');

test('approval status enum: none, pending, approved_self, approved_admin, rejected, changes_requested', () => {
  assert.equal(approvalState(null).status, 'none');
  assert.equal(approvalState({ status: 'sent', version: 1 }).status, 'pending');
  assert.deepEqual([approvalState({ status: 'approved', decided_method: 'customer_link' }).status, approvalState({ status: 'approved', decided_method: 'customer_app' }).by], ['approved_self', 'customer']);
  for (const m of ['phone', 'whatsapp']) { const a = approvalState({ status: 'approved', decided_method: m, version: 3, decided_at: 'T' }); assert.deepEqual([a.status, a.by, a.at, a.version], ['approved_admin', 'admin', 'T', 3]); }
  assert.equal(approvalState({ status: 'approved', decided_via: 'phone' }).status, 'approved_admin', 'older phone approvals have no method yet');
  assert.equal(approvalState({ status: 'approved', decided_via: 'link' }).status, 'approved_self');
  assert.equal(approvalState({ status: 'declined' }).status, 'rejected');
  assert.equal(approvalState({ status: 'changes_requested' }).status, 'changes_requested');
  assert.equal(approvalState({ status: 'superseded' }).status, 'none');
});

test('delivery and cancel blocks', () => {
  assert.deepEqual(deliveryView({}), { stage: 'none', at: null });
  assert.deepEqual(deliveryView({ delivery_stage: 'ready', ready_at: 'R' }), { stage: 'ready', at: 'R' });
  assert.deepEqual(deliveryView({ delivery_stage: 'delivered', delivered_at: 'D' }), { stage: 'delivered', at: 'D' });
  assert.deepEqual(deliveryView({ delivery_stage: 'closed', closed_at: 'C' }), { stage: 'closed', at: 'C' });
  assert.deepEqual(cancelView({ status: 'paid' }, []), { cancelled: false, kind: null, refund: { status: 'none', amount: 0 } });
  assert.equal(cancelView({ status: 'cancelled', cancel_kind: 'customer', refund_due: 49 }, []).refund.status, 'pending');
  assert.equal(cancelView({ status: 'cancelled', cancel_kind: 'unreachable', refund_due: 49 }, []).kind, 'company');
  assert.deepEqual(cancelView({ status: 'cancelled', cancel_kind: 'company', refund_due: 49 }, [{ status: 'refunded', amount: 49 }]).refund, { status: 'refunded', amount: 49 });
  assert.equal(refundView(49, [{ status: 'processing', amount: 49 }]).status, 'processing');
  assert.equal(refundView(49, [{ status: 'failed', amount: 49 }]).status, 'pending', 'a failed attempt with money still due is pending again');
  assert.equal(refundView(0, [{ status: 'failed', amount: 49 }]).status, 'failed');
  assert.equal(refundView(0, []).status, 'none');
});

test('Cashfree status mapping and a finished refund never goes back', () => {
  assert.deepEqual(['PENDING', 'ONHOLD', 'SUCCESS', 'CANCELLED', 'REJECTED', 'FAILED', 'weird'].map(mapRefundStatus), ['processing', 'processing', 'refunded', 'failed', 'failed', 'failed', 'pending']);
  assert.equal(nextRefundStatus('refunded', 'processing'), 'refunded'); assert.equal(nextRefundStatus('failed', 'pending'), 'failed'); assert.equal(nextRefundStatus('pending', 'processing'), 'processing');
});

function refundDb(rows = []) {
  const t = { rows, ledger: [{ id: 'L1', gateway_txn_id: 'cfr_rf1' }] };
  const q = (table) => { const f = {}; const api = {
    select() { return api; }, eq(k, v) { f[k] = v; return api; },
    maybeSingle: async () => ({ data: (table === 'booking_refunds' ? t.rows : t.ledger).find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null }),
    update(p) { return { eq: async (k, v) => { Object.assign(t.rows.find((r) => r[k] === v), p); return {}; } }; },
    insert: async (r) => { t.rows.push({ id: 'n' + t.rows.length, ...r }); return {}; },
  }; return api; };
  return { from: q, t };
}
test('syncBookingRefund: status, reference and Cashfree id; inserts when the trigger row is missing; never throws', async () => {
  const db = refundDb([{ id: 'r1', lead_id: 'A', reference: 'rf1', status: 'pending' }]);
  await syncBookingRefund(db, { leadId: 'A', refundId: 'rf1', cfRefundId: 9001, cashfreeStatus: 'PENDING', amount: 49 });
  assert.deepEqual([db.t.rows[0].status, db.t.rows[0].gateway_refund_id], ['processing', '9001']);
  await syncBookingRefund(db, { leadId: 'A', refundId: 'rf1', cashfreeStatus: 'SUCCESS' }); assert.equal(db.t.rows[0].status, 'refunded');
  await syncBookingRefund(db, { leadId: 'A', refundId: 'rf1', cashfreeStatus: 'PENDING' }); assert.equal(db.t.rows[0].status, 'refunded', 'late pending ignored');
  const db2 = refundDb([]); await syncBookingRefund(db2, { leadId: 'A', refundId: 'rf1', cfRefundId: '7', cashfreeStatus: 'SUCCESS', amount: 49, reason: 'x', adminId: 'adm' });
  assert.deepEqual([db2.t.rows[0].method, db2.t.rows[0].status, db2.t.rows[0].ledger_entry_id, db2.t.rows[0].reference], ['cashfree', 'refunded', 'L1', 'rf1']);
  await assert.doesNotReject(syncBookingRefund({ from() { throw new Error('boom'); } }, { leadId: 'A', refundId: 'rf1', cashfreeStatus: 'SUCCESS' }));
  await assert.doesNotReject(syncBookingRefund({ from: () => ({}) }, { leadId: 'A', refundId: 'rf1', cashfreeStatus: 'SUCCESS' }), 'the older fake database without this table still works');
});

test('customer messages are short, end with the booking ID and never show the private ref', () => {
  const lead = { name: 'Asha Rao', booking_id: 'MP-26-27-0012', ref: 'L-ABC123' };
  for (const t of [deliveryText('ready', lead, 'bike'), deliveryText('delivered', lead, 'bike'), approvalText('customer', lead), approvalText('admin', lead), garageApprovedText(lead, 'admin'), garageRejectedText(lead, 'too high')]) {
    assert.match(t, /Booking MP-26-27-0012\.$/); assert.ok(!t.includes('L-ABC123')); assert.ok(t.length < 200);
  }
  assert.match(deliveryText('ready', { name: 'A', ref: 'L-ABC123' }, 'bike'), /Booking request\.$/, 'no booking ID yet: a neutral word, never the ref');
});

test('tracking payload carries delivery and cancel blocks (token and phone modes), no gateway ids', () => {
  const lead = { status: 'cancelled', booking_id: 'MP-26-27-0001', confirm_fee: 49, confirm_paid_at: 'x', cancel_kind: 'customer', refund_due: 49, delivery_stage: null, preferred_date: null };
  const out = trackView(lead, { refunds: [{ status: 'processing', amount: 49, gateway_refund_id: '9', reference: 'rf1' }] });
  assert.deepEqual(Object.keys(out.delivery), ['stage', 'at']); assert.deepEqual(out.cancel, { cancelled: true, kind: 'customer', refund: { status: 'processing', amount: 49 } });
  assert.equal(out.closed, true); assert.match(out.note, /cancelled/);
  assert.ok(!JSON.stringify(out).includes('rf1') && !JSON.stringify(out).includes('9001'));
  const done = trackView({ status: 'completed', booking_id: 'MP-1', delivery_stage: 'delivered', delivered_at: 'D', confirm_fee: 49, confirm_paid_at: 'x' }, {});
  assert.deepEqual(done.delivery, { stage: 'delivered', at: 'D' }); assert.equal(done.cancel.cancelled, false);
  const plain = trackView({ status: 'new', booking_id: null }, {}); assert.equal(plain.delivery.stage, 'none'); assert.equal(plain.cancel.refund.status, 'none');
  const withQuote = trackView({ status: 'paid', confirm_fee: 49, confirm_paid_at: 'x' }, { secret: { code: null }, quote: { status: 'approved', version: 1, decided_method: 'phone', decided_at: 'T' } });
  assert.equal(withQuote.quote.approval.status, 'approved_admin'); assert.equal(withQuote.quote.can_decide, false);
  const open = trackView({ status: 'paid', confirm_fee: 49, confirm_paid_at: 'x' }, { secret: { code: null }, quote: { status: 'sent', version: 1 } });
  assert.equal(open.quote.can_decide, true, 'approve, decline and ask for changes stay reachable from the tracking page');
});

test('garage job payload: approval, delivery, customer_cancelled', () => {
  const base = { assignment: { id: 'A1', status: 'received' }, lead: { name: 'Asha Rao', booking_id: 'MP-1', status: 'paid' }, quote: { status: 'approved' } };
  const self = garageJobDetail({ ...base, approval: { status: 'approved', decided_method: 'customer_app', version: 2, decided_at: 'T' } }, false);
  assert.deepEqual([self.approval.status, self.approval.by, self.approval.version, self.approval.at], ['approved_self', 'customer', 2, 'T']);
  const adm = garageJobDetail({ ...base, approval: { status: 'approved', decided_method: 'whatsapp', version: 2 } }, false);
  assert.deepEqual([adm.approval.status, adm.approval.by], ['approved_admin', 'admin']); assert.match(adm.quote.label, /on behalf of the customer/);
  assert.equal(self.quote.label, 'Approved by the customer');
  assert.deepEqual(self.delivery, { stage: 'none', at: null }); assert.equal(self.customer_cancelled, false);
  const gone = garageJobListItem({ assignment: { id: 'A1', status: 'cancelled' }, lead: { status: 'cancelled', delivery_stage: null }, quote: null });
  assert.equal(gone.customer_cancelled, true); assert.equal(gone.status_label, 'Cancelled');
  assert.equal(garageJobListItem({ assignment: { id: 'A', status: 'ready' }, lead: { delivery_stage: 'delivered', delivered_at: 'D' } }).delivery.stage, 'delivered');
  assert.equal(garageJobListItem({ assignment: { id: 'A', status: 'sent' }, lead: {}, quote: { status: 'sent' } }).approval.status, 'pending');
  assert.ok(!('customer_phone' in self) && !JSON.stringify(self).includes('9876'), 'no new customer contact data');
});

test('every new RPC checks the role in the database and is closed to anon', () => {
  const fns = [...SQL.matchAll(/create or replace function public\.(crm_\w+|quote_decide)\(([^)]*)\)[\s\S]*?\n(?:end; \$\$;|\$\$;)/g)];
  const names = fns.map((m) => m[1]);
  for (const n of ['crm_booking_state', 'crm_delivery_set', 'crm_quote_admin_approve', 'crm_quote_phone_approve', 'crm_booking_estimates', 'crm_garage_estimate_review', 'crm_booking_refunds', 'crm_assignment_info', 'crm_assign_booking', 'crm_booking_timeline', 'crm_cancellations_list']) assert.ok(names.includes(n), n + ' is defined');
  for (const m of fns) {
    if (m[1] === 'quote_decide') { assert.match(SQL, /grant execute on function public\.quote_decide\(text, int, text, text, text\) to service_role/); continue; }
    assert.match(m[0], /flow_need\(\)|quote_guard\(|crm_quote_admin_approve\(|garage_staff_need\(\)/, m[1] + ' checks the role inside the function');
    assert.match(SQL, new RegExp('revoke all on function public\\.' + m[1] + '\\([^)]*\\) from public, anon'), m[1] + ' is revoked from anon');
    assert.match(SQL, new RegExp('grant execute on function public\\.' + m[1] + '\\([^)]*\\) to authenticated'), m[1] + ' is granted to authenticated only');
  }
  for (const n of ['crm_delivery_set', 'crm_booking_timeline', 'crm_booking_estimates', 'crm_assignment_info', 'crm_booking_refunds', 'crm_booking_state']) assert.match(SQL.match(new RegExp('function public\\.' + n + '\\([\\s\\S]*?\\n(?:end; \\$\\$;)'))[0], /crm_can_see\(/, n + ' checks that the person may see the booking');
});

test('migration: kinds, columns, refunds table, never weakens', () => {
  for (const k of ['delivery_ready_email', 'delivery_ready_whatsapp', 'delivery_done_email', 'delivery_done_whatsapp', 'approval_email', 'approval_whatsapp', 'garage_approved', 'refund_email', 'refund_whatsapp']) { assert.ok(SQL.includes(k)); assert.ok(KINDS.includes(k), k + ' in notify.ts'); }
  for (const old of ['confirm_email', 'team_garage_ready', 'ontheway_email', 'team_quote_decision']) assert.ok(SQL.includes(old), 'the old kind ' + old + ' is kept in the regex');
  assert.match(SQL, /\(:\[0-9\]\{1,3\}\)\?\$'\)/);
  assert.match(SQL, /delivery_stage text check \(delivery_stage in \('ready','delivered','closed'\)\)/);
  assert.match(SQL, /decided_method\s+text check \(decided_method in \('phone','whatsapp','customer_link','customer_app'\)\)/);
  assert.match(SQL, /alter table public\.booking_refunds enable row level security/); assert.match(SQL, /revoke all on public\.booking_refunds from public, anon, authenticated/); assert.match(SQL, /using \(public\.is_admin\(\)\)/);
  assert.match(SQL, /method\s+text not null check \(method in \('cashfree', 'manual'\)\)/);
  assert.doesNotMatch(SQL, /leads_no_new_mechanic/, 'the retired mechanic assignment is not touched');
  assert.doesNotMatch(SQL, /update public\.leads set mechanic_id/);
});

test('functions: booking-notify actions, quote-decision source and notice, webhook and refund sync', () => {
  const bn = read('supabase/functions/booking-notify/index.ts');
  assert.match(bn, /'delivery_update'/); assert.match(bn, /'approval_notice'/); assert.match(bn, /rpc\('crm_booking_state'/); assert.match(bn, /Choose ready or delivered/);
  const qd = read('supabase/functions/quote-decision/index.ts');
  assert.match(qd, /p_source: b\?\.source === 'track' \? 'track' : 'link'/); assert.match(qd, /sendApprovalNotice/); assert.match(qd, /notifyTeamDecision/);
  const ar = read('supabase/functions/_shared/admin-refund.ts');
  assert.equal((ar.match(/await syncBookingRefund\(/g) ?? []).length, 3, 'refund, repeat refund and webhook all sync the table');
  const ap = read('supabase/functions/_shared/after-payment.ts');
  assert.match(ap, /sendSmart\(/); assert.match(ap, /deliverAll\(dbStore\(db\), leadId, jobs/); assert.match(ap, /delivery_ready/); assert.match(ap, /garage_approved:\$\{n\}/);
  const tb = read('supabase/functions/track-booking/index.ts'); assert.match(tb, /delivery_stage,ready_at,delivered_at,closed_at,cancel_kind,cancelled_at,refund_due/); assert.match(tb, /select\('status,amount'\)/);
  const ga = read('supabase/functions/garage-app/index.ts'); assert.match(ga, /mine\(jobId, true\)/);
});
