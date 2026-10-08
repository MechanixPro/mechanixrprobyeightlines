// admin/waitlist-view.js — helpers for the Waitlist tab (no DOM, no Supabase), so they can be tested in Node.
export const INTERESTS = [
  ['car', 'Car service'], ['echallan', 'E-challan services'], ['pdi', 'AI PDI reports'], ['damage', 'AI damage analysis'],
  ['rental', 'Bike rental'], ['oem', 'OEM parts'], ['insurance', 'Insurance claim service'], ['franchise', 'Franchise model'],
];
export const interestLabel = (id) => (INTERESTS.find((i) => i[0] === id) || [id, id])[1];
// How many people asked for each service (one person can ask for several), biggest first.
export function interestCounts(rows) {
  return INTERESTS.map(([id, label]) => ({ id, label, count: rows.filter((r) => (r.interests || []).includes(id)).length }))
    .sort((a, b) => b.count - a.count || INTERESTS.findIndex((i) => i[0] === a.id) - INTERESTS.findIndex((i) => i[0] === b.id));
}
export function waitlistRows(rows, { interest = '', q = '' } = {}) {
  const n = String(q || '').trim().toLowerCase();
  return rows
    .filter((r) => !interest || (r.interests || []).includes(interest))
    .filter((r) => !n || [r.name, r.phone, r.email, r.city, r.note].some((v) => String(v ?? '').toLowerCase().includes(n)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
