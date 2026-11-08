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
