// Pure rules for the automatic WhatsApp job alert to a mechanic (template mxp_job_assigned). No Deno APIs, so node --test can run them.
import { sha256Hex } from './tech-job.ts';

export const JOB_ALERT_TEMPLATE = 'mxp_job_assigned';
/** One record per (lead, mechanic): a reassignment alerts the new mechanic only. Stored in crm_alerts_sent (lead_id, kind). */
export const alertKind = (mechanicId: string) => 'mechanic_alert:' + mechanicId;
export const alreadyAlerted = (sent: { lead_id: string; kind: string }[], leadId: string, mechanicId: string) => sent.some((s) => s.lead_id === leadId && s.kind === alertKind(mechanicId));

const SLOT_START: Record<string, number> = { morning: 9, afternoon: 12, evening: 16 };
const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** Slot start as a real instant, or null for asap / unknown slots. */
export function slotStart(date: string, slot: string): Date | null {
  const h = SLOT_START[slot]; if (h === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return new Date(date + 'T' + String(h).padStart(2, '0') + ':00:00+05:30');
}
/** Today (IST) or later. */
export const slotIsCurrent = (date: string | null, now = new Date()) => !!date && date >= istDate(now);
/** Quiet hours are 21:00 to 09:00 IST; a job starting within 2 hours is sent anyway. */
export function mayAlertNow(date: string, slot: string, now = new Date()): boolean {
  const h = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  if (h >= 9 && h < 21) return true;
  const s = slotStart(date, slot);
  return slot === 'asap' || (!!s && s.getTime() - now.getTime() <= 2 * 3600_000);
}
/** Mechanic phone in the 10-digit form the mechanics table enforces; null when missing or malformed. */
export const mechanicPhone = (p: unknown): string | null => { const d = String(p ?? '').replace(/\D/g, '').slice(-10); return /^[6-9][0-9]{9}$/.test(d) ? d : null; };

/** The six template variables: first name, booking ID, vehicle and service, area and PIN, slot, job link. No customer phone, no street address. */
export function alertParams(a: { mechanicName: string; bookingId: string; vehicle: string; service: string; area: string | null; pincode: string | null; when: string; link: string }): string[] {
  const area = [a.area, a.pincode].filter(Boolean).join(' ') || 'see job';
  return [String(a.mechanicName).split(' ')[0], a.bookingId, [a.vehicle, a.service].filter(Boolean).join(', ') || 'service', area, a.when, a.link];
}

/** Same link the Crew button (crm_tech_link) makes, minted server side: only the SHA-256 hash is stored, the old open link for the booking expires, 7 days. */
export async function mintTechLink(db: any, leadId: string, mechanicId: string): Promise<string | null> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const tok = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.from('tech_job_links').update({ expires_at: new Date().toISOString() }).eq('lead_id', leadId).is('reported_at', null).gt('expires_at', new Date().toISOString());
  const { error } = await db.from('tech_job_links').insert({ lead_id: leadId, mechanic_id: mechanicId, token_hash: await sha256Hex(tok), created_by: null, expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString() });
  return error ? null : 'https://mechanixpro.in/job/?t=' + tok;
}
