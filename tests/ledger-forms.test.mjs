import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry } from '../admin/ledger-forms.js';

const today = '2026-10-12', lead = { id: 'L1', mechanic_id: 'M1' };
const ctx = { today, lead, collectedBy: { company_manual: 500, company_portal: 0, mechanic: 300 }, outstanding: 380 };

test('a payment needs a positive amount, a collector and a date that is not in the future', () => {
  assert.equal(buildEntry('payment', { amount: '', by: 'company_manual', on: today }, ctx).ok, false);
  assert.equal(buildEntry('payment', { amount: '-5', by: 'company_manual', on: today }, ctx).ok, false);
  assert.equal(buildEntry('payment', { amount: '100', by: 'nobody', on: today }, ctx).ok, false);
  assert.match(buildEntry('payment', { amount: '100', by: 'mechanic', on: '2026-10-13' }, ctx).error, /future/i);
  const r = buildEntry('payment', { amount: '100.5', by: 'mechanic', method: 'UPI', reference: ' abc ', on: today }, ctx);
  assert.deepEqual([r.ok, r.entry.entry_type, r.entry.amount, r.entry.collected_by, r.entry.reference, r.entry.lead_id, r.entry.mechanic_id, r.entry.occurred_on], [true, 'customer_payment', 100.5, 'mechanic', 'abc', 'L1', 'M1', today]);
});
test('a payment taken by a mechanic needs the job to have a mechanic', () => {
  assert.equal(buildEntry('payment', { amount: '100', by: 'mechanic', on: today }, { ...ctx, lead: { id: 'L1' } }).ok, false);
});
test('a refund cannot be more than what that collector holds, and needs a reason', () => {
  assert.equal(buildEntry('refund', { amount: '600', by: 'company_manual', reason: 'Job cancelled', on: today }, ctx).ok, false);
  assert.equal(buildEntry('refund', { amount: '100', by: 'company_manual', reason: '', on: today }, ctx).ok, false);
  const r = buildEntry('refund', { amount: '100', by: 'company_manual', reason: 'Job cancelled', on: today }, ctx);
  assert.deepEqual([r.ok, r.entry.entry_type, r.entry.amount, r.entry.reason], [true, 'refund', 100, 'Job cancelled']);
});
test('a write-off needs a reason and cannot be more than the balance', () => {
  assert.equal(buildEntry('write_off', { amount: '100', reason: '' }, ctx).ok, false);
  assert.equal(buildEntry('write_off', { amount: '400', reason: 'Goodwill' }, ctx).ok, false);
  const r = buildEntry('write_off', { amount: '380', reason: 'Goodwill' }, ctx);
  assert.deepEqual([r.ok, r.entry.entry_type, r.entry.collected_by], [true, 'write_off', undefined]);
});
test('remittance and payout belong to a mechanic and may name a job', () => {
  assert.equal(buildEntry('remittance', { amount: '100', mechanic: '' , on: today}, { today }).ok, false);
  const r = buildEntry('remittance', { amount: '780', mechanic: 'M1', method: 'UPI', reference: 'u1', on: today }, { today });
  assert.deepEqual([r.ok, r.entry.entry_type, r.entry.mechanic_id, r.entry.lead_id ?? null, r.entry.amount], [true, 'remittance', 'M1', null, 780]);
  const p = buildEntry('payout', { amount: '400', mechanic: 'M1', on: today }, { today, lead });
  assert.deepEqual([p.ok, p.entry.entry_type, p.entry.lead_id], [true, 'payout', 'L1']);
});
test('a reversal needs a reason and the entry it cancels, and cannot cancel a reversal', () => {
  assert.equal(buildEntry('reversal', { reason: '' }, { today, target: { id: 'E1', entry_type: 'refund', lead_id: 'L1' } }).ok, false);
  assert.equal(buildEntry('reversal', { reason: 'Typed twice' }, { today, target: { id: 'E1', entry_type: 'reversal' } }).ok, false);
  const r = buildEntry('reversal', { reason: 'Typed twice' }, { today, target: { id: 'E1', entry_type: 'customer_payment', lead_id: 'L1', mechanic_id: 'M1', amount: 500 } });
  assert.deepEqual([r.ok, r.entry.entry_type, r.entry.reverses_id, r.entry.lead_id, r.entry.amount, r.entry.reason], [true, 'reversal', 'E1', 'L1', 500, 'Typed twice']);
});
