import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { conversionReport, leadMetrics, lastDays, istDate, LOST_REASONS } from '../crm/crm-rules.js';
import * as admin from '../admin/booking-steps.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261227000000_crew_conversion.sql');
const fn = (name) => { const i = sql.indexOf('create or replace function public.' + name + '('); return sql.slice(i, sql.indexOf('end; $$;', i)); };
const base = '2026-11-05T04:00:00Z';   // 9:30 AM IST
const at = (min) => new Date(new Date(base).getTime() + min * 60e3).toISOString();
const R = (o) => ({ created_at: base, status: 'new', booking_id: null, vehicle: 'bike', platform: 'google', source: 'website', crm_first_contact_at: null, crm_lost_reason: null, ...o });
const rows = [
  R({ crm_first_contact_at: at(7), status: 'contacted' }),                                                    // called in 7 min
  R({ crm_first_contact_at: at(15), status: 'quoted' }),                                                      // exactly 15 min: counts
  R({ crm_first_contact_at: at(16), status: 'payment_sent', platform: 'instagram' }),                         // 16 min: late
  R({ crm_first_contact_at: at(5), status: 'scheduled', booking_id: 'MP-1', vehicle: 'car', platform: 'instagram' }),
  R({ crm_first_contact_at: at(3), status: 'completed', booking_id: 'MP-2', platform: 'instagram' }),
  R({ status: 'lost', crm_lost_reason: 'Price too high', vehicle: 'parts', platform: null, source: 'whatsapp' }),   // never contacted
  R({ status: 'lost', crm_lost_reason: 'Other', crm_first_contact_at: at(60), vehicle: 'car' }),
  R({ status: 'lost', crm_lost_reason: null }),                                                               // an old lead with no reason
  R({ status: 'junk' }),                                                                                       // junk is not a lead
  R({}),                                                                                                       // new, untouched
];

test('the totals: leads, called within 15 minutes, quotes, confirmed, scheduled, done, lost', () => {
  const m = leadMetrics(rows, 15);
  assert.equal(m.leads, 9);                       // junk left out
  assert.equal(m.contacted, 6); assert.equal(m.within, 4);   // 7, 15, 5, 3 min
  assert.equal(m.withinPct, 44);                  // 4 of 9
  assert.equal(m.quotes, 4);                      // quoted, payment_sent, scheduled, completed
  assert.equal(m.confirmed, 2); assert.equal(m.confirmedPct, 22);
  assert.equal(m.scheduled, 2); assert.equal(m.done, 1); assert.equal(m.lost, 3);
});
test('lost reasons are counted, an old lead with no reason is shown as that, and nothing is rewritten', () => {
  const r = leadMetrics(rows).lostReasons;
  assert.deepEqual(r.map((x) => [x.reason, x.n]).sort(), [['No reason recorded', 1], ['Other', 1], ['Price too high', 1]]);
  assert.equal(leadMetrics([R({ status: 'lost', crm_lost_reason: 'No answer' })]).lostReasons[0].reason, 'No answer');   // legacy wording stays as saved
});
test('the report splits by vehicle (bike, car, parts) and sums back to the total', () => {
  const rep = conversionReport(rows);
  assert.deepEqual(['bike', 'car', 'parts'].map((v) => rep.byVehicle[v].leads), [6, 2, 1]);
  assert.equal(rep.byVehicle.car.confirmed, 1); assert.equal(rep.byVehicle.bike.done, 1);
  assert.equal(rep.byVehicle.bike.leads + rep.byVehicle.car.leads + rep.byVehicle.parts.leads, rep.total.leads);
});
test('the report splits by source with friendly names, biggest first', () => {
  const rep = conversionReport(rows), by = Object.fromEntries(rep.bySource.map((x) => [x.source, x]));
  assert.equal(by['Google Ads'].leads, 5); assert.equal(by['Meta (Instagram)'].leads, 3); assert.equal(by.WhatsApp.leads, 1);
  assert.equal(rep.bySource[0].source, 'Google Ads');
  assert.equal(rep.bySource.reduce((n, x) => n + x.leads, 0), rep.total.leads);
});
test('the report splits by day in India time', () => {
  const late = R({ created_at: '2026-11-05T19:00:00Z' });   // 12:30 AM IST on the 6th
  const rep = conversionReport([...rows, late]);
  assert.deepEqual(rep.daily.map((d) => [d.date, d.leads]), [['2026-11-05', 9], ['2026-11-06', 1]]);
  assert.equal(istDate('2026-11-05T19:00:00Z'), '2026-11-06');
});
test('an empty range gives zeros, not NaN', () => {
  const m = leadMetrics([]);
  assert.equal(m.withinPct, 0); assert.equal(m.confirmedPct, 0); assert.deepEqual(m.lostReasons, []);
  assert.equal(conversionReport([]).daily.length, 0);
});
test('Today and Last 7 days are whole India-time days', () => {
  const now = Date.parse('2026-11-05T20:00:00Z');   // already the 6th in India
  assert.deepEqual(lastDays(1, now), { from: '2026-11-06', to: '2026-11-06' });
  assert.deepEqual(lastDays(7, now), { from: '2026-10-31', to: '2026-11-06' });
});
test('there is no cost per booking, because no ad spend is stored anywhere in the repo', () => {
  const rep = conversionReport(rows);
  for (const k of ['cost', 'costPerBooking', 'spend']) assert.equal(k in rep.total, false);
  assert.doesNotMatch(read('crm/pages/conversion.js') + read('crm/crm-rules.js'), /ad_spend|adspend|costPerBooking|from\('settings'\)/i);
  assert.doesNotMatch(read('supabase/migrations/20261226000000_lead_vehicle.sql') + sql, /ad_spend|adspend/i);
});
test('the admin copy adds up the same as the desk', () => {
  assert.deepEqual(admin.conversionReport(rows), conversionReport(rows));
  assert.deepEqual(admin.leadMetrics(rows, 15), leadMetrics(rows, 15));
});

