'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/adref.js');

const DAY = 864e5;
test('a short ref code uses only letters and digits that cannot be misread', () => {
  for (let i = 0; i < 200; i++) assert.match(A.newCode(), /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(A.newCode(() => 0), 'AAAAA');
});
test('only ad visitors get a ref code', () => {
  assert.equal(A.isAd({ gclid: 'abc' }), true);
  assert.equal(A.isAd({ utm_source: 'google', utm_medium: 'cpc' }), true);
  assert.equal(A.isAd({ utm_source: 'direct' }), false);
  assert.equal(A.isAd({}), false);
});
test('the ad click is remembered for 30 days, and this visit wins over an older one', () => {
  const now = 1_000_000_000_000;
  const local = JSON.stringify({ t: now - 10 * DAY, v: { gclid: 'old', utm_campaign: 'bike-service' } });
  assert.deepEqual(A.readCtx('{}', local, now), { gclid: 'old', utm_campaign: 'bike-service' });
  assert.deepEqual(A.readCtx(JSON.stringify({ gclid: 'new' }), local, now), { gclid: 'new', utm_campaign: 'bike-service' });
  assert.deepEqual(A.readCtx('{}', JSON.stringify({ t: now - 31 * DAY, v: { gclid: 'stale' } }), now), {});
  assert.deepEqual(A.readCtx('not json', 'nope', now), {});
});
test('the ref is added once to the end of the WhatsApp text', () => {
  assert.equal(A.tagText('Hi Mechanix Pro, I need a service.', 'K7P2M'), 'Hi Mechanix Pro, I need a service.\n\nRef: K7P2M');
  assert.equal(A.tagText('Hi\nRef: K7P2M', 'K7P2M'), 'Hi\nRef: K7P2M');
  assert.equal(A.tagText('Hi', ''), 'Hi');
});
test('a wa.me link keeps its number and gets the ref inside the encoded text', () => {
  const url = 'https://wa.me/919876543210?text=' + encodeURIComponent('Hi, need a service\nArea: ');
  const out = A.tagWaUrl(url, 'K7P2M');
  assert.match(out, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.equal(decodeURIComponent(out.split('text=')[1]), 'Hi, need a service\nArea:\n\nRef: K7P2M');
  assert.equal(A.tagWaUrl('https://example.com/x', 'K7P2M'), 'https://example.com/x');
  assert.equal(A.tagWaUrl('https://wa.me/919876543210', 'K7P2M'), 'https://wa.me/919876543210?text=' + encodeURIComponent('Ref: K7P2M'));
});
test('the payload sent to the server keeps only known ad fields, trimmed', () => {
  const p = A.clickPayload('k7p2m', { gclid: 'g'.repeat(300), utm_source: 'google', junk: 'x', utm_term: 'bike\u0000 service' }, '/offers/bike-service/');
  assert.equal(p.code, 'K7P2M'); assert.equal(p.utm.gclid.length, 100); assert.equal(p.utm.junk, undefined); assert.equal(p.utm.utm_term, 'bike service'); assert.equal(p.page, '/offers/bike-service/');
});
