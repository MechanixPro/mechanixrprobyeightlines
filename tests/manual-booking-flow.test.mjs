import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { flowPaid, paidManually, confirmPaid } from '../crm/flow-rules.js';
import { buildEntry } from '../admin/ledger-forms.js';
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('a booking made by hand and paid by the desk counts as paid in the flow', () => {
  assert.equal(paidManually({ confirm_fee: null, status: 'paid' }), true);
  assert.equal(paidManually({ confirm_fee: null, status: 'new', paid_amount: 500 }), true);
  assert.equal(paidManually({ confirm_fee: null, status: 'new', paid_amount: 0 }), false);
  assert.equal(paidManually({ confirm_fee: null, status: 'junk', paid_amount: 500 }), false);
  assert.equal(paidManually({ confirm_fee: 99, confirm_paid_at: null, status: 'payment_sent' }), false);   // an online booking waits for its fee
  assert.equal(flowPaid({ confirm_fee: 99, confirm_paid_at: 'x' }), true);
  assert.equal(flowPaid({ confirm_fee: 99, confirm_paid_at: null, status: 'payment_sent' }), false);
  assert.equal(confirmPaid({ confirm_fee: null, status: 'paid' }), false);   // the fee rule itself is unchanged
});
test('the flow card hides the payment link and offers the customer code for desk-paid bookings', () => {
  const f = src('crm/flow-core.js');
  assert.match(f, /const open = !flowPaid\(l\)/);
  assert.match(f, /Make customer code/);
  assert.equal(src('admin/flow-core.js'), f);
});
test('money held by a garage can be recorded on a garage job', () => {
  const ok = buildEntry('payment', { amount: 500, by: 'mechanic', method: 'Cash', on: '2026-11-15' }, { today: '2026-11-15', lead: { id: 'L', garage_id: 'G' } });
  assert.equal(ok.ok, true); assert.equal(ok.entry.collected_by, 'mechanic');
  assert.equal(buildEntry('payment', { amount: 500, by: 'mechanic', method: 'Cash', on: '2026-11-15' }, { today: '2026-11-15', lead: { id: 'L' } }).ok, false);
});
