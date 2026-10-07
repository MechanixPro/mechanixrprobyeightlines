// Booking logic tests. Run: npm test  (node --test, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const BIKES = (() => { global.window = {}; require('../assets/js/bikes.js'); return global.window.MXP_BIKES; })();

const ITEMS = [
  { id: 'basic', kind: 'service', name: 'Basic service', price: 799 },
  { id: 'general', kind: 'service', name: 'General service', price: 1299 },
  { id: 'full', kind: 'service', name: 'Full service', price: 1999 },
  { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 199 },
  { id: 'sos', kind: 'service', name: 'Roadside emergency', price: 349 },
  { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 },
  { id: 'tyre', kind: 'addon', name: 'Tyre and puncture check', price: 49 }
];
const CFG = { bigBikeSurcharge: 300, bookingAdvance: 199 };
const base = (o) => Object.assign({ contact: 'whatsapp', brand: 'Honda', model: 'Activa 6G', type: 's', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', date: 1, slot: 'morning', name: 'Asha', phone: '9876543210' }, o);

test('findModel matches a listed model ignoring case and spaces', () => {
  assert.deepEqual(L.findModel(BIKES, 'Honda', '  activa 6g '), ['Activa 6G', 's', 0]);
});
test('findModel returns null for an unlisted model or the wrong brand', () => {
  assert.equal(L.findModel(BIKES, 'Honda', 'Splendor Plus'), null);
  assert.equal(L.findModel(BIKES, 'Nope', 'Activa 6G'), null);
});

test('recommend suggests a problem check for electric bikes', () => assert.equal(L.recommend(base({ type: 'e', km: 'gt6' })), 'repair'));
test('recommend suggests basic for under 3,000 km with no problems', () => assert.equal(L.recommend(base({ km: 'lt3' })), 'basic'));
test('recommend suggests basic for a new bike', () => assert.equal(L.recommend(base({ km: 'new' })), 'basic'));
test('recommend moves basic up to general when problems are reported', () => assert.equal(L.recommend(base({ km: 'lt3', issues: ['brake'] })), 'general'));
test('recommend suggests general for 3,000-6,000 km', () => assert.equal(L.recommend(base({ km: 'mid' })), 'general'));
test('recommend suggests full for over 6,000 km', () => assert.equal(L.recommend(base({ km: 'gt6' })), 'full'));
test('recommend suggests full when four or more problems and mid mileage', () => assert.equal(L.recommend(base({ km: 'mid', issues: ['a', 'b', 'c', 'd'] })), 'full'));
test('recommend suggests a problem check when only problems are given', () => assert.equal(L.recommend(base({ km: '', issues: ['start'] })), 'repair'));
test('recommend defaults to general when nothing is known', () => assert.equal(L.recommend(base({ km: '' })), 'general'));

test('total is the service price plus add-ons', () => assert.equal(L.total(base({ addons: ['wash', 'tyre'] }), ITEMS, CFG), 1299 + 199 + 49));
test('total adds the surcharge for bikes above 180cc on service packages', () => assert.equal(L.total(base({ cc: 'big' }), ITEMS, CFG), 1599));
test('total does not add the surcharge to roadside or problem checks', () => {
  assert.equal(L.total(base({ cc: 'big', service: 'sos' }), ITEMS, CFG), 349);
  assert.equal(L.total(base({ cc: 'big', service: 'repair' }), ITEMS, CFG), 199);
});
test('total ignores unknown add-ons', () => assert.equal(L.total(base({ addons: ['ghost'] }), ITEMS, CFG), 1299));

const WHEN = 'Tomorrow, 8 Oct · Morning (9 AM – 12 PM)';
test('buildMessage asks for a quote and lists the bike, service and estimate', () => {
  const m = L.buildMessage(base({ brand: 'Royal Enfield', model: 'Classic 350', cc: 'big' }), ITEMS, CFG, WHEN);
  assert.match(m, /quote for my bike/);
  assert.match(m, /Bike: Royal Enfield Classic 350 \(above 180cc\)/);
  assert.match(m, /Service: General service/);
  assert.match(m, /Starting estimate: ₹1,599/);
  assert.match(m, /Please send me the quote\. I will approve before work starts\./);
});
test('buildMessage includes kilometres, problems, note and add-ons only when given', () => {
  const full = L.buildMessage(base({ km: 'mid', issues: ['brake', 'chain'], note: 'rattling', addons: ['wash'] }), ITEMS, CFG, WHEN);
  assert.match(full, /Last service: 3,000–6,000 km since last service/);
  assert.match(full, /Problems: Brakes weak or noisy, Chain noise or loose chain/);
  assert.match(full, /Note: rattling/);
  assert.match(full, /Service: General service \+ Foam wash/);
  const bare = L.buildMessage(base(), ITEMS, CFG, WHEN);
  assert.doesNotMatch(bare, /Last service:|Problems:|Note:/);
});
test('buildMessage for the road asks for live location and leaves out a preferred time', () => {
  const m = L.buildMessage(base({ place: 'road' }), ITEMS, CFG, WHEN);
  assert.match(m, /live location/);
  assert.doesNotMatch(m, /Preferred time/);
});
test('buildMessage names the bike by its nickname when given', () => {
  assert.match(L.buildMessage(base({ nick: 'Bullet Raja' }), ITEMS, CFG, WHEN), /Bike: "Bullet Raja" \(Honda Activa 6G\)/);
});
test('buildMessage adds the booking reference when there is one', () => {
  assert.match(L.buildMessage(base(), ITEMS, CFG, WHEN, 'MXP-1042'), /Booking ref: MXP-1042/);
});

test('leadPayload carries the new details and a server-ready date and slot', () => {
  const p = L.leadPayload(base({ km: 'mid', issues: ['brake'], note: ' hi ', cc: 'big', nick: ' Raja ' }), '2026-10-08');
  assert.equal(p.km_band, 'mid');
  assert.deepEqual(p.issues, ['brake']);
  assert.equal(p.note, 'hi');
  assert.equal(p.big_bike, true);
  assert.equal(p.bike_nickname, 'Raja');
  assert.equal(p.preferred_date, '2026-10-08');
  assert.equal(p.preferred_slot, 'morning');
});
test('leadPayload sends roadside jobs as asap on today', () => {
  const p = L.leadPayload(base({ place: 'road' }), '2026-10-08', '2026-10-07');
  assert.equal(p.preferred_slot, 'asap');
  assert.equal(p.preferred_date, '2026-10-07');
});
test('leadPayload sends sos service as asap even when place is home', () => {
  assert.equal(L.leadPayload(base({ service: 'sos' }), '2026-10-08', '2026-10-07').preferred_slot, 'asap');
});

test('bike data: every model row is [name, m|s|e, 0|1] with no duplicates per brand', () => {
  for (const [brand, rows] of Object.entries(BIKES)) {
    const seen = new Set();
    for (const [name, type, big] of rows) {
      assert.ok(name && typeof name === 'string', brand + ' model name');
      assert.ok(['m', 's', 'e'].includes(type), brand + ' ' + name + ' type');
      assert.ok(big === 0 || big === 1, brand + ' ' + name + ' big flag');
      assert.ok(!seen.has(name.toLowerCase()), brand + ' duplicate ' + name);
      seen.add(name.toLowerCase());
    }
  }
});
test('bike data: electric-only brands list only electric models', () => {
  for (const b of ['Ather', 'Ola Electric']) assert.ok(BIKES[b].every((r) => r[1] === 'e'), b);
});
test('bike data: covers the brands riders ask for first', () => {
  for (const b of ['Honda', 'Hero', 'TVS', 'Bajaj', 'Royal Enfield', 'Yamaha', 'Suzuki', 'KTM']) assert.ok(BIKES[b].length >= 5, b);
});

test('buildMessage tells the expert to call when the customer prefers a call', () => {
  assert.match(L.buildMessage(base({ contact: 'call' }), ITEMS, CFG, WHEN), /Contact me by: Phone call/);
});
test('buildMessage says WhatsApp chat is preferred by default', () => {
  assert.match(L.buildMessage(base(), ITEMS, CFG, WHEN), /Contact me by: WhatsApp chat/);
});
test('leadPayload carries the contact preference and defaults to whatsapp', () => {
  assert.equal(L.leadPayload(base({ contact: 'call' }), '2026-10-08').contact_pref, 'call');
  assert.equal(L.leadPayload(base({ contact: undefined }), '2026-10-08').contact_pref, 'whatsapp');
});
test('callLink builds a tel: link from the configured number and rejects bad numbers', () => {
  assert.equal(L.callLink('919876543210'), 'tel:+919876543210');
  assert.equal(L.callLink('+91 98765 43210'), 'tel:+919876543210');
  assert.equal(L.callLink('91XXXXXXXXXX'), null);
  assert.equal(L.callLink(''), null);
});
