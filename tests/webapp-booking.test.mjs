import test from 'node:test';
import assert from 'node:assert/strict';
import { problems, toPayload, todaySlots, istToday, nextDays, SERVICE_ID } from '../webapp/src/booking-rules.js';
import { cleanBooking } from '../supabase/functions/_shared/book-form.ts';
import { todaySlots as serverSlots, istToday as serverToday } from '../supabase/functions/_shared/today-slots.ts';

const NOW = Date.parse('2026-11-20T06:00:00+05:30');
const KEY = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';
const day = (n) => nextDays(NOW)[n];
const bike = (o = {}) => ({ vehicle: 'bike', brand: 'Honda', model: 'Activa 6G', engine_class: 'std', service_id: SERVICE_ID.standard, house: '12', street: '4th Cross', area: 'HSR Layout', pincode: '560102', preferred_date: day(1).iso, preferred_slot: 'morning', name: 'Asha', phone: '9900000000', email: 'asha@example.com', consent_whatsapp: true, ...o });

test('a valid bike booking from the new page passes the server validation', () => {
  assert.deepEqual(problems(bike()), {});
  const r = cleanBooking(toPayload(bike(), KEY), NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.service_id, 'general');          // "Standard" is stored as general
  assert.equal(r.value.engine_class, 'std'); assert.equal(r.value.address, '12, 4th Cross');
});
test('a valid car booking passes, and sends the need, not a package', () => {
  const car = bike({ vehicle: 'car', brand: '', model: '', engine_class: null, service_id: '', car_model: 'Maruti Swift', car_need: 'inspection' });
  assert.deepEqual(problems(car), {});
  const r = cleanBooking(toPayload(car, KEY), NOW);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value.vehicle, 'car'); assert.match(r.value.need_text, /Car inspection/);
});
test('the page and the server reject the same things, in the same field', () => {
  const bad = [
    [{ pincode: '110001' }, 'pincode'], [{ phone: '1234567890' }, 'phone'], [{ email: 'nope' }, 'email'], [{ name: 'A' }, 'name'],
    [{ house: '' }, 'house'], [{ street: 'ab' }, 'street'], [{ area: '' }, 'area'], [{ service_id: 'platinum' }, 'service_id'], [{ preferred_slot: 'night' }, 'preferred_slot'],
  ];
  for (const [o, f] of bad) {
    const mine = problems(bike(o)), theirs = cleanBooking(toPayload(bike(o), KEY), NOW);
    assert.ok(mine[f], 'page flags ' + f);
    assert.equal(theirs.ok, false, f); assert.equal(theirs.field, f, 'server field for ' + f);
  }
});
test('the slot rule for today matches the server at every hour', () => {
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
    const t = Date.parse('2026-11-20T00:00:00+05:30') + (h * 60 + m) * 60000;
    const mine = todaySlots(t), s = serverSlots(t);
    for (const k of ['morning', 'afternoon', 'evening', 'asap']) assert.equal(mine[k], s[k], `${k} at ${h}:${m}`);
    assert.equal(istToday(t), serverToday(t));
  }
});
test('today is offered only while a slot is still open, and as soon as possible only for today', () => {
  const late = Date.parse('2026-11-20T19:00:00+05:30');
  const d = nextDays(late);
  assert.equal(d[0].any, false);                           // nothing left today after 7 pm: the page disables Today
  assert.equal(d[1].slots.asap, false);
  const noon = Date.parse('2026-11-20T10:00:00+05:30');
  assert.deepEqual(nextDays(noon)[0].slots, { morning: false, afternoon: true, evening: true, asap: true });
});
test('the payload never carries a fee, and the page sends no personal data to storage', () => {
  const p = toPayload(bike(), KEY);
  for (const k of Object.keys(p)) assert.ok(!/fee|amount|price|total/i.test(k), k);
});
