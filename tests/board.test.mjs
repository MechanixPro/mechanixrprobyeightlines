import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardGroups, nextStep } from '../admin/board.js';
import { GROUPS, tabsOf } from '../admin/nav.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const NOW = new Date('2026-10-12T06:00:00.000Z').getTime(); // 11:30 AM in India
const L = (o) => ({ id: o.ref, name: 'A', phone: '9876543210', created_at: '2026-10-12T04:00:00.000Z', ...o });
const leads = [
  L({ ref: 'N1', status: 'new', created_at: '2026-10-12T04:30:00.000Z' }),            // waiting 90 min
  L({ ref: 'N2', status: 'new', created_at: '2026-10-12T05:50:00.000Z' }),            // only 10 min: not late yet
  L({ ref: 'C1', status: 'contacted' }), L({ ref: 'Q1', status: 'quoted' }), L({ ref: 'P1', status: 'payment_sent' }),
  L({ ref: 'S2', status: 'scheduled', preferred_date: '2026-10-12', preferred_slot: 'evening' }),
  L({ ref: 'S1', status: 'paid', preferred_date: '2026-10-12', preferred_slot: 'morning' }),
  L({ ref: 'S3', status: 'scheduled', preferred_date: '2026-10-13', preferred_slot: 'morning' }),
  L({ ref: 'D1', status: 'completed', completed_at: '2026-10-12T03:00:00.000Z' }),   // done today (IST)
  L({ ref: 'D2', status: 'completed', completed_at: '2026-10-10T03:00:00.000Z' }),
  L({ ref: 'X1', status: 'lost' }),
];
const g = boardGroups(leads, { now: NOW });

test('the board has four groups and puts each booking in the right one', () => {
  assert.deepEqual(g.needsReply.map((l) => l.ref), ['N1']);
  assert.deepEqual(g.quotePay.map((l) => l.ref).sort(), ['C1', 'P1', 'Q1']);
  assert.deepEqual(g.visits.map((l) => l.ref), ['S1', 'S2']);
  assert.deepEqual(g.done.map((l) => l.ref), ['D1']);
});
test('visits are in time order, and lost, later and older bookings stay off the board', () => {
  const all = Object.values(g).flat().map((l) => l.ref);
  for (const off of ['X1', 'S3', 'D2', 'N2']) assert.ok(!all.includes(off), off);
});
test('the next step moves a booking forward one honest step at a time', () => {
  assert.deepEqual(nextStep('new'), { label: 'Mark contacted', to: 'contacted' });
  assert.deepEqual(nextStep('contacted'), { label: 'Mark quoted', to: 'quoted' });
  assert.deepEqual(nextStep('paid'), { label: 'Confirm visit', to: 'scheduled' });
  assert.deepEqual(nextStep('scheduled'), { label: 'Mark done', to: 'completed' });
  for (const s of ['quoted', 'payment_sent', 'completed', 'lost', 'nonsense']) assert.equal(nextStep(s), null, s);
});
test('the Today board is the first page in the Bookings section, and the markup has its button', () => {
  assert.equal(tabsOf('bookings')[0][0], 'board');
  assert.match(read('admin/index.html'), /data-tab="board"/);
});
test('each card has WhatsApp, Call, a mechanic menu, the next step and Open, and the actions are logged', () => {
  const a = read('admin/admin.js');
  for (const s of ['function board()', 'boardGroups', 'data-act="boardNext"', 'id="bm-', 'boardMech', "audit('board_step'", "audit('board_mechanic'", 'data-lead="${l.id}"']) assert.ok(a.includes(s), s);
});
test('the board works on a phone: cards stack and every control is 44px', () => {
  const c = read('admin/admin.css');
  assert.match(c, /\.bcard/); assert.match(c, /\.bgroup/); assert.match(c, /min-height:44px/);
});
