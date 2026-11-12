// One booking, one management screen: the pure rules behind the Status list, the customer approval chip, refunds, delivery and the activity feed.
// No DOM, no Supabase. crm/manage-rules.js is the source and admin/manage-rules.js is a copy (scripts/sync_shared.sh). The database stays the judge of what is allowed; these rules only decide what to show and explain.

/* ---------- Status list ---------- */
/** Exactly these options, in this order, with these labels (state keys come from crm_booking_state). */
export const STATUS_OPTIONS = [['new', 'New'], ['contacted', 'Contacted'], ['quoted', 'Quote sent'], ['payment_sent', 'Advance link sent'], ['paid', 'Booked'], ['scheduled', 'Booked (visit scheduled)'], ['cancelled_customer', 'Customer cancelled'], ['lost', 'Lost'], ['completed', 'Done'], ['ready_for_delivery', 'Vehicle ready for delivery'], ['delivered', 'Vehicle delivered'], ['closed', 'Booking closed']];
/** These keep saving through the Save changes bar. */
export const PLAIN_STATES = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'lost'];
/** These have side effects (messages, refunds), so choosing one opens a dialog instead of saving. */
export const SIDE_EFFECT = { cancelled_customer: 'cancel', completed: 'done', ready_for_delivery: 'ready', delivered: 'delivered', closed: 'closed' };
const READ_ONLY = { cancelled_company: 'Cancelled by us', junk: 'Junk' };

/** The option list for the Status dropdown. cancelled_company (and junk) show as a read-only extra only while current. */
export function statusOptions(current) {
  const opts = STATUS_OPTIONS.map(([value, label]) => ({ value, label, disabled: false }));
  if (READ_ONLY[current]) opts.push({ value: current, label: READ_ONLY[current], disabled: true });
  return opts;
}
/** The state key to start from before crm_booking_state answers (older database): the stored lead status. */
export const stateFromLead = (lead) => { const s = lead && lead.status; return s === 'cancelled' ? 'cancelled_customer' : s || 'new'; };
const DONE_OR_LATER = ['completed', 'ready_for_delivery', 'delivered', 'closed'];
/** May the Status dropdown go from `current` to `target`? { ok, action } where action is the dialog to open ('cancel'|'done'|'ready'|'delivered'|'closed'|null), or { ok:false, error } in plain words. */
export function statusJump(current, target) {
  if (!target || target === current) return { ok: true, action: null };
  const action = SIDE_EFFECT[target] || null;
  if (!action) return { ok: true, action: null };
  if (['cancelled_customer', 'cancelled_company'].includes(current)) return { ok: false, error: 'This booking is already cancelled.' };
  if (current === 'closed') return { ok: false, error: 'This booking is closed. Nothing more can be changed here.' };
  if (action === 'cancel') return ['junk', 'lost'].includes(current) ? { ok: false, error: 'This booking is ' + current + '. Restore it first.' } : DONE_OR_LATER.includes(current) ? { ok: false, error: 'The service is already done, so the booking cannot be cancelled.' } : { ok: true, action };
  if (['junk', 'lost'].includes(current)) return { ok: false, error: 'This booking is ' + current + '. Restore it first.' };
  if (action === 'done') return ['paid', 'scheduled'].includes(current) ? { ok: true, action } : current === 'completed' ? { ok: false, error: 'The service is already marked done.' } : DONE_OR_LATER.includes(current) ? { ok: false, error: 'The service is already done.' } : { ok: false, error: 'The customer must pay the confirmation fee and the booking must be confirmed before it can be marked done.' };
  if (action === 'ready') return current === 'completed' ? { ok: true, action } : current === 'ready_for_delivery' ? { ok: false, error: 'The vehicle is already marked ready for delivery.' } : current === 'delivered' ? { ok: false, error: 'The vehicle is already delivered.' } : { ok: false, error: 'Mark the service done before marking the vehicle ready for delivery.' };
  if (action === 'delivered') return ['completed', 'ready_for_delivery'].includes(current) ? { ok: true, action } : current === 'delivered' ? { ok: false, error: 'The vehicle is already delivered.' } : { ok: false, error: 'Mark the service done before marking the vehicle delivered.' };
  return current === 'delivered' ? { ok: true, action } : { ok: false, error: 'Mark the vehicle delivered before closing the booking.' };   // closed
}

