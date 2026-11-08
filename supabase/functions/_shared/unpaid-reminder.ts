// Pure rules for the one-time WhatsApp reminder to a customer who started a booking on /book/ but has not paid the confirmation fee (template mxp_booking_unpaid). No Deno APIs, so node --test can run them.
export const UNPAID_TEMPLATE = 'mxp_booking_unpaid';
/** One record per lead in crm_alerts_sent (lead_id, kind). */
export const UNPAID_KIND = 'unpaid_reminder';
export const UNPAID_LINK = 'https://mechanixpro.in/book/';
/** Statuses a /book/ lead can still be in while it is unpaid and open (book-start saves it as payment_sent). */
export const UNPAID_OPEN = ['new', 'contacted', 'payment_sent'];
const MIN = 60_000;

export const alreadyReminded = (sent: { lead_id: string; kind: string }[], leadId: string) => sent.some((s) => s.lead_id === leadId && s.kind === UNPAID_KIND);
/** Quiet hours are 21:00 to 09:00 IST: a due reminder waits for 09:00, and the 24-hour limit still applies. */
export function inQuietHours(now = new Date()): boolean { const h = new Date(now.getTime() + 330 * MIN).getUTCHours(); return h >= 21 || h < 9; }

export type UnpaidLead = { id: string; phone?: string | null; status: string; rzp_order_id?: string | null; confirm_paid_at?: string | null; consent_whatsapp?: boolean | null; opted_out?: boolean | null; deleted_at?: string | null; created_at: string; crm_first_contact_at?: string | null };
/** True when this lead should get the reminder right now. */
export function shouldRemind(l: UnpaidLead, sent: { lead_id: string; kind: string }[], now = new Date()): boolean {
  const age = now.getTime() - Date.parse(l.created_at);
  if (!(age >= 30 * MIN && age <= 24 * 3600_000)) return false;
  if (!l.rzp_order_id || l.confirm_paid_at || l.deleted_at) return false;
  if (l.consent_whatsapp !== true || l.opted_out === true) return false;
  if (!UNPAID_OPEN.includes(l.status)) return false;
  if (!/^[6-9][0-9]{9}$/.test(String(l.phone ?? '').replace(/\D/g, '').slice(-10))) return false;
  if (l.crm_first_contact_at && now.getTime() - Date.parse(l.crm_first_contact_at) < 30 * MIN) return false; // a person just reached out
  if (alreadyReminded(sent, l.id)) return false;
  return !inQuietHours(now);
}
/** {{1}} first name, {{2}} vehicle, {{3}} fee amount, {{4}} link. */
export function unpaidParams(a: { name: string; vehicle: string | null; brand?: string | null; model?: string | null; fee: number | string; link?: string }): string[] {
  const kind = a.vehicle === 'car' ? 'car' : 'bike';
  const m = [a.brand, a.model].filter(Boolean).join(' ').trim();
  return [String(a.name || 'there').trim().split(/\s+/)[0] || 'there', m ? kind + ' (' + m + ')' : kind, String(Math.round(Number(a.fee))), a.link ?? UNPAID_LINK];
}
