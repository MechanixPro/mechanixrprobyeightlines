import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectVehicle, cleanVehicle, vehicleCols, upgradeVehicle, CAR_WORDS, PARTS_WORDS, BIKE_WORDS } from '../supabase/functions/_shared/vehicle.ts';
import { VEHICLES, VEHICLE_LABEL, vehicleOf, canSetVehicle, vehicleCounts } from '../crm/crm-rules.js';
import { vehicleTag } from '../crm/ui.js';
import * as adminView from '../admin/lead-view.js';
import { MENU } from '../supabase/functions/_shared/agentive.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const mig = read('supabase/migrations/20261226000000_lead_vehicle.sql');

// ---- detector ----
test('detectVehicle: clear car, parts and bike wording', () => {
  for (const t of ['I need a car service', 'Cars service price?', 'my Swift needs service', 'Hyundai i20 service', 'Creta brake check', 'baleno', 'Brezza', 'Wagon R', 'WagonR service', 'alto 800', 'Nexon', 'Innova', 'four wheeler service', '4 wheeler', 'four-wheeler', 'CAR SERVICE', 'campaign car_service_ad', 'Called the IVR and pressed 4: Car service or parts.']) assert.equal(detectVehicle(t), 'car', t);
  for (const t of ['Axlio brake pads', 'need spare parts', 'spare part for Activa', 'car parts price', 'axlio_parts_ads']) assert.equal(detectVehicle(t), 'parts', t);
  for (const t of ['Activa service', 'my bike will not start', 'scooty repair', 'Splendor']) assert.equal(detectVehicle(t), 'bike', t);
});
test('detectVehicle: look-alike words never misfire', () => {
  for (const t of ['scar on the tank', 'carpet cleaning', 'parts of Bangalore', 'carbon filter', 'care buddy', 'Carlton road', 'caramel', 'discard', 'cart', 'waltonic', 'swiftly', 'altogether', 'innovation', 'hi', '', '   ', null, undefined, 42]) assert.equal(detectVehicle(t), null, String(t));
  assert.equal(detectVehicle('bike and car both'), null);          // ambiguous: keep what the lead has
  assert.equal(detectVehicle('parts'), null);                       // a bare word is not enough
  assert.equal(detectVehicle('brake pad for my bike'), 'bike');     // bike service wording is not a parts lead
});
test('cleanVehicle and vehicleCols: only car or parts add columns, so bike leads insert exactly as before', () => {
  assert.equal(cleanVehicle('CAR'), null); assert.equal(cleanVehicle('car'), 'car'); assert.equal(cleanVehicle('boat'), null);
  assert.deepEqual(vehicleCols('car'), { vehicle: 'car', vehicle_source: 'auto' }); assert.deepEqual(vehicleCols('parts'), { vehicle: 'parts', vehicle_source: 'auto' });
  assert.deepEqual(vehicleCols('bike'), {}); assert.deepEqual(vehicleCols(null), {});
});

// ---- the SQL detector mirrors the TypeScript one ----
test('detect_vehicle in the migration uses the same word lists as _shared/vehicle.ts', () => {
  const fn = mig.slice(mig.indexOf('function public.detect_vehicle'), mig.indexOf('-- ─────────────────────────', mig.indexOf('function public.detect_vehicle')));
  const re = (name) => new RegExp(String.raw`${name} := t ~ '\\m\(([^']+)\)\\M'`).exec(fn)?.[1];
  const car = /car := t ~ '\\m\(([^']+)\)\\M'/.exec(fn)[1], bike = /bike := t ~ '\\m\(([^']+)\)\\M'/.exec(fn)[1], parts = /if t ~ '\\m\(([^']+)\)\\M' then return 'parts'/.exec(fn)[1];
  // Emulate the SQL: lower, - _ . / to spaces, collapse spaces, whole-word regexes, same order.
  const sql = (p) => {
    if (p == null || String(p).trim() === '') return null;
    const t = String(p).toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ');
    const w = (src) => new RegExp(`(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`);
    if (w(parts).test(t)) return 'parts';
    const c = w(car).test(t), b = w(bike).test(t);
    if (c && b) return null;
    return c ? 'car' : b ? 'bike' : null;
  };
  const samples = ['', 'hi', 'bike and car', 'scar', 'carpet', 'parts of Bangalore', 'brake pad bike', 'Axlio', 'spare parts', ...CAR_WORDS, ...PARTS_WORDS, ...BIKE_WORDS,
    ...CAR_WORDS.map((w) => `need ${w} service`), ...CAR_WORDS.map((w) => `x${w}`), ...CAR_WORDS.map((w) => `${w}x`), 'car_service_ad', 'four-wheeler', 'Wagon-R'];
  for (const s of samples) assert.equal(sql(s), detectVehicle(s), JSON.stringify(s));
  for (const [list, src] of [[CAR_WORDS, car], [BIKE_WORDS, bike], [PARTS_WORDS, parts]]) for (const w of list) assert.ok(new RegExp(`(?:^|\\|)${w.replace(/ /g, ' ').replace(/s$/, 's?').replace(/^(.*)$/, '$1')}`).source && src.split('|').some((a) => new RegExp(`^${a}$`).test(w)), 'SQL list covers ' + w);
});

