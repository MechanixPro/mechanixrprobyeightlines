import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slotFee } from '../supabase/functions/_shared/checkout.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const site = JSON.parse(read('src/site.json'));

test('a new customer pays the Rs 99 slot fee, a returning customer pays the Rs 349 checkup and quote fee', () => {
  assert.equal(slotFee({ returning: false, advance: 349, newFee: 99 }), 99);
  assert.equal(slotFee({ returning: true, advance: 349, newFee: 99 }), 349);
});
test('if the new customer fee is missing or zero it falls back to the standard fee, never to free', () => {
  assert.equal(slotFee({ returning: false, advance: 349, newFee: 0 }), 349);
  assert.equal(slotFee({ returning: false, advance: 349, newFee: NaN }), 349);
});
test('the price source holds both fees', () => {
  assert.equal(site.advance, 349); assert.equal(site.newCustomerFee, 99);
});
test('a migration adds the new customer fee as a fee row', () => {
  const sql = read('supabase/migrations/20261030000000_new_customer_fee.sql');
  assert.match(sql, /'newfee'[\s\S]{0,80}'fee'[\s\S]{0,120}99/);
});
test('create-order, the WhatsApp bot and the admin payment box all use the new customer rule', () => {
  assert.match(read('supabase/functions/create-order/index.ts'), /isReturningCustomer/);
  assert.match(read('supabase/functions/whatsapp-webhook/index.ts'), /isReturningCustomer/);
  assert.match(read('admin/admin.js'), /newfee/);
});
test('a returning customer means an earlier completed job on the same phone, never the same booking', () => {
  const s = read('supabase/functions/_shared/customer.ts');
  assert.match(s, /\.eq\('phone'/); assert.match(s, /'completed'/); assert.match(s, /\.neq\('id'/);
});
test('the website tells customers the real fees', () => {
  const h = read('index.html'), app = read('assets/js/app.js');
  assert.match(h, /₹99/); assert.match(h, /new customers?/i);
  assert.match(app, /newfee/); assert.match(read('refund-policy/index.html'), /₹99/);
  assert.match(read('terms/index.html'), /₹99/);
});
