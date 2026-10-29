import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitJob } from '../admin/split.js';
import { buildInvoice } from '../admin/invoice.js';
import { mechanicCut, snapshotRow, sameFigures, filterRegister, registerTotals, byMechanic, gstSummary, registerCsv } from '../admin/invoice-register.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const services = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];
const base = { id: 'L1', ref: 'MP-AB12CD', name: 'Asha Rao', phone: '9876543210', service_id: 'general', addons: [], paid_amount: 0, mechanic_id: 'M1', customer_id: 'C1' };
const withRate = (rate, basis = 'excl', paid = 0) => ({ ...base, paid_amount: paid, invoice_override: { basis, rate, lines: [{ name: 'Labour and parts', amount: 1000 }] } });
const mech = { id: 'M1', name: 'Ravi', payout_rate: 40 };

test('splitJob still works as before for 18%, and now takes the real GST rate of the invoice', () => {
  assert.deepEqual(splitJob(1180, 40, 'before_gst'), { base: 1000, gst: 180, mechanic: 400, company: 600, mechanicRate: 40, companyRate: 60 });
  assert.equal(splitJob(1050, 40, 'before_gst', 5).base, 1000);
  assert.equal(splitJob(1000, 40, 'before_gst', 0).base, 1000);
  assert.equal(splitJob(1180, 40, 'collected').base, 1180);
});
test('the mechanic cut with GST: when GST goes to the government, the cut is worked out on the amount before GST', () => {
  const v = buildInvoice(withRate(18), services); // taxable 1000, GST 180, total 1180
  const c = mechanicCut(v, 40, 'before_gst');
  assert.equal(c.base, 1000); assert.equal(c.cut, 400); assert.equal(c.company, 600); assert.equal(c.gst, 180); assert.equal(c.basis, 'before_gst');
});
test('the mechanic cut without GST: the same percentage is worked out on the whole amount, so the rupees differ', () => {
  const v = buildInvoice(withRate(0), services); // total 1000, no GST
  const c = mechanicCut(v, 40, 'before_gst');
  assert.equal(c.base, 1000); assert.equal(c.cut, 400); assert.equal(c.gst, 0);
  const g = mechanicCut(buildInvoice(withRate(18), services), 40, 'collected');
  assert.equal(g.base, 1180); assert.equal(g.cut, 472); assert.equal(g.company, 708);
});
test('GST rates 5 and 12 are respected in the cut', () => {
  assert.equal(mechanicCut(buildInvoice(withRate(5), services), 50, 'before_gst').base, 1000);
  assert.equal(mechanicCut(buildInvoice(withRate(12), services), 50, 'before_gst').gst, 120);
});
test('the cut that is payable now follows what the customer has paid so far', () => {
  const v = buildInvoice(withRate(18, 'excl', 590), services); // total 1180, paid 590 = half
  const c = mechanicCut(v, 40, 'before_gst');
  assert.equal(c.cut, 400); assert.equal(c.payableNow, 200); assert.equal(c.owed, 200);
  const full = mechanicCut(buildInvoice(withRate(18, 'excl', 1180), services), 40, 'before_gst'); assert.equal(full.payableNow, 400); assert.equal(full.owed, 0);
  assert.equal(mechanicCut(buildInvoice(withRate(18, 'excl', 5000), services), 40, 'before_gst').payableNow, 400); // overpaid never raises the cut
});
test('no mechanic means no cut, and a rate outside 0 to 100 is held to that range', () => {
  const v = buildInvoice(withRate(18), services);
  assert.equal(mechanicCut(v, null, 'before_gst').cut, 0); assert.equal(mechanicCut(v, 250, 'before_gst').cut, 1000); assert.equal(mechanicCut(v, -5, 'before_gst').cut, 0);
});
test('a saved copy records the figures, the GST label, the mechanic and the cut at that moment', () => {
  const inv = buildInvoice(withRate(18, 'excl', 590), services, { customer: { company_name: 'Rao Traders', gstin: '29ABCDE1234F1Z5' } });
  const row = snapshotRow({ invoice: inv, lead: withRate(18, 'excl', 590), customer: { id: 'C1', company_name: 'Rao Traders', gstin: '29ABCDE1234F1Z5' }, mechanic: mech, via: 'email', basis: 'before_gst', revision: 1, now: '2026-10-12T05:00:00.000Z' });
  assert.equal(row.number, 'INV-MP-AB12CD'); assert.equal(row.has_gst, true); assert.equal(row.gst_rate, 18); assert.equal(row.total, 1180); assert.equal(row.taxable, 1000);
  assert.equal(row.mechanic_name, 'Ravi'); assert.equal(row.mechanic_rate, 40); assert.equal(row.mechanic_cut, 400); assert.equal(row.company_share, 600); assert.equal(row.payable_now, 200);
  assert.equal(row.customer_company, 'Rao Traders'); assert.equal(row.customer_gstin, '29ABCDE1234F1Z5'); assert.equal(row.via, 'email'); assert.equal(row.revision, 1);
  const r2 = snapshotRow({ invoice: inv, lead: base, customer: null, mechanic: mech, via: 'print', basis: 'before_gst', revision: 2, now: '2026-10-12T05:00:00.000Z' });
  assert.equal(r2.number, 'INV-MP-AB12CD-R2');
  const none = snapshotRow({ invoice: buildInvoice(withRate(0), services), lead: withRate(0), customer: null, mechanic: null, via: 'print', basis: 'before_gst', revision: 1, now: '2026-10-12T05:00:00.000Z' });
  assert.equal(none.has_gst, false); assert.equal(none.gst_rate, 0); assert.equal(none.mechanic_cut, 0); assert.equal(none.mechanic_name, null);
});
test('printing again with the same figures does not save a duplicate; a change does', () => {
  const inv = buildInvoice(withRate(18), services), a = snapshotRow({ invoice: inv, lead: base, customer: null, mechanic: mech, via: 'print', basis: 'before_gst', revision: 1, now: 'x' });
  const b = snapshotRow({ invoice: inv, lead: base, customer: null, mechanic: mech, via: 'email', basis: 'before_gst', revision: 2, now: 'y' });
  assert.equal(sameFigures(a, b), true);
  const c = snapshotRow({ invoice: buildInvoice(withRate(0), services), lead: base, customer: null, mechanic: mech, via: 'print', basis: 'before_gst', revision: 2, now: 'z' });
  assert.equal(sameFigures(a, c), false);
});

