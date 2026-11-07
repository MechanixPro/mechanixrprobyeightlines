import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupeeText, moneyCell, moneyWhole, shareCompact, orderChips, chipView, chipsHtml, totalsRow, clip, tableHtml } from '../admin/money-table.js';

// The previous renderer (copied from admin.js before this change) is the reference for "no number changed".
const oldRupee2 = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
const strip = (h) => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');

const A = (o = {}) => ({ lead_id: 'l', number: 'MP-26-27-0106', issuedAt: '2026-10-05T05:00:00Z', customer: 'Asha', phone: '9000000001', mechanicName: 'Ravi', mechanicPct: 75, companyPct: 25, total: 1180, byChannel: { company_manual: 500, company_portal: 0, mechanic: 180.5 }, outstanding: 499.5, remitDue: 0, payoutDue: 135.25, statusLabels: ['Partially Paid', 'Mechanic Payout Due', 'Customer Due'], ...o });
const FIX = [A(), A({ lead_id: 'm', mechanicName: null, total: 0, byChannel: { company_manual: 0, company_portal: 0, mechanic: 0 }, outstanding: 0, payoutDue: 0, statusLabels: ['Fully Paid'] }), A({ lead_id: 'n', total: 99999.999, outstanding: 0.004, remitDue: 12345678.9 })];

test('rupeeText matches the old rupee2 except zero is a dash', () => {
  for (const n of [1, 1180, 499.5, 0.1 + 0.2, 99999.999, 12345678.9, 100000, 1e7]) assert.equal(rupeeText(n), oldRupee2(n));
  for (const n of [0, null, undefined, NaN, '', 'abc', 0.004, -0]) assert.equal(rupeeText(n), '–');
  assert.equal(rupeeText(-50.5), '−₹50.50');
  assert.equal(rupeeText(0, { zero: '' }), '');
});
test('moneyCell marks zero as muted dash and escapes nothing odd', () => {
  assert.match(moneyCell(0), /mt-zero/); assert.match(moneyCell(null), /mt-zero/);
  assert.equal(moneyCell(1234), '₹1,234');
});
test('shareCompact is 75 / 25 with a tooltip, and a dash with no mechanic or odd data', () => {
  assert.deepEqual(shareCompact(A()), { text: '75 / 25', title: 'Mechanic 75%, company 25%', pct: 75 });
  assert.equal(shareCompact(A({ mechanicName: null })).text, '–');
  assert.equal(shareCompact(A({ mechanicPct: null, companyPct: undefined })).text, '–');
  assert.equal(shareCompact(A({ mechanicPct: 'x' })).text, '–');
  assert.equal(shareCompact(null).text, '–'); assert.equal(shareCompact({}).text, '–');
  assert.equal(shareCompact(A({ mechanicPct: 140, companyPct: -40 })).pct, 100);
});
test('chips are ordered by urgency, customer due first, and at most two show', () => {
  assert.deepEqual(orderChips(['Partially Paid', 'Mechanic Payout Due', 'Customer Due']), ['Customer Due', 'Mechanic Payout Due', 'Partially Paid']);
  assert.deepEqual(orderChips(['Settled', 'Zzz', 'Fully Paid', 'Aaa']), ['Fully Paid', 'Settled', 'Zzz', 'Aaa']);
  assert.deepEqual(orderChips(null), []); assert.deepEqual(orderChips([null, '', undefined, 'Unpaid']), ['Unpaid']);
  const v = chipView(['Partially Paid', 'Mechanic Payout Due', 'Customer Due']);
  assert.deepEqual(v.shown, ['Customer Due']); assert.equal(v.more, 2); assert.equal(v.all.length, 3);
  assert.equal(chipView(['Unpaid', 'Customer Due']).more, 0);
  const h = chipsHtml(['Partially Paid', 'Mechanic Payout Due', 'Customer Due']);
  assert.ok(h.indexOf('Customer Due') < h.indexOf('+2')); assert.match(h, /title="Customer Due, Mechanic Payout Due, Partially Paid"/);
  assert.match(chipsHtml([]), /mt-zero/);
});
test('totals row sums the visible rows and survives nulls', () => {
  const t = totalsRow(FIX);
  assert.equal(t.count, 3);
  assert.equal(t.total, Math.round((1180 + 0 + 99999.999) * 100) / 100);
  assert.equal(t.mechanic, 361);
  assert.equal(t.remitDue, 12345678.9);
  const odd = totalsRow([null, {}, { total: null, byChannel: null }, { total: '12', byChannel: { mechanic: 'x' } }]);
  assert.equal(odd.total, 12); assert.equal(odd.mechanic, 0); assert.equal(odd.count, 4);
  assert.equal(totalsRow(null).total, 0); assert.equal(totalsRow([]).count, 0);
});
test('clip truncates long names and tolerates null', () => {
  assert.equal(clip(null), ''); assert.equal(clip('abc', 5), 'abc'); assert.equal(clip('abcdefghij', 5), 'abcd…');
});

