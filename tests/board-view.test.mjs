import test from 'node:test';
import assert from 'node:assert/strict';
import { boardHtml, boardRow, BOARD_CAP } from '../admin/board-view.js';
import { paidInfo, paidNeedsMechanic } from '../admin/board.js';

const mechanics = [{ id: 'm1', name: '[Mechanic Name]', active: true }];
const L = (i, o = {}) => ({ id: 'l' + i, name: 'Customer ' + i, phone: '9000000' + String(i).padStart(3, '0'), status: 'contacted', service_id: 's1', est_total: 599, area: 'HSR Layout', preferred_slot: 'morning', mechanic_id: null, created_at: '2026-11-05T05:00:00Z', ...o });
const svcName = () => 'Basic service';
const many = (n, o) => Array.from({ length: n }, (_, i) => L(i + 1, o));

test('a row is two lines plus one row of actions: name, service, price, area and slot, ONE stage chip, mechanic select, Call, WhatsApp, Open and the next step', () => {
  const h = boardRow(L(1, { mechanic_id: 'm1' }), { mechanics, garages: [{ id: 'g1', name: '[Garage Name]', code: 'GR-1' }], svcName });
  assert.match(h, /class="b1"/); assert.match(h, /class="b2"/); assert.match(h, /class="bbtns"/);   // line 1, line 2, then select and one row of buttons
  assert.match(h, /Customer 1/); assert.match(h, /Basic service/); assert.match(h, /₹599/); assert.match(h, /HSR Layout · Morning · Basic service/);
  assert.equal((h.match(/bstage/g) || []).length, 1, 'one stage chip, not a stepper');
  assert.doesNotMatch(h, /class="step|stepper/);
  assert.match(h, /<select class="bsel" data-board-garage="l1"/); assert.match(h, /\[Garage Name\]/); assert.doesNotMatch(h, /data-board-mech/);
  for (const s of ['>Call<', '>WhatsApp<', '>Open<', 'data-act="boardNext"', '>Mark quoted<']) assert.ok(h.includes(s), s);
});
test('a booking without a name shows (no name)', () => assert.match(boardRow(L(1, { name: '  ' }), { mechanics, svcName }), /\(no name\)/));
test('the select keeps the assigned garage selected', () => assert.match(boardRow(L(1, { garage_id: 'g1', garage_name: 'G' }), { mechanics, garages: [{ id: 'g1', name: 'G' }], svcName }), /<option value="g1" selected>/));
test('each column shows its count, and a long column is capped at 20 with a Show more row', () => {
  const g = { needsReply: many(3, { status: 'new' }), quotePay: many(49), visits: [], done: many(1, { status: 'completed' }) };
  const h = boardHtml(g, { mechanics, svcName });
  assert.equal(BOARD_CAP, 20);
  assert.match(h, /Quote and payment <span class="count">49<\/span>/); assert.match(h, /Needs a reply <span class="count">3<\/span>/); assert.match(h, /Today(?:'|&#39;)s visits <span class="count">0<\/span>/);
  assert.equal((h.match(/class="brow/g) || []).length, 3 + 20 + 1);
  assert.match(h, /Show more \(29\)/);
  assert.doesNotMatch(boardHtml({ needsReply: many(20), quotePay: [], visits: [], done: [] }, { mechanics, svcName }), /Show more/);
  assert.equal((boardHtml(g, { mechanics, svcName, shown: { quotePay: 40 } }).match(/class="brow/g) || []).length, 3 + 40 + 1);
});
test('four tabs with counts feed the phone view, and only the active group is marked on', () => {
  const h = boardHtml({ needsReply: many(2, { status: 'new' }), quotePay: [], visits: [], done: [] }, { mechanics, svcName, active: 'needsReply' });
  assert.equal((h.match(/data-btab=/g) || []).length, 4); assert.match(h, /data-btab="needsReply" aria-selected="true"/);
  assert.equal((h.match(/class="bgroup on"/g) || []).length, 1);
});
test('paid and unassigned bookings are pinned under their own heading, left out of the columns, and carry the green PAID badge', () => {
  const paid = L(7, { status: 'paid', paid_amount: 49, confirm_paid_at: '2026-11-05T06:00:00Z', confirm_fee: 49, preferred_date: '2026-11-06' });
  const assigned = L(8, { status: 'paid', paid_amount: 49, mechanic_id: 'm1' });
  assert.deepEqual(paidNeedsMechanic([paid, assigned, L(9)]).map((l) => l.id), ['l7']);
  const h = boardHtml({ needsReply: [], quotePay: [], visits: [paid, assigned], done: [] }, { pinned: paidNeedsMechanic([paid, assigned]), mechanics, svcName, active: 'pin' });
  assert.match(h, /Paid, needs a garage <span class="count count-paid">1<\/span>/); assert.match(h, /PAID ₹49/);
  assert.equal((h.match(/data-row="l7"/g) || []).length, 1, 'never shown twice');
  assert.match(h, /class="brow is-paid needs-mech" data-row="l7"/); assert.match(h, /class="brow is-paid" data-row="l8"/);
  assert.ok(h.indexOf('bpin') < h.indexOf('bgrid'), 'pinned first');
});
test('paidInfo: paid needs a received amount; completed, lost and assigned bookings never "need a mechanic"', () => {
  assert.equal(paidInfo(L(1)).paid, false);
  assert.deepEqual(paidInfo(L(1, { paid_amount: 49, status: 'paid' })), { paid: true, amount: 49, open: true, needsMechanic: true });
  assert.equal(paidInfo(L(1, { paid_amount: 899, status: 'completed' })).needsMechanic, false);
  assert.equal(paidInfo(L(1, { confirm_fee: 49 })).paid, false, 'a fee that was not paid is not paid');
});
