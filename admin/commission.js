// admin/commission.js — what a mechanic or garage earns on one job, the manual correction, and the WhatsApp messages (no DOM, no Supabase).
//
// SIMPLE RULES
//  * Every job is Doorstep (default) or In garage.
//  * The percentage applies to the service amount before GST. GST never counts as commission.
//  * Which percentage: the one set on the job, otherwise the garage default (garage jobs) or the mechanic's usual rate (doorstep jobs), otherwise 30%.
//  * A manual adjustment in rupees (plus or minus, with a reason) is added to the mechanic's earnings; the company share moves the other way.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clampPct = (n) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
export const PLACES = { doorstep: 'Doorstep', garage: 'In garage' };
export const DEFAULT_PCT = 30;
const rupee = (n) => '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const signed = (n) => (n < 0 ? '−' : '+') + rupee(Math.abs(n));

export function effectiveRate({ lead = {}, mechanic = null, settings = {} } = {}) {
  const place = lead.job_place === 'garage' ? 'garage' : 'doorstep';
  if (lead.commission_pct !== null && lead.commission_pct !== undefined && lead.commission_pct !== '' && Number.isFinite(Number(lead.commission_pct))) return { place, pct: clampPct(lead.commission_pct), source: 'job' };
  if (place === 'garage') return { place, pct: clampPct(settings.garage_pct ?? DEFAULT_PCT), source: 'garage default' };
  if (mechanic && Number(mechanic.payout_rate) > 0) return { place, pct: clampPct(mechanic.payout_rate), source: 'mechanic' };
  return { place, pct: clampPct(settings.doorstep_pct ?? DEFAULT_PCT), source: 'default' };
}

export function jobSplit({ service, gst = 0, pct, adjust = 0 }) {
  const base = r2(service), byPct = r2((base * clampPct(pct)) / 100), adj = r2(adjust);
  const earnings = r2(Math.min(base, Math.max(0, byPct + adj)));
  return { base, pct: clampPct(pct), byPct, adjust: adj, earnings, company: r2(base - earnings), gst: r2(gst) };
}

export function cleanCommission({ place, pct, adjust, reason }) {
  const job_place = place === 'garage' ? 'garage' : 'doorstep';
  const p = String(pct ?? '').trim();
  let commission_pct = null;
  if (p !== '') { const n = Number(p); if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false, error: 'The percentage must be a whole number from 0 to 100, or empty to use the usual rate.' }; commission_pct = n; }
  const a = String(adjust ?? '').replace(/[,\s₹]/g, ''); let commission_adjust = 0;
  if (a !== '') { const n = Number(a); if (!Number.isFinite(n) || Math.abs(n) > 100000) return { ok: false, error: 'The adjustment must be an amount between −₹1,00,000 and ₹1,00,000.' }; commission_adjust = r2(n); }
  const note = String(reason ?? '').trim().slice(0, 200);
  if (commission_adjust !== 0 && !note) return { ok: false, error: 'Say why the commission is adjusted.' };
  return { ok: true, value: { job_place, commission_pct, commission_adjust, commission_note: commission_adjust !== 0 ? note : (note || null) } };
}

export function payoutShareText({ mechanicName, job }) {
  const j = job, L = [];
  L.push(`Hi ${mechanicName || 'there'}, payout details for job ${j.ref} (${j.date}):`, '');
  L.push(`Job type: ${PLACES[j.place] || 'Doorstep'}`, `Service amount (before GST): ${rupee(j.service)}${j.gst ? ` + GST ${rupee(j.gst)} = invoice total ${rupee(j.total)}` : ' (no GST on this invoice)'}`);
  L.push(`Your share: ${j.pct}% of ${rupee(j.service)} = ${rupee(r2((j.service * j.pct) / 100))}`);
  if (j.adjust) L.push(`Adjustment: ${signed(j.adjust)}${j.adjustNote ? ` (${j.adjustNote})` : ''}`);
  L.push(`You earn on this job: ${rupee(j.earnings)}`, `Mechanix Pro keeps: ${rupee(j.company)}`, '');
  const bc = j.byChannel || {}, parts = [];
  if (bc.company_manual) parts.push(`${rupee(bc.company_manual)} paid to Mechanix Pro`);
  if (bc.company_portal) parts.push(`${rupee(bc.company_portal)} paid online`);
  if (bc.mechanic) parts.push(`${rupee(bc.mechanic)} collected by you`);
  L.push(`Customer payment: ${parts.length ? parts.join(', ') : 'not received yet'}`);
  if (j.remitDue > 0.005) L.push(`Please send Mechanix Pro ${rupee(j.remitDue)} (the money you collected, less your earnings).`);
  if (j.payoutDue > 0.005) L.push(`Mechanix Pro will pay you ${rupee(j.payoutDue)}.`);
  if (j.remitDue <= 0.005 && j.payoutDue <= 0.005 && j.collected > 0) L.push('Nothing pending on this job.');
  L.push('', 'Mechanix Pro');
  return L.join('\n');
}

export function statementShareText({ mechanicName, rows, totals }) {
  const L = [`Hi ${mechanicName || 'there'}, your Mechanix Pro statement:`, ''];
  rows.forEach((r) => L.push(`${r.ref} · ${r.date} · ${PLACES[r.place] || 'Doorstep'} · ${rupee(r.earnings)}`));
  L.push('', `Total earned: ${rupee(totals.earnings)}`);
  if (totals.remitDue > 0.005) L.push(`You still owe Mechanix Pro: ${rupee(totals.remitDue)}`);
  if (totals.payoutDue > 0.005) L.push(`Mechanix Pro still owes you: ${rupee(totals.payoutDue)}`);
  L.push(`Net: ${rupee(Math.abs(totals.net))} (${totals.netLabel})`, '', 'Mechanix Pro');
  return L.join('\n');
}
