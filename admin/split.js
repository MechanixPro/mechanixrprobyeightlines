// admin/split.js — how money collected on a job is shared between the mechanic and the company (no DOM, no Supabase).
// The company chooses the mechanic's percentage; prices include 18% GST, so the company can also choose to share the amount before GST.
export function splitJob(amount, rate, basis = 'collected') {
  const r = Math.min(100, Math.max(0, Math.round(Number(rate)) || 0));
  const amt = Math.max(0, Math.round(Number(amount)) || 0);
  const base = basis === 'before_gst' ? Math.round(amt / 1.18) : amt;
  const mechanic = Math.round((base * r) / 100);
  return { base, gst: amt - base, mechanic, company: base - mechanic, mechanicRate: r, companyRate: 100 - r };
}
