const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {}; require('../assets/js/bikes.js');
const L = require('../assets/js/logic.js');
const B = global.window.MXP_BIKES;
const ITEMS = [
  { id: 'basic', kind: 'service', name: 'Basic service', price: 599 }, { id: 'general', kind: 'service', name: 'General service', price: 1299 },
  { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 }, { id: 'tyre', kind: 'addon', name: 'Tyre and puncture check', price: 49 },
  { id: 'advance', kind: 'fee', name: 'Booking advance', price: 199 }
];
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', type: 's', cc: 'std', nick: 'Raja', km: 'mid', issues: ['brake', 'chain'], note: '', service: 'general', addons: ['wash'], place: 'home', area: '', slot: '', name: '', phone: '' }, o);

test('a build survives being turned into a link and back', () => {
  const token = L.encodeBuild(st());
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const b = L.decodeBuild(token, B, ITEMS);
  assert.deepEqual(b, { brand: 'Honda', model: 'Activa 6G', type: 's', cc: 'std', nick: 'Raja', km: 'mid', issues: ['brake', 'chain'], service: 'general', addons: ['wash'] });
});
test('names with accents, quotes or emoji still round-trip', () => {
  const b = L.decodeBuild(L.encodeBuild(st({ nick: 'Rāja "Bullet" 🏍' })), B, ITEMS);
  assert.equal(b.nick, 'Rāja "Bullet" 🏍'.slice(0, 24));
});
test('a link never carries personal contact details', () => {
  const token = L.encodeBuild(st({ name: 'Asha', phone: '9876543210', email: 'a@b.in', address: 'Flat 4B' }));
  const raw = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  for (const s of ['Asha', '9876543210', 'a@b.in', 'Flat 4B']) assert.ok(!raw.includes(s), s);
});
test('a broken, tampered or unknown link is ignored, not trusted', () => {
  assert.equal(L.decodeBuild('', B, ITEMS), null); assert.equal(L.decodeBuild('%%%', B, ITEMS), null); assert.equal(L.decodeBuild('e30', B, ITEMS), null);
  const evil = L.encodeBuild(st({ brand: 'Nope', service: 'hacker', addons: ['wash', 'ghost', 'advance'], issues: ['brake', '<script>'], cc: 'huge', km: 'forever', model: 'x'.repeat(80), nick: 'n'.repeat(60) }));
  assert.equal(L.decodeBuild(evil, B, ITEMS), null);
  const mixed = L.decodeBuild(L.encodeBuild(st({ service: 'hacker', addons: ['wash', 'ghost', 'advance'], issues: ['brake', '<script>'], cc: 'huge', km: 'forever', model: 'x'.repeat(80), nick: 'n'.repeat(60) })), B, ITEMS);
  assert.equal(mixed.service, ''); assert.deepEqual(mixed.addons, ['wash']); assert.deepEqual(mixed.issues, ['brake']); assert.equal(mixed.cc, 'std'); assert.equal(mixed.km, ''); assert.equal(mixed.model.length, 40); assert.equal(mixed.nick.length, 24);
});
test('the draft message tells the team the visitor is still deciding and what they have built', () => {
  const m = L.buildDraftMessage(st(), ITEMS, { bigBikeSurcharge: 300 }, 'https://mechanixpro.in/book/?b=abc');
  assert.match(m, /still choosing/i); assert.match(m, /Bike: "Raja" \(Honda Activa 6G\)/); assert.match(m, /Service: General service \+ Foam wash/);
  assert.match(m, /Problems: Brakes weak or noisy, Chain noise or loose chain/); assert.match(m, /Starting estimate: ₹1,498/); assert.match(m, /https:\/\/mechanixpro\.in\/book\/\?b=abc/); assert.match(m, /call or message me/i);
});
test('the draft message works with a bike only', () => {
  const m = L.buildDraftMessage(st({ service: '', addons: [], issues: [], km: '', nick: '' }), ITEMS, {}, '');
  assert.match(m, /Bike: Honda Activa 6G/); assert.doesNotMatch(m, /Service:|Problems:|Starting estimate/);
});
test('the leave prompt shows once, only with a build, and never after sending', () => {
  const ok = { hasBuild: true, sent: false, promptedBefore: false, step: 2, trigger: 'exit' };
  assert.equal(L.shouldPromptExit(ok), true);
  assert.equal(L.shouldPromptExit({ ...ok, hasBuild: false }), false); assert.equal(L.shouldPromptExit({ ...ok, sent: true }), false); assert.equal(L.shouldPromptExit({ ...ok, promptedBefore: true }), false);
});
test('the idle prompt waits until the visitor is past the bike step', () => {
  assert.equal(L.shouldPromptExit({ hasBuild: true, sent: false, promptedBefore: false, step: 0, trigger: 'idle' }), false);
  assert.equal(L.shouldPromptExit({ hasBuild: true, sent: false, promptedBefore: false, step: 2, trigger: 'idle' }), true);
});
test('a registration number is checked and tidied', () => {
  for (const [raw, out] of [['ka01ab1234', 'KA01AB1234'], [' KA 05 MX 9', 'KA05MX9'], ['KA-51-HC-1234', 'KA51HC1234'], ['', null], ['abc', null], ['1234567890', null], ['KA01AB123456', null]]) assert.equal(L.cleanReg(raw), out, raw);
});
test('the booking carries the pick-up choice, registration, reminder choice and request type', () => {
  const p = L.leadPayload(st({ place: 'pickup', reg: 'ka01ab1234', reminder: true, requestType: 'callback', name: 'A', phone: '9876543210', area: 'HSR Layout', slot: 'morning' }), '2026-10-12');
  assert.equal(p.place, 'pickup'); assert.equal(p.reg_no, 'KA01AB1234'); assert.equal(p.reminder_opt_in, true); assert.equal(p.request_type, 'callback');
  const q = L.leadPayload(st({ name: 'A', phone: '9876543210', area: 'HSR Layout', slot: 'morning' }), '2026-10-12');
  assert.equal(q.request_type, 'quote'); assert.equal(q.reg_no, null); assert.equal(q.reminder_opt_in, false);
});
test('the quote message says when our mechanic will collect the bike and shows the registration', () => {
  const m = L.buildMessage(st({ place: 'pickup', reg: 'KA01AB1234', name: 'Asha', area: 'HSR Layout', slot: 'morning' }), ITEMS, { bigBikeSurcharge: 300 }, 'Tomorrow');
  assert.match(m, /Where: Pick up and drop/i); assert.match(m, /Registration: KA01AB1234/);
});
