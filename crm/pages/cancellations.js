// Cancellations (Crew and Admin): customers asking to cancel, cancelled bookings and the refunds still to be paid.
// Crew can see everything here; only the Admin sees the Record refund and Refund to customer now buttons (the money ledger is Admin-only in the database too).
import { rpc, esc, head, empty, tag, toast } from '../ui.js';

const KIND = { customer: 'Customer cancelled', company: 'We cancelled', unreachable: 'Could not reach customer' };
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const SLOT = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', asap: 'As soon as possible' };

export async function render(root, ctx) {
  const d = await rpc('crm_cancellations_list'); const reqs = d.requests || [], done = d.cancelled || [];
  const owed = done.filter((c) => c.refund_outstanding > 0), total = owed.reduce((s, c) => s + c.refund_outstanding, 0);
  const canRefund = typeof ctx.openRefund === 'function', canRefundNow = typeof ctx.refundNow === 'function';   // Admin only: Crew's host provides neither
  root.innerHTML = `${head('Cancellations', 'Customers asking to cancel, cancelled bookings, and refunds still to be paid. A refund is approved and recorded by an Admin; the money goes back through the payment gateway dashboard or the original method.')}
    <section class="card" style="margin-bottom:12px"><h3 style="margin:0 0 6px">Refunds to pay${owed.length ? ' · ' + inr(total) : ''}</h3>
    ${owed.length ? `<div class="cards">${owed.map((c) => `<article class="lead-card tone-late"><div class="lc-top"><div><h2>${esc(c.booking_id)} · ${esc(c.first_name || '')}</h2><p class="muted small">${esc(KIND[c.kind] || '')} · ${esc(c.reason || '')}</p></div>${tag(inr(c.refund_outstanding) + ' due', 'late')}</div>
      <div class="lc-meta"><button class="btn sm" type="button" data-open="${esc(c.lead_id)}">Open booking</button>${canRefund ? ` <button class="btn sm primary" type="button" data-refund="${esc(c.lead_id)}">Record refund</button>${canRefundNow ? ` <button class="btn sm" type="button" data-refundnow="${esc(c.lead_id)}" data-label="${esc(c.booking_id)} · ${esc(c.first_name || '')}" data-amt="${esc(c.refund_outstanding)}">Refund to customer now</button>` : ''}` : '<span class="small muted">Admin records the refund</span>'}</div></article>`).join('')}</div>` : empty('No refunds waiting.')}</section>
    <section class="card" style="margin-bottom:12px"><h3 style="margin:0 0 6px">Customers asking to cancel${reqs.length ? ' · ' + reqs.length : ''}</h3>
    ${reqs.length ? `<div class="cards">${reqs.map((c) => `<article class="lead-card tone-next"><div class="lc-top"><div><h2>${esc(c.booking_id)} · ${esc(c.first_name || '')}</h2><p class="muted small">${esc(c.area || '')} · ${esc(c.date || '')} ${esc(SLOT[c.slot] || c.slot || '')} · paid ${inr(c.paid)}</p></div></div>
      <p class="small">${esc(c.body || '')}</p><div class="lc-meta"><button class="btn sm primary" type="button" data-open="${esc(c.lead_id)}">Open booking to cancel</button></div></article>`).join('')}</div>` : empty('No cancel requests.')}</section>
    <section class="card"><h3 style="margin:0 0 6px">Cancelled bookings</h3>
    ${done.length ? `<div class="cards">${done.map((c) => `<article class="lead-card"><div class="lc-top"><div><h2>${esc(c.booking_id)} · ${esc(c.first_name || '')}</h2><p class="muted small">${esc(KIND[c.kind] || '')} · ${esc(c.reason || '')}</p></div>${tag(c.refund_due > 0 ? (c.refund_outstanding > 0 ? 'Refund due ' + inr(c.refund_outstanding) : 'Refunded') : 'No refund', c.refund_outstanding > 0 ? 'late' : 'soft')}</div>
      <div class="lc-meta"><button class="btn sm" type="button" data-open="${esc(c.lead_id)}">Open booking</button></div></article>`).join('')}</div>` : empty('No cancelled bookings in the last 120 days.')}</section>`;
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => ctx.openLead(b.dataset.open)));
  root.querySelectorAll('[data-refundnow]').forEach((b) => b.addEventListener('click', () => { try { ctx.refundNow(b.dataset.refundnow, b.dataset.label, Number(b.dataset.amt)); } catch (e) { toast('Could not open the refund', true); } }));
  root.querySelectorAll('[data-refund]').forEach((b) => b.addEventListener('click', () => { try { ctx.openRefund(b.dataset.refund); } catch (e) { toast('Could not open the money sheet', true); } }));
}
