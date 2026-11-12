import { confirmPending, confirmPaid, visitSub } from './flow-rules.js';
export * from './flow-rules.js';
// Pure rules for the Mechanix CRM screens. They mirror what the database enforces (supabase/migrations/20261108000000_crm.sql),
// so an agent sees the problem before saving, and the database still refuses anything that slips past.
export const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];
export const BOOKED = ['paid', 'scheduled', 'completed'];
export const STATUS_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quote sent', payment_sent: 'Advance link sent', paid: 'Booked', scheduled: 'Booked', completed: 'Done', lost: 'Lost', junk: 'Junk', cancelled: 'Cancelled' };
/** The fixed list of reasons a lead can be lost for. The same list is in crm_lost_reasons() in the database (20261227000000_crew_conversion.sql). Old leads keep the wording they were saved with. */
export const LOST_REASONS = ['Price too high', 'No answer (after 3 tries)', 'Wrong area', 'Bought elsewhere', 'Not now / later', 'Not a real enquiry', 'Other'];
export const LOST_NOTE_MIN = 5;
/** A lead is only lost with a reason from the list; "Other" also needs a note of at least 5 characters. Used by the sheet, the Lost box and the admin panel. */
export function lostReasonCheck(reason, note) {
  if (!LOST_REASONS.includes(reason)) return { ok: false, error: 'Choose why the lead was lost.' };
  if (reason === 'Other' && String(note ?? '').trim().length < LOST_NOTE_MIN) return { ok: false, error: 'Add a note of at least ' + LOST_NOTE_MIN + ' characters to explain "Other".' };
  return { ok: true };
}
export const SOURCE_LABEL = { website: 'Website', whatsapp: 'WhatsApp', phone: 'Phone call', walk_in: 'Walk in', app: 'App', instagram: 'Meta (Instagram)' };
/** Friendly name for a lead source or an ad utm_source. */
export function sourceName(key) {
  const k = String(key || '').toLowerCase();
  if (SOURCE_LABEL[k]) return SOURCE_LABEL[k];
  if (k === 'google' || k === 'adwords' || k === 'google_ads') return 'Google Ads';
    if (['fb', 'facebook', 'meta', 'ig'].includes(k)) return 'Meta';
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Unknown';
}
/** The booking ID a customer sees, or '' for a lead that is not confirmed yet. The private ref (L-...) is never shown. */
export const bookingLabel = (l) => String((l && l.booking_id) || '').trim();
/** Where an ID would go on a screen or message: the booking ID, or a neutral word (default Lead) until the booking is confirmed. */
export const idOr = (l, word = 'Lead') => bookingLabel(l) || word;
/** Vehicle tag on a lead: BIKE, CAR or PARTS. A missing or unknown value is bike (the database default). */
export const VEHICLES = ['bike', 'car', 'parts'];
export const VEHICLE_LABEL = { bike: 'BIKE', car: 'CAR', parts: 'PARTS' };
export const vehicleOf = (l) => (l && VEHICLES.includes(l.vehicle) ? l.vehicle : 'bike');
/** Who sees the change control: someone who may edit leads, on a lead that is theirs or that a supervisor handles. The database decides (set_lead_vehicle). */
export const canSetVehicle = (lead, { canEdit, mineOrBoss }) => canEdit === true && mineOrBoss === true && !!lead && lead.status !== 'junk';
/** Bike, car and parts counts from a list of lead rows (junk left out), for a one-line split. */
export function vehicleCounts(rows) { const c = { bike: 0, car: 0, parts: 0 }; for (const r of rows || []) if (!isJunk(r)) c[vehicleOf(r)]++; return c; }
export const isJunk = (l) => !!l && l.status === 'junk';
/** Leads that count in pipeline totals, conversion and cost per lead: junk is kept as data but is not a lead. */
export const countable = (leads) => (leads || []).filter((l) => !isJunk(l));
/** Crew 'Confirm booking' (gives the booking ID). Mirrors confirm_booking: an open lead with no ID, for someone who can create bookings and may see it. The database decides. */
export function canConfirmBooking(lead, me) {
  if (!lead || bookingLabel(lead) || ['lost', 'junk'].includes(lead.status)) return false;
  return !!(me && me.canCreate && (me.boss || !lead.crm_owner || lead.crm_owner === me.userId));
}
/** Mark as junk and Restore are admin only (not the other desk roles). A confirmed booking is never junk. */
export const canMarkJunk = (lead, isAdmin) => isAdmin === true && !!lead && lead.status !== 'junk' && !bookingLabel(lead) && !BOOKED.includes(lead.status);
export const canRestoreJunk = (lead, isAdmin) => isAdmin === true && isJunk(lead);
export const KIND_LABEL = { call: 'Call', whatsapp: 'WhatsApp', note: 'Note', status: 'Status', assign: 'Assigned', create: 'Added', edit: 'Edited', delete: 'Deleted', restore: 'Restored' };