// Same fixture through the old column list and the new table: every displayed value is identical (zero only turns into a dash).
const COLS = [
  { k: 'inv', label: 'Invoice', w: 120, kind: 'inv', cell: (a) => a.number },
  { k: 'total', label: 'Total', w: 96, kind: 'num', cell: (a) => moneyCell(a.total) },
  { k: 'company', label: 'Company', w: 96, kind: 'num', cell: (a) => moneyCell(a.byChannel.company_manual) },
  { k: 'online', label: 'Online', w: 96, kind: 'num', cell: (a) => moneyCell(a.byChannel.company_portal) },
  { k: 'mechanic', label: 'Mechanic', w: 96, kind: 'num', cell: (a) => moneyCell(a.byChannel.mechanic) },
  { k: 'outstanding', label: 'Customer owes', w: 96, kind: 'num', cell: (a) => moneyCell(a.outstanding) },
  { k: 'remitDue', label: 'Mechanic owes us', w: 96, kind: 'num', cell: (a) => moneyCell(a.remitDue) },
  { k: 'payoutDue', label: 'We owe mechanic', w: 96, kind: 'num', cell: (a) => moneyCell(a.payoutDue) },
];
test('snapshot: displayed values and totals equal the old renderer for a fixture set', () => {
  const OLD = (a) => [a.number, oldRupee2(a.total), oldRupee2(a.byChannel.company_manual), oldRupee2(a.byChannel.company_portal), oldRupee2(a.byChannel.mechanic), oldRupee2(a.outstanding), oldRupee2(a.remitDue), oldRupee2(a.payoutDue)];
  const t = totalsRow(FIX);
  const foot = { inv: `Total (${t.count})`, total: moneyCell(t.total), company: moneyCell(t.company), online: moneyCell(t.online), mechanic: moneyCell(t.mechanic), outstanding: moneyCell(t.outstanding), remitDue: moneyCell(t.remitDue), payoutDue: moneyCell(t.payoutDue) };
  const html = tableHtml({ cols: COLS, rows: FIX, foot, rowAttrs: (a) => `data-lead="${a.lead_id}"` });
  const trs = html.split('<tbody>')[1].split('</tbody>')[0].split('</tr>').filter((x) => x.includes('<td'));
  assert.equal(trs.length, FIX.length);
  trs.forEach((tr, i) => {
    const cells = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => strip(m[1]));
    assert.deepEqual(cells, OLD(FIX[i]).map((x) => (x === '₹0' ? '–' : x)));
  });
  const ft = [...html.split('<tfoot>')[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => strip(m[1]));
  const sum = (f) => oldRupee2(Math.round(FIX.reduce((s, a) => s + f(a), 0) * 100) / 100);
  assert.deepEqual(ft.slice(1), [sum((a) => a.total), sum((a) => a.byChannel.company_manual), sum((a) => a.byChannel.company_portal), sum((a) => a.byChannel.mechanic), sum((a) => a.outstanding), sum((a) => a.remitDue), sum((a) => a.payoutDue)].map((x) => (x === '₹0' ? '–' : x)));
});
test('tableHtml survives empty, null rows data and keeps sticky classes and a colgroup', () => {
  const h = tableHtml({ cols: COLS.map((c, i) => ({ ...c, sticky: i < 2 })), rows: [] });
  assert.match(h, /<colgroup>/); assert.match(h, /mt-sk mt-skl/); assert.match(h, /left:120px/);
  assert.doesNotThrow(() => tableHtml({ cols: COLS, rows: null }));
});
test('whole-rupee cells match the old rupee() and show a dash for zero', () => {
  const oldRupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  for (const n of [1, 499.5, 44.91, 99999.999, 12345678.9, 1e7]) assert.equal(moneyWhole(n), oldRupee(n));
  for (const n of [0, null, undefined, NaN, 'x', 0.4]) assert.match(moneyWhole(n), /mt-zero/);
});
test('row class can be a function and sticky offsets add up', () => {
  const h = tableHtml({ cols: COLS.map((c, i) => ({ ...c, sticky: i < 2 })), rows: FIX, rowCls: (a) => 'r-' + a.lead_id });
  assert.match(h, /class="r-l"/); assert.match(h, /class="r-m"/);
});
