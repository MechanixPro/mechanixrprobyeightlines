// Mechanic app: pure helpers (no Deno APIs, so Node can test them). Used by the mechanic-app Edge Function.
// Everything the mechanic's phone receives is built here, field by field, from a whitelist. The customer's address and email are never read; the phone only for an open job.
import { safeEqual, scrubText, firstName, LINK_RE, PIN_RE, UUID_RE } from './garage.ts';
export { LINK_RE, PIN_RE, UUID_RE };

export const SESSION_HOURS = 12;
export const AUDIENCE = 'mechanic';
export const OPEN_LEAD = ['paid', 'scheduled'] as const;
export const isOpenLead = (s: unknown) => (OPEN_LEAD as readonly string[]).includes(String(s));
export const SLOT: Record<string, string> = { asap: 'As soon as possible', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
export const STAGE: Record<string, string> = { on_the_way: 'On the way', arrived: 'Arrived', started: 'Code verified', repair_doorstep: 'Repair at the door', picked_up: 'Picked up', ready: 'Ready', returned: 'Delivered' };
export const LEAD_LABEL: Record<string, string> = { paid: 'Confirmed', scheduled: 'Scheduled', completed: 'Completed' };
export const LOGIN_MESSAGE: Record<string, string> = {
  link: 'This link is not valid. Ask Mechanix Pro for a new one.', off: 'Your app access is switched off. Please contact Mechanix Pro.',
  locked: 'Too many wrong PINs. Try again in 15 minutes.', pin: 'That PIN is not right.',
};

/* ---------- session (stateless, HMAC-SHA256, its own audience and key, so a garage session can never open this app) ---------- */
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => { const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret + '|' + AUDIENCE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export type MechanicClaims = { a: string; m: string; v: number; exp: number };
export async function signMechanicSession(secret: string, c: { access: string; mechanic: string; version: number }, now = Date.now(), hours = SESSION_HOURS): Promise<{ token: string; expires_at: string }> {
  if (!secret || secret.length < 16) throw new Error('session secret missing');
  const exp = Math.floor(now / 1000) + hours * 3600, body = b64u(enc.encode(JSON.stringify({ aud: AUDIENCE, a: c.access, m: c.mechanic, v: c.version, exp })));
  return { token: body + '.' + (await hmac(secret, body)), expires_at: new Date(exp * 1000).toISOString() };
}
export async function verifyMechanicSession(secret: string, token: unknown, now = Date.now()): Promise<MechanicClaims | null> {
  const t = String(token ?? ''); const i = t.indexOf('.');
  if (!secret || secret.length < 16 || i < 1 || t.length > 600) return null;
  const body = t.slice(0, i), sig = t.slice(i + 1);
  if (!safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const c = JSON.parse(unb64u(body));
    if (c.aud !== AUDIENCE || typeof c.a !== 'string' || typeof c.m !== 'string' || !Number.isInteger(c.v) || !(c.exp * 1000 > now)) return null;
    return { a: c.a, m: c.m, v: c.v, exp: c.exp };
  } catch { return null; }
}

/* ---------- dates (India) ---------- */
export const istToday = (now = Date.now()): string => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
export const dateOk = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
/** First and last day (inclusive) of the month that holds `day` (YYYY-MM-DD). */
export function monthRange(day: string): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), p = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}` };
}

/* ---------- whitelist serializers ---------- */
export type RawMechJob = { lead: Record<string, any>; service?: string | null; bike?: { brand?: string | null; model?: string | null; reg_no?: string | null } | null; reported?: boolean };
/** One job in the day list. The lead row may carry address, email and more: only the fields below are ever read. The phone is added for an OPEN job only. */
export function mechanicJobItem(raw: RawMechJob) {
  const l = raw.lead ?? {}, status = String(l.status), open = isOpenLead(status), b = raw.bike ?? {};
  const bike = [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ');
  const out: Record<string, any> = {
    id: String(l.id), booking_id: typeof l.booking_id === 'string' ? l.booking_id.slice(0, 24) : null,
    service: raw.service ? String(raw.service).slice(0, 120) : l.vehicle === 'car' ? 'Car service or problem check' : 'Bike service',
    area: scrubText(l.area, 60), date: typeof l.preferred_date === 'string' ? l.preferred_date.slice(0, 10) : null, slot: SLOT[String(l.preferred_slot)] ?? null,
    status, status_label: l.visit_stage && STAGE[l.visit_stage] && open ? STAGE[l.visit_stage] : LEAD_LABEL[status] ?? status, open,
    customer_first_name: firstName(l.name), vehicle: bike || (l.vehicle === 'car' ? 'Car' : 'Bike'), reg_no: b.reg_no ? String(b.reg_no).toUpperCase().slice(0, 13) : null,
    can_open: open && !raw.reported,
  };
  if (open) { const p = String(l.phone ?? '').replace(/\D/g, '').slice(-10); if (/^[6-9]\d{9}$/.test(p)) out.customer_phone = p; }
  return out;
}

const rupees = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
/** Dues screen: total due, what the company owes the mechanic, and the unsettled jobs. rows come from unsettledRows(); names maps lead id to { booking_id, service }. */
export function duesView(dues: { remitRemaining: number; payoutRemaining: number; paidOut?: number; remitted?: number }, rows: { lead_id: string; issued_at: string; total_collected: number; mechanic_payout: number; due_to_platform: number }[], names: Map<string, { booking_id?: string | null; service?: string | null }>) {
  return {
    total_due: rupees(dues.remitRemaining), company_owes: rupees(dues.payoutRemaining),
    unsettled: rows.slice(0, 100).map((r) => { const n = names.get(r.lead_id) ?? {};
      return { id: String(r.lead_id), booking_id: typeof n.booking_id === 'string' ? n.booking_id.slice(0, 24) : null, service: n.service ? String(n.service).slice(0, 120) : 'Service', date: String(r.issued_at ?? '').slice(0, 10) || null,
        total_collected: rupees(r.total_collected), mechanic_payout: rupees(r.mechanic_payout), due_to_platform: rupees(r.due_to_platform) }; }),
  };
}

/** Amount for a payment link: the server's own figure, never the phone's. Razorpay link limits as in mechanic-pay-link (Rs 1 to Rs 1,00,000). */
export function payAmount(due: number): { ok: true; amount: number } | { ok: false; error: string } {
  const a = rupees(due);
  if (!(a >= 1)) return { ok: false, error: 'Nothing to pay here.' };
  if (a > 100000) return { ok: false, error: 'This amount is above ₹1,00,000. Please pay in parts: open a job and pay that job.' };
  return { ok: true, amount: a };
}