test('the migration is the next one, one file, and can be run twice', () => {
  const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('20261227000000_crew_conversion.sql') && files.indexOf('20261227000000_crew_conversion.sql') < files.indexOf('20261228000000_paid_confirmation.sql'), 'crew conversion comes before the paid confirmation and everything after it');
  assert.match(sql, /drop trigger if exists leads_lost_reason_guard_tr on public\.leads;\ncreate trigger leads_lost_reason_guard_tr/);
  assert.equal((sql.match(/\ndrop function if exists /g) || []).length, 3);   // only the three list functions that gain a column (crm_web_leads keeps its signature)
  assert.doesNotMatch(sql, /insert into public\.leads|delete from public\.leads|update public\.leads set crm_lost_reason/i);   // old data is not rewritten
});
test('the database refuses lost without a reason, in crm_log, crm_set_outcome and any direct update', () => {
  assert.match(sql, /select array\['Price too high','No answer \(after 3 tries\)','Wrong area','Bought elsewhere','Not now \/ later','Not a real enquiry','Other'\]/);
  for (const name of ['crm_log', 'crm_set_outcome']) {
    const f = fn(name);
    assert.match(f, /crm_lost_reasons\(\)/, name); assert.match(f, /choose why the lead was lost/, name);
    assert.match(f, /p_lost_reason = 'Other' and char_length\(coalesce\(body, ''\)\) < 5/, name);
    assert.doesNotMatch(f, /'Booked elsewhere'|'Not interested'/, name);
  }
  const g = fn('leads_lost_reason_guard');
  assert.match(g, /new\.status = 'lost' and old\.status is distinct from 'lost' and old\.status is distinct from 'junk'/);
  assert.match(g, /choose why the lead was lost/);
  assert.match(sql, /before update of status on public\.leads/);
});
test('crm_log and crm_set_outcome keep every other rule they had', () => {
  const log = fn('crm_log'), out = fn('crm_set_outcome');
  for (const s of ['take the lead first', 'this lead belongs to a colleague', 'this booking is already confirmed', 'a lead cannot move backwards', 'only a supervisor can reopen a lost lead', 'agents cannot set that status; payment sets it', 'set the next follow-up before saving', 'crm_has_pii']) assert.ok(log.includes(s), s);
  for (const s of ['this booking is already won', 'this lead is already lost', 'only a supervisor can reopen a lost lead', "status = 'scheduled'", 'crm_has_pii']) assert.ok(out.includes(s), s);
  assert.match(sql, /grant execute on function public\.crm_log\(uuid, text, text, timestamptz, text, text, text, text\) to authenticated/);
});
test('the conversion rows leave out junk and deleted leads and keep to what the person may see', () => {
  const f = fn('crm_conversion_rows');
  assert.match(f, /security definer/); assert.match(f, /crm_need_page\('dashboard'\)/);
  assert.match(f, /l\.deleted_at is null and l\.status <> 'junk'/); assert.match(f, /crm_can\('view_all_leads'\) or l\.crm_owner is null or l\.crm_owner = auth\.uid\(\)/);
  assert.match(f, /Asia\/Kolkata/);
});
test('Mark done is admin only and only for a scheduled booking with an ID', () => {
  const f = fn('crm_mark_done');
  assert.match(f, /public\.is_admin\(\)/); assert.match(f, /l\.status <> 'scheduled' or l\.booking_id is null/);
  assert.match(sql, /revoke all on function public\.crm_mark_done\(uuid\) from public, anon/);
});
test('the lists give the step bar what it needs and keep their old columns, junk exclusion and vehicle filter', () => {
  const q = fn('crm_queue'), ll = fn('crm_leads_list'), ml = fn('crm_my_leads'), wl = fn('crm_web_leads');
  assert.match(q, /booking_id text, vehicle text\)/); assert.match(q, /public\.crm_desk_leads l/); assert.doesNotMatch(q, /public\.leads l/);
  for (const f of [ll, ml]) { assert.match(f, /first_contact_at timestamptz\)/); assert.match(f, /l\.crm_first_contact_at\n/); assert.match(f, /\(p_filter = 'junk'\) = \(l\.status = 'junk'\)/); assert.match(f, /l\.vehicle = p_vehicle/); assert.match(f, /l\.booking_id, l\.vehicle/); }
  assert.match(wl, /'first_contact_at', l\.crm_first_contact_at/); assert.match(wl, /l\.status = 'junk'/); assert.match(wl, /'booking_id', l\.booking_id/);
});

