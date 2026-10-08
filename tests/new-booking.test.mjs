import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewBooking } from '../admin/new-booking.js';

const services = [
  { id: 'general', kind: 'service', name: 'General service', price: 1299, active: true },
  { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 349, active: true },
  { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199, active: true },
  { id: 'bigbike', kind: 'fee', name: 'Above 180cc', price: 300, active: true },
];
const ctx = { services, today: '2026-10-08' };
const ok = (o) => buildNewBooking({ name: 'Asha Rao', phone: '98765 43210', ...o }, ctx);

test('name and number are the only required fields', () => {
  const r = ok({});
  assert.equal(r.error, undefined);
  assert.equal(r.lead.name, 'Asha Rao'); assert.equal(r.lead.phone, '9876543210');
  assert.equal(r.lead.status, 'contacted'); assert.equal(r.lead.source, 'phone');
  assert.equal(r.bike, null);
});
test('rejects a short name and a bad number', () => {
  assert.match(buildNewBooking({ name: 'A', phone: '9876543210' }, ctx).error, /name/i);
  assert.match(buildNewBooking({ name: 'Asha', phone: '12345' }, ctx).error, /mobile/i);
});
test('rejects a bad email and a bad PIN but allows them empty', () => {
  assert.match(ok({ email: 'nope' }).error, /email/i);
  assert.match(ok({ pincode: '5601' }).error, /PIN/);
  assert.equal(ok({ email: '', pincode: '' }).error, undefined);
});
test('keeps details given: bike, service, add-ons, place, address, notes', () => {
  const r = ok({ brand: 'Royal Enfield', model: 'Classic 350', nickname: 'Raja', bigBike: true, service: 'general', addons: ['wash', 'ghost'], area: 'HSR Layout', pincode: '560102', address: 'Flat 4B', place: 'home', date: '2026-10-10', slot: 'morning', time: '10:30 AM', km: 'mid', note: 'rattle', source: 'whatsapp', email: 'Asha@Example.com', status: 'scheduled' });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.bike, { brand: 'Royal Enfield', model: 'Classic 350', nickname: 'Raja', big_bike: true });
  assert.equal(r.lead.service_id, 'general'); assert.deepEqual(r.lead.addons, ['wash']);
  assert.equal(r.lead.est_total, 1299 + 300 + 199);
  assert.equal(r.lead.area, 'HSR Layout'); assert.equal(r.lead.pincode, '560102'); assert.equal(r.lead.address, 'Flat 4B');
  assert.equal(r.lead.preferred_date, '2026-10-10'); assert.equal(r.lead.preferred_slot, 'morning'); assert.equal(r.lead.preferred_time, '10:30 AM');
  assert.equal(r.lead.km_band, 'mid'); assert.equal(r.lead.notes, 'rattle'); assert.equal(r.lead.source, 'whatsapp'); assert.equal(r.lead.status, 'scheduled');
  assert.equal(r.customer.email, 'asha@example.com');
});
test('the surcharge is not added to a problem check', () => {
  assert.equal(ok({ service: 'repair', bigBike: true }).lead.est_total, 349);
});
test('unknown service, source or status fall back safely', () => {
  assert.match(ok({ service: 'ghost' }).error, /service/i);
  const r = ok({ source: 'tv', status: 'weird', slot: 'midnight' });
  assert.equal(r.lead.source, 'phone'); assert.equal(r.lead.status, 'contacted'); assert.equal(r.lead.preferred_slot, null);
});
test('a date needs a slot and cannot be in the past', () => {
  assert.match(ok({ date: '2026-10-10' }).error, /slot/i);
  assert.match(ok({ date: '2026-09-01', slot: 'morning' }).error, /past/i);
});
test('text is stripped of markup and capped', () => {
  const r = ok({ name: '<b>Asha</b> Rao', note: 'x'.repeat(2000) });
  assert.equal(r.lead.name, 'bAsha/b Rao'.slice(0, 60)); assert.equal(r.lead.notes.length, 1000);
});
test('the reminder and WhatsApp choices are saved', () => {
  const r = ok({ whatsapp: true, reminder: true, regNo: 'ka 03 ab 1234' });
  assert.equal(r.lead.consent_whatsapp, true); assert.equal(r.lead.reminder_opt_in, true); assert.equal(r.lead.reg_no, 'KA03AB1234');
});
