import test from 'node:test';
import assert from 'node:assert/strict';
import { mechanicAccount } from '../admin/ledger.js';
import { mechanicDues, unsettledRows, jobAccount, activeEntries } from '../supabase/functions/_shared/mech-dues.ts';
import { duesView, payAmount, monthRange, istToday, dateOk } from '../supabase/functions/_shared/mechanic.ts';

const MECH = { id: 'M1', name: 'Test Mechanic', payout_rate: 30 };
const inv = (lead_id, total, taxable, extra = {}) => ({ lead_id, ref: 'R-' + lead_id, number: 'INV-' + lead_id, issued_at: extra.issued_at ?? '2026-11-01T05:00:00Z', total, taxable, mechanic_id: 'M1', mechanic_rate: extra.rate ?? 30, commission_adjust: extra.adjust ?? 0, customer_name: 'Customer', has_gst: true, gst_rate: 18 });
const pay = (id, lead_id, amount, by, extra = {}) => ({ id, lead_id, mechanic_id: by === 'mechanic' ? 'M1' : null, entry_type: 'customer_payment', amount, collected_by: by, ...extra });
const rem = (id, amount, lead_id = null) => ({ id, lead_id, mechanic_id: 'M1', entry_type: 'remittance', amount });

// A: the mechanic took all Rs 1,180 in cash. B: the customer paid the company online. C: part cash, odd rupees (rounding).
const jobs = () => [
  { invoice: inv('A', 1180, 1000, { issued_at: '2026-11-01T05:00:00Z' }), entries: [pay('p1', 'A', 1180, 'mechanic')] },
  { invoice: inv('B', 590, 500, { issued_at: '2026-11-02T05:00:00Z' }), entries: [pay('p2', 'B', 590, 'company_portal')] },
  { invoice: inv('C', 1000, 847.46, { issued_at: '2026-11-03T05:00:00Z', rate: 33 }), entries: [pay('p3', 'C', 700, 'mechanic'), pay('p4', 'C', 300, 'company_manual')] },
];

test('dues from sample ledger rows: A, B and C, with rounding to the paisa', () => {
  const d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [] });
  const A = d.jobAccounts.find((a) => a.lead_id === 'A'), B = d.jobAccounts.find((a) => a.lead_id === 'B'), C = d.jobAccounts.find((a) => a.lead_id === 'C');
  assert.equal(A.inHand, 300); assert.equal(A.remitDue, 880);            // 30% of 1000 kept, the rest of the cash is due
  assert.equal(B.remitDue, 0); assert.equal(B.payoutObligation, 150);    // the company collected: it owes the mechanic 30% of 500
  assert.equal(C.earningsTotal, 279.66);                                 // 847.46 x 33% = 279.6618
  assert.equal(C.inHand, 195.76); assert.equal(C.remitObligation, 504.24); assert.equal(C.payoutObligation, 83.9);
  assert.equal(d.remitTotalDue, 1384.24); assert.equal(d.remitRemaining, 1384.24);
  const rows = unsettledRows(d);
  assert.deepEqual(rows.map((r) => r.lead_id), ['A', 'C'], 'oldest first, only jobs with something due');
  assert.deepEqual(rows[0], { lead_id: 'A', ref: 'R-A', issued_at: '2026-11-01T05:00:00Z', total_collected: 1180, mechanic_payout: 300, due_to_platform: 880 });
  assert.equal(rows[1].total_collected, 700); assert.equal(rows[1].mechanic_payout, 195.76); assert.equal(rows[1].due_to_platform, 504.24);
});

test('a remittance that names a job settles that job first; an unnamed one settles the oldest job; Pay All clears everything', () => {
  let d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [rem('r1', 500, 'A')] });
  assert.equal(d.jobAccounts.find((a) => a.lead_id === 'A').remitDue, 380); assert.equal(d.remitRemaining, 884.24);
  d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [rem('r2', 1000)] });                // not tied to a job: oldest first
  assert.equal(d.jobAccounts.find((a) => a.lead_id === 'A').remitDue, 0); assert.equal(d.jobAccounts.find((a) => a.lead_id === 'C').remitDue, 384.24);
  d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [rem('r3', 1384.24, 'A')] });         // Pay All names the oldest job; the overflow settles the next
  assert.equal(d.remitRemaining, 0); assert.deepEqual(unsettledRows(d), []);
  d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [rem('r4', 5000)] });                  // overpaid: nothing due, never negative
  assert.equal(d.remitRemaining, 0);
});

test('a reversed payment does not count, and a refund reduces what the mechanic collected', () => {
  const j = jobs(); j[0].entries.push({ id: 'x1', lead_id: 'A', entry_type: 'reversal', reverses_id: 'p1', amount: 1180 });
  assert.equal(activeEntries(j[0].entries).length, 0);
  assert.equal(mechanicDues({ mechanic: MECH, jobs: j, entries: [] }).jobAccounts.find((a) => a.lead_id === 'A').remitDue, 0);
  const k = jobs(); k[0].entries.push({ id: 'f1', lead_id: 'A', entry_type: 'refund', collected_by: 'mechanic', amount: 180 });
  assert.equal(mechanicDues({ mechanic: MECH, jobs: k, entries: [] }).jobAccounts.find((a) => a.lead_id === 'A').byChannel.mechanic, 1000);
});

