// "Refund to customer now": an Admin refunds a Cashfree payment through Cashfree's Refunds API and the ledger records it.
// Money code: fails closed, idempotent, never trusts the browser. No Deno-only imports, so Node tests it with a mocked fetch and a fake database.
// The caller (admin-refund/index.ts) has already proved the user is an Admin through the database (is_admin()). Crew can never reach this.
import { mapRefundStatus, nextRefundStatus } from './lifecycle.ts';
import { CashfreeError, createCashfreeRefund, getCashfreeOrderPayments, getCashfreeRefund, isCashfreeOrderId, rupees2 } from './cashfree.ts';

type Db = any;
export type RefundIn = { adminId: string; leadId: string; amount: unknown; reason: unknown; serviceIssue?: unknown };
export type Out = { status: number; body: Record<string, unknown> };

export const MANUAL_MSG = 'This money was not taken through Cashfree (or the Cashfree order could not be found), so it cannot be refunded automatically. Refund it the way it was paid, then record it in the money sheet.';
const ACCEPTED = ['SUCCESS', 'PENDING', 'ONHOLD'];
const FAILED = ['CANCELLED', 'REJECTED', 'FAILED'];
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { error, ...extra } });

type Row = any;
/** What can still be refunded, and through which Cashfree orders. Reads the ledger and the audit log only; each order is confirmed with Cashfree afterwards. */
export function refundable(rows: Row[], audits: Row[]) {
  const reversed = new Set(rows.filter((r) => r.reverses_id).map((r) => r.reverses_id));
  const live = rows.filter((r) => !reversed.has(r.id) && r.entry_type !== 'reversal');
  const orderOf = new Map<string, string>();
  for (const a of audits) if (['payment_received', 'final_paid_online'].includes(a.action) && a.details?.payment_id && a.details?.order_id) orderOf.set(String(a.details.payment_id), String(a.details.order_id));
  const orders: { orderId: string; txn: string; amount: number; id: string }[] = [];
  for (const r of live) {
    if (r.entry_type !== 'customer_payment' || r.source !== 'gateway' || !/^cashfree/i.test(String(r.method ?? ''))) continue;
    const txn = String(r.gateway_txn_id ?? ''), oid = orderOf.get(txn) ?? '';
    if (txn && !txn.startsWith('cfr_') && isCashfreeOrderId(oid)) orders.push({ orderId: oid, txn, amount: rupees2(r.amount), id: r.id });
  }
  const refundsAll = rupees2(live.filter((r) => r.entry_type === 'refund').reduce((s, r) => s + Number(r.amount), 0));
  const refundedOn = (oid: string) => rupees2(live.filter((r) => r.entry_type === 'refund' && r.source === 'gateway' && String(r.note ?? '').includes('order ' + oid)).reduce((s, r) => s + Number(r.amount), 0));
  const cashfreeTotal = rupees2(orders.reduce((s, o) => s + o.amount, 0));
  const cap = rupees2(Math.max(0, cashfreeTotal - refundsAll));
  const refundRows = rows.filter((r) => r.entry_type === 'refund' && String(r.gateway_txn_id ?? '').startsWith('cfr_')).length;
  return { orders, cap, cashfreeTotal, refundsAll, refundedOn, refundRows };
}

/** Keeps booking_refunds in step with Cashfree: pending / processing / refunded / failed. The ledger trigger already made the row; this sets the status, the reference (our refund_id) and Cashfree's cf_refund_id.
 *  Best effort and never throws: the ledger is the record of money, this table is the screen's view of it. A finished status is never undone by a late one. */
export async function syncBookingRefund(db: Db, o: { leadId: string; refundId: string; cfRefundId?: unknown; cashfreeStatus: unknown; amount?: number; reason?: string; adminId?: string | null }): Promise<void> {
  try {
    const status = mapRefundStatus(o.cashfreeStatus), gw = o.cfRefundId != null && String(o.cfRefundId) !== '' ? String(o.cfRefundId).slice(0, 40) : null;
    const { data: row } = await db.from('booking_refunds').select('id,status').eq('lead_id', o.leadId).eq('reference', o.refundId).maybeSingle();
    if (row) {
      const patch: Record<string, unknown> = { status: nextRefundStatus(row.status, status), updated_at: new Date().toISOString() };
      if (gw) patch.gateway_refund_id = gw;
      await db.from('booking_refunds').update(patch).eq('id', row.id);
      return;
    }
    const { data: led } = await db.from('ledger_entries').select('id').eq('gateway_txn_id', 'cfr_' + o.refundId).maybeSingle();
    await db.from('booking_refunds').insert({ lead_id: o.leadId, kind: 'partial', amount: o.amount ?? 0, method: 'cashfree', reference: o.refundId, gateway_refund_id: gw, status, reason: o.reason ?? null, created_by: o.adminId ?? null, ledger_entry_id: led?.id ?? null });
  } catch (e) { console.error('syncBookingRefund', (e as Error)?.message); }
}

