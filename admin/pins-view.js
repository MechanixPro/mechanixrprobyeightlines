// admin/pins-view.js — helpers for the PIN codes tab (no DOM, no Supabase), so they can be tested in Node.
export const validPin = (p) => /^\d{6}$/.test(String(p || '').replace(/\s/g, ''));
export const cleanPin = (p) => String(p || '').replace(/\s/g, '');
export const cleanPinName = (n) => String(n || '').replace(/<[^>]*>/g, '').replace(/[<>"\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
export function pinRows(rows, q = '') {
  const n = String(q || '').trim().toLowerCase();
  return rows.filter((r) => !n || r.pin.includes(n) || r.name.toLowerCase().includes(n)).map((r) => ({ ...r, status: r.active ? 'Served' : 'Paused' })).sort((a, b) => a.pin.localeCompare(b.pin));
}
