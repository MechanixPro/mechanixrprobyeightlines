// Pure rules for the Mechanix CRM screens. They mirror what the database enforces (supabase/migrations/20261108000000_crm.sql),
// so an agent sees the problem before saving, and the database still refuses anything that slips past.
export const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];
export const BOOKED = ['paid', 'scheduled', 'completed'];
export const STATUS_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quote sent', payment_sent: 'Advance link sent', paid: 'Booked', scheduled: 'Booked', completed: 'Done', lost: 'Lost' };
export const LOST_REASONS = ['Price too high', 'No answer', 'Wrong area', 'Booked elsewhere', 'Not interested', 'Other'];
export const SOURCE_LABEL = { website: 'Website', whatsapp: 'WhatsApp', phone: 'Phone call', walk_in: 'Walk in', app: 'App', instagram: 'Meta (Instagram)' };
/** Friendly name for a lead source or an ad utm_source. */
export function sourceName(key) {
  const k = String(key || '').toLowerCase();
  if (SOURCE_LABEL[k]) return SOURCE_LABEL[k];
  if (k === 'google' || k === 'adwords' || k === 'google_ads') return 'Google Ads';
    if (['fb', 'facebook', 'meta', 'ig'].includes(k)) return 'Meta';
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Unknown';
}
export const KIND_LABEL = { call: 'Call', whatsapp: 'WhatsApp', note: 'Note', status: 'Status', assign: 'Assigned', create: 'Added', edit: 'Edited', delete: 'Deleted', restore: 'Restored' };

/** Statuses an agent may move a lead to from its current one: forward steps, or Lost. A lost lead is reopened only by a supervisor. */
export function nextStatuses(current, role) {
  if (current === 'lost') return role === 'supervisor' ? OPEN.filter((s) => s !== 'new') : [];
  if (BOOKED.includes(current)) return [];
  const i = OPEN.indexOf(current);
  return [...OPEN.slice(i + 1), 'lost'];
}

/** Same test as crm_has_pii in the database: Aadhaar, PAN, bank or card numbers never go into a note. */
export function hasPii(text) {
  const t = String(text ?? '');
  if (/[A-Z]{5}[0-9]{4}[A-Z]/.test(t.toUpperCase())) return true;
  const runs = t.replace(/[ -]/g, '').match(/[0-9]{12,}/g) || [];
  return runs.some((r) => !(r.length === 12 && /^91[6-9][0-9]{9}$/.test(r)));
}

/** Check a "what happened" entry before saving. Returns { ok: true } or { ok: false, error }. */
export function validateLog({ kind, body, status, current, nextAction, lostReason, now = new Date() }) {
  const text = String(body ?? '').trim();
  if (hasPii(text)) return { ok: false, error: 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' };
  if (text.length > 1000) return { ok: false, error: 'The note is too long.' };
  if (kind === 'note' && !text && !status) return { ok: false, error: 'Write the note first.' };
  const to = status || current;
  if (to !== current && !nextStatuses(current, 'sales').includes(to) && !(current === 'lost')) return { ok: false, error: 'That move is not allowed.' };
  if (to === 'lost') {
    if (!LOST_REASONS.includes(lostReason)) return { ok: false, error: 'Choose why the lead was lost.' };
    if (lostReason === 'Other' && !text) return { ok: false, error: 'Add a note to explain "Other".' };
    return { ok: true };
  }
  if (OPEN.includes(to) && (kind !== 'note' || to !== current)) {
    if (!nextAction) return { ok: false, error: 'Set the next follow-up before saving.' };
    const t = new Date(nextAction).getTime();
    if (!(t >= now.getTime() - 5 * 60e3)) return { ok: false, error: 'The follow-up must be in the future.' };
    if (t > now.getTime() + 60 * 864e5) return { ok: false, error: 'Pick a follow-up within 60 days.' };
  }
  return { ok: true };
}

/** One-tap follow-up times. */
export function followUpPresets(now = new Date()) {
  const at = (days, h) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const list = [{ label: 'In 1 hour', date: new Date(now.getTime() + 3600e3) }];
  if (now.getHours() < 17) list.push({ label: 'Today 6 PM', date: at(0, 18) });
  list.push({ label: 'Tomorrow 10 AM', date: at(1, 10) }, { label: 'In 2 days', date: at(2, 10) }, { label: 'In a week', date: at(7, 10) });
  return list;
}

/** Value for <input type="datetime-local"> in the agent's own time zone. */
export function localInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export const telUrl = (phone) => 'tel:+91' + String(phone).replace(/\D/g, '').slice(-10);
export const waUrl = (phone, text) => 'https://wa.me/91' + String(phone).replace(/\D/g, '').slice(-10) + (text ? '?text=' + encodeURIComponent(text) : '');

export function firstMessage(lead, agentName) {
  const bike = lead.bike ? ' for your ' + lead.bike : '';
  return 'Hi ' + String(lead.name || '').split(' ')[0] + ', this is ' + (agentName || 'the team') + ' from Mechanix Pro. Thanks for your enquiry' + bike + '. We can send a mechanic to your door in ' + (lead.area || 'Bengaluru') + '. What day and time suits you?';
}

export function minutesAgo(iso, now = new Date()) { return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60e3)); }
export function ago(iso, now = new Date()) {
  const m = minutesAgo(iso, now);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.floor(m / 60) + ' h ago';
  return Math.floor(m / 1440) + ' d ago';
}

