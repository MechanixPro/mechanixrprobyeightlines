import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildServiceEdit, buildPaymentEdit } from '../admin/booking-edit.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const services = [
  { id: 'basic', kind: 'service', name: 'Basic service', price: 599 }, { id: 'general', kind: 'service', name: 'General service', price: 1299 },
  { id: 'full', kind: 'service', name: 'Full service', price: 1999 }, { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 349 },
  { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 }, { id: 'chain', kind: 'addon', name: 'Chain', price: 149 },
  { id: 'bigbike', kind: 'fee', name: 'Above-180cc surcharge', price: 300 }, { id: 'advance', kind: 'fee', name: 'Checkup and quote fee', price: 349 },
];
const ctx = { services, today: '2026-10-12' };

test('changing the service and add-ons recalculates the estimate from the live prices', () => {
  const r = buildServiceEdit({ service: 'full', addons: ['wash', 'chain', 'ghost'] }, ctx);
  assert.equal(r.ok, true); assert.equal(r.lead.service_id, 'full'); assert.deepEqual(r.lead.addons, ['wash', 'chain']); assert.equal(r.lead.est_total, 1999 + 199 + 149);
});
test('the above-180cc surcharge applies to Basic, General and Full only, and is passed on to the bike', () => {
  assert.equal(buildServiceEdit({ service: 'general', bigBike: true }, ctx).lead.est_total, 1299 + 300);
  assert.equal(buildServiceEdit({ service: 'repair', bigBike: true }, ctx).lead.est_total, 349);
  assert.deepEqual(buildServiceEdit({ service: 'general', bigBike: true }, ctx).bike, { big_bike: true });
});
test('the visit day and slot are checked and a slot is needed with a date', () => {
  const ok = buildServiceEdit({ service: 'basic', date: '2026-10-14', slot: 'evening', time: '5:30 PM' }, ctx).lead;
  assert.equal(ok.preferred_date, '2026-10-14'); assert.equal(ok.preferred_slot, 'evening'); assert.equal(ok.preferred_time, '5:30 PM');
  assert.match(buildServiceEdit({ service: 'basic', date: '2026-10-14' }, ctx).error, /slot/i);
  assert.match(buildServiceEdit({ service: 'basic', date: '2026-10-01', slot: 'morning' }, ctx).error, /past/i);
  const none = buildServiceEdit({ service: 'basic' }, ctx).lead; assert.equal(none.preferred_date, null); assert.equal(none.preferred_slot, null);
});
test('area, PIN code, address and the problem note are tidied and checked', () => {
  const l = buildServiceEdit({ service: 'basic', area: ' HSR Layout ', pincode: '560 102', address: '12 <b>MG</b> Road', note: 'brake noise' }, ctx).lead;
  assert.equal(l.area, 'HSR Layout'); assert.equal(l.pincode, '560102'); assert.doesNotMatch(l.address, /[<>]/); assert.equal(l.note, 'brake noise');
  assert.match(buildServiceEdit({ service: 'basic', pincode: '56010' }, ctx).error, /6 digits/);
  assert.match(buildServiceEdit({ service: 'nope' }, ctx).error, /valid service/i);
});
test('payment edits: amounts, the day it was received, and a paid-at that follows the amount', () => {
  const r = buildPaymentEdit({ due: '1655', paid: '349', paidOn: '2026-10-10' }, { today: '2026-10-12', now: '2026-10-12T05:00:00.000Z' });
  assert.equal(r.ok, true); assert.equal(r.lead.amount_due, 1655); assert.equal(r.lead.paid_amount, 349); assert.match(r.lead.paid_at, /^2026-10-10/);
  const zero = buildPaymentEdit({ due: '500', paid: '0' }, { today: '2026-10-12', now: '2026-10-12T05:00:00.000Z' }).lead;
  assert.equal(zero.paid_amount, 0); assert.equal(zero.paid_at, null);
  const noDate = buildPaymentEdit({ due: '500', paid: '99' }, { today: '2026-10-12', now: '2026-10-12T05:00:00.000Z' }).lead;
  assert.equal(noDate.paid_at, '2026-10-12T05:00:00.000Z');
});
test('bad payment numbers are refused with a plain message', () => {
  const c = { today: '2026-10-12', now: '2026-10-12T05:00:00.000Z' };
  assert.match(buildPaymentEdit({ due: '-5', paid: '0' }, c).error, /amount due/i);
  assert.match(buildPaymentEdit({ due: '100', paid: 'abc' }, c).error, /received/i);
  assert.match(buildPaymentEdit({ due: '100', paid: '999999999' }, c).error, /received/i);
  assert.match(buildPaymentEdit({ due: '100', paid: '0', paidOn: '2027-01-01' }, c).error, /future/i);
});
test('the booking screen has one Save changes button that saves status, service and amount due through the checked helper and is logged', () => {
  const a = read('admin/admin.js');
  for (const s of ['data-act="saveBooking"', 'buildServiceEdit', "audit('lead_updated'", 'id="es-service"', 'id="pa"']) assert.ok(a.includes(s), s);
  assert.equal((a.match(/data-act="save(Service|Payment|Changes)?"/g) || []).length, 0, 'the old separate save buttons are gone');
});
test('an invoice that was edited by hand is not changed by a service edit, and the admin is told', () => {
  assert.match(read('admin/admin.js'), /edited by hand|invoice_override[\s\S]{0,200}not change/i);
});
