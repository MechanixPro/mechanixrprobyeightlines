// Delivery of the paid-confirmation messages, one kind at a time. Pure (no Deno APIs): the store is injected so Node can test idempotency and failure isolation.
// Every kind runs on its own: it is claimed first (so a retry or a duplicate webhook cannot send twice), the send is wrapped (a throw becomes "failed"), and the result is recorded.
export const KINDS = ['confirm_email', 'receipt_email', 'confirm_whatsapp', 'team_paid', 'team_link_unpaid', 'team_unassigned', 'ontheway_email', 'team_issue', 'team_garage_estimate', 'team_garage_ready', 'delivery_ready_email', 'delivery_ready_whatsapp', 'delivery_done_email', 'delivery_done_whatsapp', 'approval_email', 'approval_whatsapp', 'garage_approved', 'garage_estimate_rejected', 'refund_email', 'refund_whatsapp'] as const;
export type Kind = (typeof KINDS)[number];
export const CUSTOMER_KINDS: Kind[] = ['confirm_email', 'receipt_email', 'confirm_whatsapp'];
export type Result = { ok: boolean; skipped?: boolean; error?: string };
export interface Store {
  claim(leadId: string, kind: Kind, force?: boolean): Promise<boolean>;
  finish(leadId: string, kind: Kind, status: 'sent' | 'failed' | 'skipped', error?: string): Promise<void>;
}

/** Runs one send exactly once. Returns 'sent', 'failed', 'skipped' (nothing to send to, or the channel is not connected) or 'duplicate' (already claimed or sent). Never throws. */
export async function deliver(store: Store, leadId: string, kind: Kind, send: () => Promise<Result>, force = false): Promise<'sent' | 'failed' | 'skipped' | 'duplicate'> {
  let claimed = false;
  try { claimed = await store.claim(leadId, kind, force); } catch { return 'failed'; }
  if (!claimed) return 'duplicate';
  let r: Result;
  try { r = await send(); } catch (e) { r = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
  try { await store.finish(leadId, kind, status, r.ok ? undefined : r.error); } catch { /* the history line is best effort */ }
  return status;
}

/** Runs several kinds independently: one failing or throwing never stops the others. */
export async function deliverAll(store: Store, leadId: string, jobs: Partial<Record<Kind, () => Promise<Result>>>, force = false): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(Object.entries(jobs).map(async ([kind, send]) => { out[kind] = await deliver(store, leadId, kind as Kind, send!, force); }));
  return out;
}

/** The staff alert text. Booking ID, vehicle tag, area and PIN, slot and amount. No customer phone, address or name. */
export function teamPaidMessage(d: { bookingId?: string | null; vehicle: string; area?: string | null; pincode?: string | null; whenText: string; amount: number; deskUrl: string }): { subject: string; text: string; html: string } {
  const place = [d.area, d.pincode].filter(Boolean).join(' ') || 'area not given';
  const line = `${d.bookingId ?? 'Booking'} (${String(d.vehicle).toUpperCase()}) paid ₹${d.amount}. ${place}. ${d.whenText}.`;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return { subject: `Paid booking${d.bookingId ? ' ' + d.bookingId : ''}: assign a mechanic`, text: `${line}\nAssign a mechanic in Dispatch: ${d.deskUrl}#dispatch`, html: `<p><b>Paid booking.</b> ${esc(line)}</p><p><a href="${esc(d.deskUrl)}#dispatch">Open Dispatch</a> and assign a mechanic.</p>` };
}
export function teamNudgeMessage(kind: 'team_link_unpaid' | 'team_unassigned', d: { bookingId?: string | null; vehicle: string; area?: string | null; minutes: number; deskUrl: string }) {
  const what = kind === 'team_link_unpaid' ? `payment link sent ${d.minutes}+ minutes ago, still unpaid` : `paid ${d.minutes}+ minutes ago, no mechanic assigned`;
  const line = `${d.bookingId ?? 'Lead'} (${String(d.vehicle).toUpperCase()}${d.area ? ', ' + d.area : ''}): ${what}.`;
  return { subject: kind === 'team_link_unpaid' ? 'Payment link unpaid: follow up' : 'Paid booking has no mechanic', text: `${line}\nOpen: ${d.deskUrl}`, html: `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${d.deskUrl}">Open the desk</a></p>` };
}

/** Which customer messages are due for a paid lead, given the rows already recorded. Failed ones are retried (up to 6 tries); sent and skipped are left alone. */
export function dueKinds(rows: { kind: string; status: string; attempts?: number }[], wanted: Kind[] = CUSTOMER_KINDS): Kind[] {
  return wanted.filter((k) => { const r = rows.find((x) => x.kind === k); return !r || (r.status === 'failed' && Number(r.attempts ?? 0) < 6); });
}
/** True when the minutes since `since` have passed. */
export const olderThan = (since: string | null | undefined, minutes: number, now: number | Date = Date.now()) => !!since && new Date(now).getTime() - Date.parse(since) >= minutes * 60_000;

export const ISSUE_LABEL: Record<string, string> = { late: 'Running late', mechanic: 'About the mechanic', payment: 'Payment', safety: 'Safety', cancel: 'Cancel request', other: 'Other' };
/** The staff alert for a new customer issue. Booking ID, vehicle tag, area and the type only: the customer's own words stay in the desk (Issues), not in email. */
export function teamIssueMessage(d: { bookingId?: string | null; vehicle: string; area?: string | null; category: string; deskUrl: string }): { subject: string; text: string; html: string } {
  const type = ISSUE_LABEL[d.category] ?? 'Other';
  const line = `${d.bookingId ?? 'Booking'} (${String(d.vehicle).toUpperCase()}${d.area ? ', ' + d.area : ''}): the customer reported a problem. Type: ${type}.`;
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return { subject: `Customer problem${d.bookingId ? ' ' + d.bookingId : ''}: ${type}`, text: `${line}\nOpen Issues in the desk: ${d.deskUrl}#issues`, html: `<p><b>Customer problem.</b> ${esc(line)}</p><p><a href="${esc(d.deskUrl)}#issues">Open Issues</a> to read it and resolve it.</p>` };
}