/** The timer chip on a lead card: late first contact beats overdue follow-up beats the next follow-up. */
export function timerInfo(lead, now = new Date(), slaMinutes = 15) {
  if (BOOKED.includes(lead.status)) return { label: 'Booked', tone: 'good' };
  if (lead.status === 'lost') return { label: lead.crm_lost_reason || 'Lost', tone: 'muted' };
  if (!lead.crm_first_contact_at && lead.status === 'new') {
    const m = minutesAgo(lead.created_at, now);
    return m > slaMinutes ? { label: 'Waiting ' + m + ' min. Contact now', tone: 'late' } : { label: 'New. Contact within ' + Math.max(1, slaMinutes - m) + ' min', tone: 'new' };
  }
  if (lead.crm_next_action_at) {
    const t = new Date(lead.crm_next_action_at);
    if (t < now) return { label: 'Follow-up overdue by ' + ago(lead.crm_next_action_at, now).replace(' ago', ''), tone: 'late' };
    return { label: 'Follow up ' + t.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), tone: 'next' };
  }
  return { label: 'Set a follow-up', tone: 'late' };
}

export const targetPercent = (booked, target) => (target > 0 ? Math.min(100, Math.round((booked / target) * 100)) : 0);
export const conversion = (booked, total) => (total > 0 ? Math.round((booked / total) * 100) : 0);

/** Slot wording and start hour (IST), the same as the website and the booking emails. */
export const SLOT_TEXT = { morning: 'Morning (9 AM – 12 PM)', afternoon: 'Afternoon (12 – 4 PM)', evening: 'Evening (4 – 8 PM)', asap: 'As soon as possible' };
const SLOT_START = { morning: 9, afternoon: 12, evening: 16 };

/** The WhatsApp message a Care Buddy sends the technician for a job. No prices: the technician gets the bill in the admin. Notes with ID numbers are left out. For a pickup job (opts.pickup) it also tells the technician to take the photos and enter the customer's code on the same link. */
export function techJobMessage(l, url, opts = {}) {
  const first = String(l.mechanic_name || '').trim().split(' ')[0];
  const day = l.preferred_date ? new Date(l.preferred_date + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
  const line = (k, v) => (v ? `${k}: ${v}\n` : '');
  return `Hi${first ? ' ' + first : ''}, new job ${l.ref}.\n\n` + line('Customer', `${l.name} (${l.phone})`) + line('Bike', l.bike) + line('Service', l.service_name)
    + line('Place', [l.area, l.address].filter(Boolean).join(', ')) + line('When', [day, SLOT_TEXT[l.preferred_slot] || ''].filter(Boolean).join(' · '))
    + line('Notes', l.notes && !hasPii(l.notes) ? String(l.notes).slice(0, 300) : '') + '\nPlease reply OK to confirm.'
    + (opts.pickup ? '\n\nPICKUP JOB: the bike goes to the workshop. At pickup, and again when you bring it back, open the link below: take 4 photos of the bike (front, back, left, right) and enter the 4-digit code the customer shows you.' : '')
    + (url ? (opts.pickup ? '\n\nYour job link (photos, code, and the amount collected after the job): ' : '\n\nAfter the job, update the amount collected here: ') + url : '');
}

/** Booked jobs with no technician that need one now: today's jobs from 2 hours before the slot starts, "as soon as possible" jobs at once, and any earlier day still unstaffed. */
export function unstaffedSoon(jobs, now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60e3), today = ist.toISOString().slice(0, 10), hour = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  return (jobs || []).filter((j) => {
    if (!j.preferred_date || j.preferred_date > today) return false;
    if (j.preferred_date < today) return true;
    const start = SLOT_START[j.preferred_slot];
    return start == null || hour >= start - 2;
  });
}

/** Order the technicians for a booking: free in its slot first, then those who cover its PIN code. Each gets a label for the picker. The booking itself never counts as a clash. */
export function rankTechs(board, lead) {
  const slot = lead.preferred_slot && lead.preferred_slot !== 'asap' ? lead.preferred_slot : null, pin = lead.pincode || null;
  const list = (board || []).map((t, i) => {
    const jobs = (t.jobs || []).filter((j) => j.id !== lead.id);
    const covers = !!pin && (t.pincodes || []).includes(pin), busy = !!slot && jobs.some((j) => j.slot === slot);
    const label = [t.name, t.area, covers ? 'covers ' + pin : '', slot ? (busy ? 'busy in this slot' : 'free') : '', jobs.length ? jobs.length + (jobs.length === 1 ? ' job' : ' jobs') + ' that day' : ''].filter(Boolean).join(' · ');
    return { id: t.id, name: t.name, covers, busy, jobs: jobs.length, label, i };
  });
  return list.sort((a, b) => (a.busy - b.busy) || (b.covers - a.covers) || (a.i - b.i));
}

