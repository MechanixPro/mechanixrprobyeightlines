const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', slot: 'morning', name: 'Asha', phone: '9876543210', type: 's' }, o);
const ITEMS = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];

test('reads ref and campaign from the query string', () => {
  assert.deepEqual(L.captureAttribution('?ref=asha&utm_campaign=Monsoon', mem()), { ref_code: 'ASHA', campaign: 'monsoon' });
});
test('accepts campaign as well as utm_campaign', () => {
  assert.equal(L.captureAttribution('?campaign=diwali', mem()).campaign, 'diwali');
});
test('remembers values for later pages in the visit', () => {
  const s = mem(); L.captureAttribution('?ref=asha', s);
  assert.equal(L.captureAttribution('', s).ref_code, 'ASHA');
});
test('a newer value replaces an older one', () => {
  const s = mem(); L.captureAttribution('?ref=asha', s);
  assert.equal(L.captureAttribution('?ref=ravi', s).ref_code, 'RAVI');
});
test('returns nulls when nothing is set and survives a broken store', () => {
  assert.deepEqual(L.captureAttribution('', mem()), { ref_code: null, campaign: null });
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(L.captureAttribution('?ref=a', bad), { ref_code: 'A', campaign: null });
});
test('message names the referrer only when there is one', () => {
  assert.match(L.buildMessage(st({ ref_code: 'ASHA' }), ITEMS, {}, 'Tomorrow'), /Referred by: ASHA/);
  assert.doesNotMatch(L.buildMessage(st(), ITEMS, {}, 'Tomorrow'), /Referred by/);
});
test('lead payload carries ref_code and campaign', () => {
  const p = L.leadPayload(st({ ref_code: 'ASHA', campaign: 'monsoon' }), '2026-10-08');
  assert.equal(p.ref_code, 'ASHA'); assert.equal(p.campaign, 'monsoon');
  assert.equal(L.leadPayload(st(), '2026-10-08').ref_code, null);
});
