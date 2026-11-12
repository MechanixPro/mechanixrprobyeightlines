// Booking lifecycle: pure helpers (no Deno APIs, so Node can test them). Used by booking-notify, quote-decision, admin-refund, track-booking and garage-app.
// Design and the list of Meta templates the owner must create: docs/BOOKING-LIFECYCLE.md
import { bookingId } from './booking-id.ts';

export type ApprovalStatus = 'none' | 'pending' | 'approved_self' | 'approved_admin' | 'rejected' | 'changes_requested';
type Q = { status?: string | null; version?: number | null; decided_at?: string | null; decided_method?: string | null; decided_via?: string | null } | null | undefined;

/** The same enum as the database function crm_booking_estimates. q is the latest quote that is sent, approved, declined or changes_requested. */
export function approvalState(q: Q): { status: ApprovalStatus; by: 'customer' | 'admin' | null; at: string | null; version: number | null; label: string } {
  if (!q || !q.status) return { status: 'none', by: null, at: null, version: null, label: 'No quote yet' };
  const meth = q.decided_method ?? (q.decided_via === 'phone' ? 'phone' : q.decided_via === 'link' ? 'customer_link' : null);
  const v = q.version ?? null, at = q.decided_at ?? null;
  switch (q.status) {
    case 'sent': return { status: 'pending', by: null, at: null, version: v, label: 'Waiting for the customer to approve' };
    case 'declined': return { status: 'rejected', by: 'customer', at, version: v, label: 'Declined by the customer' };
    case 'changes_requested': return { status: 'changes_requested', by: 'customer', at, version: v, label: 'The customer asked for changes' };
    case 'approved': return meth === 'phone' || meth === 'whatsapp'
      ? { status: 'approved_admin', by: 'admin', at, version: v, label: 'Approved by admin on behalf of the customer' }
      : { status: 'approved_self', by: 'customer', at, version: v, label: 'Approved by the customer' };
    default: return { status: 'none', by: null, at: null, version: null, label: 'No quote yet' };
  }
}

/** What the customer's tracking page and the garage see about delivery. */
export function deliveryView(l: Record<string, any>): { stage: 'none' | 'ready' | 'delivered' | 'closed'; at: string | null } {
  const s = String(l?.delivery_stage ?? '');
  if (s === 'ready') return { stage: 'ready', at: l.ready_at ?? null };
  if (s === 'delivered') return { stage: 'delivered', at: l.delivered_at ?? null };
  if (s === 'closed') return { stage: 'closed', at: l.closed_at ?? null };
  return { stage: 'none', at: null };
}

export type RefundRow = { status?: string | null; amount?: number | string | null };
/** The customer's refund line: status none | pending | processing | refunded | failed and the amount. Never a gateway id. Rows are booking_refunds rows (status and amount only). */
export function refundView(due: number, rows: RefundRow[]): { status: 'none' | 'pending' | 'processing' | 'refunded' | 'failed'; amount: number } {
  const d = Math.max(0, Number(due) || 0), live = rows.filter((r) => r.status !== 'failed'), sum = (xs: RefundRow[]) => Math.round(xs.reduce((t, r) => t + (Number(r.amount) || 0), 0) * 100) / 100;
  if (!d && !rows.length) return { status: 'none', amount: 0 };
  const amount = d || sum(rows);
  if (live.length && live.every((r) => r.status === 'refunded') && sum(live) >= d) return { status: 'refunded', amount };
  if (live.some((r) => r.status === 'processing')) return { status: 'processing', amount };
  if (live.length || d) return { status: 'pending', amount };
  return { status: 'failed', amount };
}
/** The cancellation block of the tracking payload. kind is 'customer' or 'company' (could-not-reach counts as company). */
export function cancelView(l: Record<string, any>, rows: RefundRow[]) {
  const cancelled = l?.status === 'cancelled';
  if (!cancelled) return { cancelled: false, kind: null as string | null, refund: { status: 'none' as const, amount: 0 } };
  return { cancelled: true, kind: l.cancel_kind === 'customer' ? 'customer' : 'company', refund: refundView(Number(l.refund_due) || 0, rows) };
}

/** Cashfree refund status -> booking_refunds.status. */
export function mapRefundStatus(cf: unknown): 'pending' | 'processing' | 'refunded' | 'failed' {
  const s = String(cf ?? '').toUpperCase();
  if (s === 'SUCCESS') return 'refunded';
  if (s === 'PENDING' || s === 'ONHOLD') return 'processing';
  if (['CANCELLED', 'REJECTED', 'FAILED'].includes(s)) return 'failed';
  return 'pending';
}
/** A finished refund stays finished: a late 'pending' never undoes 'refunded' or 'failed'. */
export const nextRefundStatus = (cur: string | null | undefined, incoming: string) => (cur === 'refunded' || cur === 'failed' ? cur : incoming);

/* ---------- customer messages: short, plain, end with the booking ID, never the private ref ---------- */
export const WA_TEMPLATES = { delivery_ready: 'mxp_delivery_ready', delivery_done: 'mxp_delivery_done', approval: 'mxp_quote_approved', garage_approved: 'mxp_garage_approved', garage_rejected: 'mxp_garage_estimate_rejected' } as const;
const first = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const idLine = (l: Record<string, any>) => `Booking ${bookingId(l) ?? 'request'}.`;
export function deliveryText(stage: 'ready' | 'delivered', l: Record<string, any>, vehicleName: string): string {
  return stage === 'ready'
    ? `Hi ${first(l.name)}, your ${vehicleName} is ready for delivery. We will hand it over as planned. ${idLine(l)}`
    : `Hi ${first(l.name)}, your ${vehicleName} has been delivered. Thank you for choosing Mechanix Pro. ${idLine(l)}`;
}
export function approvalText(by: 'customer' | 'admin', l: Record<string, any>): string {
  return by === 'admin'
    ? `Hi ${first(l.name)}, our team noted your approval of the quote. The work can start now. ${idLine(l)}`
    : `Hi ${first(l.name)}, we got your approval of the quote. The work can start now. ${idLine(l)}`;
}
export const garageApprovedText = (l: Record<string, any>, by: 'customer' | 'admin') =>
  `Quote approved ${by === 'admin' ? 'by Mechanix Pro on behalf of the customer' : 'by the customer'}. You can start the work. ${idLine(l)}`;
export const garageRejectedText = (l: Record<string, any>, note: string) => `Your estimate was not accepted: ${String(note).slice(0, 160)}. Please send a new one in the app. ${idLine(l)}`;
