const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', slot: 'morning', name: 'Asha', phone: '9876543210', type: 's' }, o);
const ITEMS = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];

test('nearestArea picks HSR Layout for a point in HSR', () => assert.equal(L.nearestArea(12.9121, 77.6446), 'HSR Layout'));
test('nearestArea picks Koramangala for a point in Koramangala', () => assert.equal(L.nearestArea(12.9352, 77.6245), 'Koramangala'));
test('nearestArea picks Electronic City for a point in Electronic City', () => assert.equal(L.nearestArea(12.8452, 77.6602), 'Electronic City'));
test('nearestArea says Other area when far from every service area', () => {
  assert.equal(L.nearestArea(13.0827, 80.2707), 'Other area');
  assert.equal(L.nearestArea(13.1986, 77.7066), 'Other area');
});
test('nearestArea rejects bad coordinates', () => {
  assert.equal(L.nearestArea(NaN, 77.6), null);
  assert.equal(L.nearestArea(null, null), null);
  assert.equal(L.nearestArea(95, 200), null);
});
test('distanceKm is about 1 km for 0.009 degrees of latitude and 0 for the same point', () => {
  assert.ok(Math.abs(L.distanceKm(12.9, 77.6, 12.909, 77.6) - 1) < 0.05);
  assert.equal(L.distanceKm(12.9, 77.6, 12.9, 77.6), 0);
});
test('mapsLink builds a Google Maps link with 5 decimals', () => assert.equal(L.mapsLink(12.912345678, 77.644), 'https://maps.google.com/?q=12.91235,77.64400'));
test('buildMessage includes the map pin and address when given', () => {
  const m = L.buildMessage(st({ lat: 12.9121, lng: 77.6446, address: 'Flat 4B, 27th Main' }), ITEMS, {}, 'Tomorrow');
  assert.match(m, /Address: Flat 4B, 27th Main/);
  assert.match(m, /Map pin: https:\/\/maps\.google\.com\/\?q=12\.91210,77\.64460/);
});
test('buildMessage leaves out address and map pin when not given', () => {
  const m = L.buildMessage(st(), ITEMS, {}, 'Tomorrow');
  assert.doesNotMatch(m, /Address:|Map pin:/);
});
test('leadPayload carries lat, lng and address, or nulls', () => {
  const p = L.leadPayload(st({ lat: 12.9121, lng: 77.6446, address: ' Flat 4B ' }), '2026-10-08');
  assert.equal(p.lat, 12.9121); assert.equal(p.lng, 77.6446); assert.equal(p.address, 'Flat 4B');
  const q = L.leadPayload(st(), '2026-10-08');
  assert.equal(q.lat, null); assert.equal(q.lng, null); assert.equal(q.address, null);
});
