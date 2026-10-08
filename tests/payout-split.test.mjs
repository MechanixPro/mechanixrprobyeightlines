import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitJob } from '../admin/split.js';
import { mechanicStats } from '../admin/people.js';
import { payoutReport } from '../admin/report.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('money collected is split between the mechanic and the company by the rate the company chose', () => {
  const s = splitJob(1000, 30);
  assert.deepEqual(s, { base: 1000, gst: 0, mechanic: 300, company: 700, mechanicRate: 30, companyRate: 70 });
  assert.deepEqual(splitJob(1000, 70), { base: 1000, gst: 0, mechanic: 700, company: 300, mechanicRate: 70, companyRate: 30 });
});
test('the two shares always add up to the amount, even with rounding', () => {
  for (const [amt, rate] of [[1299, 33], [999, 45], [1, 50], [1498, 30], [0, 30]]) { const s = splitJob(amt, rate); assert.equal(s.mechanic + s.company + s.gst, amt, `${amt}@${rate}`); }
});
test('the company can calculate on the amount before GST; the GST is shown separately and belongs to no one', () => {
  const s = splitJob(1180, 30, 'before_gst');
  assert.equal(s.base, 1000); assert.equal(s.gst, 180); assert.equal(s.mechanic, 300); assert.equal(s.company, 700);
});
test('a bad rate is kept between 0 and 100', () => {
  assert.equal(splitJob(1000, 150).mechanicRate, 100); assert.equal(splitJob(1000, -5).mechanicRate, 0); assert.equal(splitJob(1000, 'abc').mechanicRate, 0);
});
test('mechanic stats show what the mechanic earns and what the company keeps', () => {
  const m = [{ id: 'm1', name: 'Ravi', payout_rate: 30, active: true }];
  const leads = [{ mechanic_id: 'm1', status: 'completed', paid_amount: 1000 }, { mechanic_id: 'm1', status: 'completed', paid_amount: 500 }, { mechanic_id: 'm1', status: 'paid', paid_amount: 999 }];
  const r = mechanicStats(m, leads)[0];
  assert.equal(r.revenue, 1500); assert.equal(r.payout, 450); assert.equal(r.companyShare, 1050); assert.equal(r.companyRate, 70);
  assert.equal(mechanicStats(m, leads, { basis: 'before_gst' })[0].payout, Math.round(Math.round(1000 / 1.18) * 0.3) + Math.round(Math.round(500 / 1.18) * 0.3));
});
test('the payout report groups completed jobs by mechanic', () => {
  const rep = payoutReport([
    { mechanic_id: 'm1', status: 'completed', paid_amount: 1000 }, { mechanic_id: 'm1', status: 'completed', paid_amount: 1000 },
    { mechanic_id: 'm2', status: 'completed', paid_amount: 500 }, { mechanic_id: null, status: 'completed', paid_amount: 300 }, { mechanic_id: 'm1', status: 'paid', paid_amount: 700 }],
    [{ id: 'm1', name: 'Ravi', payout_rate: 30 }, { id: 'm2', name: 'Asha', payout_rate: 40 }], 'collected');
  const ravi = rep.rows.find((r) => r.name === 'Ravi');
  assert.deepEqual([ravi.jobs, ravi.collected, ravi.mechanic, ravi.company], [2, 2000, 600, 1400]);
  assert.deepEqual([rep.totals.jobs, rep.totals.collected, rep.totals.mechanic, rep.totals.company], [3, 2500, 800, 1700]);
  assert.equal(rep.rows.some((r) => r.name === 'Unassigned'), false);
});
test('the admin shows the split with a slider, a two-colour bar and a sample job; the company sets it per mechanic', () => {
  const a = read('../admin/admin.js');
  for (const id of ['mr-range', 'mr', 'split-bar', 'split-sample']) assert.ok(a.includes(id), id);
  assert.match(a, /splitJob\(/); assert.match(a, /Company keeps|company keeps/i);
  assert.match(a, /payoutReport\(/); assert.match(a, /st-basis/); assert.match(a, /payout_basis/);
  assert.match(read('../admin/admin.css'), /\.splitbar/);
});
test('the payout basis setting exists in the database and the owner alone can change it', () => {
  const sql = read('../supabase/migrations/20261022000000_payout_basis.sql');
  assert.match(sql, /payout_basis/); assert.match(sql, /on conflict \(key\) do nothing/);
});
