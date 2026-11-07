// Partner garage app: pure helpers (no Deno APIs, so Node can test them). Used by the garage-app Edge Function. Design: docs/superpowers/specs/2026-11-06-partner-garage-app-design.md
// Everything a garage's device receives is built here, field by field, from a whitelist. The customer's address and email are never read. The phone is read in ONE place (garageJobDetail)
// and only while the garage has an open assignment for that lead.

/** How the customer contact reaches the garage. 'direct' = the number itself (owner decision 2026-11-06). 'masked' is reserved for later: with it the detail carries no number and the app shows
 *  a call-through button instead. Changing this one value is the only switch; nothing for 'masked' is built yet. */
export const CONTACT_MODE: 'direct' | 'masked' = 'direct';

export const OPEN_STATUSES = ['sent', 'received', 'in_work', 'ready'] as const;
export const isOpen = (s: unknown) => (OPEN_STATUSES as readonly string[]).includes(String(s));
export const SESSION_HOURS = 12;
export const MAX_PHOTOS = 4;
const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const STATUS_LABEL: Record<string, string> = { sent: 'New job', received: 'Vehicle received', in_work: 'Work started', ready: 'Ready for return', returned: 'Returned', cancelled: 'Cancelled' };
export const EVENT_LABEL: Record<string, string> = { sent: 'Sent to you', received: 'Vehicle received', work_started: 'Work started', ready: 'Ready for return' };
export const QUOTE_LABEL: Record<string, string> = { none: 'No quote yet', draft: 'No quote yet', sent: 'Waiting for the customer to approve', approved: 'Approved by the customer', declined: 'Declined by the customer', superseded: 'Waiting for the customer to approve' };
/** The one button that moves a job forward, by current status. */
export const NEXT_EVENT: Record<string, { event: string; label: string } | null> = {
  sent: { event: 'received', label: 'Vehicle received' }, received: { event: 'work_started', label: 'Work started' }, in_work: { event: 'ready', label: 'Ready for return' }, ready: null, returned: null, cancelled: null,
};
export const TAB_OF = (status: string): 'open' | 'ready' | 'done' => (status === 'ready' ? 'ready' : isOpen(status) ? 'open' : 'done');

/* ---------- text safety ---------- */
/** Free text that came from a customer or staff may hold a number or email by accident: remove them before a garage sees the text. */
export function scrubText(s: unknown, max = 500): string | null {
  const t = String(s ?? '').replace(/[^\S\n]+/g, ' ').replace(/[<>]/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email removed]')
    .replace(/\+?\d[\d ()-]{5,}\d/g, '[number removed]').trim().slice(0, max);
  return t || null;
}
export const firstName = (name: unknown): string => {
  const f = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return f && !/[\d@]/.test(f) ? f.slice(0, 30) : 'Customer';
};
const digits10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10);

