// admin/invoice-auto.js — finding completed bookings that have no saved invoice, and creating those invoices (no DOM globals, no Supabase), so it can be tested in Node.
// The figures come from the same buildInvoice as the Invoice button; the save goes through the same saveInvoiceCopy path in admin.js (passed in as deps.save).
import { missingDetails } from './invoice.js';

const live = (r) => !!r && !r.voided_at;
// The booking's first name for the list, the way the desk shows it. Never the full name.
export const firstName = (name) => String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().split(/\s+/)[0] || 'Customer';
// A new-flow booking whose confirmation fee is not paid cannot get an invoice number (the paid-confirmation rule in the database). Kept as it is.
export const feeUnpaid = (lead) => !!lead && lead.confirm_fee != null && !lead.confirm_paid_at;

/** Completed bookings with no live (not voided) invoice. Deleted and junk bookings are never listed. Oldest first. */
export function missingInvoiceCandidates(leads, invoices) {
  const has = new Set((invoices || []).filter(live).map((r) => r.lead_id));
  return (leads || []).filter((l) => l && l.status === 'completed' && !l.deleted_at && !l.is_junk && !has.has(l.id))
    .sort((a, b) => String(a.completed_at || a.created_at || '').localeCompare(String(b.completed_at || b.created_at || '')));
}

/** Why this booking cannot get an invoice right now, in plain words, or '' when it can. `built` is the result of buildInvoice for the booking. */
export function invoiceProblem(lead, built) {
  if (feeUnpaid(lead)) return 'No invoice number yet: the confirmation fee is unpaid';
  if (!built || !built.lines || !built.lines.length) return 'No priced items: add the items on the invoice first';
  const miss = missingDetails(built);
  return miss.length ? 'Missing ' + miss.join(', ') : '';
}

/** One row of the review dialog per candidate. `build(lead)` gives the invoice figures (the same maths as the Invoice button). */
export function planCandidates(candidates, build) {
  return candidates.map((l) => {
    let built = null, reason = '';
    try { built = build(l); reason = invoiceProblem(l, built); } catch (e) { reason = 'Could not work out the invoice: ' + ((e && e.message) || 'error'); }
    return { id: l.id, lead: l, bookingId: l.booking_id || '', first: firstName(l.name), vehicle: built && built.vehicle ? [built.vehicle.reg, built.vehicle.label].filter(Boolean).join(' · ') : '', total: built ? built.total : 0, reason };
  });
}

/** Banner at the top of the Invoices page. Empty when nothing is missing. */
export function bannerHtml(count) {
  if (!count) return '';
  return `<div class="card inv-missing-banner" role="status" style="margin:12px 0;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;border-color:var(--warn,#c47f00)"><span><b>${count} completed booking${count === 1 ? ' has' : 's have'} no invoice.</b> Create ${count === 1 ? 'it' : 'them'} now; nothing is printed or emailed.</span><button class="btn btn-primary btn-sm" type="button" data-act="invMissingOpen">Create missing invoices</button></div>`;
}

/** The review dialog. `esc` and `inr` are the admin's own helpers. */
export function reviewHtml(plans, { esc, inr }) {
  const ok = plans.filter((p) => !p.reason), skip = plans.length - ok.length;
  const rows = plans.map((p) => `<tr class="imiss-row" data-lead="${esc(p.id)}"><td><b class="mono">${esc(p.bookingId || 'No ID yet')}</b><br>${p.reason ? `<span class="pill p-bad">Cannot create</span><br><span class="tiny muted">${esc(p.reason)}</span>` : `<span class="pill paid">Ready</span> <b>${inr(p.total)}</b>`}</td><td>${esc(p.first)}</td><td>${esc(p.vehicle || '—')}</td></tr>`).join('');
  return `<div class="modal-box imiss-box" style="width:min(760px,100%);max-height:90vh;overflow:auto"><h2 style="margin:0 0 6px">Create missing invoices</h2>
    <p class="muted" style="margin:0 0 10px">${ok.length} ready${skip ? `, ${skip} cannot be created yet` : ''}. Each invoice is saved to the register with the booking's current details. Nothing is printed or emailed.</p>
    <div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Booking, status, total</th><th>Customer</th><th>Vehicle</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="tiny muted" id="imiss-progress" role="status" aria-live="polite" style="margin:10px 0 0"></p>
    <div class="modal-btns" style="flex-wrap:wrap"><button class="btn btn-ghost" type="button" data-act="invMissingClose">Close</button><button class="btn btn-primary" type="button" data-act="invMissingGo"${ok.length ? '' : ' disabled'}>Create ${ok.length} invoice${ok.length === 1 ? '' : 's'}</button></div></div>`;
}

/**
 * Create and save each invoice one after the other, without printing or emailing. Safe to run twice: a booking that already has a live invoice is skipped.
 * deps: { hasLive(id) -> bool, save(lead) -> { row, reason } (never throws is not assumed), progress(text) }
 * Returns { created: [{id, number}], skipped: [{id, reason}], failed: [{id, reason}] }.
 */
export async function createMissing(plans, deps) {
  const out = { created: [], skipped: [], failed: [] };
  let n = 0;
  for (const p of plans) {
    n++; if (deps.progress) deps.progress(`Creating ${n} of ${plans.length}…`);
    if (p.reason) { out.skipped.push({ id: p.id, reason: p.reason }); continue; }
    if (deps.hasLive(p.id)) { out.skipped.push({ id: p.id, reason: 'Already has an invoice' }); continue; }
    try {
      const r = await deps.save(p.lead);
      if (r && r.row) out.created.push({ id: p.id, number: r.row.number });
      else out.failed.push({ id: p.id, reason: (r && r.reason) || 'The invoice was not saved' });
    } catch (e) { out.failed.push({ id: p.id, reason: (e && e.message) || 'The invoice was not saved' }); }
  }
  return out;
}

/** Final summary line(s). Failures follow the desk's "That did not work: ..." pattern and carry the server message. */
export function summaryText(res) {
  const parts = [`${res.created.length} created`];
  if (res.skipped.length) parts.push(`${res.skipped.length} skipped`);
  if (res.failed.length) parts.push(`${res.failed.length} failed`);
  let t = parts.join(', ') + '.';
  if (res.failed.length) t += ' That did not work: ' + [...new Set(res.failed.map((f) => f.reason))].join('; ') + '.';
  return t;
}

/**
 * After a booking is marked completed in Admin: create and save its invoice. Best effort, never throws, never undoes the completion.
 * (Crew users cannot write invoices, the table is admin only, so Crew does nothing here; the Admin banner "Create missing invoices" covers those bookings.)
 * deps: { hasLive(id), save(lead) -> { row, reason }, toast(text) }
 */
export async function autoInvoice(lead, deps) {
  try {
    if (!lead) return { status: 'skipped' };
    if (deps.hasLive(lead.id)) return { status: 'exists' };
    const r = await deps.save(lead);
    if (r && r.row) { deps.toast(`Invoice ${r.row.number} saved`); return { status: 'created', number: r.row.number }; }
    const reason = (r && r.reason) || 'it was not saved';
    deps.toast(`Booking completed, but the invoice could not be created: ${reason}. Use Create missing invoices.`);
    return { status: 'failed', reason };
  } catch (e) {
    const reason = (e && e.message) || 'error';
    try { deps.toast(`Booking completed, but the invoice could not be created: ${reason}. Use Create missing invoices.`); } catch (_) { /* nothing more to do */ }
    return { status: 'failed', reason };
  }
}
