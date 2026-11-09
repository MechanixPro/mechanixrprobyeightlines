// Partner plans (Bronze, Silver, Gold), mechanic KYC with Skip, assign to a mechanic or a garage, and partner history in Admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSummary, depositChip, eventText, PLAN_LABEL } from '../crm/kyc-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20270131000000_partner_plans_history.sql');

test('the three plans carry the owner\'s numbers', () => {
  assert.match(sql, /\('bronze', 'Bronze', 0, 0, 35, null, null, 1\)/);
  assert.match(sql, /\('silver', 'Silver', 10000, 3, 30, 50, 80, 2\)/);
  assert.match(sql, /\('gold', 'Gold', 20000, 3, 25, 60, 100, 3\)/);
});
test('plan, deposit and history functions are for owner and admin only; the mechanic ones are service-role only', () => {
  for (const f of ['partner_plans_list', 'partner_profile', 'partner_plan_set', 'partner_deposit_set', 'partner_history', 'partner_all_list']) {
    const body = sql.slice(sql.indexOf('create or replace function public.' + f + '('));
    assert.match(body.slice(0, 600), /kyc_need_admin\(\)/, f);
  }
  assert.match(sql, /revoke all on function public\.mechanic_kyc_state\(uuid\), public\.mechanic_kyc_skip\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /insert into public\.(payments|ledger|garage_settlements)/i);
});
test('a held deposit is never changed by a plan change, and no deposit is charged', () => {
  assert.match(sql, /when cur = 'held' then 'held'/);
  assert.match(sql, /Nothing is charged/i);
});
test('plain text for plans, deposits and history events', () => {
  assert.equal(planSummary({ deposit_amount: 0, deposit_months: 0, commission_pct: 35 }), 'No deposit · Mechanix Pro commission 35%');
  assert.equal(planSummary({ deposit_amount: 10000, deposit_months: 3, commission_pct: 30, orders_min: 50, orders_max: 80 }), 'Deposit ₹10,000 for 3 months · Mechanix Pro commission 30% · 50 to 80 orders a month');
  assert.equal(depositChip('held').label, 'Deposit received'); assert.equal(depositChip('pending').tone, 'warn'); assert.equal(PLAN_LABEL.gold, 'Gold');
  assert.equal(eventText('plan_set:silver'), 'Plan set to Silver'); assert.equal(eventText('deposit:held'), 'Deposit marked received'); assert.equal(eventText('kyc_skipped'), 'Mechanic skipped KYC for now');
});
test('the mechanic app offers KYC with a Skip, and skipping never blocks the app', () => {
  const js = read('assets/js/mechanic.js');
  assert.match(js, /Skip for now/); assert.match(js, /api\('kyc_skip'\)/); assert.match(js, /api\('kyc_link'\)/); assert.match(js, /api\('kyc_state'\)/);
  const h = read('supabase/functions/_shared/mechanic-handler.ts');
  assert.match(h, /action === 'kyc_skip'/); assert.match(h, /action === 'kyc_link'/);
  assert.match(sql, /kyc_skipped_at/);
});
test('Admin can assign a booking to a mechanic or a partner garage from the same button', () => {
  assert.match(read('admin/booking-steps.js'), /Assign mechanic or garage/);
  assert.match(read('admin/admin.js'), /flow\.actions\.assignPick\(l\)/);
  const f = read('crm/flow-core.js'); assert.match(f, /data-pick="mechanic"/); assert.match(f, /data-pick="garage"/);
  assert.equal(read('admin/flow-core.js'), f);
});
test('Admin KYC screen shows plan, deposit and full partner history, and the payout rules are untouched', () => {
  const v = read('admin/kyc-view.js');
  assert.match(v, /All partners and history/); assert.match(v, /partner_plan_set/); assert.match(v, /partner_history/); assert.match(v, /partner_deposit_set/);
  assert.equal(read('crm/kyc-rules.js'), read('admin/kyc-rules.js'));
  assert.doesNotMatch(read('admin/commission.js'), /partner_plan|\.plan\b/);
  assert.doesNotMatch(read('crm/crm.js') + read('crm/garage-desk.js'), /partner_plan|deposit_status/);
});
