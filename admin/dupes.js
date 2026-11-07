// Duplicate customers: pure logic shared by Crew and Admin (crm/dupes.js is the source; admin/dupes.js is an identical copy).
// No imports, no DOM. Rows come from crm_duplicate_customers (group_key, customer_id, name, phone, bookings, paid_total, created_at, has_booking_id).
// A summary (crm_customer_summary) may be merged in as confirmed_bookings and last_booking_date.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const normPhone10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const time = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Infinity; };

/** Bookings that are paid or confirmed: the summary's confirmed count when known, else all bookings if any carries a booking ID. */
export function paidBookings(r) {
  if (r && r.confirmed_bookings != null) return num(r.confirmed_bookings);
  return r && r.has_booking_id ? num(r.bookings) : 0;
}

/** Group rows by normalised phone (group_key wins when present). Only groups of two or more. Order: first appearance. */
export function groupRows(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.customer_id) continue;
    const k = normPhone10(r.group_key || r.phone);
    if (k.length !== 10) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map].filter(([, m]) => m.length > 1).map(([key, members]) => ({ key, members }));
}

/** Suggested keeper: most paid bookings, then the oldest record, then the lowest id (stable). Returns the customer_id. */
export function suggestKeeper(members) {
  const list = Array.isArray(members) ? members : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => paidBookings(b) - paidBookings(a) || time(a.created_at) - time(b.created_at) || String(a.customer_id).localeCompare(String(b.customer_id)))[0].customer_id;
}

const who = (r) => (r.name && String(r.name).trim()) || 'No name';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Plain-text merge confirmation. Callers escape it (esc) when putting it in HTML. Money only when showMoney. */
export function mergeConfirmText(keep, drop, { showMoney = false, rupee = (n) => '₹' + Math.round(num(n)).toLocaleString('en-IN') } = {}) {
  const k = keep || {}, d = drop || {};
  const lines = [
    `Merge "${who(d)}" into "${who(k)}" (+91 ${String(normPhone10(k.phone))}).`,
    '',
    'What moves to the kept customer:',
    `- ${plural(num(d.bookings), 'booking', 'bookings')}, with their invoices and payments${showMoney ? ` (${rupee(d.paid_total)} paid)` : ''}`,
    '- bikes and any other records linked to the merged customer',
    '',
    'What is kept as it is:',
    `- the kept customer's name, phone and ${plural(num(k.bookings), 'booking', 'bookings')}${showMoney ? ` (${rupee(k.paid_total)} paid)` : ''}`,
    '- empty fields on the kept customer (email, address, area, notes) are filled from the merged one',
    '',
    'Nothing is deleted. The merged customer stays as a retired record and an admin can undo this merge.',
  ];
  return lines.join('\n');
}

/** Same text as safe HTML paragraphs and lists. */
export function mergeConfirmHtml(keep, drop, opts) {
  const out = []; let list = false;
  for (const line of mergeConfirmText(keep, drop, opts).split('\n')) {
    if (line.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${esc(line.slice(2))}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (line) out.push(`<p>${esc(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

/** The merge reason sent to the database: who asked and from which desk. No phone numbers. */
export const mergeReason = (desk) => `Duplicate customer merged from the ${desk === 'admin' ? 'Admin' : 'Crew'} Duplicates screen`;

/** Remove a merged customer from the rows so the list updates without a reload. */
export const withoutCustomer = (rows, id) => (Array.isArray(rows) ? rows : []).filter((r) => r.customer_id !== id);
