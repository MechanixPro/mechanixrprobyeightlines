// Pure rules for the paid-confirmation flow (no DOM, no Supabase). Source: crm/flow-rules.js. admin/flow-rules.js is a copy (a test checks they are identical).
const hasPii = (text) => {   // same rule as crm/crm-rules.js hasPii
  const t = String(text ?? '');
  if (/[A-Z]{5}[0-9]{4}[A-Z]/.test(t.toUpperCase())) return true;
  return (t.replace(/[ -]/g, '').match(/[0-9]{12,}/g) || []).some((r) => !(r.length === 12 && /^91[6-9][0-9]{9}$/.test(r)));
};

/* ---------- Paid confirmation (Rs 49 to Rs 99 by engine size).  ---------- */
/** A lead whose confirmation fee is not paid yet. Old-style leads (no fee) are never pending. */
export const confirmPending = (l) => !!l && l.confirm_fee != null && !l.confirm_paid_at && !['lost', 'junk'].includes(l.status);
export const confirmPaid = (l) => !!l && l.confirm_fee != null && !!l.confirm_paid_at;
/** The badge in lead views: "Paid ₹49" or "Unpaid ₹49". null for a lead with no confirmation fee. */
export function paidBadge(l) {
  if (!l || l.confirm_fee == null) return null;
  const amt = '₹' + Number(l.confirm_fee);
  return l.confirm_paid_at ? { text: 'Paid ' + amt, tone: 'good' } : { text: 'Unpaid ' + amt, tone: 'warn' };
}
/** The quote and visit state shown next to the step bar: Quote sent, Approved, Work started, Ready, Delivered. null when there is nothing yet. */
export function visitSub(l) {
  if (!l) return null;
  const v = l.visit_stage, q = l.quote_state;
  if (l.status === 'completed' && l.confirm_fee != null) return { key: 'delivered', label: 'Delivered' };
  if (v === 'returned') return { key: 'delivered', label: 'Delivered' };
  if (v === 'ready') return { key: 'ready', label: 'Ready' };
  if (v === 'repair_doorstep' || v === 'picked_up') return { key: 'work', label: 'Work started' };
  if (q === 'approved') return { key: 'approved', label: 'Approved' };
  if (q === 'declined') return { key: 'declined', label: 'Quote declined' };
  if (q === 'sent') return { key: 'quote_sent', label: 'Quote sent' };
  if (v === 'started') return { key: 'verified', label: 'Door code verified' };
  return null;
}
/** The Call script card for a sales call. amount is the fee for the lead (from the server). */
export const callScript = (amount) => `To confirm your slot, pay ₹${amount} on the link I'm sending now. The mechanic gets your address and you get the confirmation by email and WhatsApp. The ₹${amount} is adjusted in your final bill.`;

