// Tell the mechanic: pure helpers, no DOM, no Supabase. Crew and the Admin share this file: crm/tell-mechanic.js is the source and admin/tell-mechanic.js is an identical
// copy (scripts/sync_shared.sh). Tests: tests/tell-mechanic.test.mjs. The message carries no customer phone and no street address: only the first name of the mechanic,
// booking ID, service and vehicle, area, slot and the mechanic's own job link.
export const TOLD_NOTE = 'Mechanic told on WhatsApp';
const SLOT_TEXT = { asap: 'As soon as possible', morning: 'Morning 9 to 12', afternoon: 'Afternoon 12 to 4', evening: 'Evening 4 to 8' };

/** 10 digits of an Indian mobile, from "98450 12345", "+91 98450 12345", "0 98450 12345", "919845012345". Returns "91XXXXXXXXXX" or null. */
export function mechanicWaPhone(p) {
  let d = String(p == null ? '' : p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? '91' + d : null;
}
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const dayText = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? new Date(iso + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');

/** Plain-English job message. row is a Dispatch row. url may be empty: the message then says the link will follow. */
export function tellMessage(row, url) {
  const r = row || {}, who = firstName(r.mechanic_name);
  const line = (k, v) => (v ? `${k}: ${v}\n` : '');
  const what = [r.bike, r.service_name].filter(Boolean).join(', ') || (r.vehicle ? String(r.vehicle) : '');
  const when = [dayText(r.preferred_date), SLOT_TEXT[r.preferred_slot] || ''].filter(Boolean).join(', ');
  return `Hi${who ? ' ' + who : ''}, you have a job${r.booking_id ? ' ' + r.booking_id : ''}.\n\n` + line('Service', what) + line('Area', [r.area, r.pincode].filter(Boolean).join(' ')) + line('Slot', when)
    + (url ? `\nJob link: ${url}\n` : '\nThe job link will follow.\n') + '\nReply OK when you have seen this.';
}
export function tellUrl(phone, text) { const p = mechanicWaPhone(phone); return p ? `https://wa.me/${p}?text=${encodeURIComponent(String(text || ''))}` : null; }

/** The note body logged after pressing the button. Carries the first name so a later reassignment makes the old note stale. */
export const toldNoteBody = (mechanicName) => `${TOLD_NOTE}${firstName(mechanicName) ? ' · ' + firstName(mechanicName) : ''}`;

/** Newest "Mechanic told" note for the CURRENT mechanic: { at } or null. activities: [{ body, created_at }], any order. */
export function toldInfo(activities, mechanicName) {
  const f = firstName(mechanicName).toLowerCase(); let best = null;
  for (const a of Array.isArray(activities) ? activities : []) {
    const b = String((a && a.body) || ''); if (!b.startsWith(TOLD_NOTE)) continue;
    const named = b.split(' · ')[1]; if (named && f && named.trim().toLowerCase() !== f) continue;   // told a different mechanic before a reassignment
    const t = Date.parse(a.created_at); if (Number.isNaN(t)) continue; if (!best || t > best) best = t;
  }
  return best == null ? null : { at: new Date(best).toISOString() };
}
/** "Mechanic told, 14:05" in Indian time. */
export function toldLabel(at) {
  const t = Date.parse(at); if (Number.isNaN(t)) return 'Mechanic told';
  return 'Mechanic told, ' + new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}
/** Red chip rule: a mechanic is assigned, the slot is today or tomorrow (Indian date), and no told note exists. */
export function notToldYet(row, told, now = new Date()) {
  if (!row || !row.mechanic_id || told) return false;
  const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 86400000));
  return row.preferred_date === today || row.preferred_date === tomorrow;
}
