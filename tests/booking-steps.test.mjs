import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingStep, nextAction, stepGuard, STEPS, LOST_REASONS, lostReasonCheck, validateLog, nextStatuses } from '../crm/crm-rules.js';
import * as admin from '../admin/booking-steps.js';

const L = (o) => ({ status: 'new', crm_owner: 'u1', booking_id: null, crm_first_contact_at: null, ...o });
const keyOf = (l) => bookingStep(l).key;

test('the six steps are in the order the desk shows them', () => {
  assert.deepEqual(STEPS.map(([, t]) => t), ['Lead', 'Called', 'Quote sent', 'Confirmed', 'Scheduled', 'Done']);
});
test('the step is worked out from status, first contact and booking ID: no new status values', () => {
  assert.equal(keyOf(L({})), 'lead');
  assert.equal(keyOf(L({ crm_first_contact_at: '2026-11-05T05:00:00Z' })), 'called');   // a call was logged, status still new
  assert.equal(keyOf(L({ status: 'contacted' })), 'called');
  assert.equal(keyOf(L({ status: 'quoted' })), 'quote');
  assert.equal(keyOf(L({ status: 'payment_sent' })), 'quote');
  assert.equal(keyOf(L({ status: 'quoted', booking_id: 'MP-26-26-0001' })), 'confirmed');   // the ID makes it confirmed
  assert.equal(keyOf(L({ status: 'paid', booking_id: 'MP-26-26-0001' })), 'confirmed');
  assert.equal(keyOf(L({ status: 'paid' })), 'confirmed');
  assert.equal(keyOf(L({ status: 'scheduled', booking_id: 'MP-26-26-0001' })), 'scheduled');
  assert.equal(keyOf(L({ status: 'completed', booking_id: 'MP-26-26-0001' })), 'done');
  assert.equal(bookingStep(L({ status: 'completed' })).steps.every((s) => s.state === 'done'), true);
  assert.equal(bookingStep(L({ booking_id: '   ' })).key, 'lead');   // a blank ID is not an ID
  assert.equal(bookingStep(null).key, 'lead');
});
test('the private L- ref is not a booking ID', () => {
  assert.equal(keyOf(L({ ref: 'L-ABC234' })), 'lead');
});
test('a step bar marks done, current and todo steps; lost and junk keep the step they reached, marked stopped', () => {
  const s = bookingStep(L({ status: 'quoted' })).steps.map((x) => x.state);
  assert.deepEqual(s, ['done', 'done', 'current', 'todo', 'todo', 'todo']);
  const lost = bookingStep(L({ status: 'lost', crm_first_contact_at: 'x' }));
  assert.equal(lost.closed, 'lost'); assert.deepEqual(lost.steps.map((x) => x.state), ['done', 'stopped', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(bookingStep(L({ status: 'junk' })).closed, 'junk');
  assert.equal(bookingStep(L({ status: 'lost' })).next, null);
});

test('the next action follows the step: Call now, Send quote, Confirm booking, Schedule, Mark done', () => {
  const me = { canCreate: true, userId: 'u1', boss: false };
  assert.equal(nextAction(L({}), 'agent', me).label, 'Call now');
  assert.equal(nextAction(L({ status: 'contacted' }), 'agent', me).label, 'Send quote');
  assert.equal(nextAction(L({ status: 'quoted' }), 'agent', me).label, 'Confirm booking');
  assert.equal(nextAction(L({ status: 'quoted', booking_id: 'MP-1' }), 'agent', me).label, 'Schedule');
  assert.equal(nextAction(L({ status: 'scheduled', booking_id: 'MP-1' }), 'admin', me).label, 'Mark done');
});
test('there is no next action on a done, lost or junk lead', () => {
  for (const status of ['completed', 'lost', 'junk']) assert.equal(nextAction(L({ status, booking_id: 'MP-1' }), 'admin'), null);
});
test('an agent takes an unowned lead before anything else; a supervisor can call it straight away', () => {
  assert.equal(nextAction(L({ crm_owner: null }), 'agent').key, 'take');
  assert.equal(nextAction(L({ crm_owner: null }), 'supervisor').key, 'call');
});
test('Confirm booking shows but is not allowed for someone who cannot create bookings; Mark done is admin only', () => {
  const a = nextAction(L({ status: 'quoted' }), 'agent', { canCreate: false, userId: 'u1', boss: false });
  assert.equal(a.allowed, false); assert.match(a.reason, /supervisor/);
  const d = nextAction(L({ status: 'scheduled', booking_id: 'MP-1' }), 'supervisor');
  assert.equal(d.allowed, false); assert.match(d.reason, /admin/i);
});

test('illegal jumps are refused with a clear message', () => {
  const g = (l, t) => stepGuard(l, t);
  assert.match(g(L({ status: 'quoted' }), 'schedule').error, /Confirm the booking first/);
  assert.match(g(L({}), 'schedule').error, /booking ID/);
  assert.match(g(L({ status: 'lost' }), 'confirm').error, /lost/);
  assert.match(g(L({ status: 'junk' }), 'confirm').error, /junk/);
  assert.match(g(L({ status: 'quoted', booking_id: 'MP-1' }), 'done').error, /Schedule the job/);
  assert.match(g(L({}), 'done').error, /before marking it done/);
  assert.match(g(L({ status: 'paid', booking_id: 'MP-1' }), 'lost').error, /booked job/);
  assert.match(g(L({ status: 'scheduled', booking_id: 'MP-1' }), 'quote').error, /past the quote/);
  assert.match(g(L({ status: 'paid', booking_id: 'MP-1' }), 'confirm').error, /already confirmed/);
});
test('legal moves pass', () => {
  assert.equal(stepGuard(L({ status: 'quoted' }), 'confirm').ok, true);
  assert.equal(stepGuard(L({ status: 'quoted', booking_id: 'MP-1' }), 'schedule').ok, true);
  assert.equal(stepGuard(L({ status: 'scheduled', booking_id: 'MP-1' }), 'done').ok, true);
  assert.equal(stepGuard(L({ status: 'contacted' }), 'quote').ok, true);
  assert.equal(stepGuard(L({ status: 'contacted' }), 'lost').ok, true);
});
test('the step rules do not change the status rules the database enforces', () => {
  assert.deepEqual(nextStatuses('new', 'sales'), ['contacted', 'quoted', 'payment_sent', 'lost']);
  assert.deepEqual(nextStatuses('scheduled', 'sales'), []);
  assert.deepEqual(nextStatuses('junk', 'supervisor'), []);
});

test('lost needs a reason from the fixed list; Other needs a note of 5 characters', () => {
  assert.deepEqual(LOST_REASONS, ['Price too high', 'No answer (after 3 tries)', 'Wrong area', 'Bought elsewhere', 'Not now / later', 'Not a real enquiry', 'Other']);
  assert.equal(lostReasonCheck('', 'x').ok, false);
  assert.equal(lostReasonCheck(undefined, 'a long note').ok, false);
  assert.equal(lostReasonCheck('Because', 'a long note').ok, false);
  assert.equal(lostReasonCheck('No answer', '').ok, false);   // the old wording is no longer offered
  assert.equal(lostReasonCheck('Other', '').ok, false);
  assert.equal(lostReasonCheck('Other', 'abcd').ok, false);
  assert.equal(lostReasonCheck('Other', '  abcd  ').ok, false);   // spaces do not count
  assert.equal(lostReasonCheck('Other', 'abcde').ok, true);
  for (const r of LOST_REASONS.filter((x) => x !== 'Other')) assert.equal(lostReasonCheck(r, '').ok, true, r);
});
test('saving a lead as lost without a reason is refused by the log check', () => {
  const now = new Date('2026-11-05T10:00:00');
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', now }).ok, false);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Other', body: 'hi', now }).ok, false);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Other', body: 'moved to Pune', now }).ok, true);
  assert.equal(validateLog({ kind: 'status', status: 'lost', current: 'new', lostReason: 'Wrong area', now }).ok, true);
});

test('the admin copy gives the same steps, next action, guards and lost rules as the desk', () => {
  const statuses = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed', 'lost', 'junk'];
  for (const status of statuses) for (const booking_id of [null, 'MP-26-26-0001']) for (const crm_first_contact_at of [null, '2026-11-05T05:00:00Z']) {
    const l = L({ status, booking_id, crm_first_contact_at });
    assert.deepEqual(admin.bookingStep(l), bookingStep(l), JSON.stringify(l));
    const a = nextAction(l, 'admin'), b = admin.nextAction(l);
    assert.equal(a && a.key, b && b.key); assert.equal(a && a.label, b && b.label);
    for (const t of ['call', 'quote', 'confirm', 'schedule', 'done', 'lost']) assert.equal(admin.stepGuard(l, t).ok, stepGuard(l, t).ok, JSON.stringify(l) + t);
  }
  assert.deepEqual(admin.LOST_REASONS, LOST_REASONS);
  for (const [r, n] of [['', ''], ['Other', 'abcd'], ['Other', 'abcde'], ['Price too high', ''], ['No answer', '']]) assert.equal(admin.lostReasonCheck(r, n).ok, lostReasonCheck(r, n).ok);
});
