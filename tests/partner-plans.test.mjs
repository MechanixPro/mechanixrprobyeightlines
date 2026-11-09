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
test('the booking form offers Puncture repair, and the server accepts it', () => {
  assert.match(read('src/book-pay.html'), /<option value="puncture">Puncture repair<\/option>/);
  assert.match(read('assets/js/book-pay.js'), /puncture: 'Puncture repair'/);
  assert.match(read('supabase/functions/_shared/book-form.ts'), /BIKE_SERVICES = \['basic', 'general', 'full', 'repair', 'puncture'\]/);
});
test('the Book your slot pop-up is a dismissible card that stays off one-task pages and links to /book/', () => {
  const js = read('assets/js/slot-popup.js');
  assert.match(js, /\(book\|track\|pay\|rate\|warranty/); assert.match(js, /Book your slot/); assert.match(js, /href: '\/book\/'/); assert.match(js, /vehicle=car/);
  assert.match(js, /Escape/); assert.match(js, /snooze\(3\)|close\(3\)/); assert.match(js, /setTimeout\(show, 20000\)/);
  assert.match(read('index.html'), /slot-popup\.js/); assert.doesNotMatch(read('pay/index.html'), /slot-popup/);
  assert.match(read('assets/css/slot-popup.css'), /prefers-reduced-motion/);
});
test('review fixes: suspended garages get no customer contact, the accept window and checklist are enforced on the server, requests keep waiting ones first', () => {
  const g = read('supabase/functions/garage-app/index.ts');
  assert.match(g, /isOpen\(a\.status\) && !who\.suspended/);
  assert.match(g, /blocked: 'receiving'/);
  const m = read('supabase/migrations/20270132000000_garage_server_gates.sql');
  assert.match(m, /a\.offer_expires_at < now\(\)/); assert.match(m, /'blocked', 'receiving'/);
  assert.match(m, /order by \(u\.status = 'pending'\) desc, u\.created_at desc limit 60/);
  assert.match(m, /where id = p_id and kyc_skipped_at is null/);
  assert.match(read('supabase/functions/_shared/mechanic-handler.ts'), /Your KYC is already approved/);
  assert.match(read('crm/crm.js'), /'assignPick'/);
});
test('car bookings can choose AC, battery, tyres, brakes, inspection, repair and cleaning, and the server accepts exactly those', () => {
  const h = read('src/book-pay.html'), f = read('supabase/functions/_shared/book-form.ts'), js = read('assets/js/book-pay.js');
  for (const k of ['service', 'inspection', 'brakes', 'ac', 'battery', 'tyres', 'repair', 'cleaning', 'problem']) {
    assert.match(h, new RegExp(`name="car_need" value="${k}"`), k); assert.match(f, new RegExp(`${k}: '`), k); assert.match(js, new RegExp(`${k}: '`), k);
  }
  assert.match(f, /Object\.keys\(CAR_NEEDS\)\.includes\(String\(b\.car_need\)\)/);
});
import { garageFromForm, CATS } from '../admin/garages-view.js';
test('Admin can add, edit and delete a garage by hand', () => {
  const ok = garageFromForm({ name: ' Sri Motors ', owner_name: 'Owner', mobile: '9876543210', address: '12 Main Road HSR', pincode: '560102', lat: '12.9116, 77.6389', lng: '', categories: ['2-wheeler', 'bogus'], open_days: 'Mon-Sat', open_time: '09:00', close_time: '19:00', bays: '3' }, 'abc');
  assert.equal(ok.value.name, 'Sri Motors'); assert.deepEqual(ok.value.categories, ['2-wheeler']); assert.equal(ok.value.lat, 12.9116); assert.equal(ok.value.lng, 77.6389); assert.equal(ok.value.bays, 3); assert.equal(ok.value.id, 'abc');
  assert.match(garageFromForm({ lat: 'near the temple', lng: '' }).error, /Bengaluru/); assert.ok(CATS.length === 5);
  const m = read('supabase/migrations/20270133000000_admin_garage_delete.sql');
  assert.match(m, /admin_garage_delete[\s\S]*kyc_need_admin\(\)/); assert.match(m, /open job/); assert.match(m, /deleted_at = now\(\)/); assert.match(m, /revoked_at = coalesce\(revoked_at, now\(\)\)/);
  assert.match(m, /revoke all on function public\.admin_garage_delete\(uuid\).* from public, anon/);
  assert.match(read('admin/nav.js'), /\['garages', 'Garages'\]/); assert.match(read('admin/index.html'), /data-tab="garages"/); assert.match(read('admin/admin.js'), /garagesView\.mount/);
  assert.equal(read('crm/geo-parse.js'), read('admin/geo-parse.js'));
});
test('the garage app offers the customer code on every accepted job, and the garage can make it without ever seeing it', () => {
  const js = read('assets/js/garage.js'), e = read('supabase/functions/garage-app/index.ts'), m = read('supabase/migrations/20270134000000_admin_garages_code_issue.sql');
  assert.match(js, /api\('code_issue'/); assert.match(js, /Vehicle picked up: make the customer/); assert.match(js, /No code for this job, continue/);
  assert.match(e, /action === 'code_issue'/); assert.match(e, /WRITE_ACTIONS = \['code_issue'/);
  assert.match(e.slice(e.indexOf("action === 'code_issue'"), e.indexOf("action === 'verify_code'")), /return json\(req, \{ ok: true, already: !!r\.already \}\)/);
  assert.doesNotMatch(m.slice(m.indexOf('create or replace function public.garage_code_issue')), /return jsonb_build_object\('ok', true, 'code'/);
  assert.match(m, /grant execute on function public\.garage_code_issue\(uuid, uuid\) to service_role/);
});
test('admins who are not the owner can pick a partner garage and use the Garages screen', () => {
  const m = read('supabase/migrations/20270134000000_admin_garages_code_issue.sql');
  assert.match(m, /crm_garage_picker[\s\S]*perform public\.flow_need\(\)/); assert.match(m, /admin_garage_save[\s\S]*kyc_need_admin\(\)/);
  const v = read('admin/garages-view.js'); assert.match(v, /admin_garage_list/); assert.match(v, /admin_garage_save/); assert.match(v, /admin_garage_get/); assert.doesNotMatch(v, /crm_garage_(list|save|get)/);
  assert.match(read('admin/admin.js'), /can: \(\) => \['owner', 'admin'\]\.includes\(S\.me\?\.role\)/);
});
test('a garage estimate can be approved even though no doorstep mechanic ever set a visit stage', () => {
  const m = read('supabase/migrations/20270135000000_garage_quote_gate.sql');
  assert.match(m, /not exists \(select 1 from public\.garage_assignments ga where ga\.lead_id = l\.id and ga\.status in \('received','in_work','ready'\)\)/);
  assert.match(m, /waiting for the confirmation fee/);   // the paid-confirmation rule is untouched
  assert.match(m, /create or replace function public\.crm_quote_save\(p_lead uuid, p_lines jsonb, p_eta jsonb\)/);
});
