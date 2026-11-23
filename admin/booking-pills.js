// The Bookings list filter pills and the masked phone shown in list rows (new design, Stage 3). Pure strings, no page, no database.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// value = what S.status holds (the same values the old Status select used), label = words on the pill.
export const PILLS = [['open', 'Open'], ['new', 'New'], ['contacted', 'Contacted'], ['quoted', 'Quote sent'], ['payment_sent', 'Advance link sent'], ['paid', 'Booked'], ['completed', 'Done'], ['cancelled', 'Cancelled'], ['lost', 'Lost'], ['overdue', 'Customer overdue'], ['junk', 'Junk'], ['all', 'All']];

/** counts: { value: number }. A pill whose count is 0 still shows, so the row does not jump around, except the two rare ones. */
export function pillsHtml(counts = {}, active = 'open') {
  const shown = PILLS.filter(([v]) => !['overdue', 'junk'].includes(v) || (counts[v] || 0) > 0 || v === active);
  return `<div class="pills" role="group" aria-label="Filter by status">${shown.map(([v, label]) => `<button type="button" class="pill-f${v === active ? ' is-on' : ''}" data-pill="${esc(v)}" aria-pressed="${v === active}">${esc(label)} <span class="pill-n">${Number(counts[v]) || 0}</span></button>`).join('')}</div>`;
}

/** 90000 00001 -> 90•••••01. Only the first two and last two digits stay. Anything that is not ten digits is shown as dots only. */
export function maskPhone(p) {
  const d = String(p ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d.slice(0, 2) + '•••••' + d.slice(-2) : '•••••••';
}
