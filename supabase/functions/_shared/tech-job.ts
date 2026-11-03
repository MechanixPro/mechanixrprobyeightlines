// Rules for the technician job link (/job/): the token hash, the technician's percent and the company's share, and the report check.
// No Deno APIs, so node --test can run them. techPct is the same rule as admin/commission.js effectiveRate.

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const clampPct = (n: unknown) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
const round2 = (n: number) => Math.round(n * 100) / 100;
export const DEFAULT_PCT = 30;

/** The technician's percent: the booking's own percent, then the garage default for garage jobs, then the technician's payout rate, then the doorstep default. */
export function techPct({ lead = {}, mechanic = null, settings = {} }: { lead?: any; mechanic?: any; settings?: any }): number {
  const c = lead?.commission_pct;
  if (c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c))) return clampPct(c);
  if (lead?.job_place === 'garage') return clampPct(settings?.garage_pct ?? DEFAULT_PCT);
  if (mechanic && Number(mechanic.payout_rate) > 0) return clampPct(mechanic.payout_rate);
  return clampPct(settings?.doorstep_pct ?? DEFAULT_PCT);
}

/** The technician keeps pct of the base (the amount before GST when the basis says so and an invoice gives the split); the company's share is the rest of what they collected. */
export function companyShare({ collected, pct, basis, invoice = null }: { collected: number; pct: number; basis: string; invoice?: { total: number; taxable: number } | null }) {
  const amt = Math.max(0, Number(collected) || 0);
  const base = basis === 'before_gst' && invoice && Number(invoice.total) > 0 ? amt * (Number(invoice.taxable) || 0) / Number(invoice.total) : amt;
  const mechanicCut = round2((base * clampPct(pct)) / 100);
  return { mechanicCut, company: Math.max(0, round2(amt - mechanicCut)) };
}

const looksLikeId = (t: string) => /[A-Z]{5}[0-9]{4}[A-Z]/i.test(t) || /[0-9]{12,}/.test(t.replace(/[ -]/g, ''));

export function cleanReport(b: any): { ok: true; value: { t: string; amount: number; note: string | null } } | { ok: false; error: string } {
  const t = String(b?.t ?? '');
  if (!/^[0-9a-f]{64}$/.test(t)) return { ok: false, error: 'This link is not valid.' };
  const raw = String(b?.amount ?? '').trim(), amount = Number(raw);
  if (raw === '' || !Number.isFinite(amount) || amount < 0 || amount > 100000 || Math.round(amount * 100) !== amount * 100) return { ok: false, error: 'Enter the amount you collected, from ₹0 to ₹1,00,000.' };
  const n = String(b?.note ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
  return { ok: true, value: { t, amount, note: n && !looksLikeId(n) ? n : null } };
}
