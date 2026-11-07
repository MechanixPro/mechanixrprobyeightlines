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
// Changed for the compact board: the row markup moved from admin.js (boardCard) to admin/board-view.js, and the controls are 32px on a mouse and 44px on touch.
test('each row has WhatsApp, Call, a mechanic menu, the next step and Open, and the actions are logged', () => {
  const a = read('admin/admin.js'), v = read('admin/board-view.js');
  // Release A (desk shell): the board is five stage cards, so admin.js now calls stageGroups and stageBoardHtml; boardGroups and boardHtml stay in the modules and are still tested below.
  for (const s of ['function board()', 'stageGroups', 'stageBoardHtml(', 'boardMech', "audit('board_step'", "audit('board_mechanic'"]) assert.ok(a.includes(s), s);
  for (const s of ['data-act="boardNext"', 'data-board-mech', 'wa.me/91', 'tel:+91', 'data-lead="${esc(l.id)}"']) assert.ok(v.includes(s), s);
});
test('the board works on a phone: one group at a time, and every control is 44px on touch', () => {
  const c = read('admin/admin.css');
  assert.match(c, /\.brow/); assert.match(c, /\.bgroup/); assert.match(c, /\.btabs/); assert.match(c, /pointer:coarse[^}]*min-height:var\(--tap\)/);
});

// Release A: five stage cards (New, Quoted, Paid, On the way, Done). One booking appears in one column; paid with no mechanic comes first.
import { stageGroups } from '../admin/board.js';
import { stageBoardHtml, STAGE_COLS } from '../admin/board-view.js';
test('stage cards: New, Quoted, Paid, On the way, Done, each booking once, paid with no mechanic first', () => {
  const now = Date.parse('2026-11-07T06:00:00Z'), iso = (m) => new Date(now - m * 60000).toISOString();
  const L = [
    { id: 'n', status: 'new', created_at: iso(5) }, { id: 'old', status: 'new', created_at: iso(60 * 24 * 10) },
    { id: 'q', status: 'quoted', created_at: iso(300) }, { id: 'pl', status: 'payment_sent', created_at: iso(300) },
    { id: 'p1', status: 'paid', created_at: iso(300), confirm_paid_at: 'x', confirm_fee: 49, mechanic_id: 'm1', preferred_slot: 'morning' },
    { id: 'p2', status: 'paid', created_at: iso(300), confirm_paid_at: 'x', confirm_fee: 49, preferred_slot: 'evening' },
    { id: 'w', status: 'paid', created_at: iso(300), confirm_paid_at: 'x', confirm_fee: 49, mechanic_id: 'm1' },
    { id: 'd', status: 'completed', created_at: iso(900), completed_at: iso(10) }, { id: 'gone', status: 'new', created_at: iso(5), deleted_at: iso(1) },
  ];
  const g = stageGroups(L, { now, onWay: new Set(['w']) });
  assert.deepEqual(g.new.map((l) => l.id), ['n']); assert.deepEqual(g.quoted.map((l) => l.id).sort(), ['pl', 'q']);
  assert.deepEqual(g.paid.map((l) => l.id), ['p2', 'p1']); assert.deepEqual(g.onway.map((l) => l.id), ['w']); assert.deepEqual(g.done.map((l) => l.id), ['d']);
  assert.deepEqual(STAGE_COLS.map((c) => c[1]), ['New', 'Quoted', 'Paid', 'On the way', 'Done']);
  const h = stageBoardHtml(g, { svcName: (x) => x });
  assert.match(h, /PAID ₹49/); assert.match(h, /data-btab="onway"/); assert.equal((h.match(/data-row="/g) || []).length, 7);
});
test('on the way is empty and says so when the live status could not be loaded', () => {
  assert.match(stageBoardHtml({}, { svcName: (x) => x, onWayKnown: false }), /Live status could not be loaded/);
});
