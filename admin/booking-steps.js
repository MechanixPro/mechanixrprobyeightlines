import { confirmPending, confirmPaid, visitSub } from './flow-rules.js';
export * from './flow-rules.js';
// admin/booking-steps.js — the booking steps, lost reasons and conversion numbers for the admin panel (no DOM, no Supabase), so Node can test them.
// The same rules as crm/crm-rules.js. The admin and the desk are built and deployed separately, so this is a small copy, not an import; tests/booking-steps.test.mjs checks the two give the same answers.
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'], BOOKED = ['paid', 'scheduled', 'completed'], VEHICLES = ['bike', 'car', 'parts'];
const bookingLabel = (l) => String((l && l.booking_id) || '').trim();
const vehicleOf = (l) => (l && VEHICLES.includes(l.vehicle) ? l.vehicle : 'bike');
const firstContact = (l) => (l && (l.crm_first_contact_at || l.first_contact_at)) || null;
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
const SOURCE = { website: 'Website', whatsapp: 'WhatsApp', phone: 'Phone call', walk_in: 'Walk in', app: 'App', instagram: 'Meta (Instagram)' };
export function sourceName(key) {
  const k = String(key || '').toLowerCase();
  if (SOURCE[k]) return SOURCE[k];
  if (k === 'google' || k === 'adwords' || k === 'google_ads') return 'Google Ads';
  if (['fb', 'facebook', 'meta', 'ig'].includes(k)) return 'Meta';
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Unknown';
}

export const LOST_REASONS = ['Price too high', 'No answer (after 3 tries)', 'Wrong area', 'Bought elsewhere', 'Not now / later', 'Not a real enquiry', 'Other'];
export const LOST_NOTE_MIN = 5;
export function lostReasonCheck(reason, note) {
  if (!LOST_REASONS.includes(reason)) return { ok: false, error: 'Choose why the lead was lost.' };
  if (reason === 'Other' && String(note ?? '').trim().length < LOST_NOTE_MIN) return { ok: false, error: 'Add a note of at least ' + LOST_NOTE_MIN + ' characters to explain "Other".' };
  return { ok: true };
}

export const STEPS = [['lead', 'Lead'], ['called', 'Called'], ['quote', 'Quote sent'], ['confirmed', 'Confirmed'], ['scheduled', 'Scheduled'], ['done', 'Done']];
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
/** The admin's one button for a lead. An admin may take every step. */
export function nextAction(lead) {
  const st = bookingStep(lead);
  if (st.closed || st.index === 5) return null;
  if (st.index === 2 && confirmPending(lead)) return { key: 'resend_link', label: 'Resend payment link' };
  if (st.index === 3 && confirmPaid(lead) && !lead.mechanic_name && !lead.mechanic_id) return { key: 'assign', label: 'Assign mechanic' };
  return [{ key: 'call', label: 'Call now' }, { key: 'quote', label: 'Send quote' }, { key: 'confirm', label: 'Confirm booking' }, { key: 'schedule', label: 'Schedule' }, { key: 'done', label: 'Mark done' }][st.index];
}
export function stepGuard(lead, target) {
  const st = bookingStep(lead), no = (error) => ({ ok: false, error });
  if (st.closed === 'junk') return no('This lead is junk. Restore it first.');
  if (st.closed === 'lost') return no('This lead is lost. Reopen it first.');
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

/* ---------- conversion numbers ---------- */
export const istDate = (v) => new Date(new Date(v).getTime() + 330 * 60e3).toISOString().slice(0, 10);
export function leadMetrics(rows, slaMin = 15) {
  const m = { leads: 0, contacted: 0, within: 0, quotes: 0, confirmed: 0, scheduled: 0, done: 0, lost: 0 }, reasons = new Map();
  for (const r of (rows || []).filter((x) => x && x.status !== 'junk')) {
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
/** Total, bike / car / parts, by source and by day. A lead's source is its ad source (utm) or where it came from. Cost per booking is not here: no ad spend is stored. */
export function conversionReport(rows, { slaMin = 15 } = {}) {
  const list = (rows || []).filter((x) => x && x.status !== 'junk'), platform = (r) => (r.utm && r.utm.utm_source) || r.platform || r.source;
  const group = (keyOf) => { const g = new Map(); for (const r of list) { const k = keyOf(r); (g.get(k) || g.set(k, []).get(k)).push(r); } return g; };
  const byVehicle = {}; for (const v of VEHICLES) byVehicle[v] = leadMetrics(list.filter((r) => vehicleOf(r) === v), slaMin);
  const bySource = [...group((r) => sourceName(platform(r)))].map(([source, rs]) => ({ source, ...leadMetrics(rs, slaMin) })).sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
  const daily = [...group((r) => istDate(r.created_at))].map(([date, rs]) => ({ date, ...leadMetrics(rs, slaMin) })).sort((a, b) => a.date.localeCompare(b.date));
  return { slaMin, total: leadMetrics(list, slaMin), byVehicle, bySource, daily };
}
