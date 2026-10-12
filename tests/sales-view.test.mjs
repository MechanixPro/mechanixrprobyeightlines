import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAccounts, salesCsv, entryLabel, ledgerCsv } from '../admin/sales-view.js';

const A = (o) => ({ lead_id: 'x', ref: 'MP-1', number: 'INV-1', issuedAt: '2026-10-05T05:00:00Z', customer: 'Asha', mechanicId: 'M1', mechanicName: 'Ravi', total: 1180, service: 1000, gst: 180, hasGst: true, mechanicPct: 40, earningsTotal: 400, companyShareTotal: 600,
  byChannel: { company_manual: 1180, company_portal: 0, mechanic: 0 }, collected: 1180, outstanding: 0, gatewayFees: 0, payoutObligation: 400, inHand: 0, remitObligation: 0, remitDue: 0, payoutDue: 400, statusLabels: ['Fully Paid', 'Mechanic Payout Due'], ...o });
const rows = [A({}), A({ lead_id: 'y', ref: 'MP-2', customer: 'Ben', mechanicId: null, mechanicName: null, issuedAt: '2026-09-01T05:00:00Z', outstanding: 500, collected: 680, statusLabels: ['Partially Paid', 'Customer Due', 'Overdue'] })];

test('filters by period, mechanic, status and text', () => {
  assert.equal(filterAccounts(rows, { from: '2026-10-01', to: '2026-10-31' }).length, 1);
  assert.equal(filterAccounts(rows, { mechanic: 'none' })[0].ref, 'MP-2');
  assert.equal(filterAccounts(rows, { mechanic: 'M1' })[0].ref, 'MP-1');
  assert.equal(filterAccounts(rows, { status: 'Overdue' })[0].ref, 'MP-2');
  assert.equal(filterAccounts(rows, { q: 'asha' })[0].ref, 'MP-1');
  assert.equal(filterAccounts(rows, {}).length, 2);
});
test('csv has one line per job with the three balances separate, and cannot start a formula', () => {
  const csv = salesCsv([A({ customer: '=cmd()' })]);
  const [head, line] = csv.split('\n');
  assert.match(head, /Customer balance/); assert.match(head, /Mechanic remittance due/); assert.match(head, /Mechanic payout due/);
  assert.ok(line.includes("'=cmd()")); assert.ok(line.includes('1180'));
});
test('entry labels read plainly', () => {
  assert.equal(entryLabel({ entry_type: 'customer_payment', collected_by: 'mechanic' }), 'Customer paid the mechanic');
  assert.equal(entryLabel({ entry_type: 'customer_payment', collected_by: 'company_portal' }), 'Customer paid online');
  assert.equal(entryLabel({ entry_type: 'customer_payment', collected_by: 'company_manual' }), 'Customer paid the company');
  assert.equal(entryLabel({ entry_type: 'remittance' }), 'Mechanic paid the company');
  assert.equal(entryLabel({ entry_type: 'payout' }), 'Company paid the mechanic');
  assert.equal(entryLabel({ entry_type: 'refund', collected_by: 'company_manual' }), 'Refund to customer');
  assert.equal(entryLabel({ entry_type: 'write_off' }), 'Balance written off');
  assert.equal(entryLabel({ entry_type: 'reversal' }), 'Cancelled an entry');
});

test('filters by collection channel and by invoice type', () => {
  const r = [A({ lead_id: 'a' }), A({ lead_id: 'b', hasGst: false, gstRate: 0, byChannel: { company_manual: 0, company_portal: 500, mechanic: 0 } }), A({ lead_id: 'c', byChannel: { company_manual: 0, company_portal: 0, mechanic: 300 } })];
  assert.deepEqual(filterAccounts(r, { channel: 'company_portal' }).map((x) => x.lead_id), ['b']);
  assert.deepEqual(filterAccounts(r, { channel: 'mechanic' }).map((x) => x.lead_id), ['c']);
  assert.deepEqual(filterAccounts(r, { gst: 'without' }).map((x) => x.lead_id), ['b']);
  assert.deepEqual(filterAccounts(r, { gst: 'with' }).map((x) => x.lead_id), ['a', 'c']);
});
test('csv now carries the phone and both revenue shares', () => {
  const [head, line] = salesCsv([A({ phone: '9876543210', companyPct: 60 })]).split('\n');
  assert.match(head, /Phone/); assert.match(head, /Mechanic %/); assert.match(head, /Company %/);
  assert.ok(line.includes('9876543210')); assert.ok(line.includes(',40,60,'));
});
test('transaction csv lists every entry with who recorded it and whether it was cancelled', () => {
  const entries = [
    { id: 'e1', created_at: '2026-10-05T05:00:00Z', occurred_on: '2026-10-05', entry_type: 'customer_payment', collected_by: 'company_portal', amount: 500, gateway_fee: 11.8, gateway_txn_id: 'pay_1', settlement_status: 'settled', method: 'Razorpay', reference: 'pay_1', source: 'gateway', lead_id: 'a' },
    { id: 'e2', created_at: '2026-10-06T05:00:00Z', occurred_on: '2026-10-06', entry_type: 'customer_payment', collected_by: 'mechanic', amount: 300, created_by: 'u1', note: '=bad', lead_id: 'a' },
    { id: 'e3', created_at: '2026-10-07T05:00:00Z', occurred_on: '2026-10-07', entry_type: 'reversal', reverses_id: 'e2', amount: 300, reason: 'typo', created_by: 'u1', lead_id: 'a' }];
  const csv = ledgerCsv(entries, { refs: { a: 'MP-1' }, mechanics: {}, who: (e) => (e.created_by ? 'Team' : 'System') });
  const lines = csv.split('\n'); assert.equal(lines.length, 4);
  assert.match(lines[0], /Recorded by/); assert.match(lines[0], /Settlement/);
  assert.ok(lines[1].includes('MP-1') && lines[1].includes('System') && lines[1].includes('settled') && lines[1].includes('11.8') && lines[1].includes('Active'));
  assert.ok(lines[2].includes('Cancelled') && lines[2].includes("'=bad"));
  assert.ok(lines[3].includes('typo'));
});
