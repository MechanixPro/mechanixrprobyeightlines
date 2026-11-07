// admin/board-view.js — the Today board as compact two-line rows (markup only: no DOM, no Supabase), so it can be tested in Node.
// One booking = one <li class="brow">. Line 1: name, service, price. Line 2: area and slot, ONE stage chip, the paid chip, the mechanic select. Then one row of actions.
// The full 6-step stepper lives only in the booking sheet.
import { esc } from './ds.js';
import { nextStep, paidInfo } from './board.js';
import { bookingStep } from './booking-steps.js';

export const BOARD_CAP = 20;
export const BOARD_COLS = [
  ['needsReply', 'Needs a reply', 'New for more than 30 minutes. Reply first.'],
  ['quotePay', 'Quote and payment', 'Waiting for a quote, an answer or a payment.'],
  ['visits', 'Today\'s visits', 'Booked for today, in time order.'],
  ['done', 'Done today', 'Finished jobs.'],
];
const SLOTS = { asap: 'ASAP', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// The bold green PAID badge. Used on the board, Bookings list, Dispatch and the customer detail.
export const paidBadge = (l) => { const p = paidInfo(l); return p.paid ? `<span class="paid-badge" title="Payment received">PAID ${rupee(p.amount)}</span>` : ''; };

export function boardRow(l, { mechanics = [], svcName = (x) => x } = {}) {
  const p = paidInfo(l), n = nextStep(l.status), st = bookingStep(l);
  const slot = [SLOTS[l.preferred_slot] || '', l.preferred_time || ''].filter(Boolean).join(' ');
  const where = [l.area, slot].filter(Boolean).join(' · ') || 'No place or time yet';
  const svc = svcName(l.service_id);
  const opts = mechanics.filter((m) => m.active || m.id === l.mechanic_id).map((m) => `<option value="${esc(m.id)}"${m.id === l.mechanic_id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  return `<li class="brow${p.paid ? ' is-paid' : ''}${p.needsMechanic ? ' needs-mech' : ''}" data-row="${esc(l.id)}">
    <div class="b1"><button class="bname" type="button" data-lead="${esc(l.id)}">${esc(String(l.name || '').trim() || '(no name)')}</button><span class="bsvc">${esc(svc || '')}</span><span class="bprice num">${l.est_total ? rupee(l.est_total) : ''}</span></div>
    <div class="b2"><span class="bwhere">${esc(where)}</span><span class="mx-chip bstage">${esc(st.label)}</span>${paidBadge(l)}<select class="bsel" data-board-mech="${esc(l.id)}" aria-label="Mechanic"><option value="">No mechanic</option>${opts}</select></div>
    <div class="bbtns"><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a><a class="btn btn-wa btn-sm" href="https://wa.me/91${esc(l.phone)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn btn-ghost btn-sm" type="button" data-lead="${esc(l.id)}">Open</button>${n ? `<button class="btn btn-primary btn-sm" type="button" data-act="boardNext" data-id="${esc(l.id)}">${esc(n.label)}</button>` : ''}</div></li>`;
}

// groups = boardGroups(); pinned = paid bookings with no mechanic (shown first, and left out of the columns so nothing appears twice).
export function boardHtml(groups, { pinned = [], mechanics = [], svcName, active = 'needsReply', shown = {} } = {}) {
  const pin = new Set(pinned.map((l) => l.id)), ctx = { mechanics, svcName };
  const cols = BOARD_COLS.map(([k, title, hint]) => {
    const rows = (groups[k] || []).filter((l) => !pin.has(l.id)), cap = shown[k] || BOARD_CAP, more = rows.length - cap;
    return { k, title, hint, count: rows.length, html: rows.slice(0, cap).map((l) => boardRow(l, ctx)).join('') + (more > 0 ? `<li class="bmore"><button class="btn btn-ghost btn-sm" type="button" data-bmore="${k}">Show more (${more})</button></li>` : '') };
  });
  const tabs = `<div class="btabs" role="tablist" aria-label="Board groups">${(pinned.length ? [['pin', 'Paid, needs a mechanic', pinned.length]] : []).concat(cols.map((c) => [c.k, c.title, c.count])).map(([k, t, c]) => `<button type="button" role="tab" data-btab="${k}" aria-selected="${k === active}"${k === 'pin' ? ' class="tab-paid"' : ''}>${esc(t)} <span class="count">${c}</span></button>`).join('')}</div>`;
  const pinSec = pinned.length ? `<section class="bpin bgroup${active === 'pin' ? ' on' : ''}" data-bcol="pin"><h2>Paid, needs a mechanic <span class="count count-paid">${pinned.length}</span></h2><ul class="blist">${pinned.map((l) => boardRow(l, ctx)).join('')}</ul></section>` : '';
  const colsHtml = cols.map((c) => `<section class="bgroup${c.k === active ? ' on' : ''}" data-bcol="${c.k}"><h2 title="${esc(c.hint)}">${esc(c.title)} <span class="count">${c.count}</span></h2><ul class="blist">${c.html || '<li class="muted bempty">Nothing here.</li>'}</ul></section>`).join('');
  return `${tabs}${pinSec}<div class="bgrid">${colsHtml}</div>`;
}
