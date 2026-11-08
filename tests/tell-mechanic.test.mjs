import test from 'node:test';
import assert from 'node:assert/strict';
import { mechanicWaPhone, tellMessage, tellUrl, toldInfo, toldLabel, notToldYet, toldNoteBody, TOLD_NOTE } from '../crm/tell-mechanic.js';

const row = { id: 'l1', booking_id: 'MXP-1042', mechanic_id: 'm1', mechanic_name: 'Ravi Kumar', bike: 'Honda Activa', service_name: 'General service', area: 'HSR Layout', pincode: '560102', preferred_date: '2026-11-09', preferred_slot: 'morning' };

test('phone is normalised to 91XXXXXXXXXX', () => {
  for (const p of ['98450 12345', '+91 98450 12345', '09845012345', '919845012345', '98450-12345']) assert.equal(mechanicWaPhone(p), '919845012345');
});
test('bad or missing phone gives null', () => {
  for (const p of [null, undefined, '', '12345', '5845012345', '98450123456789', 'abc']) assert.equal(mechanicWaPhone(p), null);
  assert.equal(tellUrl('', 'x'), null);
});
test('message has the plain facts and the link', () => {
  const m = tellMessage(row, 'https://mechanixpro.in/job/#k=abc');
  assert.match(m, /^Hi Ravi, you have a job MXP-1042\./);
  assert.match(m, /Service: Honda Activa, General service/); assert.match(m, /Area: HSR Layout 560102/); assert.match(m, /Slot: .*Morning 9 to 12/);
  assert.match(m, /Job link: https:\/\/mechanixpro\.in\/job\/#k=abc/); assert.match(m, /Reply OK when you have seen this\.$/);
});
test('message never carries a customer phone, a street address or superlatives', () => {
  const m = tellMessage({ ...row, phone: '9811100001', address: '12 MG Road', name: 'Asha Rao' }, 'https://x/y');
  assert.ok(!/9811100001|MG Road|Asha/.test(m));
  assert.ok(!/best|amazing|guarantee|premium|top-notch|!/i.test(m));
});
test('missing fields and missing link do not break the message', () => {
  const m = tellMessage({ mechanic_name: '' }, '');
  assert.match(m, /^Hi, you have a job\./); assert.match(m, /The job link will follow\./); assert.ok(!/undefined|null/.test(m));
  assert.doesNotThrow(() => tellMessage(null, null));
});
test('URL is wa.me with encoded text', () => {
  const m = tellMessage(row, 'https://x/y?a=1&b=2'), u = tellUrl('98450 12345', m);
  assert.ok(u.startsWith('https://wa.me/919845012345?text='));
  assert.equal(decodeURIComponent(u.split('?text=')[1]), m); assert.ok(!/\s|\n/.test(u));
});
test('told note is found for the current mechanic only', () => {
  const acts = [{ body: 'Called customer', created_at: '2026-11-08T08:00:00Z' }, { body: toldNoteBody('Ravi Kumar'), created_at: '2026-11-08T08:35:00Z' }];
  assert.equal(toldInfo(acts, 'Ravi Kumar').at, '2026-11-08T08:35:00.000Z');
  assert.equal(toldInfo(acts, 'Suresh B'), null);   // reassigned since
  assert.equal(toldInfo([], 'Ravi'), null); assert.equal(toldInfo(null, 'Ravi'), null);
  assert.equal(toldNoteBody(''), TOLD_NOTE);
});
test('told label shows Indian time', () => { assert.equal(toldLabel('2026-11-08T08:35:00Z'), 'Mechanic told, 14:05'); assert.equal(toldLabel('bad'), 'Mechanic told'); });
test('red chip only for assigned, today or tomorrow, not told', () => {
  const now = new Date('2026-11-08T06:00:00Z');
  assert.equal(notToldYet({ ...row, preferred_date: '2026-11-08' }, null, now), true);
  assert.equal(notToldYet({ ...row, preferred_date: '2026-11-09' }, null, now), true);
  assert.equal(notToldYet({ ...row, preferred_date: '2026-11-10' }, null, now), false);
  assert.equal(notToldYet({ ...row, preferred_date: '2026-11-08' }, { at: 'x' }, now), false);
  assert.equal(notToldYet({ ...row, mechanic_id: null, preferred_date: '2026-11-08' }, null, now), false);
});
