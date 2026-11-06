import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../assets/js/book-pay.js');
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const site = JSON.parse(read('src/site.json')).services;
const prices = Object.fromEntries(Object.keys(site).map((k) => [k, site[k].price]));

test('summary: tier, price and fee for each engine size, from the site price data', () => {
  const mk = (engine, svc, model = 'Activa') => B.summary({ vehicle: 'bike', brand: 'Honda', model, engine_class: engine, service_id: svc }, prices, {});
  let s = mk('std', 'general'); assert.equal(s.engine, 'Up to 149cc'); assert.equal(s.priceNum, site.general.price); assert.equal(s.fee, 49); assert.equal(s.vehicle, 'Honda Activa');
  s = mk('mid', 'general'); assert.equal(s.engine, '150 to 250cc'); assert.equal(s.priceNum, site.general250.price); assert.equal(s.fee, 69);
  s = mk('big', 'full'); assert.equal(s.engine, '251cc and above'); assert.equal(s.priceNum, site.full500.price); assert.equal(s.fee, 99);
  assert.match(s.feeLine, /^Pay ₹99 now to lock your slot\. It is adjusted in your final bill\.$/);
  assert.equal(mk('std', 'basic').feeLine, 'Pay ₹49 now to lock your slot. It is adjusted in your final bill.');
  assert.equal(mk('mid', 'repair').priceNum, site.repair.price);
});
test('summary: a cc number in the model wins, like the fee rule; unknown size says so and shows "From"', () => {
  const s = B.summary({ vehicle: 'bike', brand: 'Bajaj', model: 'Pulsar 220F', engine_class: 'std', service_id: 'basic' }, prices, {});
  assert.equal(s.engine, '150 to 250cc'); assert.equal(s.priceNum, site.basic250.price); assert.equal(s.fee, 69);
  const u = B.summary({ vehicle: 'bike', brand: '', model: 'Mystery', engine_class: '', service_id: 'basic' }, prices, {});
  assert.equal(u.unknown, true); assert.match(u.priceText, /^From ₹/); assert.match(u.feeLine, /not clear/);
});
test('summary: cars pay the car fee and get no invented price', () => {
  const s = B.summary({ vehicle: 'car', car_model: 'Hyundai i20', car_need: 'service' }, prices, {});
  assert.equal(s.fee, 99); assert.equal(s.priceNum, null); assert.match(s.priceText, /Quoted before any work/); assert.equal(s.vehicle, 'Hyundai i20'); assert.equal(s.engine, ''); assert.ok(s.ready);
});
test('summary: live fee rows are honoured, GST wording matches the site, nothing is ready until chosen', () => {
  assert.equal(B.summary({ vehicle: 'car', car_model: 'Swift' }, prices, { confirm_car: 89 }).fee, 89);
  const s = B.summary({ vehicle: 'bike', model: 'Activa', engine_class: 'std', service_id: 'basic' }, prices, {});
  assert.equal(s.gstNote, 'Excluding GST. GST at 18% is added on your final invoice.');
  assert.match(read('src/services.html'), /GST at 18% is added on your final invoice/);
  assert.equal(B.summary({ vehicle: 'bike' }, prices, {}).ready, false);
  assert.equal(B.summary({ vehicle: 'bike', model: 'Activa', engine_class: 'std', service_id: 'basic' }, {}, {}).priceNum, null, 'no price row means no number, never a made-up one');
});
test('choices kept for navigate-away-and-back hold no personal details', () => {
  const o = B.choicesForStorage({ vehicle: 'bike', brand: 'Honda', model: 'Activa', engine_class: 'std', service_id: 'basic', name: 'A Name', phone: '9876543210', email: 'a@b.co', house: 'Flat 1', street: 'Main', area: 'HSR', pincode: '560102', lat: '12.9', lng: '77.6', preferred_slot: 'morning' }, 2);
  for (const k of ['name', 'phone', 'email', 'house', 'street', 'area', 'pincode', 'lat', 'lng']) assert.ok(!(k in o), k);
  assert.equal(o.model, 'Activa'); assert.equal(o.step, 2);
  const js = read('assets/js/book-pay.js');
  assert.equal((js.match(/sessionStorage\.setItem/g) || []).length, 1); assert.match(js, /sess\.set\(choicesForStorage\(values\(\), step\)\)/);
  assert.ok(/try \{ win\.sessionStorage\.setItem/.test(js));
});
test('markup: progress, summary, built moment, price list; no inline script', () => {
  const h = read('src/book-pay.html');
  for (const m of ['id="bk-prog"', 'Step 1 of 3', 'Takes about a minute', 'id="bk-sum"', 'id="bk-sum-live"', 'aria-live="polite"', 'You built this', 'data-next="1">Change my choices', 'id="bk-prices"']) assert.ok(h.includes(m), m);
  assert.ok(!/<script/i.test(h) && !/ on\w+=/.test(h));
  assert.ok(h.includes('type="email"') && !/id="bk-email"[^>]*optional/i.test(h), 'email stays required');
  assert.ok(h.indexOf('class="bk-steps"') < h.indexOf('<form id="bkForm"'));
  const built = read('book/index.html'); assert.ok(built.includes('Step 1 of 3') && built.includes('<li data-id="full500">' + site.full500.price + '</li>'));
});
test('payment path unchanged: same endpoints, same validation, fee still server-checked', () => {
  const js = read('assets/js/book-pay.js');
  for (const m of ["call('book-start'", "call('verify-payment'", 'Number(x.d.fee) !== shown.amount', 'problems(v)', 'DEFAULTS = { confirm_std: 49, confirm_mid: 69, confirm_big: 99, confirm_car: 99 }']) assert.ok(js.includes(m), m);
});

test('no personal details are kept in the browser draft, and step and checkout events carry none', () => {
  const js = read('assets/js/book-pay.js');
  const save = js.match(/var SAVE = \[([^\]]*)\]/)[1];
  for (const f of ['name', 'phone', 'email', 'house', 'street', 'need_text']) assert.doesNotMatch(save, new RegExp(`'${f}'`), f);
  assert.match(js, /PERSONAL\.forEach\(function \(n\) \{ delete saved\[n\]; \}\)/);
  assert.match(js, /mxpTrack\('book_step', \{ step: n \}\)/); assert.match(js, /mxpTrack\('begin_checkout', \{ currency: 'INR'/);
  assert.match(read('_headers'), /https:\/\/analytics\.google\.com/);
});