/* ---------- Quote builder rules (same checks as the crm_quote_save RPC, which still decides) ---------- */
export const QUOTE_KINDS = [['parts', 'Parts'], ['labour', 'Labour'], ['other', 'Other']];
/** Genuine Parts Promise: every part line says whether it is Genuine or Equivalent. */
export const PART_TYPES = [['genuine', 'Genuine'], ['equivalent', 'Equivalent']];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
/** Lines are before GST; 18% GST is added on top; the confirmation fee already paid is credited. */
export function quoteTotals(lines, feePaid = 0, rate = 18) {
  const subtotal = r2((lines || []).reduce((n, l) => n + r2(l.amount), 0)), gst = r2(subtotal * rate / 100), total = r2(subtotal + gst), credit = Math.min(Number(feePaid) || 0, total);
  return { subtotal, gst, total, feeCredit: credit, balance: r2(total - credit) };
}
/** Is this quote ready to save and send? The delivery estimate is required: hours (1 to 72) for a repair at the door, or a day for a pickup. */
export function quoteCheck(lines, eta, today = new Date()) {
  const no = (error) => ({ ok: false, error });
  const list = lines || [];
  if (!list.length) return no('Add at least one line.');
  if (list.length > 20) return no('At most 20 lines.');
  for (const l of list) {
    if (!QUOTE_KINDS.some(([k]) => k === l.kind)) return no('Each line is parts, labour or other.');
    if (l.kind === 'parts' && !PART_TYPES.some(([k]) => k === l.part_type)) return no('Mark each part as Genuine or Equivalent.');
    const nm = String(l.name || '').trim();
    if (nm.length < 2 || nm.length > 80) return no('Each line needs a name (2 to 80 characters).');
    if (hasPii(nm)) return no('Remove ID, bank or card numbers from the line names.');
    const a = Number(l.amount); if (!Number.isFinite(a) || a < 0 || a > 100000 || String(l.amount).trim() === '') return no('Each amount must be from 0 to 1,00,000.');
  }
  if (!eta || (eta.kind !== 'hours' && eta.kind !== 'date')) return no('Set the estimated delivery before sending the quote.');
  if (eta.kind === 'hours') { const h = Number(eta.hours); if (!Number.isInteger(h) || h < 1 || h > 72) return no('Set the estimated delivery: hours from 1 to 72.'); }
  else {
    const ist = (d) => new Date(new Date(d).getTime() + 330 * 60e3).toISOString().slice(0, 10), t0 = ist(today), t60 = ist(new Date(today).getTime() + 60 * 864e5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eta.date || '') || eta.date < t0 || eta.date > t60) return no('Set the estimated delivery: a day within the next 60 days.');
  }
  return { ok: true };
}
/** Work may start only when the latest sent quote is approved. status is the latest quote's status (or null for none). */
export function canStartWork(quoteStatus) { return quoteStatus === 'approved'; }
/** Which Resend buttons to show: failed or skipped messages. rows come from crm_notifications. */
export const NOTICE_LABEL = { confirm_email: 'Confirmation email', receipt_email: 'Fee receipt email', confirm_whatsapp: 'WhatsApp confirmation', team_paid: 'Team alert: paid', team_link_unpaid: 'Team alert: link unpaid', team_unassigned: 'Team alert: no mechanic', quote_email: 'Quote email', quote_whatsapp: 'Quote WhatsApp', team_quote_decision: 'Team alert: quote decision', eta_email: 'Delivery update email', eta_whatsapp: 'Delivery update WhatsApp', ontheway_email: 'On-the-way email', team_issue: 'Team alert: customer issue' };
export const resendable = (rows) => (rows || []).filter((r) => ['failed', 'skipped'].includes(r.status) && !String(r.kind).startsWith('team_link') && !String(r.kind).startsWith('team_unass') && !String(r.kind).startsWith('team_quote'));
/** Dispatch order: unassigned first, then day, then slot (as soon as possible first), then oldest. Mirrors crm_dispatch_list. */
export const SLOT_RANK = { asap: 0, morning: 1, afternoon: 2, evening: 3 };
export function dispatchOrder(rows) {
  return [...(rows || [])].sort((a, b) => (Number(!!(a.mechanic_id || a.garage_id)) - Number(!!(b.mechanic_id || b.garage_id))) || String(a.preferred_date).localeCompare(String(b.preferred_date)) || ((SLOT_RANK[a.preferred_slot] ?? 4) - (SLOT_RANK[b.preferred_slot] ?? 4)) || String(a.created_at).localeCompare(String(b.created_at)));
}

/* ----- Customer journey (added details, issues, mechanic last seen) ----- */
export const ISSUE_TYPES = { late: 'Running late', mechanic: 'About the mechanic', payment: 'Payment', safety: 'Safety', other: 'Other' };
/** "Mechanic last seen 3 min ago": age in seconds in, words out. Over 10 minutes it says the point is old. */
export function seenLine(ageSeconds) {
  const a = ageSeconds == null ? NaN : Number(ageSeconds); if (!Number.isFinite(a) || a < 0) return null;
  if (a < 45) return 'Mechanic last seen just now';
  const m = Math.round(a / 60);
  if (m < 60) return `Mechanic last seen ${m} min ago${m > 10 ? ' (old point)' : ''}`;
  return `Mechanic last seen ${Math.round(m / 60)} h ago (old point)`;
}
export const mapsUrl = (lat, lng) => (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}` : null);
/** Open issues first (oldest first), then resolved ones (newest first). */
export function issueOrder(rows) {
  return [...(rows || [])].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.status === 'open' ? String(a.created_at).localeCompare(String(b.created_at)) : String(b.resolved_at).localeCompare(String(a.resolved_at))));
}
