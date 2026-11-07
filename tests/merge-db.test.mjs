// Static checks of the duplicate detection and merge migration (the behaviour is tested against real Postgres in supabase/local-test/merge.sql).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NAME = '20270104000000_duplicate_merge.sql';
const M = read('supabase/migrations/' + NAME);
const RPCS = ['crm_duplicate_customers', 'crm_duplicate_leads', 'crm_merge_customers', 'crm_merge_leads', 'crm_unmerge_customers', 'crm_unmerge_leads', 'crm_customer_summary', 'crm_merge_list'];
const body = (fn) => { const i = M.indexOf('create or replace function public.' + fn + '('); assert.ok(i >= 0, fn + ' exists'); return M.slice(i, M.indexOf('end $$;', i) + 7); };

test('the migration is the newest one and in order', () => {
  const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes(NAME));   // changed on purpose: the funnel migration (20270105) now follows this one
  assert.ok(files.indexOf(NAME) > 0 && files[files.indexOf(NAME) - 1] < NAME);
});
test('rollback notes and a design header come first', () => {
  const head = M.slice(0, M.indexOf('create or replace function'));
  assert.match(head, /ROLLBACK NOTES/); assert.match(head, /DESIGN/); assert.match(head, /Phone uniqueness/);
  for (const fn of [...RPCS, 'norm_phone10']) assert.ok(head.includes(fn), 'rollback notes drop ' + fn);
  assert.match(head, /drop table if exists public\.merge_moved_rows, public\.customer_merges, public\.lead_merges/);
});
test('every RPC is security definer with a fixed search_path', () => {
  for (const fn of [...RPCS, 'merge_gate', 'merge_move_rows', 'merge_restore_rows', 'customer_follow_merge']) {
    assert.match(body(fn), /security definer set search_path = public/, fn);
  }
});
test('RPCs are granted to authenticated only, never to anon or public', () => {
  const grants = M.slice(M.indexOf('-- ───────────────────────────── 9.'));
  assert.match(grants, /revoke all on function[\s\S]*from public, anon;/);
  assert.match(grants, /grant execute on function[\s\S]*to authenticated;/);
  assert.doesNotMatch(M, /grant [^;]*to (anon|public)\b/i);
  for (const fn of RPCS) assert.ok(new RegExp('grant execute on function[^;]*public\\.' + fn + '\\(').test(grants), fn + ' granted');
  assert.match(M, /revoke all on function public\.merge_gate\(boolean\)[\s\S]*from public, anon, authenticated;/, 'internal helpers are not callable');
});
test('permissions: admin or merge_records for merge, admin only for undo', () => {
  const gate = body('merge_gate');
  assert.match(gate, /flow_can\('merge_records'\)/); assert.match(gate, /is_admin\(\)/);
  for (const fn of ['crm_merge_customers', 'crm_merge_leads', 'crm_duplicate_customers', 'crm_duplicate_leads', 'crm_merge_list']) assert.match(body(fn), /perform public\.merge_gate\(\);/, fn);
  for (const fn of ['crm_unmerge_customers', 'crm_unmerge_leads']) assert.match(body(fn), /perform public\.merge_gate\(true\);/, fn);
});
test('merges refuse the unsafe cases', () => {
  const l = body('crm_merge_leads'), c = body('crm_merge_customers');
  assert.match(l, /both leads have a booking ID/); assert.match(l, /both leads are paid/); assert.match(l, /already have an invoice/);
  assert.match(l, /at least 3 letters/); assert.match(c, /at least 3 letters/);
  assert.match(l, /two different leads/); assert.match(c, /two different customers/);
  assert.match(c, /is blocked and the one kept is not/);
  assert.match(l, /already_merged/); assert.match(c, /already_merged/);
});
test('merging never deletes: soft retire, snapshot, audit, and the ledger is moved not copied', () => {
  const code = M.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /delete from public\.(leads|customers|ledger_entries|invoices|bikes|messages)\b/);
  assert.doesNotMatch(code, /insert into public\.ledger_entries|insert into public\.invoices/);
  assert.match(body('crm_merge_leads'), /deleted_reason = left\('merged into ' \|\| k\.ref/);
  assert.match(body('crm_merge_customers'), /merged_into = k\.id, merged_at = now\(\)/);
  for (const fn of ['crm_merge_customers', 'crm_merge_leads', 'crm_unmerge_customers', 'crm_unmerge_leads']) assert.match(body(fn), /insert into public\.audit_log/, fn);
  assert.match(body('crm_merge_leads'), /paid_amount = coalesce\(k\.paid_amount, 0\) \+ coalesce\(d\.paid_amount, 0\)/);
  assert.match(M, /pg_constraint/, 'child tables are discovered, not hard coded');
});
test('merge tables are closed: RLS on, no policies, no grants', () => {
  for (const t of ['customer_merges', 'lead_merges', 'merge_moved_rows']) assert.match(M, new RegExp('alter table public\\.' + t + ' enable row level security'));
  assert.doesNotMatch(M, /create policy/i);
  assert.match(M, /revoke all on public\.customer_merges, public\.lead_merges, public\.merge_moved_rows from public, anon, authenticated/);
});
test('phone uniqueness is untouched and new links follow the merge', () => {
  const code = M.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /drop constraint[^;]*customers_phone_key/); assert.doesNotMatch(code, /create unique index[^;]*customers/i);
  for (const t of ['leads', 'bikes', 'invoices']) assert.match(M, new RegExp('create trigger ' + t + '_customer_follow_merge_tr before insert or update of customer_id on public\\.' + t));
  assert.match(M, /create or replace function public\.norm_phone10\(p text\) returns text language sql immutable/);
  assert.match(M, /right\(regexp_replace\(coalesce\(p, ''\), '\\D', '', 'g'\), 10\)/);
});
test('idempotent: only guarded forms', () => {
  const code = M.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /create table (?!if not exists)/); assert.doesNotMatch(code, /add column (?!if not exists)/);
  assert.doesNotMatch(code, /create index (?!if not exists)/); assert.doesNotMatch(code, /create function/);
  assert.doesNotMatch(code, /create view (?!or replace)/);
  assert.equal((code.match(/create trigger/g) || []).length, (code.match(/drop trigger if exists/g) || []).length, 'every trigger is dropped first');
  assert.doesNotMatch(code, /disable row level security/i);
});
test('the local Postgres harness runs the merge checks, twice-safe migration included', () => {
  const run = read('supabase/local-test/run.sh');
  assert.match(run, /merge\.sql/); assert.match(run, /20270104000000_duplicate_merge/);
  const t = read('supabase/local-test/merge.sql');
  for (const s of ['permission matrix', 'double merge is a no-op', 'unmerge restores', 'upsert on phone', 'two paid', 'phone variants share one key', 'ANY table']) assert.ok(t.toLowerCase().includes(s.toLowerCase()), s);
  assert.match(t, /\nrollback;/);
});
test('tests and docs use placeholders, not real numbers or secrets', () => {
  const t = read('supabase/local-test/merge.sql');
  assert.doesNotMatch(t, /@(gmail|yahoo|outlook)\./i); assert.doesNotMatch(t, /\b[6-9]\d{9}\b(?<!98[1-4]\d{7})/);
});
