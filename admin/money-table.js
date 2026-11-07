// admin/money-table.js: one table component for the Money screens (no DOM, no Supabase).
// Formatting only. It never recalculates a figure: the only new arithmetic is the visible-rows totals line (plain sums).
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Rupee text. Same rounding and grouping as the old rupee2; zero, null, NaN and junk become an en dash.
export function rupeeText(n, { zero = '–', whole = false } = {}) {
  const v = whole ? Math.round(Number(n) || 0) : r2(n);
  if (!v) return zero;
  const neg = v < 0, a = Math.abs(v);
  return (neg ? '−' : '') + '₹' + a.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(a) ? 0 : 2, maximumFractionDigits: 2 });
}
export const moneyCell = (n) => (r2(n) ? esc(rupeeText(n)) : '<span class="mt-zero" aria-label="nil">–</span>');
// Same, rounded to whole rupees (the Invoices register and Reports have always shown whole rupees).
export const moneyWhole = (n) => (Math.round(Number(n) || 0) ? esc(rupeeText(n, { whole: true })) : '<span class="mt-zero" aria-label="nil">–</span>');

// '75 / 25' (mechanic / company). Nothing when there is no mechanic or the percentages are missing.
export function shareCompact(a) {
  if (!a || !a.mechanicName) return { text: '–', title: 'No mechanic on this job', pct: null };
  const m = Number(a.mechanicPct), c = Number(a.companyPct);
  if (!Number.isFinite(m) || !Number.isFinite(c)) return { text: '–', title: 'Split not set', pct: null };
  return { text: `${m} / ${c}`, title: `Mechanic ${m}%, company ${c}%`, pct: Math.max(0, Math.min(100, m)) };
}

// Most urgent first. Unknown labels go after the known ones, in their given order.
export const STATUS_ORDER = ['Customer Due', 'Overdue', 'Mechanic Remittance Due', 'Mechanic Payout Due', 'Partially Paid', 'Unpaid', 'Fully Paid', 'Settled'];
export function orderChips(labels) {
  const list = (Array.isArray(labels) ? labels : []).filter((x) => x != null && x !== '').map(String);
  const rank = (x) => { const i = STATUS_ORDER.indexOf(x); return i < 0 ? STATUS_ORDER.length : i; };
  return list.map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
}
// At most `max` chips on the row; the rest are folded into one "+N" chip (full list in its title).
export function chipView(labels, max = 2) {
  const all = orderChips(labels);
  if (all.length <= max) return { shown: all, more: 0, all };
  return { shown: all.slice(0, max - 1), more: all.length - (max - 1), all };
}
const CHIP_CLS = (t) => (['Fully Paid', 'Settled'].includes(t) ? 'paid' : ['Customer Due', 'Overdue', 'Mechanic Remittance Due'].includes(t) ? 'lost' : '');
export function chipsHtml(labels, max = 2) {
  const v = chipView(labels, max);
  if (!v.all.length) return '<span class="mt-zero">–</span>';
  return `<span class="mt-chips">${v.shown.map((t) => `<span class="pill ${CHIP_CLS(t)}">${esc(t)}</span>`).join('')}${v.more ? `<span class="pill" title="${esc(v.all.join(', '))}">+${v.more}</span>` : ''}</span>`;
}

// Sums of the rows shown (nulls count as 0).
export const SALES_SUM = [['total', (a) => a.total], ['company', (a) => a.byChannel && a.byChannel.company_manual], ['online', (a) => a.byChannel && a.byChannel.company_portal], ['mechanic', (a) => a.byChannel && a.byChannel.mechanic], ['outstanding', (a) => a.outstanding], ['remitDue', (a) => a.remitDue], ['payoutDue', (a) => a.payoutDue]];
export function totalsRow(rows, defs = SALES_SUM) {
  const list = Array.isArray(rows) ? rows : [];
  const out = { count: list.length };
  for (const [k, f] of defs) out[k] = r2(list.reduce((t, a) => t + (Number(a && f(a)) || 0), 0));
  return out;
}

export const clip = (s, n = 28) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }); };
export const dateText = day;

// Generic table. cols: [{ k, label, w (px), kind: 'text'|'num'|'inv'|'chips', sticky, cell(row) -> html, foot, card: 'head'|'detail' }]
// Sticky columns stay put on horizontal scroll (left offset = widths of the sticky columns before them).
// rowAttrs(row) -> attribute string for the <tr> and the phone card. rowCls: string or (row) -> string.
export function tableHtml({ cols, rows, cls = '', rowAttrs = () => '', rowCls = 'fin-tr', foot = null, label = '', cardHead }) {
  const list = Array.isArray(rows) ? rows : [];
  const total = cols.reduce((t, c) => t + (c.w || 100), 0);
  let left = 0; const lastSticky = cols.map((c) => !!c.sticky).lastIndexOf(true);
  const pos = cols.map((c, i) => { const o = c.sticky ? { cls: ` mt-sk${i === lastSticky ? ' mt-skl' : ''}`, st: ` style="left:${left}px"` } : { cls: '', st: '' }; if (c.sticky) left += c.w || 100; return o; });
  const rc = (r) => (typeof rowCls === 'function' ? rowCls(r) : rowCls);
  const colgroup = `<colgroup>${cols.map((c) => `<col style="width:${c.w || 100}px">`).join('')}</colgroup>`;
  const head = `<thead><tr>${cols.map((c, i) => `<th class="mc-${c.kind || 'text'}${pos[i].cls}"${pos[i].st} scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const body = list.map((r) => `<tr class="${rc(r)}" ${rowAttrs(r)} tabindex="0">${cols.map((c, i) => `<td class="mc-${c.kind || 'text'}${pos[i].cls}"${pos[i].st} data-label="${esc(c.label)}">${c.cell(r)}</td>`).join('')}</tr>`).join('');
  const tfoot = foot ? `<tfoot><tr class="mt-foot">${cols.map((c, i) => `<td class="mc-${c.kind || 'text'}${pos[i].cls}"${pos[i].st}>${foot[c.k] ?? ''}</td>`).join('')}</tr></tfoot>` : '';
  const cards = cardHead ? `<div class="mt-cards" aria-label="${esc(label)}">${list.map((r) => `<div class="mt-card"><div class="mt-tap ${rc(r)}" ${rowAttrs(r)} tabindex="0">${cardHead(r)}</div><details><summary>Details</summary><dl class="mt-dl">${cols.filter((c) => c.card === 'detail').map((c) => `<dt>${esc(c.label)}</dt><dd>${c.cell(r)}</dd>`).join('')}</dl></details></div>`).join('')}</div>` : '';
  return `<div class="mt-wrap ${cardHead ? 'mt-has-cards ' : ''}${cls}"><div class="mt-scroll"><table class="mt-table" style="--tw:${total}px">${colgroup}${head}<tbody>${body}</tbody>${tfoot}</table></div>${cards}</div>`;
}
