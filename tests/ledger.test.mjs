import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEntries, jobAccount, mechanicAccount, summaryCards, jobStatus } from '../admin/ledger.js';

const NOW = new Date('2026-10-20T06:00:00.000Z').getTime();
const inv = (o = {}) => ({ lead_id: 'J1', ref: 'MP-J1', number: 'INV-MP-J1', issued_at: '2026-10-10T05:00:00.000Z', taxable: 1000, cgst: 90, sgst: 90, total: 1180, gst_rate: 18, has_gst: true, mechanic_rate: 40, mechanic_id: 'M1', customer_name: 'Asha', ...o });
let n = 0;
const E = (o) => ({ id: 'e' + ++n, created_at: '2026-10-11T05:00:00.000Z', occurred_on: '2026-10-11', ...o });
const pay = (amount, by, o = {}) => E({ entry_type: 'customer_payment', collected_by: by, amount, lead_id: 'J1', mechanic_id: by === 'mechanic' ? 'M1' : null, ...o });
const acct = (invoice, entries, m = { id: 'M1', name: 'Ravi', payout_rate: 40 }) => jobAccount({ invoice, entries, mechanic: m, now: NOW });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg}: ${a} vs ${b}`);

test('revenue share is on the service amount before GST; GST is kept apart from earnings and company share', () => {
  const a = acct(inv(), []);
  assert.equal(a.service, 1000); assert.equal(a.gst, 180); assert.equal(a.total, 1180);
  assert.equal(a.mechanicPct, 40); assert.equal(a.companyPct, 60); assert.equal(a.earningsTotal, 400); assert.equal(a.companyShareTotal, 600);
  near(a.earningsTotal + a.companyShareTotal + a.gst, a.total, 'earnings + company + GST = invoice total');
});
test('a no-GST invoice shares the whole amount, so the same percentage gives a different base', () => {
  const a = acct(inv({ taxable: 1000, cgst: 0, sgst: 0, total: 1000, gst_rate: 0, has_gst: false }), []);
  assert.equal(a.gst, 0); assert.equal(a.earningsTotal, 400); assert.equal(a.companyShareTotal, 600);
});

test('METHOD A, company collects manually in full: customer clear, company owes the mechanic the earnings, nothing to remit', () => {
  const a = acct(inv(), [pay(1180, 'company_manual', { method: 'cash' })]);
  assert.equal(a.collected, 1180); assert.equal(a.byChannel.company_manual, 1180); assert.equal(a.outstanding, 0);
  assert.equal(a.payoutObligation, 400); assert.equal(a.remitObligation, 0); assert.equal(a.inHand, 0);
  assert.deepEqual(a.statusLabels, ['Fully Paid', 'Mechanic Payout Due']);
});
test('METHOD B, portal payment: gateway fee is recorded but does not change what the customer owes', () => {
  const a = acct(inv(), [pay(1180, 'company_portal', { method: 'portal', gateway_txn_id: 'pay_X1', gateway_fee: 27.82, gateway_status: 'captured', settlement_status: 'pending' })]);
  assert.equal(a.byChannel.company_portal, 1180); assert.equal(a.outstanding, 0); assert.equal(a.gatewayFees, 27.82); assert.equal(a.payoutObligation, 400);
});
test('METHOD C, mechanic collects in full: he keeps his earnings and must remit the company share plus GST; no payout from the company', () => {
  const a = acct(inv(), [pay(1180, 'mechanic')]);
  assert.equal(a.byChannel.mechanic, 1180); assert.equal(a.outstanding, 0);
  assert.equal(a.inHand, 400); assert.equal(a.remitObligation, 780); assert.equal(a.payoutObligation, 0);
  near(a.remitObligation, a.companyShareTotal + a.gst, 'remit = company share + GST');
  assert.deepEqual(a.statusLabels, ['Fully Paid', 'Mechanic Remittance Due']);
});
test('METHOD C partial: half paid to the mechanic means half the earnings in hand and half the remittance, and the customer still owes half', () => {
  const a = acct(inv(), [pay(590, 'mechanic')]);
  assert.equal(a.collected, 590); assert.equal(a.outstanding, 590); assert.equal(a.inHand, 200); assert.equal(a.remitObligation, 390);
  assert.ok(a.statusLabels.includes('Partially Paid')); assert.ok(a.statusLabels.includes('Customer Due'));
});
test('mixed payments on one invoice: the company part earns a payout, the mechanic part earns a remittance, and nothing is counted twice', () => {
  const a = acct(inv(), [pay(590, 'company_manual'), pay(590, 'mechanic')]);
  assert.equal(a.outstanding, 0); assert.equal(a.payoutObligation, 200); assert.equal(a.inHand, 200); assert.equal(a.remitObligation, 390);
  near(a.payoutObligation + a.inHand, a.earningsTotal, 'the mechanic\'s total earnings are accounted for exactly once');
});
test('multiple partial payments add up and the status moves from Unpaid to Partially Paid to Fully Paid', () => {
  assert.deepEqual(acct(inv(), []).statusLabels.slice(0, 1), ['Unpaid']);
  const half = acct(inv(), [pay(300, 'company_manual'), pay(300, 'company_portal')]);
  assert.equal(half.collected, 600); assert.equal(half.outstanding, 580); assert.ok(half.statusLabels.includes('Partially Paid'));
  const done = acct(inv(), [pay(300, 'company_manual'), pay(300, 'company_portal'), pay(580, 'company_manual')]);
  assert.equal(done.outstanding, 0); assert.ok(done.statusLabels.includes('Fully Paid'));
});
test('a refund reduces what was collected and the earnings that were earned', () => {
  const a = acct(inv(), [pay(1180, 'company_manual'), E({ entry_type: 'refund', collected_by: 'company_manual', amount: 590, lead_id: 'J1' })]);
  assert.equal(a.collected, 590); assert.equal(a.outstanding, 590); assert.equal(a.payoutObligation, 200);
});
test('a reversal cancels one entry completely and keeps both in the history; a write-off clears a balance without cash', () => {
  const p = pay(1180, 'company_manual'), r = E({ entry_type: 'reversal', reverses_id: p.id, reason: 'Wrong amount', amount: 1180, lead_id: 'J1' });
  assert.equal(activeEntries([p, r]).length, 0);
  const a = acct(inv(), [p, r, pay(1000, 'company_manual')]);
  assert.equal(a.collected, 1000); assert.equal(a.outstanding, 180);
  const w = acct(inv(), [pay(1000, 'company_manual'), E({ entry_type: 'write_off', amount: 180, lead_id: 'J1', reason: 'Goodwill' })]);
  assert.equal(w.outstanding, 0); assert.equal(w.writtenOff, 180); assert.equal(w.collected, 1000);
});
test('overpaying never creates negative balances or extra earnings', () => {
  const a = acct(inv(), [pay(2000, 'company_manual')]);
  assert.equal(a.outstanding, 0); assert.equal(a.credit, 820); assert.equal(a.payoutObligation, 400);
});
test('overdue means a customer balance more than 7 days after the invoice', () => {
  const old = acct(inv({ issued_at: '2026-10-10T05:00:00.000Z' }), [pay(500, 'company_manual')]);
  assert.ok(old.statusLabels.includes('Overdue'));
  const fresh = acct(inv({ issued_at: '2026-10-19T05:00:00.000Z' }), [pay(500, 'company_manual')]);
  assert.ok(!fresh.statusLabels.includes('Overdue'));
});
test('a job with no mechanic has no earnings and no remittance', () => {
  const a = jobAccount({ invoice: inv({ mechanic_id: null, mechanic_rate: 0 }), entries: [pay(1180, 'company_manual')], mechanic: null, now: NOW });
  assert.equal(a.earningsTotal, 0); assert.equal(a.payoutObligation, 0); assert.equal(a.companyShareTotal, 1000);
});
test('settled means the customer is clear and neither side owes the other', () => {
  assert.ok(jobStatus({ outstanding: 0, remitDue: 0, payoutDue: 0, collected: 1180 }).includes('Settled'));
  assert.ok(!jobStatus({ outstanding: 0, remitDue: 5, payoutDue: 0, collected: 1180 }).includes('Settled'));
});

const mech = { id: 'M1', name: 'Ravi', phone: '9000000001', payout_rate: 40 };
const mk = (id, issued, entries) => ({ invoice: inv({ lead_id: id, ref: 'MP-' + id, number: 'INV-MP-' + id, issued_at: issued }), entries: entries.map((e) => ({ ...e, lead_id: id })) });
test('mechanic ledger: money the mechanic owes the company and money the company owes him are separate, and net settlement is shown', () => {
  const jobs = [mk('J1', '2026-10-01T05:00:00.000Z', [pay(1180, 'mechanic')]), mk('J2', '2026-10-05T05:00:00.000Z', [pay(1180, 'company_manual')])];
  const l = mechanicAccount({ mechanic: mech, jobs, entries: [], now: NOW });
  assert.equal(l.jobs, 2); assert.equal(l.serviceSales, 2000); assert.equal(l.directCollected, 1180); assert.equal(l.earnings, 800);
  assert.equal(l.remitTotalDue, 780); assert.equal(l.payoutTotalDue, 400); assert.equal(l.remitRemaining, 780); assert.equal(l.payoutRemaining, 400);
  assert.equal(l.net, -380); assert.equal(l.netLabel, 'Mechanic owes Mechanix Pro');
});
test('recording a remittance and a payout reduces each balance independently, oldest job first', () => {
  const jobs = [mk('J1', '2026-10-01T05:00:00.000Z', [pay(1180, 'mechanic')]), mk('J3', '2026-10-06T05:00:00.000Z', [pay(1180, 'mechanic')])];
  const entries = [E({ entry_type: 'remittance', mechanic_id: 'M1', amount: 900 }), E({ entry_type: 'payout', mechanic_id: 'M1', amount: 0 + 1 })];
  const l = mechanicAccount({ mechanic: mech, jobs, entries, now: NOW });
  assert.equal(l.remitted, 900); assert.equal(l.remitRemaining, 780 + 780 - 900); assert.equal(l.paidOut, 1);
  assert.equal(l.jobAccounts[0].remitDue, 0); assert.equal(l.jobAccounts[1].remitDue, 660);
});
test('a remittance reversed by mistake is not counted; the final status says Settled when both sides are clear', () => {
  const jobs = [mk('J1', '2026-10-01T05:00:00.000Z', [pay(1180, 'mechanic')])];
  const r = E({ entry_type: 'remittance', mechanic_id: 'M1', amount: 780 }), rev = E({ entry_type: 'reversal', reverses_id: r.id, reason: 'Entered twice', amount: 780, mechanic_id: 'M1' });
  assert.equal(mechanicAccount({ mechanic: mech, jobs, entries: [r, rev], now: NOW }).remitRemaining, 780);
  const ok = mechanicAccount({ mechanic: mech, jobs, entries: [r], now: NOW });
  assert.equal(ok.remitRemaining, 0); assert.equal(ok.status, 'Settled');
});

test('the nine dashboard figures add up from the ledger and the invoices', () => {
  const jobs = [mk('J1', '2026-10-01T05:00:00.000Z', [pay(1180, 'mechanic')]), mk('J2', '2026-10-05T05:00:00.000Z', [pay(590, 'company_manual'), pay(300, 'company_portal', { gateway_fee: 7 })])];
  const accts = jobs.map((j) => jobAccount({ invoice: j.invoice, entries: j.entries, mechanic: mech, now: NOW }));
  const cards = summaryCards(accts, [E({ entry_type: 'remittance', mechanic_id: 'M1', amount: 100 }), E({ entry_type: 'payout', mechanic_id: 'M1', amount: 50 })], jobs.flatMap((j) => j.entries));
  assert.equal(cards.invoiceSales, 2360); assert.equal(cards.collectedManual, 590); assert.equal(cards.collectedPortal, 300); assert.equal(cards.collectedMechanic, 1180);
  assert.equal(cards.customerOutstanding, 290); assert.equal(cards.gst, 360); assert.equal(cards.payoutsPaid, 50); assert.equal(cards.gatewayFees, 7);
  assert.equal(cards.mechanicsOweCompany, 680); assert.equal(cards.payoutsPending, 251.69); // 400 x 890 / 1180 = 301.69, less 50 already paid out
});

test('the job account carries the phone and the company percentage for the table', async () => {
  const { jobAccount } = await import('../admin/ledger.js');
  const a = jobAccount({ invoice: { lead_id: 'p', ref: 'MP-9', number: 'INV-9', issued_at: '2026-10-05T05:00:00Z', customer_name: 'Asha', customer_phone: '9876543210', has_gst: true, gst_rate: 18, total: 1180, taxable: 1000, mechanic_id: 'M1', mechanic_rate: 40 }, entries: [] });
  assert.equal(a.phone, '9876543210'); assert.equal(a.mechanicPct, 40); assert.equal(a.companyPct, 60);
});
