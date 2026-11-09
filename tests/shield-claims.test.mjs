// Mechanix Shield: migration, Edge Function, tracking card, Crew tab and terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql = code(read('supabase/migrations/20270125000000_shield_claims.sql'));

test('the claim table is private, capped at 5,000, one open claim per booking', () => {
  assert.match(sql, /alter table public\.shield_claims enable row level security/); assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /amount <= 5000/); assert.match(sql, /where status in \('open', 'approved'\)/);
});
test('a claim needs a delivered booking inside 48 hours and plain text', () => {
  const fn = sql.slice(sql.indexOf('function public.shield_claim_create'), sql.indexOf('function public.shield_status_get'));
  assert.match(fn, /l\.status <> 'completed'/); assert.match(fn, /interval '48 hours'/); assert.match(fn, /crm_has_pii\(d\)/); assert.match(fn, /where track_token = p_token/);
});
test('only the admin approves or pays; any desk role can decline with a reason; the amount shows to the admin only', () => {
  const fn = sql.slice(sql.indexOf('function public.crm_shield_decide'));
  assert.match(fn, /p_decision <> 'declined' and not public\.is_admin\(\)/); assert.match(fn, /p_decision = 'declined' and n is null/);
  assert.match(fn, /p_amount > 5000/); assert.match(fn, /q\.status <> 'approved' then raise exception 'approve first'/);
  const list = sql.slice(sql.indexOf('function public.crm_shield_list'), sql.indexOf('function public.crm_shield_decide'));
  assert.match(list, /case when adm then q\.amount end/); assert.match(list, /crm_can_see\(l, role_\)/);
});
test('customer functions are service role only, desk functions need a signed-in desk role', () => {
  assert.match(sql, /grant execute on function public\.shield_claim_create\(text, text\), public\.shield_status_get\(uuid\) to service_role/);
  assert.match(sql, /revoke all on function public\.shield_claim_create\(text, text\), public\.shield_status_get\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.crm_shield_list\(\), public\.crm_shield_decide\(uuid, text, numeric, text, text\) to authenticated/);
});
test('the function, the tracking page and the Crew tab use it', () => {
  const f = read('supabase/functions/shield-claim/index.ts');
  assert.match(f, /\[0-9a-f\]\{32\}/); assert.match(f, /track_attempts/); assert.match(f, /rpc\('shield_claim_create', \{ p_token: token, p_description: description \}\)/);
  assert.match(read('supabase/functions/track-booking/index.ts'), /rpc\('shield_status_get'/);
  const t = read('assets/js/track.js'); assert.match(t, /put\('trShield'/); assert.match(t, /post\('shield-claim'/); assert.match(t, /'trShield'/);
  const c = read('crm/pages/followups.js'); assert.match(c, /crm_shield_list/); assert.match(c, /crm_shield_decide/); assert.match(c, /Shield claims/);
});
test('terms state the promise as a company promise, not insurance, with the exclusions', () => {
  const b = read('scripts/build_pages.py');
  assert.match(b, /Mechanix Shield:<\/b> if your vehicle is damaged while it is in our care, Mechanix Pro pays up to Rs 5,000 per job/);
  assert.match(b, /not an insurance policy/); assert.match(b, /48 hours of delivery/);
});

test('a monthly cap stops approvals past it, only the admin sees and changes it', () => {
  const m = code(read('supabase/migrations/20270126000000_shield_cap.sql'));
  assert.match(m, /insert into public\.settings \(key, value\) values \('shield_cap'/);
  assert.match(m, /used \+ round\(p_amount, 2\) > cap then raise exception 'this would pass the monthly Shield cap/);
  assert.match(m, /function public\.crm_shield_cap_set\(p_amount numeric\)[\s\S]*not public\.is_admin\(\) then raise exception 'only the admin changes the cap'/);
  assert.match(m, /function public\.crm_shield_month\(\)[\s\S]*not public\.is_admin\(\) then return null/);
  assert.match(m, /p_decision <> 'declined' and not public\.is_admin\(\)/);   // the decide function keeps the admin-only rule
  const c = read('crm/pages/followups.js'); assert.match(c, /crm_shield_month/); assert.match(c, /crm_shield_cap_set/);
});