/** Statuses an agent may move a lead to from its current one: forward steps, or Lost. A lost lead is reopened only by a supervisor. */
export function nextStatuses(current, role) {
  if (current === 'junk') return [];
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
    return lostReasonCheck(lostReason, text);
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
  if (lead.status === 'junk') return { label: lead.junk_reason ? 'Junk: ' + lead.junk_reason : 'Junk', tone: 'muted' };
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
  return `Hi${first ? ' ' + first : ''}, new job${bookingLabel(l) ? ' ' + bookingLabel(l) : ''}.\n\n` + line('Customer', `${l.name} (${l.phone})`) + line('Bike', l.bike) + line('Service', l.service_name)
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
  return `Hi${first ? ' ' + first : ''}, your Mechanix Pro ${kind} code for ${bookingLabel(l) ? 'booking ' + bookingLabel(l) : 'your booking'} is ${code}.\n\nShare it with ${tech || 'the technician'} only ${what}, after they have photographed the bike. It works for 24 hours. Do not share it with anyone else.`;
}

/* ---------- Booking steps: Lead, Called, Quote sent, Confirmed, Scheduled, Done ----------
   Worked out from the status, the first contact time and the booking ID. No new status values: the database keeps its own. */
export const STEPS = [['lead', 'Lead'], ['called', 'Called'], ['quote', 'Quote sent'], ['confirmed', 'Confirmed'], ['scheduled', 'Scheduled'], ['done', 'Done']];
const firstContact = (l) => (l && (l.crm_first_contact_at || l.first_contact_at)) || null;
/** Which step a lead has reached. A lost or junk lead keeps the step it reached, marked stopped. steps[].state is done, current, stopped or todo. */
export function bookingStep(lead) {
  const l = lead || {}, s = l.status, closed = s === 'lost' || s === 'junk' ? s : null;
  let index = 0;
  if (s === 'completed') index = 5;
  else if (s === 'scheduled') index = 4;
  else if (s === 'paid' || bookingLabel(l)) index = 3;
  else if (s === 'quoted' || s === 'payment_sent') index = 2;
  else if (s === 'contacted' || firstContact(l)) index = 1;
  // "Payment link sent" is how step 3 reads while a confirmation payment link waits to be paid (same step, same index: nothing else moves).
  const linkSent = index === 2 && s === 'payment_sent';
  const steps = STEPS.map(([key, label], i) => ({ key, label: i === 2 && linkSent ? 'Payment link sent' : label, state: i < index ? 'done' : i > index ? 'todo' : closed ? 'stopped' : index === 5 ? 'done' : 'current' }));
  return { index, key: STEPS[index][0], label: linkSent ? 'Payment link sent' : STEPS[index][1], closed, steps, next: closed || index === 5 ? null : STEPS[index + 1][1], sub: visitSub(l) };
}
/** The one button to show for a lead. role is agent, supervisor or admin; me ({ canCreate, userId, boss }) is optional and only decides whether Confirm booking is allowed. Returns null when there is nothing to do. */
export function nextAction(lead, role = 'agent', me = null) {
  const st = bookingStep(lead);
  if (st.closed || st.index === 5) return null;
  if (role === 'agent' && !lead.crm_owner && st.index < 3) return { key: 'take', label: 'Take lead', allowed: true, reason: '' };
  switch (st.index) {
    case 0: return { key: 'call', label: 'Call now', allowed: true, reason: '' };
    case 1: return { key: 'quote', label: 'Send quote', allowed: true, reason: '' };
    case 2: { if (confirmPending(lead)) return { key: 'resend_link', label: 'Resend payment link', allowed: true, reason: '' };
      const ok = me ? canConfirmBooking(lead, me) : true; return { key: 'confirm', label: 'Confirm booking', allowed: ok, reason: ok ? '' : 'You cannot confirm this booking. Ask a supervisor.' }; }
    case 3: if (confirmPaid(lead) && !lead.mechanic_name && !lead.mechanic_id) return { key: 'assign', label: 'Assign garage', allowed: true, reason: '' };
      return { key: 'schedule', label: 'Schedule', allowed: true, reason: '' };
    default: return role === 'admin' ? { key: 'done', label: 'Mark done', allowed: true, reason: '' } : { key: 'done', label: 'Mark done', allowed: false, reason: 'An admin marks the job done after the technician reports and payment is checked.' };
  }
}
/** Is this move allowed from where the lead is? target: call, quote, confirm, schedule, done or lost. The database still decides; this gives the message first. */
export function stepGuard(lead, target) {
  const st = bookingStep(lead), no = (error) => ({ ok: false, error });
  if (st.closed === 'junk') return no('This lead is junk. An admin must restore it first.');
  if (st.closed === 'lost') return no('This lead is lost. A supervisor must reopen it first.');
  if (target === 'quote' && st.index >= 2) return no('This lead is already past the quote step.');
  if ((target === 'confirm' || target === 'schedule') && confirmPending(lead)) return no('Waiting for the confirmation fee. The booking is confirmed when it is paid.');
  if (target === 'confirm' && st.index >= 3) return no('This booking is already confirmed.');
  if (target === 'schedule') {
    if (!bookingLabel(lead) && st.index < 4) return no('Confirm the booking first. Scheduling needs the booking ID.');
    if (st.index >= 4) return no('This booking is already scheduled.');
  }
  if (target === 'done') {
    if (st.index === 5) return no('This job is already done.');
    if (st.index < 3) return no('Confirm and schedule the booking before marking it done.');
    if (st.index < 4) return no('Schedule the job before marking it done.');
  }
  if (target === 'lost' && BOOKED.includes(lead.status)) return no('A booked job cannot be marked lost here.');
  return { ok: true };
}

