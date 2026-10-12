import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAccounts, salesCsv, entryLabel } from '../admin/sales-view.js';

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
