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
export const KIND_LABEL = { call: 'Call', whatsapp: 'WhatsApp', note: 'Note', status: 'Status', assign: 'Assigned', create: 'Added' };

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