/* ---------- session (stateless, HMAC-SHA256) ---------- */
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => { const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
export type SessionClaims = { a: string; g: string; v: number; exp: number };
export async function signSession(secret: string, c: { access: string; garage: string; version: number }, now = Date.now(), hours = SESSION_HOURS): Promise<{ token: string; expires_at: string }> {
  if (!secret || secret.length < 16) throw new Error('session secret missing');
  const exp = Math.floor(now / 1000) + hours * 3600, body = b64u(enc.encode(JSON.stringify({ a: c.access, g: c.garage, v: c.version, exp })));
  return { token: body + '.' + (await hmac(secret, body)), expires_at: new Date(exp * 1000).toISOString() };
}
export async function verifySession(secret: string, token: unknown, now = Date.now()): Promise<SessionClaims | null> {
  const t = String(token ?? ''); const i = t.indexOf('.');
  if (!secret || secret.length < 16 || i < 1 || t.length > 600) return null;
  const body = t.slice(0, i), sig = t.slice(i + 1);
  if (!safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const c = JSON.parse(unb64u(body));
    if (typeof c.a !== 'string' || typeof c.g !== 'string' || !Number.isInteger(c.v) || !(c.exp * 1000 > now)) return null;
    return { a: c.a, g: c.g, v: c.v, exp: c.exp };
  } catch { return null; }
}
export const LINK_RE = /^[0-9a-f]{48}$/;
export const PIN_RE = /^[0-9]{4,6}$/;

/* ---------- whitelist serializers ---------- */
export type RawJob = {
  assignment: Record<string, any>;
  lead: Record<string, any>;                                 // the whole lead row may be passed in: only the fields below are ever read
  service?: string | null;
  vehicle?: { brand?: string | null; model?: string | null; reg_no?: string | null } | null;
  issue?: string | null;                                     // what the customer wrote about the problem (scrubbed here)
  pickup?: { note?: string | null; photos?: string[] } | null;
  progress?: { event: string; at: string; note?: string | null; photos?: string[] }[];
  estimates?: Record<string, any>[];
  quote?: { status?: string | null } | null;
};
const gst = (sub: number) => Math.round(sub * 18) / 100;
export function estimateView(e: Record<string, any>) {
  const lines = (Array.isArray(e.lines) ? e.lines : []).slice(0, 20).map((l: any) => ({ kind: ['parts', 'labour', 'other'].includes(l?.kind) ? l.kind : 'other', name: String(l?.name ?? '').slice(0, 80), amount: Number(l?.amount) || 0 }));
  const sub = Math.round(lines.reduce((t: number, l: any) => t + l.amount, 0) * 100) / 100;
  return {
    id: String(e.id), status: ['draft', 'submitted', 'approved', 'rejected', 'converted'].includes(e.status) ? e.status : 'draft', lines, subtotal: sub, gst: gst(sub), total: Math.round((sub + gst(sub)) * 100) / 100,
    notes: scrubText(e.notes, 500), hours: Number.isInteger(e.hours) ? e.hours : null, return_day: typeof e.return_day === 'string' ? e.return_day.slice(0, 10) : null,
    review_note: e.status === 'rejected' ? scrubText(e.review_note, 300) : null, submitted_at: e.submitted_at ?? null,
  };
}
function base(raw: RawJob) {
  const a = raw.assignment, l = raw.lead ?? {}, status = String(a.status);
  const v = raw.vehicle ?? {}, model = [v.brand && v.brand !== 'Other' ? v.brand : '', v.model].filter(Boolean).join(' ');
  const qs = String(raw.quote?.status ?? 'none');
  return {
    id: String(a.id), status, status_label: STATUS_LABEL[status] ?? status, tab: TAB_OF(status), open: isOpen(status),
    booking_id: typeof l.booking_id === 'string' ? l.booking_id.slice(0, 24) : null,
    customer_first_name: firstName(l.name),
    vehicle: model || (l.vehicle === 'car' ? 'Car' : 'Bike'), vehicle_type: l.vehicle === 'car' ? 'car' : 'bike', reg_no: v.reg_no ? String(v.reg_no).toUpperCase().slice(0, 13) : null,
    work: raw.service ? String(raw.service).slice(0, 120) : l.vehicle === 'car' ? 'Car service or problem check' : 'Bike service',
    return_by: a.eta ?? null, assigned_at: a.assigned_at ?? null,
    quote: { status: QUOTE_LABEL[qs] ? qs : 'none', label: QUOTE_LABEL[qs] ?? QUOTE_LABEL.none },
    next: NEXT_EVENT[status] ?? null,
  };
}
/** The job list: never a phone, address or email. */
export function garageJobListItem(raw: RawJob) { return base(raw); }

/** The job detail. includeContact must be true only when the caller already proved an open assignment for this garage and the contact view was logged. */
export function garageJobDetail(raw: RawJob, includeContact: boolean) {
  const b = base(raw), a = raw.assignment;
  const out: Record<string, any> = {
    ...b,
    work_needed: scrubText(raw.issue, 600), found: scrubText(a.notes, 500),
    pickup: raw.pickup ? { note: scrubText(raw.pickup.note, 300), photos: (raw.pickup.photos ?? []).filter((u) => /^https:\/\//.test(String(u))).slice(0, 12) } : null,
    timeline: [{ event: 'sent', label: EVENT_LABEL.sent, at: a.assigned_at ?? null, note: null, photos: [] as string[] },
      ...(raw.progress ?? []).map((p) => ({ event: String(p.event), label: EVENT_LABEL[p.event] ?? String(p.event), at: p.at, note: scrubText(p.note, 300), photos: (p.photos ?? []).filter((u) => /^https:\/\//.test(String(u))).slice(0, MAX_PHOTOS) }))],
    estimates: (raw.estimates ?? []).slice(0, 10).map(estimateView),
    can_start: b.status === 'received' && raw.quote?.status === 'approved',
    start_blocked_reason: b.status === 'received' && raw.quote?.status !== 'approved' ? 'The customer has not approved the quote yet. Send your estimate. Work can start once the customer approves.' : null,
    can_estimate: ['received', 'in_work'].includes(b.status),
  };
  if (includeContact && CONTACT_MODE === 'direct' && b.open) {
    const p = digits10(raw.lead?.phone);
    if (/^[6-9]\d{9}$/.test(p)) out.customer_phone = p;
  }
  return out;
}

export type RawStatementRow = { assignment: Record<string, any>; lead: Record<string, any>; vehicle?: { brand?: string | null; model?: string | null } | null; settlement?: { amount?: number | string; settled?: boolean; settled_at?: string | null; note?: string | null } | null };
/** Completed jobs and what Admin entered for each. No rate is worked out here. */
export function garageStatement(rows: RawStatementRow[]) {
  const items = rows.map((r) => {
    const v = r.vehicle ?? {}, s = r.settlement;
    return { id: String(r.assignment.id), booking_id: typeof r.lead?.booking_id === 'string' ? r.lead.booking_id.slice(0, 24) : null, vehicle: [v.brand && v.brand !== 'Other' ? v.brand : '', v.model].filter(Boolean).join(' ') || 'Vehicle',
      completed_at: r.assignment.returned_at ?? r.assignment.ready_at ?? null, amount: s ? Number(s.amount) : null, settled: s ? !!s.settled : false, settled_at: s?.settled_at ?? null, note: s ? scrubText(s.note, 200) : null,
      status: s ? (s.settled ? 'settled' : 'pending') : 'amount_not_entered' };
  });
  const sum = (f: (i: any) => boolean) => Math.round(items.filter(f).reduce((t, i) => t + (i.amount ?? 0), 0) * 100) / 100;
  return { items, pending: sum((i) => i.status === 'pending'), settled: sum((i) => i.status === 'settled') };
}

/* ---------- requests ---------- */
export function cleanUpload(b: any): { ok: true; value: string[] } | { ok: false; error: string } {
  const types = Array.isArray(b?.types) ? b.types.map((t: unknown) => String(t)) : [];
  if (!types.length || types.length > MAX_PHOTOS) return { ok: false, error: `Send 1 to ${MAX_PHOTOS} photos at a time.` };
  if (!types.every((t: string) => PHOTO_TYPES[t])) return { ok: false, error: 'Photos must be JPEG, PNG or WebP.' };
  return { ok: true, value: types.map((t: string) => PHOTO_TYPES[t]) };
}
export const photoPath = (garage: string, assignment: string, uuid: string, ext: string) => `${garage}/${assignment}/${uuid}.${ext}`;
export const photoPathOk = (p: unknown, garage: string, assignment: string) => new RegExp(`^${garage}/${assignment}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(String(p ?? ''));
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const EVENTS = ['received', 'work_started', 'ready'];

/** The estimate form: checked here for a quick plain-words answer; the database checks again. */
export function cleanEstimate(b: any): { ok: true; value: { lines: { kind: string; name: string; amount: number }[]; notes: string | null; hours: number | null; day: string | null } } | { ok: false; error: string } {
  const raw = Array.isArray(b?.lines) ? b.lines : [];
  if (!raw.length) return { ok: false, error: 'Add at least one line.' };
  if (raw.length > 20) return { ok: false, error: 'At most 20 lines.' };
  const lines: { kind: string; name: string; amount: number }[] = [];
  for (const l of raw) {
    const kind = String(l?.kind ?? ''), name = String(l?.name ?? '').trim(), amount = Number(l?.amount);
    if (!['parts', 'labour', 'other'].includes(kind)) return { ok: false, error: 'Each line is parts, labour or other.' };
    if (name.length < 2 || name.length > 80) return { ok: false, error: 'Each line needs a name (2 to 80 characters).' };
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return { ok: false, error: 'Each amount must be from 0 to 1,00,000.' };
    lines.push({ kind, name, amount: Math.round(amount * 100) / 100 });
  }
  const hours = b?.hours === '' || b?.hours == null ? null : Number(b.hours), day = b?.day ? String(b.day) : null;
  if (hours != null && (!Number.isInteger(hours) || hours < 1 || hours > 72)) return { ok: false, error: 'Estimated hours must be from 1 to 72.' };
  if (day != null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Pick a return day.' };
  if (hours != null && day != null) return { ok: false, error: 'Give the estimated hours or a return day, not both.' };
  return { ok: true, value: { lines, notes: b?.notes ? String(b.notes).slice(0, 500) : null, hours, day } };
}

/** Login failures in plain words. */
export const LOGIN_MESSAGE: Record<string, string> = {
  link: 'This link is not valid. Ask Mechanix Pro for a new one.', off: 'This garage access is switched off. Please contact Mechanix Pro.',
  locked: 'Too many wrong PINs. Try again in 15 minutes.', pin: 'That PIN is not right.',
};

/* ---------- team alerts and the customer line (no names, no numbers) ---------- */
export function teamGarageMessage(kind: 'estimate' | 'ready', d: { bookingId?: string | null; vehicle: string; garageName: string; total?: number; deskUrl: string }) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const ref = d.bookingId ?? 'Booking', line = kind === 'estimate'
    ? `${ref} (${d.vehicle.toUpperCase()}): partner garage ${d.garageName} sent a repair estimate${d.total != null ? ` of Rs ${d.total} incl. GST` : ''}. Review it in the desk.`
    : `${ref} (${d.vehicle.toUpperCase()}): partner garage ${d.garageName} marked the vehicle ready for return.`;
  return { subject: kind === 'estimate' ? `Garage estimate to review${d.bookingId ? ' ' + d.bookingId : ''}` : `Garage says ready${d.bookingId ? ' ' + d.bookingId : ''}`, text: `${line}\nOpen: ${d.deskUrl}`, html: `<p>${esc(line)}</p><p><a href="${esc(d.deskUrl)}">Open the desk</a></p>` };
}
/** What the customer's tracking page says while the vehicle is with a partner garage. No garage name or address. */
export function partnerGarageLine(status: string | null | undefined): { line: string; detail: string } | null {
  switch (status) {
    case 'sent': return { line: 'Your vehicle is on its way to a partner garage', detail: 'The garage is getting ready to take it in.' };
    case 'received': return { line: 'Your vehicle is at a partner garage', detail: 'The garage has received it.' };
    case 'in_work': return { line: 'Your vehicle is at a partner garage', detail: 'The work has started.' };
    case 'ready': return { line: 'Your vehicle is at a partner garage', detail: 'The work is done and the vehicle is ready to come back to you.' };
    default: return null;
  }
}

/* ---------- dashboard (the first screen) ---------- */
/** IST calendar day (YYYY-MM-DD) of a timestamp, or null. */
export const istDay = (iso: unknown): string | null => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10) : null; };
export type DashboardInput = { today: string; garage: { name?: string | null; city?: string | null; is_open?: boolean | null; shop_loc_at?: string | null }; rows: RawStatementRow[] };
/** Greeting, today's count, open count, month figures and the amounts Admin entered that are still unpaid. Nothing is worked out beyond counting and averaging the amounts Admin typed:
 *  there is no rate or share here. Amounts are what Mechanix Pro owes the garage ("We owe you"); the settlement data has no amount the garage owes the company. */
export function garageDashboard(inp: DashboardInput) {
  const month = inp.today.slice(0, 7), live = inp.rows.filter((r) => r.assignment.status !== 'cancelled');
  const doneRows = live.filter((r) => ['ready', 'returned'].includes(String(r.assignment.status)) && (istDay(r.assignment.returned_at ?? r.assignment.ready_at) ?? '').startsWith(month));
  const amounts = doneRows.map((r) => (r.settlement ? Number(r.settlement.amount) : NaN)).filter((n) => Number.isFinite(n));
  const unsettled = live.filter((r) => r.settlement && !r.settlement.settled).slice(0, 100).map((r) => {
    const v = r.vehicle ?? {};
    return { id: String(r.assignment.id), booking_id: typeof r.lead?.booking_id === 'string' ? r.lead.booking_id.slice(0, 24) : null, vehicle: [v.brand && v.brand !== 'Other' ? v.brand : '', v.model].filter(Boolean).join(' ') || 'Vehicle',
      completed_at: r.assignment.returned_at ?? r.assignment.ready_at ?? null, amount: Math.round(Number(r.settlement!.amount) * 100) / 100, direction: 'we_owe_you' as const, label: 'We owe you' };
  });
  return {
    name: String(inp.garage.name ?? '').slice(0, 80), city: inp.garage.city ? String(inp.garage.city).slice(0, 40) : null, is_open: inp.garage.is_open !== false,
    today_jobs: live.filter((r) => istDay(r.assignment.assigned_at) === inp.today).length, open_jobs: live.filter((r) => isOpen(r.assignment.status)).length,
    month: { jobs: live.filter((r) => (istDay(r.assignment.assigned_at) ?? '').startsWith(month)).length, completed: doneRows.length, avg_ticket: amounts.length ? Math.round((amounts.reduce((t, n) => t + n, 0) / amounts.length) * 100) / 100 : null },
    unsettled, unsettled_total: Math.round(unsettled.reduce((t, u) => t + u.amount, 0) * 100) / 100,
    location: { set: !!inp.garage.shop_loc_at, at: inp.garage.shop_loc_at ?? null },
  };
}
/** A browser position: only finite numbers inside India's box; accuracy rounded. */
export function cleanLocation(b: any): { ok: true; lat: number; lng: number; acc: number | null } | { ok: false } {
  const lat = Number(b?.lat), lng = Number(b?.lng), acc = b?.acc == null || b?.acc === '' ? null : Number(b.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 38 || lng < 68 || lng > 98) return { ok: false };
  return { ok: true, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: acc != null && Number.isFinite(acc) && acc >= 0 && acc <= 100000 ? Math.round(acc) : null };
}
