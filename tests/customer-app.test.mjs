import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../assets/js/customer-app.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const bikes = { Honda: [['Activa 6G', 's', 0], ['Shine', 'm', 0]], Royal_Enfield: [['Classic 350', 'm', 1]] };
test('the vehicle search matches brand and model words and needs two letters', () => {
  const l = C.flat(bikes);
  assert.deepEqual(C.search(l, 'activa').map((v) => v.model), ['Activa 6G']);
  assert.deepEqual(C.search(l, 'honda sh').map((v) => v.model), ['Shine']);
  assert.deepEqual(C.search(l, 'a'), []);
});
test('Book package opens the booking page already filled, and a PIN is only added when it is 6 digits', () => {
  assert.equal(C.bookUrl({ brand: 'Honda', model: 'Activa 6G' }, 'basic', '560102'), '/book/?vehicle=bike&brand=Honda&model=Activa%206G&service=basic&pincode=560102');
  assert.equal(C.bookUrl(null, 'repair', '56'), '/book/?vehicle=bike&service=repair');
});
test('a price is shown only when the live list has a real one', () => {
  assert.equal(C.priceOf([{ id: 'basic', price_inr: 499 }], 'basic'), 499); assert.equal(C.priceOf([{ id: 'repair', price_inr: 0 }], 'repair'), null); assert.equal(C.priceOf(null, 'basic'), null);
});
test('the customer app is installable and is part of the site build; it makes no claim the business has not made', () => {
  const m = JSON.parse(read('customer.webmanifest')); assert.equal(m.scope, '/customer/'); assert.equal(m.display, 'standalone');
  assert.match(read('customer/index.html'), /rel="manifest" href="\/customer\.webmanifest"/);
  const b = read('scripts/build_site.sh'); assert.match(b, /customer\.webmanifest/); assert.match(b, /for d in job garage mechanic onboard customer /);
  assert.doesNotMatch(read('assets/js/customer-app.js'), /loyalty|cashback|live video/i);
});

test('extra services show a price only when the Prices tab has one, and the rest are quoted after a check', () => {
  const j = read('assets/js/customer-app.js');
  assert.match(j, /ADDON_IDS = \['wash', 'chain', 'brake', 'tyre', 'battery'\]/); assert.match(j, /Quoted after a check/); assert.match(j, /Number\(x\.price_inr\) > 0/);
  assert.doesNotMatch(j, /₹\s?\d{2,}/);
});
