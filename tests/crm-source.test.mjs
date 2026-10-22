import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cleanCrmUser } from '../supabase/functions/_shared/crm-user.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pages = readdirSync(new URL('../crm/pages/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => read('crm/pages/' + f));
const js = [read('crm/crm.js'), read('crm/ui.js'), ...pages].join('\n'), html = read('crm/index.html'), sql = read('supabase/migrations/20261108000000_crm.sql'), build = read('scripts/build_crm.sh');

test('the desk never reads or writes tables directly: only database functions and the user function', () => {
  assert.doesNotMatch(js, /\.from\(\s*['"`]/);
  assert.match(js, /rpc\('crm_log'/); assert.match(js, /functions\.invoke\('crm-user'/);
});
test('no secrets in the desk and no inline scripts (the CSP forbids them)', () => {
  assert.doesNotMatch(js + html, /service_role|SERVICE_ROLE|sk_live|rzp_|AISENSY/i);
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  assert.equal(inline.length, 0);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});
test('every database function is security definer, and public access is revoked', () => {
  for (const f of ['crm_me', 'crm_queue', 'crm_lead', 'crm_claim', 'crm_assign', 'crm_log', 'crm_add_lead', 'crm_team_stats', 'crm_list_users', 'crm_set_target', 'crm_set_user_active'])
    assert.match(sql, new RegExp('function public\\.' + f + '\\('), f);
  assert.match(sql, /revoke all on function public\.' \|\| f \|\| ' from public/);
  assert.equal((sql.match(/create or replace function public\.crm_(me|queue|lead|claim|assign|log|add_lead|team_stats|list_users|set_target|set_user_active)\(/g) || []).length, 11);
  assert.ok((sql.match(/security definer set search_path = public/g) || []).length >= 11);
});
test('agents get no table policy on the CRM tables; only the owner does', () => {
  assert.match(sql, /alter table public\.crm_users enable row level security/); assert.match(sql, /alter table public\.crm_activities enable row level security/);
  assert.doesNotMatch(sql, /create policy[^;]*to authenticated using \(true\)/i);
  for (const m of sql.matchAll(/create policy (\w+) on public\.(\w+)[^;]*;/g)) assert.match(m[0], /is_owner\(\)/, m[1]);
});
test('the sales rules live in the database: follow-up, lost reason, forward only, no payment statuses, no card or ID numbers', () => {
  assert.match(sql, /set the next follow-up before saving/); assert.match(sql, /choose why the lead was lost/);
  assert.match(sql, /a lead cannot move backwards/); assert.match(sql, /agents cannot set that status; payment sets it/);
  assert.match(sql, /Remove Aadhaar, PAN, bank or card numbers/); assert.match(sql, /only a supervisor can reopen a lost lead/);
});
test('the desk never returns money columns', () => {
  const fn = sql.slice(sql.indexOf('function public.crm_queue'), sql.indexOf('function public.crm_claim'));
  assert.doesNotMatch(fn, /paid_amount|amount_due|payment_link|commission|mechanic_id|invoice/i);
});
test('the build script ships a strict CSP and no robots access', () => {
  assert.match(build, /Content-Security-Policy: default-src 'self'/); assert.match(build, /X-Robots-Tag: noindex/); assert.match(build, /frame-ancestors 'none'/);
});
test('a new team member needs a name, a valid email and a known role', () => {
  assert.equal(cleanCrmUser({ name: 'Asha Rao', email: ' ASHA@Example.com ', role: 'sales' }).value.email, 'asha@example.com');
  assert.equal(cleanCrmUser({ name: 'A', email: 'a@b.co', role: 'sales' }).ok, false);
  assert.equal(cleanCrmUser({ name: 'Asha Rao', email: 'nope', role: 'sales' }).ok, false);
  assert.equal(cleanCrmUser({ name: 'Asha Rao', email: 'a@b.co', role: 'owner' }).ok, false);
});

const allSql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).map((f) => read('supabase/migrations/' + f)).join('\n');
test('every database function the desk calls exists in a migration', () => {
  const names = new Set([...js.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(names.size > 40, 'found ' + names.size);
  for (const n of names) assert.match(allSql, new RegExp('function public\\.' + n + '\\('), n);
});
test('the desk screens each have a permission page and the menu hides what a login cannot open', () => {
  for (const p of ['dashboard', 'leads', 'rsa', 'tickets', 'garage_visits', 'garages', 'mechanics', 'knowledge', 'team']) assert.match(js, new RegExp("page: '" + p + "'"), p);
  assert.match(js, /screens\(\)\.find/); assert.match(js, /pageOk\(s\.page\)/);
});
test('the leads table has the ten agreed columns in order', () => {
  const cols = ['Lead', 'Mobile number', 'Source', 'Stage', 'Owner', 'Disposition', 'Sub disposition', 'Follow-up', 'Created date', 'Last activity date'];
  const pos = cols.map((c) => read('crm/pages/leads.js').indexOf('<th>' + c + '</th>'));
  assert.ok(pos.every((p) => p > 0), JSON.stringify(pos));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
});
test('every function in the desk migrations is security definer and closed to the public', () => {
  for (const file of ['20261110000000_desk_permissions_leads', '20261111000000_desk_garages_mechanics_bookings', '20261112000000_desk_tickets_rsa_knowledge', '20261113000000_desk_booking_catalog', '20261114000000_desk_pickers']) {
    const m = read('supabase/migrations/' + file + '.sql');
    const defs = m.match(/create or replace function public\.crm_[a-z_]+\([^]*?\$\$;/g) || [];
    assert.ok(defs.length > 0, file);
    for (const d of defs) {
      const name = d.match(/function public\.(crm_[a-z_]+)/)[1];
      if (['crm_pages', 'crm_actions', 'crm_preset', 'crm_preset_for', 'crm_pipeline_next', 'crm_suggest_hub', 'crm_clean_text', 'crm_touch'].includes(name)) continue; // pure helpers that read no table
      if (!/security definer/.test(d)) assert.fail(file + ': ' + name + ' is not security definer');
    }
    assert.match(m, /revoke all on function/); assert.match(m, /grant execute on function/);
  }
});
