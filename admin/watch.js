// Service Watch: pure ordering, labels and card markup for the stuck-job list. Source in crm/, identical copy in admin/ (scripts/sync_shared.sh). Tests: tests/watch.test.mjs.
// The data comes from crm_service_watch(). Every function survives null and odd values. Money (amount) is dropped unless showMoney is true.
import { esc } from './ds.js';

export const RULE_TITLE = {
  not_accepted: 'Garage has not accepted', late_for_slot: 'Late for the slot', code_pending: 'Arrived, code not verified', quote_not_sent: 'Quote not sent',
  quote_waiting: 'Customer has not answered the quote', no_eta: 'Vehicle at garage, no estimated date', ready_not_requested: 'Ready, payment not requested',
  payment_pending: 'Payment still pending', delivered_no_proof: 'Delivered, proof missing',
};
export const ruleTitle = (r) => RULE_TITLE[r] || 'Needs attention';

export function fmtAge(m) {
  const n = m == null || m === "" ? NaN : Number(m);
  if (!Number.isFinite(n) || n < 0) return 'a while';
  if (n < 1) return 'under a minute';
  if (n < 90) return Math.round(n) + ' min';
  if (n < 2880) return Math.round(n / 60) + ' h';
  return Math.round(n / 1440) + ' days';
}

/** Red before amber, then the longest stuck first, then name. Rows without a lead or rule are dropped. Amount removed unless showMoney. */
export function watchList(raw, showMoney = false) {
  const rows = (Array.isArray(raw) ? raw : []).filter((x) => x && typeof x === 'object' && x.lead_id && x.rule)
    .map((x) => ({ ...x, severity: x.severity === 'red' ? 'red' : 'amber', minutes: Math.max(0, Number(x.minutes) || 0), title: ruleTitle(x.rule), amount: showMoney && x.amount != null ? Number(x.amount) : null }));
  return rows.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1) || b.minutes - a.minutes || String(a.name || '').localeCompare(String(b.name || '')));
}
export const redCount = (raw) => watchList(raw).filter((x) => x.severity === 'red').length;

const tel = (p) => 'tel:+91' + String(p).replace(/\D/g, '').slice(-10);
const wa = (p) => 'https://wa.me/91' + String(p).replace(/\D/g, '').slice(-10);
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/** One issue card. Buttons use data-w (call and wa are plain links). */
export function watchCard(i) {
  const who = i.rule === 'not_accepted' ? i.garage_name : i.mechanic_name || i.garage_name;
  const ext = (label, p) => (p ? `<a class="btn ghost" href="${esc(tel(p))}" data-w="call2">${esc(label)}</a>` : '');
  return `<article class="watch-card watch-${i.severity}" data-id="${esc(i.lead_id)}">
    <div class="watch-main"><span class="watch-tag">${i.severity === 'red' ? 'Urgent' : 'Watch'}</span> <b>${esc(i.title)}</b>
      <p>${esc(i.name || 'Customer')} <small class="muted">${esc(i.ref || '')}</small></p>
      <p class="small muted">${esc([i.area, i.vehicle_service].filter(Boolean).join(' · '))}</p>
      <p class="small"><b>Stuck ${esc(fmtAge(i.minutes))}</b>${who ? ' · ' + esc(who) : ''}${i.amount != null ? ' · <b>' + rupee(i.amount) + '</b>' : ''}</p></div>
    <div class="watch-act">
      ${i.phone ? `<a class="btn call watch-bigcall" href="${esc(tel(i.phone))}" data-w="call">Call customer</a>` : ''}
      ${ext(i.rule === 'not_accepted' || !i.technician_phone ? 'Call garage' : 'Call technician', i.rule === 'not_accepted' || !i.technician_phone ? i.garage_phone : i.technician_phone)}
      ${i.phone ? `<a class="btn wa" href="${esc(wa(i.phone))}" target="_blank" rel="noopener" data-w="wa">WhatsApp</a>` : ''}
      <button class="btn ghost" type="button" data-w="open" data-id="${esc(i.lead_id)}">Open booking</button>
      ${i.rule === 'not_accepted' ? `<button class="btn" type="button" data-w="reassign" data-id="${esc(i.lead_id)}">Reassign</button>` : ''}
    </div></article>`;
}
