// admin/split.js — how money collected on a job is shared between the mechanic and the company (no DOM, no Supabase).
// The company chooses the mechanic's percentage; prices include 18% GST, so the company can also choose to share the amount before GST.
export function splitJob(amount, rate, basis = 'collected', gstRate = 18) {
  const r = Math.min(100, Math.max(0, Math.round(Number(rate)) || 0));
  const amt = Math.max(0, Math.round(Number(amount)) || 0);
  const g = [0, 5, 12, 18].includes(Number(gstRate)) ? Number(gstRate) : 18; // the GST rate of the invoice; prices on the site include 18%
  const base = basis === 'before_gst' ? Math.round(amt / (1 + g / 100)) : amt;
  const mechanic = Math.round((base * r) / 100);
  return { base, gst: amt - base, mechanic, company: base - mechanic, mechanicRate: r, companyRate: 100 - r };
}