const rows = (() => {
  const mk = (ref, rate, mechRow, paid, issued) => snapshotRow({ invoice: buildInvoice({ ...withRate(rate, 'excl', paid), ref }, services), lead: { ...withRate(rate, 'excl', paid), ref }, customer: null, mechanic: mechRow, via: 'email', basis: 'before_gst', revision: 1, now: issued });
  return [mk('MP-A1', 18, { id: 'M1', name: 'Ravi', payout_rate: 40 }, 1180, '2026-10-02T05:00:00.000Z'), mk('MP-A2', 0, { id: 'M1', name: 'Ravi', payout_rate: 40 }, 1000, '2026-10-05T05:00:00.000Z'),
    mk('MP-A3', 5, { id: 'M2', name: 'Meena', payout_rate: 50 }, 0, '2026-10-09T05:00:00.000Z'), mk('MP-A4', 18, null, 0, '2026-09-20T05:00:00.000Z')];
})();

test('filters: with or without GST, the rate, the mechanic, the dates and a search', () => {
  assert.equal(filterRegister(rows, { gst: 'with' }).length, 3); assert.equal(filterRegister(rows, { gst: 'without' }).length, 1);
  assert.equal(filterRegister(rows, { rate: '5' }).length, 1); assert.equal(filterRegister(rows, { mechanic: 'M1' }).length, 2); assert.equal(filterRegister(rows, { mechanic: 'none' }).length, 1);
  assert.equal(filterRegister(rows, { from: '2026-10-01', to: '2026-10-31' }).length, 3); assert.equal(filterRegister(rows, { q: 'a3' }).length, 1);
});
test('totals add up what is on screen, per mechanic and per GST rate', () => {
  const t = registerTotals(rows); assert.equal(t.count, 4); assert.equal(t.total, 1180 + 1000 + 1050 + 1180); assert.equal(t.gst, 180 + 0 + 50 + 180);
  const m = byMechanic(rows), ravi = m.find((r) => r.name === 'Ravi');
  assert.equal(ravi.count, 2); assert.equal(ravi.withGst.count, 1); assert.equal(ravi.withoutGst.count, 1);
  assert.equal(ravi.withGst.cut, 400); assert.equal(ravi.withoutGst.cut, 400); assert.equal(ravi.cut, 800); assert.equal(ravi.withGst.gst, 180);
  const g = gstSummary(rows); assert.equal(g.find((r) => r.rate === 18).count, 2); assert.equal(g.find((r) => r.rate === 0).taxable, 1000); assert.equal(g.find((r) => r.rate === 5).cgst, 25);
  assert.ok(m.some((r) => r.name === 'No mechanic'));
});
test('the CSV for the accountant has one line per invoice with GST, cut and company share, and quotes awkward text safely', () => {
  const csv = registerCsv(rows.map((r) => ({ ...r, customer_name: 'A, "B"' })));
  const lines = csv.split('\n'); assert.equal(lines.length, 5);
  for (const h of ['Invoice', 'GST', 'GST rate', 'Taxable', 'CGST', 'SGST', 'Total', 'Mechanic', 'Mechanic %', 'Mechanic cut', 'Company share']) assert.ok(lines[0].includes(h), h);
  assert.ok(lines[1].includes('"A, ""B"""')); assert.ok(lines.some((l) => l.includes('No GST')));
  assert.doesNotMatch(registerCsv([{ ...rows[0], customer_name: '=cmd|x' }]), /,=cmd/); // spreadsheet formulas are neutralised
});
test('the database has an invoices table that admins can read and add to but nobody can change or delete', () => {
  const sql = read('supabase/migrations/20261101000000_invoices.sql');
  for (const c of ['number', 'revision', 'has_gst', 'gst_rate', 'taxable', 'cgst', 'sgst', 'total', 'mechanic_rate', 'mechanic_cut', 'company_share', 'payable_now', 'payout_basis']) assert.match(sql, new RegExp(c), c);
  assert.match(sql, /enable row level security/i); assert.match(sql, /for select[\s\S]{0,80}is_admin/i); assert.match(sql, /for insert[\s\S]{0,80}is_admin/i);
  assert.doesNotMatch(sql, /for (update|delete|all)/i);
});
test('the admin has an Invoices tab, saves a copy when printing or emailing, and shows the mechanic cut on the invoice screen', () => {
  const a = read('admin/admin.js'), h = read('admin/index.html');
  assert.match(h, /data-tab="invoices"/); assert.match(a, /invoices,/); assert.match(a, /from\('invoices'\)\.insert/); assert.match(a, /Mechanic cut/);
  assert.match(a, /data-act="invRegisterCsv"/); assert.match(a, /data-act="backfillInvoices"/);
});

import { docKey, latestDocs, nextDocKey, combineDocs } from '../admin/invoice-register.js';
test('a booking can hold a main invoice and separate extra-work invoices that add up for sales', () => {
  const rows = [{ id: 1, revision: 1 }, { id: 2, revision: 2 }, { id: 3, revision: 1, doc_key: 'B' }];
  assert.equal(docKey(rows[0]), 'A'); assert.deepEqual(latestDocs(rows).map((r) => r.id), [2, 3]); assert.equal(nextDocKey(rows), 'C'); assert.equal(nextDocKey([{}]), 'B');
  const main = { taxable: 1000, cgst: 90, sgst: 90, discount: 0, total: 1180, has_gst: true, lines: [{ name: 'Service', amount: 1000 }] };
  const extra = { taxable: 500, cgst: 45, sgst: 45, discount: 0, total: 590, has_gst: true, lines: [{ name: 'Brake pads', amount: 500 }], doc_key: 'B' };
  const c = combineDocs(main, [extra]); assert.equal(c.total, 1770); assert.equal(c.taxable, 1500); assert.equal(c.cgst + c.sgst, 270); assert.equal(c.lines.length, 2); assert.equal(c.docs, 2);
  assert.equal(combineDocs(main, []), main);
});