test('the desk and admin show the steps everywhere a lead appears', () => {
  const crm = read('crm/crm.js'), leads = read('crm/pages/leads.js'), web = read('crm/pages/webleads.js'), adm = read('admin/admin.js');
  assert.match(crm, /\$\{stepper\(l\)\}<div class="timer/);              // My day cards
  assert.match(crm, /\$\{stepper\(l\)\}\$\{nextBtn\(l\)\}/);               // the lead panel
  assert.match(leads, /stepper\(\{ \.\.\.r, status: r\.stage \}, true\)/); assert.match(web, /stepper\(r, true\)/);
  assert.match(adm, /stepBar\(l, true\)/); assert.match(adm, /\$\{stepBar\(l\)\}\$\{nextBtn\(l\)\}/);   // admin rows, board cards and the booking details
  assert.match(adm, /conversionCard\(week, rl\)/);
});
test('the desk refuses illegal jumps and a lost lead without a reason before it calls the database', () => {
  const crm = read('crm/crm.js'), adm = read('admin/admin.js');
  assert.match(crm, /stepGuard\(S\.detail\.lead, target\)/); assert.match(crm, /stepGuard\(S\.detail\.lead, kind === 'won' \? 'schedule' : 'lost'\)/);
  assert.match(crm, /lostReasonCheck\(reason, note\)/);
  assert.match(adm, /lostReasonCheck\(\(\$\('#lr'\)/); assert.match(adm, /upd\.crm_lost_reason = \$\('#lr'\)\.value/);
  assert.match(crm, /rpc\('crm_mark_done'/);
});
test('the dashboard shows conversion to supervisors and the lost reasons', () => {
  assert.match(read('crm/pages/dashboard.js'), /ctx\.can\('view_all_leads'\) \? conversion\.section\(ctx\)/);
  const c = read('crm/pages/conversion.js');
  assert.match(c, /rpc\('crm_conversion_rows'/); assert.match(c, /Why leads were lost/); assert.match(c, /By vehicle/); assert.match(c, /By source/);
});
test('the desk and admin are built separately: each gets its own copy of the step rules', () => {
  assert.match(read('scripts/build_crm.sh'), /cp -R "\$root\/crm" "\$out\/crm"/); assert.match(read('scripts/build_admin.sh'), /cp -R "\$root\/admin" "\$out\/admin"/);
  assert.doesNotMatch(read('admin/booking-steps.js') + read('admin/admin.js'), /from ['"]\.\.\/crm\//);
  assert.doesNotMatch(read('crm/crm-rules.js') + read('crm/crm.js'), /from ['"]\.\.\/admin\//);
});
test('the lost reason list is the same in the database and in the desk', () => {
  const m = sql.match(/select array\[([^\]]+)\]/)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(m, LOST_REASONS);
});
