import test from 'node:test';
import assert from 'node:assert/strict';
import { progressSteps, moneyTriple, progressHtml, moneyHtml, PROGRESS } from '../crm/booking-head.js';

test('seven steps in the approved order', () => {
  assert.deepEqual(PROGRESS.map((p) => p[1]), ['Confirmed', 'Assigned', 'Customer code', 'Quote approved', 'Work', 'Final payment', 'Invoice']);
});
test('nothing known: first step is current, the rest are to do', () => {
  const s = progressSteps({});
  assert.equal(s[0].state, 'current'); assert.ok(s.slice(1).every((x) => x.state === 'todo'));
});
test('paid and assigned: next is Customer code', () => {
  const s = progressSteps({ confirmed: true, assigned: true });
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
});
test('door code verified counts from the started stage onward', () => {
  assert.equal(progressSteps({ confirmed: true, assigned: true, stage: 'on_the_way' })[2].state, 'current');
  assert.equal(progressSteps({ confirmed: true, assigned: true, stage: 'started' })[2].state, 'done');
});
test('final payment needs a known zero balance, not a missing one', () => {
  const base = { confirmed: true, assigned: true, stage: 'returned', quoteStatus: 'approved_self', completed: true, hasInvoice: true };
  assert.equal(progressSteps({ ...base, balance: null })[5].state, 'current');
  assert.equal(progressSteps({ ...base, balance: 0 })[5].state, 'done');
  assert.equal(progressSteps({ ...base, balance: 120 })[5].state, 'current');
});
test('a lost or junk booking shows no current step', () => {
  assert.ok(progressSteps({ confirmed: true, closed: true }).every((x) => x.state !== 'current'));
});
test('money: balance never negative, missing total stays null', () => {
  assert.deepEqual(moneyTriple({ total: 942.82, paid: 49 }), { total: 942.82, paid: 49, balance: 893.82 });
  assert.equal(moneyTriple({ total: 100, paid: 150 }).balance, 0);
  assert.deepEqual(moneyTriple({ paid: 49 }), { total: null, paid: 49, balance: null });
});
test('html: escapes labels, marks current step, shows a dash for unknown money', () => {
  const h = progressHtml(progressSteps({ confirmed: true }));
  assert.match(h, /aria-current="step"/); assert.match(h, /1 of 7 steps done\. Next: Assigned/);
  const m = moneyHtml(moneyTriple({ paid: 49 }));
  assert.match(m, /Invoice total<\/dt><dd class="mx-money3__v">—/); assert.match(m, /₹49/);
  assert.match(moneyHtml(moneyTriple({ total: 500, paid: 500 })), /mx-money3__v--ok/);
});
import { codeCardHtml, partnerCardHtml } from '../crm/booking-head.js';
test('code card shows the state, never a code, and handles unknown state', () => {
  assert.match(codeCardHtml('verified'), /Verified at the door/); assert.match(codeCardHtml('verified'), /--good/);
  assert.match(codeCardHtml('locked'), /Locked after 5 wrong tries/);
  assert.match(codeCardHtml(undefined), /Not loaded yet/); assert.match(codeCardHtml('weird'), /Not loaded yet/);
  assert.doesNotMatch(codeCardHtml('open'), /\d{4}/);
});
test('partner card escapes names and says when nobody is assigned', () => {
  assert.match(partnerCardHtml(null), /Not assigned yet/);
  const h = partnerCardHtml({ name: '<b>X</b>', kind: 'garage', phone: '+91 90000 00001' });
  assert.doesNotMatch(h, /<b>X/); assert.match(h, /Partner garage/); assert.match(h, /90000 00001/);
});
