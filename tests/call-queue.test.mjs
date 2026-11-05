import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callQueue, inCallQueue, waitInfo, WAIT_AMBER, WAIT_RED, WAIT_DARK } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const now = new Date('2026-11-05T12:00:00Z');
const ago = (min) => new Date(now.getTime() - min * 60e3).toISOString();
const lead = (id, min, o = {}) => ({ id, status: 'new', created_at: ago(min), crm_owner: null, crm_first_contact_at: null, booking_id: null, ...o });

test('the wait colours switch past 15 minutes, 2 hours and 24 hours', () => {
  assert.deepEqual([WAIT_AMBER, WAIT_RED, WAIT_DARK], [15, 120, 1440]);
  const tone = (m) => waitInfo(ago(m), now).tone;
  assert.equal(tone(0), 'ok'); assert.equal(tone(15), 'ok'); assert.equal(tone(16), 'amber');
  assert.equal(tone(120), 'amber'); assert.equal(tone(121), 'red');
  assert.equal(tone(1440), 'red'); assert.equal(tone(1441), 'dark'); assert.equal(tone(65 * 60), 'dark');
});
test('the wait reads in minutes, hours and days', () => {
  assert.equal(waitInfo(ago(7), now).label, '7 min');
  assert.equal(waitInfo(ago(192), now).label, '3 h 12 min');
  assert.equal(waitInfo(ago(65 * 60), now).label, '2 d 17 h');
});
test('the queue is oldest first, with the wait and owner flag on each lead', () => {
  const q = callQueue([lead('c', 30), lead('a', 600, { crm_owner: 'u1' }), lead('b', 100)], now);
  assert.deepEqual(q.map((l) => l.id), ['a', 'b', 'c']);
  assert.equal(q[0].wait.tone, 'red'); assert.equal(q[0].unowned, false);
  assert.equal(q[1].wait.tone, 'amber'); assert.equal(q[1].unowned, true);
  assert.equal(q[2].wait.tone, 'amber');
});
test('junk, lost, booked and confirmed leads are never in the queue', () => {
  const rows = [lead('ok', 60), lead('junk', 60, { status: 'junk' }), lead('lost', 60, { status: 'lost' }), lead('paid', 60, { status: 'paid', booking_id: 'MP-1' }), lead('sched', 60, { status: 'scheduled' }),
    lead('done', 60, { status: 'completed' }), lead('id', 60, { booking_id: 'MP-26-26-0001' })];
  assert.deepEqual(callQueue(rows, now).map((l) => l.id), ['ok']);
});
test('a lead that was contacted leaves the queue; one that only has the status new but no contact stays', () => {
  assert.equal(inCallQueue(lead('x', 5, { crm_first_contact_at: ago(1) })), false);
  assert.equal(inCallQueue(lead('x', 5)), true);
  assert.equal(inCallQueue(lead('x', 5, { status: 'contacted' })), true);   // marked contacted somewhere else, but no call or message was ever logged
  assert.equal(inCallQueue(null), false);
});
test('an empty or missing list gives an empty queue', () => {
  assert.deepEqual(callQueue([], now), []); assert.deepEqual(callQueue(null, now), []);
});

test('the Call now tab, count badge, Take this lead and assign use the existing actions', () => {
  const crm = read('crm/crm.js'), page = read('crm/pages/callnow.js');
  assert.match(crm, /id: 'callnow', title: 'Call now'/); assert.match(crm, /id="cqBadge"/);
  assert.match(crm, /rpc\('crm_call_queue'\)/);
  assert.match(page, /Take this lead/); assert.match(page, /rpc\('crm_claim'/); assert.match(page, /rpc\('crm_assign'/);
  assert.match(page, /ctx\.can\('assign_leads'\)/); assert.match(page, /ctx\.can\('take_leads'\)/);   // assigning is only for people who may
  assert.match(page, /setInterval\(tick/); assert.match(page, /clearInterval/);   // a live timer that is cleaned up
  assert.doesNotMatch(page, /\.from\(\s*['"`]/);
});
test('the queue colours are in the stylesheet and are not colour alone', () => {
  const css = read('crm/crm.css');
  for (const c of ['w-amber', 'w-red', 'w-dark', 'unowned']) assert.ok(css.includes('.cq-row.' + c) || css.includes('.' + c + ' .cq-wait'), c);
  assert.match(read('crm/pages/callnow.js'), /cq-wait/);   // the number of minutes is always written out
});

const sql = read('supabase/migrations/20261227000000_crew_conversion.sql');
const fn = (name) => { const i = sql.indexOf('create or replace function public.' + name + '('); return sql.slice(i, sql.indexOf('end; $$;', i)); };
test('crm_call_queue is security definer, checks the role and page, and keeps to what the person may see', () => {
  const f = fn('crm_call_queue');
  assert.match(f, /security definer set search_path = public/); assert.match(f, /crm_need_role\(\)/); assert.match(f, /crm_need_page\('leads'\)/);
  assert.match(f, /crm_can\('view_all_leads'\) or l\.crm_owner is null or l\.crm_owner = auth\.uid\(\)/);
  assert.match(f, /l\.deleted_at is null/); assert.match(f, /status in \('new','contacted','quoted','payment_sent'\)/);
  assert.match(f, /l\.booking_id is null and l\.crm_first_contact_at is null/);
  assert.match(f, /order by l\.created_at asc/);
  assert.match(sql, /revoke all on function public\.crm_call_queue\(\) from public, anon;\ngrant execute on function public\.crm_call_queue\(\) to authenticated/);
  assert.doesNotMatch(f, /crm_desk_leads/);   // website leads are in the queue
});
