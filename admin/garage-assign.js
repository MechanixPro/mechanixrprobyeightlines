// Dispatch: how a booking that went to a partner garage is shown. Pure rules, no page code. Shared by Crew and Admin.
// garage_seen_at is the moment the garage first opened the job (garage_assignments.received_at).
export const hasGarage = (r) => !!(r && r.garage_id);
export const isHandled = (r) => !!(r && (r.mechanic_id || r.garage_id));
export const garageLabel = (r) => (hasGarage(r) ? 'Garage: ' + (r.garage_name || 'Partner garage') : null);

/** "14:05" in India time from an ISO timestamp, or null. */
export function istTime(iso) {
  const t = iso ? new Date(iso) : null; if (!t || Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
}
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** The chip under the garage name: { text, tone } or null. Not seen and the visit is today or tomorrow gives the red chip. */
export function garageSeenChip(r, now = new Date()) {
  if (!hasGarage(r)) return null;
  const at = istTime(r.garage_seen_at);
  if (at) return { text: 'Seen by garage ' + at, tone: 'good' };
  const today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 864e5));
  return r.preferred_date === today || r.preferred_date === tomorrow ? { text: 'Garage has not seen it', tone: 'bad' } : { text: 'Not opened by the garage yet', tone: 'warn' };
}

const STEP_TEXT = { sent: 'Sent, waiting for the garage', received: 'Accepted, customer code next', in_work: 'Work started', ready: 'Ready for return' };
/** The garage's current step, and a red chip when a job sent to the garage has not been accepted in 15 minutes (garage_assigned_at, garage_seen_at and garage_status already come with each Dispatch row). */
export function garageStepChips(r, now = new Date()) {
  if (!hasGarage(r)) return [];
  const out = [], st = r.garage_status;
  if (STEP_TEXT[st]) out.push({ text: STEP_TEXT[st], tone: st === 'sent' ? 'warn' : 'good' });
  const at = r.garage_assigned_at ? new Date(r.garage_assigned_at).getTime() : NaN;
  if (st === 'sent' && Number.isFinite(at) && new Date(now).getTime() - at > 15 * 60e3) out.push({ text: 'Garage has not accepted in 15 minutes', tone: 'bad' });
  return out;
}