// ---- migration ----
test('migration: column with default bike, a check, a source column, idempotent', () => {
  assert.match(mig, /add column if not exists vehicle text not null default 'bike' check \(vehicle in \('bike','car','parts'\)\)/);
  assert.match(mig, /add column if not exists vehicle_source text check \(vehicle_source in \('auto','desk'\)\)/);
  assert.doesNotMatch(mig, /add column (?!if not exists)/); assert.doesNotMatch(mig, /create index (?!if not exists)/);
  assert.doesNotMatch(mig, /disable row level security/i);
  assert.match(mig, /create or replace function public\.detect_vehicle/); assert.match(mig, /drop function if exists public\.crm_leads_list\(text, text, uuid, date, date, integer\);/);
});
test('migration backfill is conservative: only default bike leads with no source, only car/parts set, nothing else touched', () => {
  const b = mig.slice(mig.indexOf('declare n_car int'), mig.indexOf('raise notice'));
  assert.match(b, /where l\.vehicle = 'bike' and l\.vehicle_source is null/);   // a desk edit (source desk) or an earlier run is never looked at
  assert.match(b, /set vehicle = t\.v, vehicle_source = 'auto' from t where t\.id = l\.id and t\.v in \('car', 'parts'\)/);
  assert.match(b, /m\.direction = 'in' and m\.sender = 'customer'/);              // customer words only, not staff notes
  assert.doesNotMatch(b, /set [^;]*\b(status|booking_id|ref|junk_[a-z]+|paid_amount)\s*=/);
  assert.match(b, /disable trigger leads_touch/); assert.match(b, /enable trigger leads_touch/);
  assert.match(mig, /raise notice 'lead vehicle backfill/);
});
test('set_lead_vehicle: security definer, desk roles who see the lead and admins, writes desk source, history and audit', () => {
  const f = mig.slice(mig.indexOf('function public.set_lead_vehicle'), mig.indexOf('grant execute on function public.set_lead_vehicle'));
  for (const s of ['security definer set search_path = public', "not in ('bike','car','parts')", 'for update', 'public.is_admin()', "crm_require('edit_leads')", 'coalesce(public.crm_can_see(l, r), false)', "vehicle_source = 'desk'",
    'insert into public.crm_activities', "'edit'", 'upper(l.vehicle)', "'lead_vehicle_set'", 'auth.uid()']) assert.ok(f.includes(s), s);
  assert.match(mig, /revoke all on function public\.set_lead_vehicle\(uuid, text\) from public, anon;\ngrant execute on function public\.set_lead_vehicle\(uuid, text\) to authenticated;/);
  assert.match(mig, /revoke all on function public\.detect_vehicle\(text\) from public, anon, authenticated/);
});
test('desk functions return the vehicle and the list functions filter by it; junk, booking IDs and permissions are as before', () => {
  assert.match(mig, /create or replace view public\.crm_desk_leads as select \* from public\.leads where source is distinct from 'website';/);
  const old = read('supabase/migrations/20261225000000_booking_id_after_confirmation.sql');
  const fnOf = (src, name) => { const i = src.indexOf('create or replace function public.' + name + '('); return src.slice(i, src.indexOf('end; $$;', i)); };
  for (const n of ['crm_leads_list', 'crm_my_leads']) {
    const a = fnOf(mig, n), o = fnOf(old, n);
    assert.match(a, /p_vehicle text default null/); assert.match(a, /booking_id text, vehicle text\)/); assert.match(a, /l\.booking_id, l\.vehicle\n/); assert.match(a, /nullif\(p_vehicle, ''\) is null or l\.vehicle = p_vehicle/);
    // identical to the old body once the vehicle pieces are taken out
    const strip = (x) => x.replace(/, p_vehicle text default null/, '').replace(/, vehicle text\)/, ')').replace(/, l\.vehicle\n/, '\n').replace(/    and \(nullif\(p_vehicle, ''\) is null or l\.vehicle = p_vehicle\)\n/, '');
    assert.equal(strip(a), o, n + ' body unchanged apart from the vehicle');
  }
  const lead = fnOf(mig, 'crm_lead'); assert.match(lead, /'vehicle', l\.vehicle, 'vehicle_source', l\.vehicle_source/); assert.match(lead, /crm_can_see\(l, r\)/);
  const web = fnOf(mig, 'crm_web_leads'); assert.match(web, /'vehicle', l\.vehicle/); assert.match(web, /p_vehicle text default null/); assert.match(web, /l\.status <> 'junk'/);
  const sum = fnOf(mig, 'crm_leads_summary'); assert.match(sum, /by_vehicle/); assert.match(sum, /status <> 'junk'/); assert.match(sum, /'junk', \(select count\(\*\)/);
  const dash = fnOf(mig, 'crm_dashboard'); assert.match(dash, /by_vehicle/); assert.match(dash, /status <> 'junk'/); assert.match(dash, /view_attribution/); assert.match(dash, /view_team_performance/);
  assert.match(mig, /'crm_leads_list\(text,text,uuid,date,date,integer,text\)','crm_my_leads\(text,text,text\)','crm_leads_summary\(date,date,uuid,text\)'/);
  assert.doesNotMatch(mig, /junk_prev_status|confirm_booking|invoice_no_alloc|leads_private_ref/);   // booking-ID and junk rules are not rewritten here
});

