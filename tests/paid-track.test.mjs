import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visitView, trackView, VISIT_KEYS, DOOR_LINE } from '../supabase/functions/_shared/track.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const paid = { confirm_fee: 69, confirm_paid_at: '2026-11-05T10:00:00Z', status: 'paid', mechanic_id: 'm1', preferred_date: '2026-11-06', preferred_slot: 'morning', booking_id: 'MP-26-27-0001', area: 'HSR Layout', pincode: '560102', address: 'Flat 4B, 27th Main', phone: '9876543210', notes: 'a private note about the customer', ref: 'L-ABC234' };
const keyOf = (l, x) => { const v = visitView({ ...paid, ...l }, x); return v.steps.find((s) => s.state === 'current')?.key ?? (v.index === 9 ? 'completed' : null); };
const Q = (status, extra = {}) => ({ status, version: 1, eta_text: 'about 3 hours after the work starts', ...extra });

test('the tracking states in the customer\'s words: Confirmed, Mechanic assigned, On the way, Arrived and verified, Quote sent, Approved, Work started, Ready, Delivered, Completed', () => {
  assert.deepEqual(visitView(paid, {}).steps.map((s) => s.label), ['Confirmed and paid', 'Mechanic assigned', 'On the way', 'Arrived and verified', 'Quote sent', 'Approved', 'Work started', 'Ready', 'Delivered', 'Completed']);
  assert.deepEqual(VISIT_KEYS.length, 10);
});
test('each real state moves the timeline, in order, for a doorstep repair', () => {
  assert.equal(keyOf({ confirm_paid_at: null, status: 'payment_sent' }, {}), 'confirmed');   // not paid: nothing is done yet
  assert.equal(visitView({ ...paid, confirm_paid_at: null, status: 'payment_sent' }, {}).steps.every((s) => s.state !== 'done'), true);
  assert.equal(keyOf({ mechanic_id: null }, {}), 'confirmed');
  assert.equal(keyOf({}, { mechanic: 'Ravi Kumar' }), 'assigned');
  assert.equal(keyOf({ visit_stage: 'on_the_way' }, { mechanic: 'Ravi' }), 'on_the_way');
  assert.equal(keyOf({ visit_stage: 'started' }, { mechanic: 'Ravi', doorVerified: true }), 'verified');
  assert.equal(keyOf({ visit_stage: 'started' }, { mechanic: 'Ravi', quote: Q('sent') }), 'quote_sent');
  assert.equal(keyOf({ visit_stage: 'started' }, { mechanic: 'Ravi', quote: Q('approved') }), 'approved');
  assert.equal(keyOf({ visit_stage: 'repair_doorstep' }, { mechanic: 'Ravi', quote: Q('approved') }), 'work');
  assert.equal(keyOf({ visit_stage: 'ready' }, { mechanic: 'Ravi', quote: Q('approved') }), 'ready');
  assert.equal(keyOf({ visit_stage: 'returned' }, { mechanic: 'Ravi', quote: Q('approved') }), 'delivered');
  assert.equal(keyOf({ visit_stage: 'returned', status: 'completed' }, { mechanic: 'Ravi', quote: Q('approved') }), 'completed');
});
test('a pickup says Picked up, a car says car, a revised or declined quote says so', () => {
  const v = visitView({ ...paid, visit_stage: 'picked_up', job_place: 'garage' }, { mechanic: 'Ravi', vehicle: 'car', quote: Q('approved') });
  assert.equal(v.steps[6].label, 'Picked up'); assert.match(v.note, /Your car was picked up/);
  assert.equal(visitView({ ...paid, visit_stage: 'started' }, { mechanic: 'R', quote: { ...Q('sent'), version: 2 } }).steps[4].label, 'Revised quote sent');
  const d = visitView({ ...paid, visit_stage: 'started' }, { mechanic: 'R', quote: Q('declined') }); assert.equal(d.steps[4].label, 'Quote declined'); assert.match(d.note, /declined/); assert.equal(d.eta, null);
  assert.equal(visitView({ ...paid, visit_stage: 'started' }, { mechanic: 'R', quote: Q('approved') }).eta, 'about 3 hours after the work starts');
});
test('every state has a "what happens next" line, and a closed booking has none', () => {
  for (const [l, x] of [[{ mechanic_id: null }, {}], [{}, { mechanic: 'Ravi' }], [{ visit_stage: 'arrived' }, { mechanic: 'Ravi' }], [{ visit_stage: 'started' }, { mechanic: 'Ravi', quote: Q('sent') }], [{ visit_stage: 'ready' }, { mechanic: 'Ravi', quote: Q('approved') }]]) assert.ok(visitView({ ...paid, ...l }, x).next.length > 10);
  const c = visitView({ ...paid, status: 'lost' }, {}); assert.equal(c.closed, true); assert.equal(c.next, null);
});
test('no personal data leaks without the secret link: no phone, no street address, no notes, no code, no quote lines; the mechanic shows by first name only', () => {
  const x = { mechanic: 'Ravi Kumar', certified: true, vehicle: 'bike', doorVerified: false, quote: Q('sent', { lines: [{ kind: 'parts', name: 'Pad', amount: 400 }], total: 472 }) };
  const open = JSON.stringify(trackView({ ...paid, visit_stage: 'arrived' }, x));
  for (const bad of ['9876543210', 'Flat 4B', 'private note', 'L-ABC234', 'Kumar', 'Pad', '"door_code":"', 'address":"']) assert.ok(!open.includes(bad), 'public view leaked ' + bad);
  assert.match(open, /"mechanic":"Ravi"/);
  const withLink = trackView({ ...paid, visit_stage: 'arrived' }, { ...x, secret: { code: '4821', address: 'Flat 4B, 27th Main, HSR Layout, 560102' } });
  assert.equal(withLink.door_code, '4821'); assert.equal(withLink.door_line, DOOR_LINE); assert.equal(withLink.address, 'Flat 4B, 27th Main, HSR Layout, 560102'); assert.equal(withLink.quote.lines.length, 1); assert.equal(withLink.quote.can_decide, true);
  const s = JSON.stringify(withLink); for (const bad of ['9876543210', 'private note', 'L-ABC234', 'Kumar']) assert.ok(!s.includes(bad), 'link view leaked ' + bad);
  assert.equal(trackView({ ...paid, visit_stage: 'started' }, { ...x, doorVerified: true, secret: { code: '4821' } }).door_code, null);   // the code is gone once it has been used
  assert.equal(trackView({ ...paid, status: 'completed' }, { ...x, secret: { code: '4821' } }).door_code, null);
  assert.equal(trackView({ ...paid, confirm_paid_at: null, status: 'payment_sent' }, { ...x, secret: { code: '4821' } }).door_code, null);   // no code before payment
});
test('old leads (no confirmation fee) track exactly as before', () => {
  const v = trackView({ status: 'scheduled', preferred_date: '2026-10-10', preferred_slot: 'morning', booking_id: 'MP-26-27-0009' }, { mechanic: 'Ravi Kumar', certified: true });
  assert.equal(v.stage, 3); assert.equal(v.visit, undefined); assert.equal(v.mechanic, 'Ravi'); assert.deepEqual(v.stages, ['Request received', 'Quote shared', 'Slot confirmed', 'Mechanic booked', 'Service done']);
});
test('track-booking takes the secret token as well as the reference and number, with the same message for a wrong one', () => {
  const f = read('supabase/functions/track-booking/index.ts');
  assert.match(f, /\[0-9a-f\]\{32\}/); assert.match(f, /from\('booking_secrets'\)/); assert.match(f, /track_attempts/); assert.match(f, /429/);
  assert.equal((f.match(/This link is not valid\./g) || []).length >= 2, true); assert.match(f, /NOT_FOUND/);
  const js = read('assets/js/track.js'); assert.match(js, /\[0-9a-f\]\{32\}/); assert.match(js, /quote-decision/); assert.match(js, /setTimeout\(function \(\) \{ if \(!doc\.hidden\)/);   // follows the mechanic only while the page is visible
  assert.doesNotMatch(read('track/index.html'), /<script(?![^>]*\bsrc=)[^>]*>[^<]/);
});
test('the customer\'s Approve and Decline are recorded once, with the time, and the team hears about it', () => {
  const f = read('supabase/functions/quote-decision/index.ts'), sql = read('supabase/migrations/20261228000000_paid_confirmation.sql');
  assert.match(f, /rpc\('quote_decide'/); assert.match(f, /notifyTeamDecision/); assert.match(f, /if \(!data\.already\)/);
  assert.match(sql, /'already', true/); assert.match(sql, /decided_at = now\(\), decided_via = 'link'/); assert.match(sql, /grant execute on function public\.quote_decide\(text, int, text, text\) to service_role/);
});