/** Check a "Technician assigned" (assign) or "Booking confirmed" (confirm) move before saving. today is the IST date as YYYY-MM-DD. */
export function moveCheck(kind, v, today) {
  if (!v.mechanic_id) return { ok: false, error: 'Choose the technician.' };
  if (kind === 'confirm') {
    if (!v.date) return { ok: false, error: 'Choose the date.' };
    if (!v.slot) return { ok: false, error: 'Choose a time slot.' };
    if (v.date < today) return { ok: false, error: 'The date is in the past.' };
  }
  return { ok: true };
}

/** Distance in km between two [lat, lng] points (haversine), or null if either is missing. */
function kmBetween(a, b) {
  if (!a || !b) return null;
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}
/** Find by PIN: technicians who cover the PIN first, then the rest by distance from the PIN's centre to their base (first) PIN; garages by distance. geo is PIN -> [lat, lng, ...]. */
export function nearestByPin(pin, techs, garages, geo) {
  const p = String(pin || '').trim();
  if (!/^[0-9]{6}$/.test(p)) throw new Error('Enter a 6-digit PIN code.');
  const centre = (geo || {})[p] || null, km = (q) => (centre && q && geo[q] ? kmBetween(centre, geo[q]) : null);
  const byKm = (a, b) => (a.km == null) - (b.km == null) || (a.km ?? 0) - (b.km ?? 0);
  const t = (techs || []).map((x) => ({ id: x.id, name: x.name, area: x.area || '', covers: (x.pincodes || []).includes(p), km: km((x.pincodes || [])[0]), jobs: (x.jobs || []).length }));
  t.sort((a, b) => (b.covers - a.covers) || byKm(a, b));
  const g = (garages || []).map((x) => ({ id: x.id, name: x.name, pincode: x.pincode || '', km: x.pincode === p ? 0 : km(x.pincode) })).sort(byKm);
  return { pinKnown: !!centre, techs: t, garages: g };
}

export function parseContacts(text) {
  const rows = [], seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/); if (!m) continue;
    const phone = m[1].replace(/\D/g, ''); if (seen.has(phone)) continue; seen.add(phone);
    const name = line.replace(m[0], ' ').replace(/[",;\t|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    rows.push({ name, phone });
  }
  return rows;
}

/* ---------- OTP handover (pickup jobs). Same rules as supabase/functions/_shared/handover.ts and the crm_handover_code RPC. ---------- */
export const HANDOVER_MAX_ATTEMPTS = 5;
export const HANDOVER_MIN_PHOTOS = 4;
export const HANDOVER_KIND_LABEL = { pickup: 'Pickup', return: 'Return' };

/** The Handover card's line for one step. items are the lead's handovers from crm_handovers, newest first. */
export function handoverStatus(items, kind, now = new Date()) {
  const mine = (items || []).filter((h) => h.kind === kind);
  const done = mine.find((h) => h.verified_at);
  if (done) return { state: 'verified', label: 'Verified', verifiedAt: done.verified_at, by: done.mechanic_name || '', photos: (done.photo_paths || []).length };
  const h = mine[0];
  if (!h) return { state: 'none', label: 'Not started' };
  if (h.locked_at || Number(h.attempts) >= HANDOVER_MAX_ATTEMPTS) return { state: 'locked', label: 'Locked after 5 wrong codes. Send a new code.' };
  if (Date.parse(h.code_expires_at) <= new Date(now).getTime()) return { state: 'expired', label: 'Code expired. Send a new code.' };
  return { state: 'sent', label: 'Code sent, waiting for the technician' };
}

/** Whether the desk may make a code for this step now: the return waits for a verified pickup, and a verified step is done. */
export function canSendHandoverCode(items, kind) {
  if ((items || []).some((h) => h.kind === kind && h.verified_at)) return false;
  return kind === 'pickup' || (items || []).some((h) => h.kind === 'pickup' && h.verified_at);
}

/** The WhatsApp message to the customer with the one-time code. The code goes only to the customer; the technician asks for it at handover. */
export function handoverMessage(l, kind, code) {
  const first = String(l.name || '').trim().split(' ')[0], tech = String(l.mechanic_name || '').trim().split(' ')[0];
  const what = kind === 'pickup' ? `before ${tech || 'our technician'} takes your bike` : `when ${tech || 'our technician'} brings your bike back`;
  return `Hi${first ? ' ' + first : ''}, your Mechanix Pro ${kind} code for booking ${l.ref} is ${code}.\n\nShare it with ${tech || 'the technician'} only ${what}, after they have photographed the bike. It works for 24 hours. Do not share it with anyone else.`;
}
