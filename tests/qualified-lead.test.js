// Only a complete, serviceable booking request counts as a Google Ads Lead. Casual taps are tracked, but kept out of bidding.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const L = require('../assets/js/logic.js');
const PINS = { '560102': 'HSR Layout', '560034': 'Koramangala' };
const base = (o) => ({ name: 'Asha Rao', phone: '9876543210', service: 'general', area: 'HSR Layout', pin: '560102', place: 'home', dateIso: '2026-10-12', hour: 10, ...o });
const q = (st, off) => L.leadQuality(st, PINS, off || {});

test('a complete request in a served PIN is a qualified lead', () => {
  assert.deepEqual(q(base()), { qualified: true, reason: 'ok' });
});
test('a request with no PIN but a real Bengaluru area still qualifies, because the PIN is optional on the form', () => {
  assert.equal(q(base({ pin: '' })).qualified, true);
});
test('a PIN we do not serve, or have paused in the admin, does not qualify', () => {
  assert.deepEqual(q(base({ pin: '600001' })), { qualified: false, reason: 'pin_not_served' });
  assert.deepEqual(q(base(), { '560102': true }), { qualified: false, reason: 'pin_not_served' });
});
test('an area outside Bengaluru does not qualify', () => {
  assert.deepEqual(q(base({ area: 'Other area', pin: '' })), { qualified: false, reason: 'outside_area' });
});
test('a missing name, a bad number, no service or no day and time is not a qualified lead', () => {
  assert.equal(q(base({ name: 'A' })).reason, 'incomplete'); assert.equal(q(base({ phone: '12345' })).reason, 'incomplete');
  assert.equal(q(base({ service: '' })).reason, 'incomplete'); assert.equal(q(base({ dateIso: '' })).reason, 'incomplete'); assert.equal(q(base({ hour: null })).reason, 'incomplete');
});
test('a roadside request needs no day and time', () => {
  assert.equal(q(base({ place: 'road', dateIso: '', hour: null })).qualified, true);
});
test('the booking form sends generate_lead only for a qualified request, and keeps casual taps out of bidding', () => {
  const a = read('assets/js/app.js');
  assert.match(a, /L\.leadQuality\(/); assert.match(a, /q\.qualified \? 'generate_lead' : 'lead_unqualified'/);
  assert.doesNotMatch(a, /track\('generate_lead', \{ service: st\.service, method: 'draft' \}\)/); assert.match(a, /track\('lead_draft'/);
  assert.doesNotMatch(a, /track\('generate_lead', \{ service: st\.service, method: 'callback' \}\)/); assert.match(a, /track\('lead_callback'/);
  assert.doesNotMatch(a, /track\('generate_lead', \{ service: 'sos' \}\)/); assert.match(a, /track\('lead_sos'/);
  assert.equal((a.match(/track\('generate_lead'/g) || []).length, 0); // only the conditional form remains
});
test('the Ads conversion and Meta Lead still fire only for generate_lead', () => {
  const t = read('assets/js/tags.js');
  assert.match(t, /name === 'generate_lead' && C\.googleAdsSendTo/); assert.match(t, /if \(name === 'generate_lead'\) window\.fbq\('track', 'Lead'/);
});