export async function runRefund(db: Db, i: RefundIn): Promise<Out> {
  const leadId = String(i.leadId ?? '');
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return fail(404, 'Booking not found.');
  const amount = Number(i.amount);
  if (!Number.isFinite(amount) || !(amount > 0) || rupees2(amount) !== amount) return fail(400, 'Enter a refund amount above zero, in rupees (up to 2 decimals).');
  const reason = clean(i.reason, 200);
  if (reason.length < 3) return fail(400, 'Write a short reason for the refund.');
  const { data: lead } = await db.from('leads').select('id,ref,status,deleted_at').eq('id', leadId).maybeSingle();
  if (!lead || lead.deleted_at) return fail(404, 'Booking not found.');
  // Safest rule: a cancelled booking, or any other booking only when the Admin states it is a service-issue refund and gives a real reason (10+ characters). Closed-as-junk/lost bookings never.
  if (lead.status !== 'cancelled') {
    if (i.serviceIssue !== true || reason.length < 10 || ['junk', 'lost'].includes(lead.status)) return fail(409, 'Only a cancelled booking can be refunded here. For a service-issue refund on a live booking, confirm it is a service issue and write the reason (at least 10 characters).');
  }
  const { data: rows } = await db.from('ledger_entries').select('*').eq('lead_id', leadId);
  const { data: audits } = await db.from('audit_log').select('action,details').eq('details->>lead', lead.ref);
  const rf = refundable(rows ?? [], audits ?? []);
  if (!rf.orders.length) return fail(409, MANUAL_MSG, { manual: true });
  if (amount > rf.cap) return fail(400, `The most that can be refunded through Cashfree is ₹${rf.cap}.`, { max: rf.cap });

  // Confirm each candidate order with Cashfree itself; pick the first one with enough left for this single refund.
  let chosen: { orderId: string } | null = null, bestLeft = 0;
  for (const o of rf.orders) {
    let pays: any[];
    try { pays = await getCashfreeOrderPayments(o.orderId); } catch (e) { return fail(502, 'Could not reach Cashfree to check the payment. Nothing was refunded. Try again in a minute.'); }
    const ok = pays.find((p) => String(p?.cf_payment_id) === o.txn && p?.payment_status === 'SUCCESS' && rupees2(p.payment_amount) === o.amount);
    if (!ok) continue;
    const left = rupees2(Math.min(o.amount - rf.refundedOn(o.orderId), rf.cap));
    bestLeft = Math.max(bestLeft, left);
    if (!chosen && amount <= left) chosen = o;
  }
  if (!chosen) return bestLeft > 0 ? fail(400, `A single refund can be at most ₹${bestLeft} (the most left on one Cashfree payment).`, { max: bestLeft }) : fail(409, MANUAL_MSG, { manual: true });

  const rejectedBefore = (audits ?? []).filter((a: Row) => a.action === 'refund_gateway_rejected').length;
  const seq = rf.refundRows + rejectedBefore + 1;
  const refundId = 'rf' + leadId.replace(/-/g, '').slice(0, 12) + 'n' + seq;   // same inputs give the same id, so a retry can never refund twice
  const orderId = chosen.orderId;

  let r: any;
  try {
    r = await createCashfreeRefund({ orderId, refundId, rupees: amount, note: 'Mechanix Pro refund ' + lead.ref });
  } catch (e) {
    const ce = e instanceof CashfreeError ? e : null;
    if (ce && ce.status === 409) {   // this refund_id already exists at Cashfree: an earlier attempt got through. Read it back, never create another.
      try { r = await getCashfreeRefund(orderId, refundId); } catch { return fail(502, 'Cashfree already has this refund but its status could not be read. Check the Cashfree dashboard, then try again.'); }
      if (rupees2(r?.refund_amount) !== amount) return fail(409, 'An earlier refund with a different amount already exists at Cashfree. Check the Cashfree dashboard.');
    } else if (ce && ce.status >= 400 && ce.status < 500) {
      return fail(400, `Cashfree did not accept the refund: ${ce.message}. Nothing was recorded.`);
    } else {
      return fail(502, 'Could not confirm the refund with Cashfree. Nothing was recorded. It is safe to press the button again: the same refund is never made twice.');
    }
  }
  const st = String(r?.refund_status ?? '').toUpperCase();
  if (FAILED.includes(st)) {
    await db.from('audit_log').insert({ actor: i.adminId, action: 'refund_gateway_rejected', details: { lead: lead.ref, refund_id: refundId, status: st } }).then(() => {}, () => {});
    return fail(400, `Cashfree did not accept the refund (${st.toLowerCase()}${r?.status_description ? ': ' + clean(r.status_description, 120) : ''}). Nothing was recorded.`);
  }
  if (!ACCEPTED.includes(st)) return fail(409, `Cashfree has the refund as "${st.toLowerCase() || 'unknown'}" and it is not moving yet. Nothing was recorded. Approve or check it in the Cashfree dashboard.`);

  const { error } = await db.from('ledger_entries').insert({ lead_id: leadId, entry_type: 'refund', amount, collected_by: 'company_portal', method: 'cashfree', reference: refundId, source: 'gateway', gateway_txn_id: 'cfr_' + refundId, reason, note: `Cashfree order ${orderId}; refund ${st.toLowerCase()}`, created_by: i.adminId });
  if (error && error.code === '23505') { await syncBookingRefund(db, { leadId, refundId, cfRefundId: r?.cf_refund_id, cashfreeStatus: st, amount, reason, adminId: i.adminId }); return { status: 200, body: { ok: true, already: true, refund_id: refundId, status: st, amount } }; }
  if (error) {
    console.error('refund ledger insert failed', error.code);
    await db.from('audit_log').insert({ actor: i.adminId, action: 'refund_ledger_failed', details: { lead: lead.ref, refund_id: refundId, amount } }).then(() => {}, () => {});
    return fail(500, 'Cashfree accepted the refund but it could not be written to the ledger. Press the button again: it will record the same refund without refunding twice.');
  }
  await syncBookingRefund(db, { leadId, refundId, cfRefundId: r?.cf_refund_id, cashfreeStatus: st, amount, reason, adminId: i.adminId });
  await db.from('audit_log').insert({ actor: i.adminId, action: 'refund_to_customer', details: { lead: lead.ref, amount, refund_id: refundId, order_id: orderId, status: st, reason } }).then(() => {}, () => {});
  await db.from('crm_activities').insert({ lead_id: leadId, actor: i.adminId, kind: 'note', body: `Refund Rs ${amount} sent to the customer through Cashfree (${st.toLowerCase()}). It reaches the original payment method in 5 to 7 working days.` }).then(() => {}, () => {});
  return { status: 200, body: { ok: true, already: false, refund_id: refundId, status: st, amount } };
}

