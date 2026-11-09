// Partner KYC review rules (pure, no DOM, no Supabase). Shared by Admin (admin/kyc-view.js). Tested in tests/kyc-view.test.mjs.
// REQUIRED is a copy of supabase/functions/_shared/partner-kyc.ts; the test checks the two stay the same.
export const REQUIRED = {
  garage: [
    { type: 'aadhaar_front', min: 1 }, { type: 'aadhaar_back', min: 1 }, { type: 'pan', min: 1 }, { type: 'garage_photo', min: 3 },
    { type: 'mechanic_photo', min: 1 }, { type: 'mechanic_aadhaar_front', min: 1 }, { type: 'mechanic_aadhaar_back', min: 1 }, { type: 'mechanic_pan', min: 1 },
    { type: 'signed_agreement', min: 1 },
  ],
  mechanic: [
    { type: 'mechanic_photo', min: 1 }, { type: 'aadhaar_front', min: 1 }, { type: 'aadhaar_back', min: 1 }, { type: 'pan', min: 1 }, { type: 'signed_agreement', min: 1 },
  ],
};
export const DOC_LABELS = {
  aadhaar_front: 'Aadhaar, front', aadhaar_back: 'Aadhaar, back', pan: 'PAN card', garage_photo: 'Garage photos', shop_licence: 'Shop licence',
  mechanic_photo: 'Mechanic photo', mechanic_aadhaar_front: 'Mechanic Aadhaar, front', mechanic_aadhaar_back: 'Mechanic Aadhaar, back', mechanic_pan: 'Mechanic PAN card', signed_agreement: 'Signed agreement',
};
export const docLabel = (t) => DOC_LABELS[t] || String(t || '').replace(/_/g, ' ');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One chip per applicant: Documents submitted, Waiting for documents, Approved or Rejected. */
export function applicantChip(row) {
  const d = row && row.decision;
  if (d === 'approved') return { key: 'approved', label: 'Approved', tone: 'ok' };
  if (d === 'rejected') return { key: 'rejected', label: 'Rejected', tone: 'bad' };
  if (row && row.submitted) return { key: 'submitted', label: 'Documents submitted', tone: 'warn' };
  return { key: 'waiting', label: 'Waiting for documents', tone: 'muted' };
}
const ORDER = { submitted: 0, waiting: 1, approved: 2, rejected: 3 };
export const sortApplicants = (rows) => [...(rows || [])].sort((a, b) => ORDER[applicantChip(a).key] - ORDER[applicantChip(b).key] || String(a.name || '').localeCompare(String(b.name || '')));

export function docChip(status) {
  if (status === 'accepted') return { label: 'Accepted', tone: 'ok' };
  if (status === 'rejected') return { label: 'Rejected', tone: 'bad' };
  return { label: 'To check', tone: 'warn' };
}
const acceptedCount = (docs, type) => (docs || []).filter((d) => d.doc_type === type && d.status === 'accepted').length;
/** Required documents that still lack enough Accepted files: [{ type, need }]. */
export function missingAccepted(kind, docs) {
  return (REQUIRED[kind] || []).map((r) => ({ type: r.type, need: r.min - acceptedCount(docs, r.type) })).filter((m) => m.need > 0);
}
export const canApprove = (kind, docs) => Array.isArray(REQUIRED[kind]) && missingAccepted(kind, docs).length === 0;
export function checkReason(text) { const t = String(text ?? '').trim(); return t ? { ok: true, reason: t.slice(0, 300) } : { ok: false, error: 'Write a reason the applicant can act on.' }; }
/** Documents grouped for the checklist: required types first (even if nothing was uploaded), then any extra types. */
export function checklist(kind, docs) {
  const req = REQUIRED[kind] || [], seen = new Set(req.map((r) => r.type));
  const extra = [...new Set((docs || []).map((d) => d.doc_type))].filter((t) => !seen.has(t));
  return [...req.map((r) => ({ type: r.type, min: r.min, required: true })), ...extra.map((t) => ({ type: t, min: 0, required: false }))]
    .map((g) => ({ ...g, label: docLabel(g.type), files: (docs || []).filter((d) => d.doc_type === g.type), accepted: acceptedCount(docs, g.type) }));
}

/* ---- Partner plans and history (Admin only; these pure rules sit here so they are tested with the other KYC rules) ---- */
export const PLAN_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/** One plain line for a plan row from partner_plans: "Deposit ₹10,000 for 3 months · Mechanix Pro commission 30% · 50 to 80 orders a month". */
export function planSummary(p) {
  if (!p) return '';
  const dep = Number(p.deposit_amount) > 0 ? `Deposit ${inr(p.deposit_amount)} for ${p.deposit_months} months` : 'No deposit';
  const orders = p.orders_min != null && p.orders_max != null ? ` · ${p.orders_min} to ${p.orders_max} orders a month` : '';
  return `${dep} · Mechanix Pro commission ${Number(p.commission_pct)}%${orders}`;
}
export const DEPOSIT_TEXT = { not_required: 'No deposit needed', pending: 'Deposit not received yet', held: 'Deposit received', refunded: 'Deposit refunded' };
export const depositChip = (s) => ({ label: DEPOSIT_TEXT[s] || 'No deposit needed', tone: s === 'held' ? 'ok' : s === 'pending' ? 'warn' : 'muted' });
const EVENT_TEXT = { link_created: 'Onboarding link sent', docs_deleted: 'Documents deleted', kyc_skipped: 'Mechanic skipped KYC for now', submitted: 'Documents submitted' };
/** Readable text for one onboarding-log action. Never includes a document name or number. */
export function eventText(action) {
  const a = String(action || '');
  if (EVENT_TEXT[a]) return EVENT_TEXT[a];
  let m = /^plan_set:(bronze|silver|gold)$/.exec(a); if (m) return 'Plan set to ' + PLAN_LABEL[m[1]];
  m = /^deposit:(pending|held|refunded)$/.exec(a); if (m) return { pending: 'Deposit marked pending', held: 'Deposit marked received', refunded: 'Deposit marked refunded' }[m[1]];
  m = /^(doc_[a-z_]+|kyc_[a-z_]+|onboard[a-z_]*|[a-z_]+)$/.exec(a);
  return m ? a.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Activity';
}