/* ---------- Customer approval ---------- */
/** The chip and the line under it for approval.status from crm_booking_estimates. null means show nothing. */
export function approvalInfo(a) {
  const s = a && a.status; if (!s || s === 'none') return null;
  const by = a.decided_by_name, how = a.method === 'whatsapp' ? 'WhatsApp' : a.method === 'phone' ? 'phone call' : a.method || '';
  switch (s) {
    case 'pending': return { text: 'Pending customer approval', tone: 'warn', detail: '' };
    case 'approved_self': return { text: 'Customer approved (self)', tone: 'good', detail: '' };
    case 'approved_admin': return { text: 'Customer approved (by admin)', tone: 'good', detail: [by ? 'by ' + by : '', how ? 'confirmed by ' + how : ''].filter(Boolean).join(' · '), remarks: a.remarks || '' };
    case 'rejected': return { text: 'Customer rejected', tone: 'bad', detail: '', remarks: a.remarks || '' };
    case 'changes_requested': return { text: 'Customer asked for changes', tone: 'warn', detail: '', remarks: a.remarks || '' };
    default: return null;
  }
}
export const approveCheck = ({ method, remarks }) => !['phone', 'whatsapp'].includes(method) ? { ok: false, error: 'Choose how the customer confirmed: phone call or WhatsApp.' } : String(remarks ?? '').trim().length < 5 ? { ok: false, error: 'Write what the customer said (at least 5 characters).' } : { ok: true, method, remarks: String(remarks).trim() };
export const rejectCheck = (remarks) => (String(remarks ?? '').trim().length < 3 ? { ok: false, error: 'Write the reason (at least 3 characters).' } : { ok: true, remarks: String(remarks).trim() });

/* ---------- Refunds ---------- */
export const REFUND_STATUS = { pending: ['Pending', 'warn'], processing: ['Processing', 'info'], refunded: ['Refunded', 'good'], failed: ['Failed', 'bad'] };
export const refundStatus = (s) => REFUND_STATUS[s] || [String(s || 'Unknown'), ''];
/** What may still be refunded: the server's `refundable`, else what is outstanding. */
export const refundMax = (r, fallback = 0) => Math.max(0, Number(r && r.refundable != null ? r.refundable : fallback) || 0);
/** Full uses the whole refundable amount; Partial uses what was typed, never more than refundable. */
export function refundCheck({ mode, amount, max }) {
  const cap = Math.max(0, Number(max) || 0); if (!(cap > 0)) return { ok: false, error: 'Nothing is left to refund.' };
  const n = mode === 'full' ? cap : Math.round(Number(String(amount ?? '').replace(/[^0-9.]/g, '')) * 100) / 100;
  if (!(n > 0)) return { ok: false, error: 'Enter the amount to refund.' };
  if (n > cap + 0.005) return { ok: false, error: 'The refund cannot be more than ' + cap + '.' };
  return { ok: true, amount: n };
}

/* ---------- Delivery ---------- */
export const DELIVERY_STAGES = { done: { state: 'completed', button: 'Mark service completed (Done)', title: 'Mark the service completed', submit: 'Mark done' }, ready: { button: 'Mark vehicle ready for delivery', title: 'Vehicle ready for delivery', submit: 'Mark ready and tell the customer' }, delivered: { button: 'MARK VEHICLE DELIVERED', title: 'Vehicle delivered', submit: 'Mark delivered and tell the customer' }, closed: { button: 'Close booking', title: 'Close this booking', submit: 'Close booking' } };
/** The delivery stages that can be pressed now, by booking state (crm_booking_state). Nothing once cancelled or before the booking is paid. */
export function deliveryStages(state) {
  switch (state) { case 'paid': case 'scheduled': return ['done']; case 'completed': return ['ready', 'delivered']; case 'ready_for_delivery': return ['delivered']; case 'delivered': return ['closed']; default: return []; }
}
export const deliveryVisible = (state) => ['paid', 'scheduled', 'completed', 'ready_for_delivery', 'delivered', 'closed'].includes(state);
export const deliveryCheck = (stage, remarks) => (stage === 'delivered' && String(remarks ?? '').trim().length < 3 ? { ok: false, error: 'Write a short remark about the handover (at least 3 characters).' } : { ok: true, remarks: String(remarks ?? '').trim() || null });
/** Stages that tell the customer (Edge Function booking-notify delivery_update). */
export const deliveryNotifies = (stage) => stage === 'ready' || stage === 'delivered';

/* ---------- Activity feed ---------- */
export const TIMELINE_KINDS = { assignment: ['Assignment', 'info'], estimate: ['Estimate', 'info'], approval: ['Approval', 'good'], rejection: ['Rejection', 'bad'], payment: ['Payment', 'good'], refund: ['Refund', 'warn'], completion: ['Completed', 'good'], delivery: ['Delivery', 'good'], closure: ['Closed', ''], message: ['Message', ''] };
export const timelineKind = (k) => TIMELINE_KINDS[k] || [String(k || 'Update').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), ''];
const ist = (at, opts) => { const t = at ? new Date(at) : null; return t && !Number.isNaN(t.getTime()) ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(t) : ''; };
/** Date and time in India time for one feed row. */
export const istStamp = (at) => ({ date: ist(at, { day: '2-digit', month: 'short', year: 'numeric' }), time: ist(at, { hour: 'numeric', minute: '2-digit', hour12: true }) });
/** Rows of the older history (crm_lead activities) shaped like the new feed. */
export const legacyTimeline = (activities) => (activities || []).map((a) => ({ at: a.created_at || a.at, kind: a.kind === 'payment' ? 'payment' : a.kind === 'whatsapp' || a.kind === 'message' ? 'message' : a.kind || 'update', title: a.title || String(a.kind || 'Update').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), detail: a.body || a.detail || '', by_name: a.actor || a.by_name || '' }));
