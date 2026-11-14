import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { garageBreakdown } from '../supabase/functions/_shared/commission.ts';
import { jobAccount } from '../admin/ledger.js';
import { jobSplit } from '../admin/commission.js';
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// One job: service 16,200 + GST 2,916 = 19,116; 52% to the garage. Same figures into the Admin engine and the garage-app breakdown.
const sp = jobSplit({ service: 16200, gst: 2916, pct: 52, adjust: 0 });
const snap = { service_base: 16200, gst: 2916, total: 19116, pct: 52, adjust: 0, earnings: sp.earnings, company: sp.company, rate_source: 'job' };
const inv = { lead_id: 'L', ref: 'R', issued_at: '2026-11-07T00:00:00Z', total: 19116, taxable: 16200, mechanic_id: 'G', mechanic_rate: 52, commission_adjust: 0 };
const E = (o) => ({ id: Math.random().toString(36), ...o });
const cases = {
  'direct: garage collects everything': [E({ entry_type: 'customer_payment', collected_by: 'mechanic', amount: 19116 })],
  'online: company collects everything': [E({ entry_type: 'customer_payment', collected_by: 'company_portal', amount: 19116 })],
  'split payment': [E({ entry_type: 'customer_payment', collected_by: 'mechanic', amount: 10000 }), E({ entry_type: 'customer_payment', collected_by: 'company_manual', amount: 9116 })],
  'partial settlement': [E({ entry_type: 'customer_payment', collected_by: 'mechanic', amount: 19116 }), E({ entry_type: 'remittance', collected_by: 'company_manual', amount: 5000 })],
  'refund and reversal ignored': [E({ id: 'p1', entry_type: 'customer_payment', collected_by: 'mechanic', amount: 500 }), E({ entry_type: 'reversal', reverses_id: 'p1', amount: 500 }), E({ entry_type: 'customer_payment', collected_by: 'mechanic', amount: 19116 })],
};
for (const [name, entries] of Object.entries(cases)) {
  test('garage breakdown equals the Admin ledger engine: ' + name, () => {
    const rem = entries.filter((e) => e.entry_type === 'remittance').reduce((t, e) => t + e.amount, 0);
    const a = jobAccount({ invoice: inv, entries, mechanic: { id: 'G', payout_rate: 52 }, allocated: { remit: rem, payout: 0 } });
    const b = garageBreakdown(snap, entries, null);
    assert.equal(b.garage_earnings, a.earningsTotal);
    assert.equal(b.commission, a.companyShareTotal);
    assert.equal(b.collected_from_customer, a.collected);
    assert.equal(b.received_by_garage, a.byChannel.mechanic);
    assert.equal(b.payable_to_mx, a.remitDue);
    assert.equal(b.payable_to_garage, a.payoutDue);
    assert.equal(b.garage_earnings + b.commission, b.service_amount);
  });
}
test('the saved split does not move when the same data is read twice', () => {
  const x = garageBreakdown(snap, cases['split payment'], null), y = garageBreakdown(snap, cases['split payment'], null);
  assert.deepEqual(x, y);
});
test('a garage statement only reads its own jobs, and Admin shows the card for garage jobs', () => {
  const srv = src('supabase/functions/garage-app/index.ts');
  assert.match(srv, /garageBreakdown\(snap, LE\.get\(a\.lead_id\)/);
  assert.match(srv, /const \{ data: rows \} = await mine\(\)\.in\('status', \['ready', 'returned'\]\)/);   // the statement starts from this garage's own assignments
  const ad = src('admin/admin.js');
  assert.match(ad, /\$\{moneyCard\(l\)\}\$\{commissionCard\(l\)\}/);
  assert.match(ad, /if \(l\.garage_id\) return \{ kind: 'garage'/);
  assert.match(src('supabase/migrations/20270148000000_job_commission.sql'), /on conflict \(lead_id\) do nothing/);
});
