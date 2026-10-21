import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStatuses, hasPii, validateLog, followUpPresets, timerInfo, telUrl, waUrl, targetPercent, conversion, sourceName, firstMessage, localInputValue } from '../crm/crm-rules.js';

const now = new Date('2026-10-21T10:00:00');
const soon = new Date('2026-10-22T10:00:00').toISOString();

test('an agent can only move a lead forward or to Lost', () => {
  assert.deepEqual(nextStatuses('new', 'sales'), ['contacted', 'quoted', 'payment_sent', 'lost']);
  assert.deepEqual(nextStatuses('quoted', 'sales'), ['payment_sent', 'lost']);
  assert.deepEqual(nextStatuses('paid', 'sales'), []);
});
test('only a supervisor can reopen a lost lead', () => {
  assert.deepEqual(nextStatuses('lost', 'sales'), []);
  assert.ok(nextStatuses('lost', 'supervisor').includes('contacted'));
});
test('Aadhaar, PAN and card numbers are caught, phone numbers are not', () => {
  assert.equal(hasPii('aadhaar 1234 5678 9012'), true);
  assert.equal(hasPii('pan ABCDE1234F'), true);
  assert.equal(hasPii('card 4111-1111-1111-1111'), true);
  assert.equal(hasPii('call +91 98765 43210'), false);
  assert.equal(hasPii('9876543210 wants a brake check'), false);
});
test('an open lead cannot be saved without a follow-up', () => {
  const r = validateLog({ kind: 'call', body: 'spoke', status: 'contacted', current: 'new', now });
  assert.equal(r.ok, false); assert.match(r.error, /follow-up/i);
  assert.equal(validateLog({ kind: 'call', body: 'spoke', status: 'contacted', current: 'new', nextAction: soon, now }).ok, true);
});
test('the follow-up has to be in the future and within 60 days', () => {
  assert.equal(validateLog({ kind: 'call', status: 'contacted', current: 'new', nextAction: '2026-10-20T10:00:00', now }).ok, false);
  assert.equal(validateLog({ kind: 'call', status: 'contacted', current: 'new', nextAction: '2027-03-01T10:00:00', now }).ok, false);
});
test('Lost needs a reason from the list, and Other needs a note', () => {
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', now }).ok, false);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Because', now }).ok, false);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Other', now }).ok, false);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Other', body: 'moved city', now }).ok, true);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Price too high', now }).ok, true);
});
test('a note on its own needs text but no follow-up', () => {
  assert.equal(validateLog({ kind: 'note', body: '', current: 'contacted', now }).ok, false);
  assert.equal(validateLog({ kind: 'note', body: 'prefers evenings', current: 'contacted', now }).ok, true);
});
test('a note with a card number is refused', () => {
  assert.equal(validateLog({ kind: 'note', body: 'card 4111 1111 1111 1111', current: 'new', now }).ok, false);
});
test('the timer chip puts a late first contact first', () => {
  const late = { status: 'new', created_at: '2026-10-21T09:40:00', crm_first_contact_at: null };
  assert.equal(timerInfo(late, now, 15).tone, 'late');
  const fresh = { status: 'new', created_at: '2026-10-21T09:55:00', crm_first_contact_at: null };
  assert.equal(timerInfo(fresh, now, 15).tone, 'new');
  assert.equal(timerInfo({ status: 'contacted', crm_next_action_at: '2026-10-21T09:00:00', crm_first_contact_at: 'x' }, now).tone, 'late');
  assert.equal(timerInfo({ status: 'contacted', crm_next_action_at: soon, crm_first_contact_at: 'x' }, now).tone, 'next');
  assert.equal(timerInfo({ status: 'paid' }, now).tone, 'good');
  assert.equal(timerInfo({ status: 'contacted', crm_first_contact_at: 'x' }, now).label, 'Set a follow-up');
});
test('follow-up presets skip "Today 6 PM" in the evening', () => {
  assert.ok(followUpPresets(new Date('2026-10-21T10:00:00')).some((p) => p.label === 'Today 6 PM'));
  assert.ok(!followUpPresets(new Date('2026-10-21T18:30:00')).some((p) => p.label === 'Today 6 PM'));
});
test('phone links use the last ten digits with +91', () => {
  assert.equal(telUrl('98765 43210'), 'tel:+919876543210');
  assert.equal(waUrl('09876543210', 'Hi there'), 'https://wa.me/919876543210?text=Hi%20there');
});
test('the first message greets by first name and keeps the brand wording', () => {
  const m = firstMessage({ name: 'Ravi Kumar', bike: 'Honda Activa', area: 'HSR Layout' }, 'Asha');
  assert.match(m, /^Hi Ravi,/); assert.match(m, /Asha from Mechanix Pro/); assert.match(m, /Honda Activa/);
});
test('progress and conversion are whole percentages that never pass 100', () => {
  assert.equal(targetPercent(2, 3), 67); assert.equal(targetPercent(5, 3), 100); assert.equal(targetPercent(1, 0), 0);
  assert.equal(conversion(3, 12), 25); assert.equal(conversion(0, 0), 0);
});
test('datetime-local values are written in local time', () => {
  assert.match(localInputValue(new Date(2026, 9, 21, 9, 5)), /^2026-10-21T09:05$/);
});
test('sources get friendly names', () => {
  assert.equal(sourceName('google'), 'Google Ads'); assert.equal(sourceName('instagram'), 'Meta (Instagram)'); assert.equal(sourceName('fb'), 'Meta'); assert.notEqual(sourceName('justdial'), 'JustDial');
  assert.equal(sourceName('walk_in'), 'Walk in'); assert.equal(sourceName('newsletter'), 'Newsletter'); assert.equal(sourceName(''), 'Unknown');
});
