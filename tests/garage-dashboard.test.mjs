import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { garageDashboard, cleanLocation, istDay } from '../supabase/functions/_shared/garage.ts';
const require = createRequire(import.meta.url);
const G = require('../assets/js/garage.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PHONE = '9876543210', ADDRESS = '42 Secret Lane, Test Nagar', EMAIL = 'private.person@example.invalid';
const row = (n, status, extra = {}, settlement = null) => ({ assignment: { id: 'A' + n, status, assigned_at: '2026-11-07T04:00:00Z', ...extra }, lead: { booking_id: 'MP-26-27-000' + n, phone: PHONE, address: ADDRESS, email: EMAIL, name: 'Asha Rao' }, vehicle: { brand: 'Honda', model: 'Activa' }, settlement });

test('dashboard: today, open now, month figures and the amounts Admin entered that are still unpaid', () => {
  const d = garageDashboard({ today: '2026-11-07', garage: { name: 'Test Garage', city: 'Bengaluru', is_open: true, shop_loc_at: '2026-11-06T09:00:00Z' }, rows: [
    row(1, 'sent'), row(2, 'in_work', { assigned_at: '2026-11-05T04:00:00Z' }),
    row(3, 'returned', { assigned_at: '2026-11-02T04:00:00Z', returned_at: '2026-11-04T12:00:00Z' }, { amount: 1850, settled: true }),
    row(4, 'ready', { assigned_at: '2026-11-03T04:00:00Z', ready_at: '2026-11-06T12:00:00Z' }, { amount: 640.5, settled: false }),
    row(5, 'returned', { assigned_at: '2026-10-20T04:00:00Z', returned_at: '2026-10-22T12:00:00Z' }, { amount: 999, settled: false }),
    row(6, 'cancelled', { assigned_at: '2026-11-07T04:00:00Z' })] });
  assert.equal(d.today_jobs, 1, 'only today, not the cancelled one'); assert.equal(d.open_jobs, 3, 'sent, in work and ready');
  assert.deepEqual(d.month, { jobs: 4, completed: 2, avg_ticket: 1245.25 }, 'October job excluded; average of the amounts Admin typed (1850, 640.5)');
  assert.equal(d.unsettled.length, 2); assert.equal(d.unsettled_total, 1639.5); assert.deepEqual(d.unsettled.map((u) => [u.booking_id, u.amount, u.label, u.direction]), [['MP-26-27-0004', 640.5, 'We owe you', 'we_owe_you'], ['MP-26-27-0005', 999, 'We owe you', 'we_owe_you']]);
  assert.deepEqual(d.location, { set: true, at: '2026-11-06T09:00:00Z' }); assert.equal(d.is_open, true); assert.equal(d.name, 'Test Garage');
});
test('dashboard: an empty garage, a closed shop, no location and no amounts entered yet', () => {
  const d = garageDashboard({ today: '2026-11-07', garage: { name: 'G', is_open: false }, rows: [row(1, 'returned', { returned_at: '2026-11-05T12:00:00Z' })] });
  assert.equal(d.is_open, false); assert.equal(d.month.avg_ticket, null); assert.deepEqual(d.unsettled, []); assert.deepEqual(d.location, { set: false, at: null }); assert.equal(d.city, null);
  assert.equal(garageDashboard({ today: '2026-11-07', garage: {}, rows: [] }).today_jobs, 0);
});
test('dashboard: never a phone, address, email or customer name, whatever the lead row holds', () => {
  const d = garageDashboard({ today: '2026-11-07', garage: { name: 'Test Garage' }, rows: [row(4, 'ready', { ready_at: '2026-11-06T12:00:00Z' }, { amount: 100, settled: false, note: `call ${PHONE}` })] }), out = JSON.stringify(d);
  for (const bad of [PHONE, ADDRESS, EMAIL, 'Secret Lane', 'Asha Rao']) assert.ok(!out.includes(bad), bad);
  assert.deepEqual(Object.keys(d).sort(), ['city', 'is_open', 'location', 'month', 'name', 'open_jobs', 'today_jobs', 'unsettled', 'unsettled_total']);
});
test('IST day and location cleaning', () => {
  assert.equal(istDay('2026-11-07T20:00:00Z'), '2026-11-08'); assert.equal(istDay('x'), null); assert.equal(istDay(null), null);
  assert.deepEqual(cleanLocation({ lat: 12.97161234, lng: '77.59461234', acc: 35.4 }), { ok: true, lat: 12.971612, lng: 77.594612, acc: 35 });
  assert.deepEqual(cleanLocation({ lat: 12.9, lng: 77.5 }), { ok: true, lat: 12.9, lng: 77.5, acc: null });
  for (const bad of [{}, { lat: 'x', lng: 77 }, { lat: 91, lng: 77 }, { lat: 0, lng: 0 }, { lat: 12, lng: 200 }, { lat: null, lng: null }, { lat: NaN, lng: 77 }]) assert.equal(cleanLocation(bad).ok, false, JSON.stringify(bad));
  assert.equal(cleanLocation({ lat: 12.9, lng: 77.5, acc: -5 }).acc, null); assert.equal(cleanLocation({ lat: 12.9, lng: 77.5, acc: 999999 }).acc, null);
});
test('garage-app: the new actions are listed, session-guarded and use the new database functions only', () => {
  const f = read('supabase/functions/garage-app/index.ts');
  assert.match(f, /const ACTIONS = \[[^\]]*'dashboard', 'location_set', 'open_set'(, 'verify_code')?\]/);   // J3 added verify_code at the end
  const afterSession = f.slice(f.indexOf('const claims = await verifySession')); for (const a of ['location_set', 'open_set', "'dashboard'"]) assert.ok(afterSession.includes(a), a + ' is after the session check');
  assert.match(f, /rpc\('garage_location_set'/); assert.match(f, /rpc\('garage_open_set'/); assert.match(f, /cleanLocation\(b\)/);
  assert.ok(!/\.from\('leads'\)\.select\('\*'\)/.test(f) && !/address|email/.test(f.slice(f.indexOf("if (action === 'dashboard')"), f.indexOf("if (action === 'jobs')"))), 'the dashboard reads no address or email');
});
test('garage app: Home first, Open/Closed, monthly figures, shop location, never blocked by a refused permission', () => {
  const j = read('assets/js/garage.js');
  assert.match(j, /\['home', 'Home'\], \['jobs', 'Jobs'\]/); assert.match(j, /openHome\(true\)/); assert.match(j, /'Get my jobs'/); assert.match(j, /'Update shop location'/); assert.match(j, /'Previous unsettled \('/); assert.match(j, /'We owe you'|u\.label/);
  assert.match(j, /locAsked\(win\)/, 'asks once per phone'); assert.match(j, /fail\(\)/, 'a refusal only shows a note'); assert.ok(!/throw|alert\(/.test(j.slice(j.indexOf('function saveLocation'), j.indexOf('function setOpen'))));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(/.test(j));
  assert.equal(G.locText({ set: false }), 'Not saved yet'); assert.match(G.locText({ set: true, at: '2026-11-07T10:00:00Z' }), /^Saved 7 Nov, 3:30 pm$/);
  const mem = {}, win = { localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } } };
  assert.equal(G.locAsked(win), false); G.markLocAsked(win); assert.equal(G.locAsked(win), true);
  assert.equal(G.locAsked({ localStorage: { getItem() { throw new Error('blocked'); } } }), true, 'storage blocked: never nag');
});
test('css: the shared dashboard classes exist and use no inline or external resource', () => {
  const c = read('assets/css/garage.css'); for (const k of ['.d-banner', '.d-card', '.d-toggle', '.d-opt', '.d-stats', '.d-fold', '.d-fig', '.d-qr', '.g-tabs-4', '.g-tabs-2']) assert.ok(c.includes(k), k);
  assert.ok(!/@import|url\(http/.test(c));
});
