// The top of a booking, the same in Admin and Crew (new design, Stage 1). Pure functions: no page, no database, so Node can test them.
// ONE file: crm/booking-head.js is the source; admin/booking-head.js is a copy (scripts/shared-files.txt).
// It shows only what is already stored. A step that cannot be told from the data stays "to do" rather than guessing "done".
import { esc } from './ds.js';

export const PROGRESS = [['confirmed', 'Confirmed'], ['assigned', 'Assigned'], ['code', 'Customer code'], ['quote', 'Quote approved'], ['work', 'Work'], ['final', 'Final payment'], ['invoice', 'Invoice']];
const STAGE_ORDER = ['on_the_way', 'arrived', 'started', 'repair_doorstep', 'picked_up', 'ready', 'returned'];
const stageAtLeast = (stage, min) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min) && STAGE_ORDER.indexOf(stage) >= 0;

/** Seven steps, each done, current or todo. in: { confirmed, assigned, stage, quoteStatus, completed, balance, hasInvoice, closed } */
export function progressSteps(i = {}) {
  const q = String(i.quoteStatus || '');
  const done = {
    confirmed: !!i.confirmed,
    assigned: !!i.assigned,
    code: stageAtLeast(i.stage, 'started'),
    quote: q === 'approved_self' || q === 'approved_admin' || q === 'approved',
    work: !!i.completed || stageAtLeast(i.stage, 'ready'),
    final: !!i.completed && i.balance != null && Number(i.balance) <= 0.005,
    invoice: !!i.hasInvoice,
  };
  let seenCurrent = false;
  const steps = PROGRESS.map(([key, label]) => {
    let state = done[key] ? 'done' : 'todo';
    if (state === 'todo' && !seenCurrent && !i.closed) { state = 'current'; seenCurrent = true; }
    return { key, label, state };
  });
  return steps;
}

/** Total, paid and balance from the invoice figures. Missing total -> null (shown as a dash), never a made-up zero. */
export function moneyTriple({ total, paid } = {}) {
  const t = total == null || total === '' ? null : Number(total), p = Number(paid) || 0;
  if (t == null || Number.isNaN(t)) return { total: null, paid: p, balance: null };
  return { total: t, paid: p, balance: Math.max(0, Math.round((t - p) * 100) / 100) };
}

const inr = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

/** The progress line as HTML. Accessible: one sentence for screen readers, the dots are decoration. */
export function progressHtml(steps) {
  const cur = steps.find((s) => s.state === 'current'), doneN = steps.filter((s) => s.state === 'done').length;
  const say = doneN === steps.length ? 'All seven steps done.' : `${doneN} of ${steps.length} steps done${cur ? '. Next: ' + cur.label : ''}.`;
  return `<ol class="mx-prog" aria-label="${esc(say)}">${steps.map((s) => `<li class="mx-prog__s mx-prog__s--${s.state}"${s.state === 'current' ? ' aria-current="step"' : ''}><span class="mx-prog__dot" aria-hidden="true"></span><span class="mx-prog__l">${esc(s.label)}</span></li>`).join('')}</ol>`;
}

/** Invoice total, Paid, Balance. A balance above zero is amber, zero is green. */
export function moneyHtml(m) {
  const tone = m.balance == null ? '' : m.balance > 0.005 ? ' mx-money3__v--due' : ' mx-money3__v--ok';
  return `<dl class="mx-money3"><div><dt>Invoice total</dt><dd class="mx-money3__v">${inr(m.total)}</dd></div><div><dt>Paid</dt><dd class="mx-money3__v">${inr(m.paid)}</dd></div><div><dt>Balance</dt><dd class="mx-money3__v${tone}">${inr(m.balance)}</dd></div></dl>`;
}
