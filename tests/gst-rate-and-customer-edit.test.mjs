import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvoice } from '../admin/invoice.js';
import { buildInvoice as buildInvoiceFn } from '../supabase/functions/_shared/invoice.ts';
import { invoiceEmail } from '../supabase/functions/_shared/email-templates.ts';
import { cleanCustomerEdit, cleanBikeEdit, customerRows } from '../admin/people.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const services = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];
const base = { ref: 'MP-AB12CD', name: 'Asha', phone: '9876543210', service_id: 'general', addons: [], paid_amount: 0 };
const ov = (rate, basis = 'excl') => ({ ...base, invoice_override: { basis, rate, lines: [{ name: 'Labour', amount: 1000 }] } });

test('the GST rate is chosen per invoice and added on top of the amounts', () => {
  for (const [rate, gst, total] of [[0, 0, 1000], [5, 50, 1050], [12, 120, 1120], [18, 180, 1180]]) {
    const v = buildInvoice(ov(rate), services);
    assert.equal(v.gstRate, rate, 'rate ' + rate); assert.equal(v.taxable, 1000); assert.equal(+(v.cgst + v.sgst).toFixed(2), gst); assert.equal(v.total, total);
  }
});
test('when amounts include GST, the chosen rate is carved out of them', () => {
  const v = buildInvoice(ov(5, 'incl'), services);
  assert.equal(v.total, 1000); assert.equal(v.taxable, 952.38); assert.equal(+(v.cgst + v.sgst).toFixed(2), 47.62);
});
test('an unknown or missing rate falls back to 18%, never to a made-up rate', () => {
  assert.equal(buildInvoice(ov(7), services).gstRate, 18);
  assert.equal(buildInvoice(ov(undefined), services).gstRate, 18);
  assert.equal(buildInvoice(base, services).gstRate, 18);
});
test('the invoice email function gives the same numbers as the admin for every rate', () => {
  for (const rate of [0, 5, 12, 18]) for (const basis of ['excl', 'incl']) {
    const a = buildInvoice(ov(rate, basis), services), b = buildInvoiceFn(ov(rate, basis), services);
    for (const k of ['taxable', 'cgst', 'sgst', 'total', 'gstRate']) assert.equal(a[k], b[k], `${k} ${rate} ${basis}`);
  }
});
test("the invoice carries the customer's company name and GSTIN when given", () => {
  const c = { company_name: 'Rao Traders', gstin: '29ABCDE1234F1Z5', address: '12 MG Road' };
  for (const f of [buildInvoice, buildInvoiceFn]) {
    const v = f(base, services, { customer: c });
    assert.equal(v.customer.company, 'Rao Traders'); assert.equal(v.customer.gstin, '29ABCDE1234F1Z5'); assert.equal(v.customer.address, '12 MG Road');
  }
});
test('the invoice email shows the real GST rate, and no tax lines at 0%', () => {
  const site = { siteUrl: 'https://mechanixpro.in', phoneDisplay: 'x', phoneTel: '+91', whatsappUrl: 'https://wa.me/91', email: 'a@b.in' };
  const co = { legalName: 'NOVA VENTURES', addressLines: [], city: 'Bengaluru', state: 'Karnataka', pincode: '560102', gstin: '29DVCPR0895G1Z3' };
  const m5 = invoiceEmail({ ...site, invoice: buildInvoiceFn(ov(5), services), company: co });
  assert.match(m5.html, /CGST @ 2\.5%/); assert.match(m5.html, /added at 5%/);
  const m0 = invoiceEmail({ ...site, invoice: buildInvoiceFn(ov(0), services), company: co });
  assert.doesNotMatch(m0.html, /CGST/); assert.match(m0.html, /No GST/i);
});

test('customer edits are checked: name, phone, email, address, company and GSTIN', () => {
  const ok = cleanCustomerEdit({ name: ' Asha Rao ', phone: '+91 98765 43210', email: 'Asha@Example.com', address: '12 MG Road', area: 'HSR Layout', company_name: 'Rao Traders', gstin: '29abcde1234f1z5' });
  assert.deepEqual(ok, { ok: true, value: { name: 'Asha Rao', phone: '9876543210', email: 'asha@example.com', address: '12 MG Road', area: 'HSR Layout', company_name: 'Rao Traders', gstin: '29ABCDE1234F1Z5' } });
  assert.equal(cleanCustomerEdit({ name: '', phone: '9876543210' }).ok, false);
  assert.equal(cleanCustomerEdit({ name: 'Asha', phone: '12345' }).ok, false);
  assert.equal(cleanCustomerEdit({ name: 'Asha', phone: '9876543210', email: 'nope' }).ok, false);
  assert.equal(cleanCustomerEdit({ name: 'Asha', phone: '9876543210', gstin: 'BADGSTIN' }).ok, false);
  const blank = cleanCustomerEdit({ name: 'Asha', phone: '9876543210' });
  assert.equal(blank.ok, true); assert.equal(blank.value.email, null); assert.equal(blank.value.gstin, null);
});
test('bike edits are checked and the registration number is tidied', () => {
  assert.deepEqual(cleanBikeEdit({ brand: ' Honda ', model: 'Activa 6G', reg_no: 'ka 01 ab 1234' }), { ok: true, value: { brand: 'Honda', model: 'Activa 6G', reg_no: 'KA01AB1234' } });
  assert.equal(cleanBikeEdit({ brand: '', model: '' }).ok, false);
});
test('the customers list carries the new details', () => {
  const [r] = customerRows([{ id: 'c1', name: 'A', phone: '9', address: 'x', area: 'y', company_name: 'z', gstin: 'g', email: 'e' }], [], []);
  assert.equal(r.address, 'x'); assert.equal(r.company, 'z'); assert.equal(r.gstin, 'g'); assert.equal(r.email, 'e');
});
test('the admin customer screen has an edit form that also updates the customer\'s bookings', () => {
  const a = read('admin/admin.js');
  assert.match(a, /data-act="saveCustomerDetails"/); assert.match(a, /cleanCustomerEdit/); assert.match(a, /from\('leads'\)\.update\(\{ name/);
  assert.match(a, /data-act="saveBike"/);
});
test('a migration adds the customer detail columns', () => {
  const sql = read('supabase/migrations/20261031000000_customer_details.sql');
  for (const c of ['address', 'area', 'company_name', 'gstin']) assert.match(sql, new RegExp(c));
});
test('the admin invoice editor offers the GST rates 0, 5, 12 and 18', () => {
  const a = read('admin/admin.js');
  assert.match(a, /id="ie-rate"/); for (const r of ['0', '5', '12', '18']) assert.match(a, new RegExp(`value="${r}"`));
});