test('a manual commission adjustment moves money between the two sides, never above the service amount or below zero', () => {
  const a = jobAccount({ invoice: inv('A', 1180, 1000, { adjust: 50 }), entries: [pay('p1', 'A', 1180, 'mechanic')] });
  assert.equal(a.earningsTotal, 350); assert.equal(a.remitDue, 830);
  assert.equal(jobAccount({ invoice: inv('A', 1180, 1000, { adjust: -9999 }), entries: [pay('p1', 'A', 1180, 'mechanic')] }).earningsTotal, 0);
  assert.equal(jobAccount({ invoice: inv('A', 1180, 1000, { adjust: 9999 }), entries: [pay('p1', 'A', 1180, 'mechanic')] }).earningsTotal, 1000);
});

/* The same rows through admin/ledger.js (what Admin > Mechanic ledgers uses) and through the port: every figure must match. */
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
test('parity with admin/ledger.js on 300 random books (jobs, payments by every channel, refunds, reversals, remittances, payouts, adjustments)', () => {
  const r = rng(7);
  for (let n = 0; n < 300; n++) {
    const count = 1 + Math.floor(r() * 6), js = [], mine = []; let id = 0;
    for (let i = 0; i < count; i++) {
      const taxable = Math.round(r() * 200000) / 100, total = Math.round(taxable * (r() < 0.8 ? 1.18 : 1) * 100) / 100, lead = 'L' + i, rate = Math.floor(r() * 101);
      const entries = [];
      for (const ch of ['company_manual', 'company_portal', 'mechanic']) if (r() < 0.5) entries.push(pay('e' + ++id, lead, Math.round(r() * total * 100) / 100 || 1, ch));
      if (entries.length && r() < 0.2) entries.push({ id: 'e' + ++id, lead_id: lead, entry_type: 'refund', collected_by: entries[0].collected_by, amount: Math.min(entries[0].amount, 5) });
      if (entries.length && r() < 0.15) entries.push({ id: 'e' + ++id, lead_id: lead, entry_type: 'reversal', reverses_id: entries[0].id, amount: entries[0].amount });
      if (r() < 0.2) entries.push({ id: 'e' + ++id, lead_id: lead, entry_type: 'write_off', amount: 1 });
      js.push({ invoice: inv(lead, total, taxable, { issued_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), rate, adjust: r() < 0.3 ? Math.round((r() - 0.5) * 20000) / 100 : 0 }), entries });
    }
    for (let k = 0; k < Math.floor(r() * 4); k++) mine.push({ id: 'm' + ++id, lead_id: r() < 0.5 ? 'L' + Math.floor(r() * count) : null, mechanic_id: 'M1', entry_type: r() < 0.7 ? 'remittance' : 'payout', amount: Math.round(r() * 80000) / 100 || 1 });
    const a = mechanicAccount({ mechanic: MECH, jobs: js, entries: mine }), b = mechanicDues({ mechanic: MECH, jobs: js, entries: mine });
    for (const k of ['remitTotalDue', 'remitted', 'remitRemaining', 'payoutTotalDue', 'paidOut', 'payoutRemaining', 'net', 'earnings']) assert.equal(b[k], a[k], `${k} (book ${n})`);
    for (const x of a.jobAccounts) { const y = b.jobAccounts.find((q) => q.lead_id === x.lead_id); for (const k of ['total', 'service', 'collected', 'outstanding', 'earningsTotal', 'payoutObligation', 'inHand', 'remitObligation', 'remitDue', 'payoutDue']) assert.equal(y[k], x[k], `${k} job ${x.lead_id} (book ${n})`); assert.deepEqual(y.byChannel, x.byChannel); }
  }
});

test('the dues view: figures and names only, no customer data; payment amounts come from the server and respect the Razorpay limits', () => {
  const d = mechanicDues({ mechanic: MECH, jobs: jobs(), entries: [] });
  const v = duesView(d, unsettledRows(d), new Map([['A', { booking_id: 'MP-26-27-0001', service: 'Full bike service' }]]));
  assert.equal(v.total_due, 1384.24); assert.equal(v.unsettled.length, 2); assert.equal(v.unsettled[0].booking_id, 'MP-26-27-0001'); assert.equal(v.unsettled[1].service, 'Service');
  assert.deepEqual(Object.keys(v.unsettled[0]).sort(), ['booking_id', 'date', 'due_to_platform', 'id', 'mechanic_payout', 'service', 'total_collected']);
  assert.deepEqual(payAmount(880.456), { ok: true, amount: 880.46 }); assert.equal(payAmount(0.5).ok, false); assert.equal(payAmount(0).ok, false); assert.equal(payAmount(100001).ok, false); assert.equal(payAmount(100000).ok, true);
});

test('month range and India date helpers', () => {
  assert.deepEqual(monthRange('2026-11-07'), { from: '2026-11-01', to: '2026-11-30' }); assert.deepEqual(monthRange('2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(istToday(Date.parse('2026-11-07T20:00:00Z')), '2026-11-08', 'after 5:30 pm UTC it is already tomorrow in India');
  assert.ok(dateOk('2026-11-07')); assert.ok(!dateOk('2026-02-30')); assert.ok(!dateOk('07-11-2026')); assert.ok(!dateOk(null));
});