/** Cashfree REFUND_STATUS_WEBHOOK. The payload is only a pointer: the refund is read back from Cashfree. A failed refund gets a reversal row (append-only ledger) and a note for staff. */
export async function handleRefundWebhook(db: Db, evt: any): Promise<'ok' | 'ignored' | 'retry'> {
  const ref = evt?.data?.refund ?? {};
  const refundId = String(ref.refund_id ?? ''), orderId = String(ref.order_id ?? '');
  if (!/^[A-Za-z0-9]{3,40}$/.test(refundId) || !isCashfreeOrderId(orderId)) return 'ignored';
  const { data: row } = await db.from('ledger_entries').select('*').eq('gateway_txn_id', 'cfr_' + refundId).maybeSingle();
  if (!row || row.entry_type !== 'refund') return 'ignored';   // not a refund we recorded
  let r: any;
  try { r = await getCashfreeRefund(orderId, refundId); } catch { return 'retry'; }
  const st = String(r?.refund_status ?? '').toUpperCase();
  await syncBookingRefund(db, { leadId: row.lead_id, refundId, cfRefundId: r?.cf_refund_id, cashfreeStatus: st, amount: Number(row.amount), reason: row.reason ?? undefined });   // SUCCESS -> refunded, PENDING or ONHOLD -> processing, failure -> failed
  if (!FAILED.includes(st)) return 'ok';   // SUCCESS and in-flight states need no ledger change
  const amt = Number(row.amount);
  const { error } = await db.from('ledger_entries').insert({ lead_id: row.lead_id, entry_type: 'reversal', reverses_id: row.id, amount: amt, reason: `Refund ${st.toLowerCase()} at the gateway`, source: 'gateway', gateway_txn_id: 'cfx_' + refundId, note: 'Cashfree reported the refund as failed: the money did not go back to the customer' });
  if (error && error.code === '23505') return 'ok';   // already reversed by an earlier delivery
  if (error) { console.error('refund reversal failed', error.code); return 'retry'; }
  await db.from('audit_log').insert({ actor: null, action: 'refund_failed_at_gateway', details: { lead_id: row.lead_id, refund_id: refundId, amount: amt, status: st } }).then(() => {}, () => {});
  await db.from('crm_activities').insert({ lead_id: row.lead_id, actor: null, kind: 'note', body: `Refund Rs ${amt} failed at the gateway: pay it another way, then record it in the money sheet.` }).then(() => {}, () => {});
  return 'ok';
}
