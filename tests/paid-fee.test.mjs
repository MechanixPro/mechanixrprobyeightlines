import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmFee, clampFee, engineFromModel, engineFor, feeLine, gstSplit, FEE_MIN, FEE_MAX, FEE_DEFAULTS, UNKNOWN_FEE } from '../supabase/functions/_shared/confirm-fee.ts';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const book = createRequire(import.meta.url)('../assets/js/book-pay.js');

test('the fee follows the engine size: up to 149cc 49, 150 to 250cc 69, 251cc and above 99, cars 99', () => {
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Activa 125' }).amount, 49);
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Pulsar 220F' }).amount, 69);
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Duke 390' }).amount, 99);
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Splendor Plus', engine: 'std' }).amount, 49);
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Classic', engine: 'mid' }).amount, 69);
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Interceptor', engine: 'big' }).amount, 99);
  assert.equal(confirmFee({ vehicle: 'car', model: 'Hyundai i20' }).amount, 99);
});
test('a customer cannot lower the fee: a cc number in the model name beats a smaller picked size', () => {
  assert.equal(engineFor('Duke 390', 'std').engine, 'big');
  const r = confirmFee({ vehicle: 'bike', model: 'Duke 390', engine: 'std' });
  assert.equal(r.amount, 99); assert.equal(r.review, true);   // and Crew is asked to look
  assert.equal(engineFor('Pulsar 150', 'big').engine, 'big');  // a larger pick can only raise it
});
test('if the engine size cannot be worked out the fee is 69 and the lead is flagged for Crew', () => {
  for (const o of [{ vehicle: 'bike', model: 'Activa 6G' }, { vehicle: 'bike', model: '' }, { vehicle: 'bike', model: 'Zoom', engine: 'nonsense' }, { vehicle: 'bike' }]) {
    const r = confirmFee(o); assert.equal(r.amount, UNKNOWN_FEE); assert.equal(r.amount, 69); assert.equal(r.review, true);
  }
});
test('no value outside 49 to 99 can ever be charged, whatever the price rows or inputs say', () => {
  assert.equal(FEE_MIN, 49); assert.equal(FEE_MAX, 99);
  for (const bad of [0, -5, 1, 48, 100, 349, 1e9, NaN, null, undefined, 'abc', Infinity]) { const v = clampFee(bad); assert.ok(v >= 49 && v <= 99, String(bad) + ' -> ' + v); }
  for (const price of [1, 30, 500, 349, 'x', null]) {
    for (const o of [{ vehicle: 'car' }, { vehicle: 'bike', model: 'Activa 125' }, { vehicle: 'bike', model: 'Duke 390' }, { vehicle: 'bike' }]) {
      const rows = Object.keys(FEE_DEFAULTS).map((id) => ({ id, price }));
      const a = confirmFee({ ...o, rows }).amount; assert.ok(a >= 49 && a <= 99, JSON.stringify(o) + ' price ' + price + ' -> ' + a);
    }
  }
  assert.equal(confirmFee({ vehicle: 'bike', model: 'Activa 125', rows: [{ id: 'confirm_std', price: 59 }] }).amount, 59);   // the Prices tab can move a fee inside the range
});
test('the same fee rule runs in the browser preview and on the server', () => {
  const grid = [['Activa 125', 'std'], ['Activa 125', 'big'], ['Pulsar 220F', 'std'], ['Duke 390', 'mid'], ['Unknown model', 'mid'], ['Unknown model', ''], ['', ''], ['Interceptor 650', 'std']];
  for (const [model, engine] of grid) assert.equal(book.feeFor({ vehicle: 'bike', model, engine }).amount, confirmFee({ vehicle: 'bike', model, engine }).amount, model + '/' + engine);
  assert.equal(book.feeFor({ vehicle: 'car' }).amount, confirmFee({ vehicle: 'car' }).amount);
  assert.equal(book.feeFor({ vehicle: 'bike', model: 'x', engine: '' }).unknown, true);
  assert.equal(book.engineFromModel('CB300F'), engineFromModel('CB300F'));
});
test('the line shown before paying says the exact amount and that it is adjusted', () => {
  assert.equal(feeLine('bike', 69), 'Confirmation fee for your bike size: ₹69. Adjusted in your final bill.');
  assert.match(feeLine('car', 99), /for your car: ₹99\. Adjusted in your final bill\./);
  assert.equal(book.feeLine('bike', 69), feeLine('bike', 69));
});
test('GST is carved out of the amount: it includes 18%', () => {
  assert.deepEqual(gstSplit(49), { base: 41.53, gst: 7.47, total: 49 });
  assert.deepEqual(gstSplit(99), { base: 83.9, gst: 15.1, total: 99 });
  assert.equal(gstSplit(69).base + gstSplit(69).gst, 69);
});
test('the fee rows live in the services table and the database refuses any outside 49 to 99', () => {
  const sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  for (const id of ['confirm_std', 'confirm_mid', 'confirm_big', 'confirm_car']) assert.match(sql, new RegExp(`\\('${id}', 'fee'`));
  assert.match(sql, /check \(id !~ '\^confirm_' or price between 49 and 99\)/);
  assert.match(sql, /confirm_fee\s+integer check \(confirm_fee between 49 and 99\)/);
  assert.match(sql, /on conflict \(id\) do nothing;\s+-- never overwrite a price the owner has edited/);
});
test('every path that charges uses the one fee function, never an amount from the browser', () => {
  const bs = read('supabase/functions/book-start/index.ts'), cl = read('supabase/functions/_shared/confirm-link.ts'), dp = read('supabase/functions/desk-payment-link/index.ts'), pl = read('supabase/functions/payment-link/index.ts');
  assert.match(bs, /confirmFee\(\{ vehicle: b\.vehicle/); assert.doesNotMatch(bs, /raw\.(fee|amount)|b\.(fee|amount)\b/);
  assert.match(cl, /confirmFee\(/); assert.match(dp, /purpose === 'confirm'[\s\S]*prepareConfirmationLink/); assert.match(pl, /purpose === 'confirm'[\s\S]*prepareConfirmationLink/);
  assert.doesNotMatch(dp.slice(dp.indexOf("purpose === 'confirm'"), dp.indexOf('paymentsReady()')), /b\.amount/);   // the desk cannot type an amount on this path
  const order = read('supabase/functions/create-order/index.ts'); assert.match(order, /confirm_fee && lead\.rzp_order_id/);
  const form = read('assets/js/book-pay.js'); assert.doesNotMatch(book.payload({ vehicle: 'bike', model: 'x' }, 'k'.repeat(16)).toString?.() ?? '', /fee/); assert.equal('fee' in book.payload({ vehicle: 'bike', model: 'x' }, 'k'.repeat(16)), false); assert.ok(form.includes('The fee is not in it'));
});
