// The client's garage BRD: 15 minute accept window, decline with a reason, cancel requests, receiving checklist, announcements,
// view-only profile, performance, change requests, and a view-only mode for a suspended garage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../assets/js/garage.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = code(read('supabase/migrations/20270130000000_garage_brd.sql'));
const fn = (name) => { const i = sql.indexOf('function public.' + name); return sql.slice(i, sql.indexOf('end $$;', i)); };

test('the receiving checklist comes after the vehicle is found and before the code, and an older job detail is not blocked', () => {
  const j = (o = {}) => ({ status: 'received', code_needed: true, code: 'none', ...o });
  assert.equal(G.jobPage(j({ receiving: { done: false } }), { arrived: true, found: true }), 'receive');
  assert.equal(G.jobPage(j({ receiving: { done: true } }), { arrived: true, found: true }), 'code');
  assert.equal(G.jobPage(j(), { arrived: true, found: true }), 'code');   // no receiving field: treated as done
  assert.equal(G.jobPage(j({ code_needed: false, receiving: { done: false } }), {}), 'receive');
  assert.equal(G.jobPage(j({ code_needed: false, receiving: { done: true } }), {}), 'inspect');
  assert.ok(G.PAGES.indexOf('receive') > G.PAGES.indexOf('phone') && G.PAGES.indexOf('receive') < G.PAGES.indexOf('code'));
});
test('declining needs a reason, only works on an unaccepted offer, and counts the week (first one free); nothing is charged', () => {
  const d = fn('garage_decline');
  assert.match(d, /a\.status <> 'sent'/); assert.match(d, /char_length\(r\) < 5/); assert.match(d, /crm_has_pii\(r\)/); assert.match(d, /cancel_kind = 'declined'/); assert.match(d, /free_used', n > 1/);
  assert.doesNotMatch(sql, /insert into public\.\w*(penalty|deduction)/i);
});
test('an offer nobody accepts within 15 minutes goes back to Dispatch', () => {
  assert.match(sql, /offer_expires_at timestamptz default \(now\(\) \+ interval '15 minutes'\)/);
  const e = fn('garage_offers_expire'); assert.match(e, /a\.status = 'sent'/); assert.match(e, /a\.offer_expires_at < now\(\)/); assert.match(e, /cancel_kind = 'expired'/); assert.match(e, /back with Dispatch/);
  assert.match(read('supabase/functions/desk-automation/index.ts'), /rpc\('garage_offers_expire'\)/);
  assert.match(sql, /d\.cancel_kind in \('declined', 'expired'\)/);   // not offered again to the same garage in Live leads
});
test('after accepting, a garage can only ask to cancel; the desk decides', () => {
  const c = fn('garage_cancel_request'); assert.match(c, /a\.status not in \('received', 'in_work'\)/); assert.match(c, /garage_cancel_requests/);
  const d = fn('crm_garage_request_decide'); assert.match(d, /garage_staff_need\(\)/); assert.match(d, /p_decision = 'declined' and n is null/); assert.match(d, /cancel_kind = 'garage_cancelled'/);
});
test('bank and working-hours changes are requests; a bank request carries no numbers', () => {
  const c = fn('garage_change_request'); assert.match(c, /Do not type account or ID numbers/); assert.match(c, /ot >= ct/);
  const d = fn('crm_garage_request_decide'); assert.match(d, /update public\.garages set open_days = c\.details ->> 'open_days'/); assert.doesNotMatch(d, /garage_bank/);
});
test('the receiving checklist needs the odometer, all five points, and 1 to 6 photos in this garage and job folder', () => {
  const r = fn('garage_receiving_save'); assert.match(r, /p_odometer > 999999/); assert.match(r, /< 5 then/); assert.match(r, /cardinality\(ph\) < 1 or cardinality\(ph\) > 6/); assert.match(r, /p not like g\.id::text \|\| '\/' \|\| a\.id::text \|\| '\/%'/);
});
test('announcements: staff publish, every garage reads, unread counts per garage', () => {
  assert.match(fn('crm_announcement_save'), /garage_staff_need\(\)/); assert.match(fn('garage_announcements_list'), /garage_announcement_reads/);
  assert.match(sql, /garage_announcements_list\(uuid\), public\.garage_announcement_read\(uuid, uuid\)[^;]*to service_role/);
});
test('a suspended garage can sign in and look, and the app refuses every change', () => {
  assert.match(fn('garage_session_check'), /'suspended', \(g\.status = 'paused' or g\.ops_state = 'suspended'\)/); assert.doesNotMatch(fn('garage_session_check'), /g\.status = 'paused' then return/);
  const f = read('supabase/functions/garage-app/index.ts'); assert.match(f, /who\.suspended && WRITE_ACTIONS\.includes\(action\)/);
  for (const a of ['progress', 'estimate_submit', 'claim', 'decline', 'cancel_request', 'change_request', 'receiving_save', 'live_add', 'verify_code']) assert.ok(new RegExp("const WRITE_ACTIONS = \\[[^\\]]*'" + a + "'").test(f), a);
  for (const a of ['jobs', 'dashboard', 'statement', 'profile', 'performance', 'announcements']) assert.ok(!new RegExp("const WRITE_ACTIONS = \\[[^\\]]*'" + a + "'").test(f), a + ' stays readable');
});
test('the app: Decline with a reason, a real countdown, the receiving page, announcements, profile and performance, requests, cancel ask', () => {
  const g = read('assets/js/garage.js');
  assert.match(g, /api\('decline'/); assert.match(g, /offer_expires_at/); assert.match(g, /api\('receiving_save'/); assert.match(g, /api\('announcements'\)/); assert.match(g, /api\('profile'\)/); assert.match(g, /api\('performance'\)/);
  assert.match(g, /api\('change_request'/); assert.match(g, /api\('cancel_request'/); assert.match(g, /function renderAnnouncements/); assert.match(g, /function renderAccount/); assert.match(g, /Your account is suspended/);
  assert.doesNotMatch(g, /Can’t take it/);
});
test('Crew and Admin: a Requests tab and an Announcements tab in the garage screen', () => {
  for (const d of ['crm', 'admin']) { const s = read(d + '/garage-desk.js'); assert.match(s, /crm_garage_requests_list/); assert.match(s, /crm_garage_request_decide/); assert.match(s, /crm_announcement_save/); assert.match(s, /crm_announcement_archive/); }
  assert.equal(read('crm/garage-desk.js'), read('admin/garage-desk.js'));
});
test('a job accepted before the receiving checklist existed is not sent back to it', () => {
  const f = read('supabase/functions/garage-app/index.ts'); assert.match(f, /RECEIVING_FROM = Date\.parse\('2026-11-10T00:00:00\+05:30'\)/); assert.match(f, /Date\.parse\(a\.received_at\) < RECEIVING_FROM/);
});
