import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cleanBooking } from '../supabase/functions/_shared/book-form.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const book = createRequire(import.meta.url)('../assets/js/book-pay.js');
const now = Date.parse('2026-11-05T05:00:00Z');
const base = { client_key: 'abcdefgh-1234-5678', vehicle: 'bike', brand: 'Bajaj', model: 'Pulsar 220F', engine_class: 'mid', service_id: 'general', house: 'Flat 4B', street: '27th Main', area: 'HSR Layout', pincode: '560102',
  preferred_date: '2026-11-06', preferred_slot: 'morning', name: 'Test Customer', phone: '98765 43210', email: 'test@example.invalid', consent_whatsapp: true };

test('a complete bike booking is accepted and the address is joined for the lead', () => {
  const r = cleanBooking(base, now); assert.equal(r.ok, true);
  assert.equal(r.value.address, 'Flat 4B, 27th Main'); assert.equal(r.value.pincode, '560102'); assert.equal(r.value.phone, '9876543210'); assert.equal(r.value.engine_class, 'mid'); assert.equal(r.value.email, 'test@example.invalid');
});
test('each missing or wrong detail gets its own clear message and field', () => {
  const bad = (o, field, re) => { const r = cleanBooking({ ...base, ...o }, now); assert.equal(r.ok, false, field); assert.equal(r.field, field); assert.match(r.error, re); };
  bad({ email: '' }, 'email', /email/i); bad({ email: 'not-an-email' }, 'email', /email/i); bad({ phone: '12345' }, 'phone', /mobile/i); bad({ pincode: '110001' }, 'pincode', /Bengaluru PIN/);
  bad({ house: '' }, 'house', /house or flat/i); bad({ street: 'a' }, 'street', /street/i); bad({ area: '' }, 'area', /area/i); bad({ preferred_slot: 'night' }, 'preferred_slot', /slot/i);
  bad({ preferred_date: '2026-01-01' }, 'preferred_date', /30 days/); bad({ preferred_date: '2026-12-30' }, 'preferred_date', /30 days/); bad({ name: '' }, 'name', /name/i);
  bad({ model: '' }, 'model', /model/i); bad({ service_id: 'sos' }, 'service_id', /needs/i); bad({ client_key: 'short' }, 'form', /Reload/); bad({ vehicle: 'boat' }, 'vehicle', /bike or car/i);
});
test('a car booking needs a make and model and what it needs, and is not priced like a bike', () => {
  const car = { ...base, vehicle: 'car', brand: '', model: 'Hyundai i20', service_id: '', car_need: 'problem', need_text: 'noise from the front wheel' };
  const r = cleanBooking(car, now); assert.equal(r.ok, true); assert.equal(r.value.vehicle, 'car'); assert.equal(r.value.service_id, ''); assert.match(r.value.need_text, /^Problem check: noise/);
  assert.equal(cleanBooking({ ...car, car_need: undefined }, now).ok, false);
});
test('location is saved only when it is inside Bengaluru', () => {
  assert.equal(cleanBooking({ ...base, lat: '12.91', lng: '77.64' }, now).value.lat, 12.91);
  assert.equal(cleanBooking({ ...base, lat: '28.6', lng: '77.2' }, now).value.lat, null);
});
test('the browser checks the same things before it asks the server, step by step', () => {
  const v = { vehicle: 'bike', model: 'Activa', service_id: 'basic', house: 'F1', street: 'Main road', area: 'HSR', pincode: '560102', preferred_date: '2026-11-06', preferred_slot: 'asap', name: 'Asha', phone: '9876543210', email: 'a@example.invalid' };
  assert.deepEqual(book.problems(v), {});
  assert.deepEqual(Object.keys(book.problems({ ...v, email: '', phone: '1' }, 3)).sort(), ['email', 'phone']);
  assert.deepEqual(Object.keys(book.problems({ ...v, pincode: '700001' }, 2)), ['pincode']);
  assert.deepEqual(Object.keys(book.problems({ ...v, model: '' }, 1)), ['model']);
  assert.deepEqual(Object.keys(book.problems({ vehicle: 'car', car_model: '' }, 1)), ['car_model']);
});
test('the page is phone first, has no inline script, saves progress on the phone and keeps the claims for bikes only', () => {
  const html = read('book/index.html'), js = read('assets/js/book-pay.js');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]/); assert.doesNotMatch(html, /\son(click|change|input|submit)=/); assert.match(html, /book\.css/); assert.match(html, /book-pay\.js/);
  assert.match(html, /id="bkForm"/); assert.match(html, /name="email"[^>]*type="email"|type="email"[^>]*name="email"/);
  for (const l of ['The fee is adjusted in your final bill', 'itemised quote before any work', 'Nothing starts without your OK and your code', 'one-time code protects your vehicle', 'confirmation by email and WhatsApp', 'Secure payment with Razorpay']) assert.ok(html.includes(l), l);
  assert.doesNotMatch(html, /10,000|1,300|rating|★|stars|\bavg\b/i);   // the two owner-confirmed claims are added by the script, for bikes only
  assert.match(js, /bike-proof/); assert.match(js, /if \(!car\) trust\.insertAdjacentHTML/); assert.match(js, /localStorage/);
  assert.match(read('assets/css/book.css'), /min-height:4[48]px/);
});
test('the old quote builder stays reachable at /quote/ and the build copies it', () => {
  assert.match(read('quote/index.html'), /id="builder"/); assert.match(read('scripts/build_site.sh'), /\bquote\b/); assert.match(read('book/index.html'), /href="\/quote\/"/);
});
test('payment is idempotent end to end: one lead per form, one order per lead, one ledger row per payment', () => {
  const bs = read('supabase/functions/book-start/index.ts'), vp = read('supabase/functions/verify-payment/index.ts'), wh = read('supabase/functions/razorpay-webhook/index.ts'), sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(sql, /create unique index if not exists leads_client_key_uidx/); assert.match(bs, /eq\('client_key'/); assert.match(bs, /lead\.rzp_order_id && Number\(lead\.confirm_fee\) === fee\.amount/); assert.match(bs, /23505/);
  assert.match(vp, /payment_received[\s\S]*seen && seen\.length[\s\S]*afterConfirmationPaid/);   // the same payment verified twice counts once but re-runs failed messages
  assert.match(wh, /order\.paid/); assert.match(wh, /payment\.captured/); assert.match(wh, /eq\('details->>payment_id', pay\.id\)/); assert.match(wh, /23505/);
  assert.match(bs, /status: 'paid', already: true/);   // a refresh after paying says so instead of charging again
});
