const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', slot: 'morning', name: 'Asha', phone: '9876543210', type: 's' }, o);

test('validEmail accepts normal addresses and rejects broken ones', () => {
  for (const ok of ['a@b.in', 'asha.k+tag@gmail.com', 'A@B.CO.IN']) assert.equal(L.validEmail(ok), true, ok);
  for (const bad of ['', 'asha', 'a@b', 'a b@c.in', '@c.in', 'a@.in']) assert.equal(L.validEmail(bad), false, bad);
});
test('the lead carries a cleaned email and the marketing choice', () => {
  const p = L.leadPayload(st({ email: ' Asha@Gmail.com ', emailOffers: true }), '2026-10-08');
  assert.equal(p.email, 'asha@gmail.com'); assert.equal(p.email_marketing, true);
});
test('no email means no marketing consent is sent', () => {
  const p = L.leadPayload(st({ email: '', emailOffers: true }), '2026-10-08');
  assert.equal(p.email, null); assert.equal(p.email_marketing, false);
  assert.equal(L.leadPayload(st(), '2026-10-08').email, null);
});
