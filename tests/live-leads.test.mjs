// Live leads: SQL rules, garage-app actions and the Live leads screen (source-pattern tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20270122000000_live_leads.sql');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the leads function returns no name, phone, email or street address', () => {
  const fn = code.slice(code.indexOf('function public.garage_live_leads'), code.indexOf('function public.garage_claim_lead'));
  const out = fn.slice(fn.indexOf('jsonb_agg'));
  assert.doesNotMatch(out, /l\.(name|phone|email|address|notes)\b/);
  for (const col of ['l.area', 'l.pincode', 'l.preferred_date', 'distance_km']) assert.ok(out.includes(col), col);
});
test('only available, live garages within the radius or the same PIN, under their job limit, see leads', () => {
  assert.match(code, /status in \('live', 'pilot'\) and ops_state = 'active' and is_open/);
  assert.match(code, /radius_km/); assert.match(code, /max_open_jobs/); assert.match(code, /l\.pincode = g\.pincode/);
  assert.match(code, /openjobs >= maxjobs/);
});
test('claim re-checks inside one transaction and reports taken to the loser', () => {
  const fn = code.slice(code.indexOf('function public.garage_claim_lead'));
  assert.match(fn, /for update/); assert.match(fn, /'error', 'taken'/); assert.match(fn, /'error', 'full'/); assert.match(fn, /'received', now\(\)/);
  assert.match(fn, /garage_claimed/); assert.match(fn, /already/);
});
test('both functions are service role only', () => {
  assert.match(code, /revoke all on function public\.garage_live_leads\(uuid\), public\.garage_claim_lead\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(code, /grant execute on function public\.garage_live_leads\(uuid\), public\.garage_claim_lead\(uuid, uuid\) to service_role/);
});
test('garage-app has the leads and claim actions', () => {
  const s = read('supabase/functions/garage-app/index.ts');
  assert.match(s, /'leads', 'claim'\]/); assert.match(s, /rpc\('garage_live_leads', \{ p_garage: garageId \}\)/); assert.match(s, /rpc\('garage_claim_lead'/);
  assert.match(s, /Someone else got this one\./);
});
test('the app polls every 20 seconds only on the Live leads screen and only while the page is visible', () => {
  const j = read('assets/js/garage.js');
  assert.match(j, /20000/); assert.match(j, /if \(S\.screen !== 'leads'\) \{ stopLeads\(\)/); assert.match(j, /!d\.hidden\) fetchLeads\(\)/);
  assert.match(j, /Switch Available on to see live leads/); assert.match(j, /Claim this job/);
  assert.doesNotMatch(j.slice(j.indexOf('function renderLeads'), j.indexOf('function openJobs')), /customer_phone|\.phone|\.address|\.name\b/);
});
