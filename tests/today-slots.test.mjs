// Today Slots: Today shows only while a window is still ahead; the server refuses a passed window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { todaySlots as srv, istToday as srvDay } from '../supabase/functions/_shared/today-slots.ts';
import { cleanBooking } from '../supabase/functions/_shared/book-form.ts';
const T = createRequire(import.meta.url)('../assets/js/today-slots.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const at = (hhmm) => Date.parse('2026-11-10T' + hhmm + ':00+05:30');

test('windows must start 2 hours from now: the day closes after 2 PM except as soon as possible until 6 PM', () => {
  assert.deepEqual(T.todaySlots(at('06:00')), { morning: true, afternoon: true, evening: true, asap: false, any: true });
  assert.deepEqual(T.todaySlots(at('09:30')), { morning: false, afternoon: false || true, evening: true, asap: true, any: true });
  const noon = T.todaySlots(at('11:00')); assert.equal(noon.morning, false); assert.equal(noon.afternoon, false); assert.equal(noon.evening, true);
  const late = T.todaySlots(at('14:30')); assert.equal(late.evening, false); assert.equal(late.asap, true); assert.equal(late.any, true);
  const night = T.todaySlots(at('18:30')); assert.equal(night.any, false);
});
test('the browser rule and the server rule give the same answer at every quarter hour', () => {
  for (let m = 0; m < 24 * 60; m += 15) { const t = Date.parse('2026-11-10T00:00:00+05:30') + m * 60000; assert.deepEqual(srv(t), T.todaySlots(t), 'at minute ' + m); assert.equal(srvDay(t), T.istToday(t)); }
});
test('the server refuses a passed window today and as soon as possible on another day, and accepts the rest', () => {
  const now = at('15:00'), base = { client_key: 'abcdefgh-1234-5678', vehicle: 'bike', brand: 'Bajaj', model: 'Pulsar 220F', engine_class: 'mid', service_id: 'general', house: 'Flat 4B', street: '27th Main', area: 'HSR Layout', pincode: '560102', name: 'Test Customer', phone: '98765 43210', email: 'test@example.invalid', consent_whatsapp: true };
  const r = (o) => cleanBooking({ ...base, ...o }, now);
  assert.equal(r({ preferred_date: '2026-11-10', preferred_slot: 'morning' }).ok, false);
  assert.equal(r({ preferred_date: '2026-11-10', preferred_slot: 'evening' }).ok, false);
  assert.equal(r({ preferred_date: '2026-11-10', preferred_slot: 'asap' }).ok, true);
  assert.equal(r({ preferred_date: '2026-11-11', preferred_slot: 'asap' }).ok, false);
  assert.equal(r({ preferred_date: '2026-11-11', preferred_slot: 'morning' }).ok, true);
});
test('the booking form hides Today after the last window and disables windows that have passed', () => {
  const b = read('assets/js/book-pay.js'); assert.match(b, /MXP_TODAY/); assert.match(b, /todayLab\.hidden = true/); assert.match(b, /bk-off/);
  assert.match(read('book/index.html'), /today-slots\.js/);
});