/* ---------- Call now queue ---------- */
export const WAIT_AMBER = 15, WAIT_RED = 120, WAIT_DARK = 1440;
/** An open lead nobody has contacted yet and that has no booking ID. Mirrors crm_call_queue. Junk, lost and booked leads are never in it. */
export const inCallQueue = (l) => !!l && OPEN.includes(l.status) && !bookingLabel(l) && !firstContact(l);
/** How long a lead has waited, with its colour: amber past 15 minutes, red past 2 hours, dark past 24 hours. */
export function waitInfo(createdAt, now = new Date()) {
  const m = minutesAgo(createdAt, now);
  const tone = m > WAIT_DARK ? 'dark' : m > WAIT_RED ? 'red' : m > WAIT_AMBER ? 'amber' : 'ok';
  const label = m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.floor(m / 1440) + ' d ' + Math.floor((m % 1440) / 60) + ' h';
  return { minutes: m, tone, label };
}
/** The queue: leads that belong in it, oldest first, each with its wait and whether it has no owner. */
export function callQueue(leads, now = new Date()) {
  return (leads || []).filter(inCallQueue)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || String(a.id).localeCompare(String(b.id)))
    .map((l) => ({ ...l, wait: waitInfo(l.created_at, now), unowned: !l.crm_owner }));
}

/* ---------- Conversion numbers ---------- */
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
export const istDate = (v) => new Date(new Date(v).getTime() + 330 * 60e3).toISOString().slice(0, 10);
/** The first and last IST date (YYYY-MM-DD) of "today" (days = 1) or the last N days. */
export function lastDays(days, now = Date.now()) { const to = istDate(now); return { from: istDate(new Date(to + 'T00:00:00Z').getTime() - (days - 1) * 864e5), to }; }
/** Counts for a set of leads. Junk is left out. Quotes sent means the lead reached the quote step or later (worked out from its status today, there is no history table). */
export function leadMetrics(rows, slaMin = 15) {
  const m = { leads: 0, contacted: 0, within: 0, quotes: 0, confirmed: 0, scheduled: 0, done: 0, lost: 0 }, reasons = new Map();
  for (const r of countable(rows)) {
    m.leads++;
    const fc = firstContact(r);
    if (fc) { m.contacted++; if (new Date(fc).getTime() - new Date(r.created_at).getTime() <= slaMin * 60e3) m.within++; }
    if (['quoted', 'payment_sent', ...BOOKED].includes(r.status) || bookingLabel(r)) m.quotes++;
    if (bookingLabel(r) || BOOKED.includes(r.status)) m.confirmed++;
    if (r.status === 'scheduled' || r.status === 'completed') m.scheduled++;
    if (r.status === 'completed') m.done++;
    if (r.status === 'lost') { m.lost++; const k = String(r.crm_lost_reason || 'No reason recorded'); reasons.set(k, (reasons.get(k) || 0) + 1); }
  }
  m.withinPct = pct(m.within, m.leads); m.confirmedPct = pct(m.confirmed, m.leads);
  m.lostReasons = [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
  return m;
}
/** Total, bike / car / parts, by source and by day (India time). Cost per booking is not here: no ad spend is stored anywhere to divide by. */
export function conversionReport(rows, { slaMin = 15 } = {}) {
  const list = countable(rows), group = (keyOf) => { const g = new Map(); for (const r of list) { const k = keyOf(r); (g.get(k) || g.set(k, []).get(k)).push(r); } return g; };
  const byVehicle = {}; for (const v of VEHICLES) byVehicle[v] = leadMetrics(list.filter((r) => vehicleOf(r) === v), slaMin);
  const bySource = [...group((r) => sourceName(r.platform || r.source))].map(([source, rs]) => ({ source, ...leadMetrics(rs, slaMin) })).sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
  const daily = [...group((r) => istDate(r.created_at))].map(([date, rs]) => ({ date, ...leadMetrics(rs, slaMin) })).sort((a, b) => a.date.localeCompare(b.date));
  return { slaMin, total: leadMetrics(list, slaMin), byVehicle, bySource, daily };
}