// ---- Edge Functions ----
function fakeDb(rows) {
  const calls = [];
  const q = (patch) => { const f = []; const b = { eq(c, v) { f.push([c, v]); return b; }, or(x) { f.push(['or', x]); return b; },
    select() { calls.push({ patch, f }); const hit = rows.filter((r) => f.every(([c, v]) => (c === 'or' ? (r.vehicle_source == null || r.vehicle_source === 'auto') : r[c] === v))); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })) }); } }; return b; };
  return { calls, from: () => ({ update: q }) };
}
test('upgradeVehicle: bike goes to car once, a desk tag is never overridden, a tagged lead never goes back', async () => {
  const rows = [{ id: 'a', vehicle: 'bike', vehicle_source: null }, { id: 'b', vehicle: 'bike', vehicle_source: 'desk' }, { id: 'c', vehicle: 'car', vehicle_source: 'auto' }, { id: 'd', vehicle: 'bike', vehicle_source: 'auto' }];
  const db = fakeDb(rows);
  assert.equal(await upgradeVehicle(db, 'a', 'car'), true); assert.equal(rows[0].vehicle, 'car'); assert.equal(rows[0].vehicle_source, 'auto');
  assert.equal(await upgradeVehicle(db, 'b', 'car'), false); assert.equal(rows[1].vehicle, 'bike'); assert.equal(rows[1].vehicle_source, 'desk');
  assert.equal(await upgradeVehicle(db, 'c', 'parts'), false); assert.equal(rows[2].vehicle, 'car');   // already moved once
  assert.equal(await upgradeVehicle(db, 'd', 'parts'), true);
  assert.equal(await upgradeVehicle(db, 'a', 'bike'), false); assert.equal(await upgradeVehicle(db, 'a', null), false); assert.equal(await upgradeVehicle(db, '', 'car'), false);
  assert.equal(await upgradeVehicle({ from() { throw new Error('boom'); } }, 'a', 'car'), false);   // never breaks the caller
});
test('Edge Functions tag by inbound text or call option, and never write the desk source', () => {
  const sl = read('supabase/functions/submit-lead/index.ts'), al = read('supabase/functions/aisensy-lead/index.ts'), wh = read('supabase/functions/whatsapp-webhook/index.ts'),
    ib = read('supabase/functions/_shared/inbound.ts'), iv = read('supabase/functions/agentive-ivr/index.ts');
  assert.match(sl, /cleanVehicle\(b\.vehicle\) \?\? detectVehicle\(/); assert.match(sl, /\.\.\.extra, \.\.\.vehicleCols\(vehicle\)/);
  assert.match(al, /\.\.\.vehicleCols\(detectVehicle\(\[x\.campaign, x\.note, x\.bike_brand, x\.bike_model\]/);
  assert.match(wh, /\.\.\.vehicleCols\(detectVehicle\(text\)\)/); assert.match(wh, /upgradeVehicle\(db, lead\.id, detectVehicle\(text\)\)/);
  assert.match(ib, /\.\.\.vehicleCols\(detectVehicle\(x\.text\)\)/); assert.match(ib, /upgradeVehicle\(db, lead\.id, detectVehicle\(x\.text\)\)/);
  assert.match(iv, /vehicleCols\(item\?\.vehicle \?\? detectVehicle\(k\.keyLabel\)\)/); assert.match(iv, /upgradeVehicle\(db, lead\.id, item\?\.vehicle/);
  assert.equal(MENU['4'].vehicle, 'car'); for (const k of ['1', '2', '3', '5-1', '5-2', '0']) assert.equal(MENU[k].vehicle, undefined, k);
  for (const f of [sl, al, wh, ib, iv]) assert.doesNotMatch(f, /vehicle_source: 'desk'/);
  assert.match(read('supabase/functions/_shared/vehicle.ts'), /\.or\('vehicle_source\.is\.null,vehicle_source\.eq\.auto'\)/);
  // template parameter counts are untouched: no template call was edited
  assert.doesNotMatch(sl + wh + iv, /vehicle[^\n]*(params|sendTemplate|sendCampaign)/);
});
test('the daily report adds a bike, car, parts line and still goes out when the column is missing', () => {
  const r = read('supabase/functions/desk-daily-report/index.ts');
  assert.match(r, /select\('vehicle'\)/); assert.match(r, /vq\.error \? null/); assert.match(r, /By vehicle/);
});

// ---- Crew and Admin screens ----
test('crew rules: vehicle helpers', () => {
  assert.deepEqual(VEHICLES, ['bike', 'car', 'parts']); assert.deepEqual(VEHICLE_LABEL, { bike: 'BIKE', car: 'CAR', parts: 'PARTS' });
  assert.equal(vehicleOf({ vehicle: 'car' }), 'car'); assert.equal(vehicleOf({}), 'bike'); assert.equal(vehicleOf({ vehicle: 'boat' }), 'bike'); assert.equal(vehicleOf(null), 'bike');
  assert.equal(canSetVehicle({ status: 'new' }, { canEdit: true, mineOrBoss: true }), true);
  assert.equal(canSetVehicle({ status: 'new' }, { canEdit: false, mineOrBoss: true }), false); assert.equal(canSetVehicle({ status: 'new' }, { canEdit: true, mineOrBoss: false }), false);
  assert.equal(canSetVehicle({ status: 'junk' }, { canEdit: true, mineOrBoss: true }), false); assert.equal(canSetVehicle(null, { canEdit: true, mineOrBoss: true }), false);
  assert.deepEqual(vehicleCounts([{ vehicle: 'car' }, { vehicle: 'car', status: 'junk' }, { vehicle: 'parts' }, {}, { vehicle: 'bike' }]), { bike: 2, car: 1, parts: 1 });   // junk is not counted
});
test('the badge is plain text in a chip and escapes nothing it should not trust', () => {
  assert.match(vehicleTag('car'), /class="chip veh veh-car"[^>]*>CAR</); assert.match(vehicleTag('parts'), />PARTS</); assert.match(vehicleTag('bike'), />BIKE</);
  assert.match(vehicleTag('<script>'), />BIKE</); assert.doesNotMatch(vehicleTag('<script>'), /script/);
});
test('Crew and Admin show the badge, filter and desk control through set_lead_vehicle, without inline scripts', () => {
  const crm = read('crm/crm.js'), leads = read('crm/pages/leads.js'), web = read('crm/pages/webleads.js'), adm = read('admin/admin.js');
  assert.match(crm, /vehicleTag\(vehicleOf\(l\)\)/); assert.match(crm, /id=\"vehSel\"/); assert.match(crm, /rpc\('set_lead_vehicle', \{ p_lead: s\.dataset\.lead, p_vehicle: s\.value \}\)/);
  assert.match(crm, /canSetVehicle\(l, \{ canEdit: can\('edit_leads'\), mineOrBoss \}\)/);
  assert.match(leads, /p_vehicle: st\.vehicle \|\| null/); assert.match(leads, /id="vehicle"/); assert.match(leads, /vehicleTag\(vehicleOf\(r\)\)/); assert.match(leads, /by_vehicle/);
  assert.match(web, /p_vehicle: st\.vehicle \|\| null/); assert.match(web, /vehicleTag\(vehicleOf\(r\)\)/);
  assert.match(adm, /id="fv"/); assert.match(adm, /rpc\('set_lead_vehicle'/); assert.match(adm, /id="vsel"/); assert.match(adm, /vehicleOf\(l\) === S\.vehicle/);
  for (const f of [crm, leads, web]) assert.doesNotMatch(f, /\son(click|change|input)=/);
  assert.equal(adminView.vehicleOf({ vehicle: 'parts' }), 'parts'); assert.equal(adminView.vehicleOf({}), 'bike');
  assert.deepEqual(adminView.sourceReport([{ vehicle: 'car' }, { vehicle: 'car' }, {}, { vehicle: 'parts' }]).vehicle, [['CAR', 2], ['BIKE', 1], ['PARTS', 1]]);
});
