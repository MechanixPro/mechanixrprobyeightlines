// Redo Promise: migration, Edge Function, tracking card, Crew tab and wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = code(read('supabase/migrations/20270123000000_redo_requests.sql'));

test('the redo table is private, one open request per booking, with bounded text', () => {
  assert.match(sql, /alter table public\.redo_requests enable row level security/);
  assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /create unique index if not exists redo_one_open_per_lead on public\.redo_requests \(lead_id\) where status in \('open', 'approved'\)/);
  assert.match(sql, /char_length\(reason\) between 5 and 500/);
});
test('the 30 day window is counted from the completed date and only completed bookings qualify', () => {
  const fn = sql.slice(sql.indexOf('function public.redo_request_create'), sql.indexOf('function public.redo_status_get'));
  assert.match(fn, /l\.status <> 'completed'/); assert.match(fn, /l\.completed_at < now\(\) - interval '30 days'/);
  assert.match(fn, /where track_token = p_token/);
});
test('customer functions are service role only, desk functions need a signed-in desk role', () => {
  assert.match(sql, /revoke all on function public\.redo_request_create\(text, text\), public\.redo_status_get\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.redo_request_create\(text, text\), public\.redo_status_get\(uuid\) to service_role/);
  assert.match(sql, /grant execute on function public\.crm_redo_list\(\), public\.crm_redo_decide\(uuid, text, text\) to authenticated/);
  assert.equal((sql.match(/crm_need_role\(\)/g) || []).length >= 2, true);
  assert.match(sql, /crm_can_see\(l, role_\)/);
});
test('a decline needs a reason and an open request must be approved before it is done', () => {
  assert.match(sql, /p_decision = 'declined' and n is null/); assert.match(sql, /q\.status = 'open' and p_decision = 'done'/);
});
test('the redo-request function checks the origin, limits tries and calls only the database function', () => {
  const f = read('supabase/functions/redo-request/index.ts');
  assert.match(f, /\[0-9a-f\]\{32\}/); assert.match(f, /track_attempts/); assert.match(f, /rpc\('redo_request_create'/);
  assert.match(read('supabase/functions/track-booking/index.ts'), /rpc\('redo_status_get'/);
});
test('the tracking page and the Crew tab use it', () => {
  const t = read('assets/js/track.js');
  assert.match(t, /put\('trRedo'/); assert.match(t, /post\('redo-request'/);
  const c = read('crm/pages/followups.js');
  assert.match(c, /crm_redo_list/); assert.match(c, /crm_redo_decide/); assert.match(c, /Redo requests/);
});
test('terms and refund policy name the Redo Promise', () => {
  const b = read('scripts/build_pages.py');
  assert.equal((b.match(/Redo Promise/g) || []).length >= 2, true);
});
