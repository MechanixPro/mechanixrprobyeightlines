-- Duplicate detection and merge checks (20270104000000_duplicate_merge.sql). Runs after the other local tests in the same LOCAL scratch database; reuses their users.
-- Everything runs inside one transaction that is rolled back at the end, so no other test sees these rows. All phones and names are test placeholders.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
-- Fingerprint of everything that hangs off two leads (every table with a foreign key to leads), so "restores exact state" is a real comparison.
create or replace function pg_temp.fp_leads(x uuid, y uuid) returns text language sql as $$
  select md5(string_agg((to_jsonb(l) - 'updated_at')::text, '|' order by l.id)) from public.leads l where l.id in (x, y)
$$;
create or replace function pg_temp.fp_children(parent regclass, x uuid, y uuid) returns text language plpgsql as $$
declare f record; acc text := ''; part text;
begin
  for f in select format('%I.%I', n.nspname, cl.relname) as tbl, cl.relname as rel, a.attname::text as col from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.confrelid = parent and cl.relname not in ('customer_merges', 'lead_merges') order by 1 loop
    execute format('select md5(coalesce(string_agg((to_jsonb(t) - ''updated_at'')::text, ''|'' order by (to_jsonb(t) - ''updated_at'')::text), '''')) from %s t where t.%I in ($1, $2) %s', f.tbl, f.col,
      case when f.rel = 'crm_activities' then $q$and coalesce(t.body, '') !~ '^(Merged duplicate|Undid the merge)'$q$ else '' end) into part using x, y;
    acc := acc || f.rel || ':' || part || ';';
  end loop;
  return acc;
end $$;
-- How many rows still point at a record in ANY table that has a foreign key to it.
create or replace function pg_temp.residual(parent regclass, x uuid) returns integer language plpgsql as $$
declare f record; n integer; total integer := 0;
begin
  for f in select format('%I.%I', ns.nspname, cl.relname) as tbl, a.attname::text as col from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.confrelid = parent and cl.relname not in ('customer_merges', 'lead_merges') loop
    execute format('select count(*) from %s t where t.%I = $1', f.tbl, f.col) into n using x; total := total + n;
  end loop;
  return total;
end $$;

begin;
-- test users: a1 staff admin, a9 owner, c3 sales agent (no merge right), b2 nobody; f1 = a sales agent that was explicitly given merge_records
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'merger@example.invalid') on conflict do nothing;
insert into public.crm_users (user_id, name, role, active, permissions) values ('00000000-0000-0000-0000-0000000000f1', 'Merge Agent', 'sales', true, '{"pages":{},"actions":{"merge_records":true}}'::jsonb) on conflict (user_id) do update set permissions = excluded.permissions, active = true;

-- ───────────── phone key
select pg_temp.ok(public.norm_phone10('+91 98100 00001') = '9810000001' and public.norm_phone10('09810000001') = '9810000001'
  and public.norm_phone10(' 98100-00001 ') = '9810000001' and public.norm_phone10('+919810000001') = '9810000001' and public.norm_phone10('9810000001') = '9810000001', 'phone variants share one key');
select pg_temp.ok(public.norm_phone10(null) is null and public.norm_phone10('abc') is null, 'no digits gives null');

-- ───────────── permission matrix (the check comes before anything else, so dummy ids are enough)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');   -- sales agent
select pg_temp.fails($$select * from public.crm_duplicate_customers()$$, 'permission', 'agent cannot list duplicate customers');
select pg_temp.fails($$select * from public.crm_duplicate_leads()$$, 'permission', 'agent cannot list duplicate leads');
select pg_temp.fails($$select public.crm_merge_customers(gen_random_uuid(), gen_random_uuid(), 'same person')$$, 'permission', 'agent cannot merge customers');
select pg_temp.fails($$select public.crm_merge_leads(gen_random_uuid(), gen_random_uuid(), 'same person')$$, 'permission', 'agent cannot merge leads');
select pg_temp.fails($$select public.crm_unmerge_customers(gen_random_uuid())$$, 'permission', 'agent cannot unmerge customers');
select pg_temp.fails($$select public.crm_unmerge_leads(gen_random_uuid())$$, 'permission', 'agent cannot unmerge leads');
select pg_temp.fails($$select * from public.crm_merge_list()$$, 'permission', 'agent cannot read the merge history');
select pg_temp.fails($$select * from public.customer_merges$$, 'permission denied', 'nobody reads merge tables directly (agent)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');   -- not on the team at all
select pg_temp.fails($$select * from public.crm_duplicate_leads()$$, 'permission', 'a signed-in non-team user cannot list');
select pg_temp.fails($$select * from public.lead_merges$$, 'permission denied', 'nobody reads lead_merges directly');
select pg_temp.fails($$select * from public.merge_moved_rows$$, 'permission denied', 'nobody reads merge_moved_rows directly');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');   -- owner
select pg_temp.fails($$select * from public.customer_merges$$, 'permission denied', 'even the owner uses the RPC, not the table');
select pg_temp.ok((select count(*) from public.crm_duplicate_customers()) >= 0 and (select count(*) from public.crm_duplicate_leads()) >= 0, 'owner can list');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');   -- staff admin
select pg_temp.ok((select count(*) from public.crm_duplicate_customers()) >= 0, 'admin can list');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');   -- merge_records
select pg_temp.ok((select count(*) from public.crm_duplicate_customers()) >= 0 and (select count(*) from public.crm_merge_list()) >= 0, 'merge_records can list');
select pg_temp.fails($$select public.crm_unmerge_leads(gen_random_uuid())$$, 'only an admin', 'merge_records cannot undo, only admins');
reset role;

-- ───────────── customers: seed (phone check relaxed inside this rolled-back transaction so variants can exist)
alter table public.customers drop constraint customers_phone_check;
insert into public.customers (id, phone, name, address) values
  ('c1000000-0000-0000-0000-00000000000a', '9810000001', 'Asha Test', null),
  ('c1000000-0000-0000-0000-00000000000b', '+91 98100 00001', 'A. Test', 'Test Street 1'),
  ('c1000000-0000-0000-0000-00000000000c', '09810000001', 'Asha T', null),
  ('c1000000-0000-0000-0000-0000000000d1', '9810000004', 'Dev Test', null),
  ('c1000000-0000-0000-0000-0000000000d2', '+91 98100 00004', 'Dev T', 'Test Road 4');
update public.customers set email = 'asha@example.invalid', email_marketing_consent = true where id = 'c1000000-0000-0000-0000-00000000000b';
update public.customers set blocked = true, blocked_reason = 'test block' where id = 'c1000000-0000-0000-0000-00000000000c';
insert into public.leads (id, name, phone, status, source, customer_id, preferred_date) values
  ('a1000000-0000-0000-0000-0000000000a1', 'Asha Test', '9810000001', 'new', 'website', 'c1000000-0000-0000-0000-00000000000a', current_date + 20),
  ('a1000000-0000-0000-0000-0000000000b1', 'A Test', '9810000001', 'new', 'website', 'c1000000-0000-0000-0000-00000000000b', current_date + 40),
  ('a1000000-0000-0000-0000-0000000000b2', 'A Test', '9810000001', 'new', 'website', 'c1000000-0000-0000-0000-00000000000b', current_date + 60),
  ('a1000000-0000-0000-0000-0000000000d1', 'Dev Test', '9810000004', 'new', 'website', 'c1000000-0000-0000-0000-0000000000d2', current_date + 20);
update public.leads set booking_id = public.order_ref_next() where id = 'a1000000-0000-0000-0000-0000000000b1';
insert into public.leads (id, name, phone, status, source, preferred_date) values ('a1000000-0000-0000-0000-0000000000f1', 'No Link', '9810000001', 'new', 'website', current_date + 80);   -- same phone, no customer_id
insert into public.bikes (id, customer_id) values ('b1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-00000000000b'), ('b1000000-0000-0000-0000-0000000000d2', 'c1000000-0000-0000-0000-0000000000d2');
insert into public.invoices (id, lead_id, ref, number, customer_name, customer_id, has_gst, gst_rate, basis, taxable, cgst, sgst, total)
  values ('a2000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', 'T-REF-B1', 'T-INV-B1', 'A Test', 'c1000000-0000-0000-0000-00000000000b', false, 0, 'incl', 100, 0, 0, 100);

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- detection
select pg_temp.ok((select count(distinct customer_id) from public.crm_duplicate_customers() where group_key = '9810000001') = 3, 'three phone variants form one customer group');
select pg_temp.ok((select bookings from public.crm_duplicate_customers() where customer_id = 'c1000000-0000-0000-0000-00000000000b') = 2, 'booking count per customer (non-deleted leads)');
select pg_temp.ok((select has_booking_id from public.crm_duplicate_customers() where customer_id = 'c1000000-0000-0000-0000-00000000000b') and not (select has_booking_id from public.crm_duplicate_customers() where customer_id = 'c1000000-0000-0000-0000-00000000000a'), 'has_booking_id is per customer');
select pg_temp.ok((select count(*) from public.crm_duplicate_customers() where group_key = '9810000004') = 2, 'a second pair is its own group');
-- refusals
select pg_temp.fails($$select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'same person')$$, 'different customers', 'same id refused');
select pg_temp.fails($$select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', null)$$, 'reason', 'missing reason refused');
select pg_temp.fails($$select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'ab 12')$$, 'reason', 'a reason under 3 letters refused');
select pg_temp.fails($$select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000c', 'same person')$$, 'blocked', 'blocked duplicate into an unblocked customer refused');
select pg_temp.fails($$select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'same person')$$, 'not found', 'unknown customer refused');
reset role;
create temp table fp as select pg_temp.fp_children('public.customers'::regclass, 'c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d2') as c,
  (select md5(string_agg((to_jsonb(c) - 'merged_into' - 'merged_at')::text, '|' order by c.id)) from public.customers c where c.id in ('c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d2')) as r;
create temp table paid_before as select coalesce(sum(paid_amount), 0) as p from public.leads;

-- merge pair 1 as merge_records (not an admin)
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table m1 as select public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'same person, two phone formats') as r;
grant select on m1 to authenticated;
select pg_temp.ok((select r ->> 'already_merged' from m1) = 'false', 'merge reported');
reset role;
select pg_temp.ok((select name from public.customers where id = 'c1000000-0000-0000-0000-00000000000a') = 'Asha Test', 'kept name is never overwritten');
select pg_temp.ok((select email from public.customers where id = 'c1000000-0000-0000-0000-00000000000a') = 'asha@example.invalid'
  and (select address from public.customers where id = 'c1000000-0000-0000-0000-00000000000a') = 'Test Street 1'
  and (select email_marketing_consent from public.customers where id = 'c1000000-0000-0000-0000-00000000000a'), 'empty fields and consent filled from the dropped customer');
select pg_temp.ok((select merged_into from public.customers where id = 'c1000000-0000-0000-0000-00000000000b') = 'c1000000-0000-0000-0000-00000000000a'
  and (select phone from public.customers where id = 'c1000000-0000-0000-0000-00000000000b') = '+91 98100 00001', 'dropped customer is retired and keeps its phone');
select pg_temp.ok(pg_temp.residual('public.customers'::regclass, 'c1000000-0000-0000-0000-00000000000b') = 0, 'nothing in ANY table still points at the retired customer (bikes, leads, invoices, all FKs)');
select pg_temp.ok((select count(*) from public.leads where customer_id = 'c1000000-0000-0000-0000-00000000000a') = 3 and (select count(*) from public.bikes where customer_id = 'c1000000-0000-0000-0000-00000000000a') = 1
  and (select customer_id from public.invoices where id = 'a2000000-0000-0000-0000-0000000000b1') = 'c1000000-0000-0000-0000-00000000000a', 'leads, bike and invoice moved to the kept customer');
select pg_temp.ok((select count(*) from public.audit_log where action = 'customers_merged' and details ->> 'merge' = (select r ->> 'merge_id' from m1)) = 1
  and (select actor from public.audit_log where action = 'customers_merged' order by id desc limit 1) = '00000000-0000-0000-0000-0000000000f1', 'merge is in the audit log with the actor');
select pg_temp.ok(not exists (select 1 from public.audit_log where action = 'customers_merged' and details::text ~ '98100'), 'audit log holds no phone number');
select pg_temp.ok((select coalesce(sum(paid_amount), 0) from public.leads) = (select p from paid_before), 'paid total over all leads unchanged');
-- idempotent: the same call again, and the reverse call, change nothing
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_merge_customers('c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'same person again') ->> 'already_merged') = 'true'
  and (public.crm_merge_customers('c1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000a', 'same person reversed') ->> 'already_merged') = 'true', 'double merge is a no-op');
reset role;
select pg_temp.ok((select count(*) from public.customer_merges where kept = 'c1000000-0000-0000-0000-00000000000a') = 1, 'still exactly one merge row');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- the group now shows only the live duplicates; the blocked one stays refused
select pg_temp.ok((select count(distinct customer_id) from public.crm_duplicate_customers() where group_key = '9810000001') = 2, 'merged customer leaves the duplicate list');
reset role;

-- book-start style upsert after the merge: it lands on the retired row, and the new lead and bike still join the surviving customer
create temp table up as with i as (insert into public.customers (phone, name) values ('+91 98100 00001', 'Walk In') on conflict (phone) do update set name = public.customers.name returning id) select id from i;
select pg_temp.ok((select id from up) = 'c1000000-0000-0000-0000-00000000000b', 'upsert on phone resolves to the retired row (unique phone untouched)');
insert into public.leads (id, name, phone, status, source, customer_id) select 'a1000000-0000-0000-0000-0000000000e1', 'Walk In', '9810000001', 'new', 'website', id from up;
insert into public.bikes (id, customer_id) select 'b1000000-0000-0000-0000-0000000000e1', id from up;
select pg_temp.ok((select customer_id from public.leads where id = 'a1000000-0000-0000-0000-0000000000e1') = 'c1000000-0000-0000-0000-00000000000a'
  and (select customer_id from public.bikes where id = 'b1000000-0000-0000-0000-0000000000e1') = 'c1000000-0000-0000-0000-00000000000a', 'new lead and bike are re-pointed to the surviving customer');
select pg_temp.ok(pg_temp.residual('public.customers'::regclass, 'c1000000-0000-0000-0000-00000000000b') = 0, 'still nothing points at the retired customer');
insert into public.customers (phone, name) values ('9810000077', 'Fresh') on conflict (phone) do update set name = excluded.name;
select pg_temp.ok(exists (select 1 from public.customers where phone = '9810000077' and merged_into is null), 'upsert of a brand new phone still inserts');
-- one source of truth for the desk
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok((select bookings from public.crm_customer_summary('c1000000-0000-0000-0000-00000000000a')) = 5, 'summary counts linked leads and same-phone leads once each (a1, b1, b2, f1, e1)');
select pg_temp.ok((select confirmed_bookings from public.crm_customer_summary('c1000000-0000-0000-0000-00000000000a')) = 1, 'summary counts bookings with a booking ID');
select pg_temp.ok((select (bookings, paid_total, last_booking_date) from public.crm_customer_summary('c1000000-0000-0000-0000-00000000000a')) is not distinct from (select (bookings, paid_total, last_booking_date) from public.crm_customer_summary('c1000000-0000-0000-0000-00000000000b')), 'the retired and the surviving customer show identical numbers');
select pg_temp.ok((select duplicate_customers from public.crm_customer_summary('c1000000-0000-0000-0000-00000000000a')) = 1, 'summary reports the other live customer with this phone (the blocked one)');
reset role;
-- pair 2: merge by an admin, then undo restores the exact state
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table m2 as select public.crm_merge_customers('c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d2', 'duplicate sign up') as r;
grant select on m2 to authenticated;
select pg_temp.ok((select r ->> 'already_merged' from m2) = 'false', 'pair 2 merged');
select public.crm_unmerge_customers((select (r ->> 'merge_id')::uuid from m2));
select pg_temp.fails($$select public.crm_unmerge_customers((select (r ->> 'merge_id')::uuid from m2))$$, 'already', 'undo twice refused');
reset role;
select pg_temp.ok((select c from fp) = pg_temp.fp_children('public.customers'::regclass, 'c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d2'), 'unmerge restores every moved row exactly');
select pg_temp.ok((select r from fp) = (select md5(string_agg((to_jsonb(c) - 'merged_into' - 'merged_at')::text, '|' order by c.id)) from public.customers c where c.id in ('c1000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d2'))
  and (select merged_into from public.customers where id = 'c1000000-0000-0000-0000-0000000000d2') is null and (select address from public.customers where id = 'c1000000-0000-0000-0000-0000000000d1') is null, 'unmerge restores both customer rows exactly');
-- a changed record blocks the undo of pair 1
update public.customers set email = 'changed@example.invalid' where id = 'c1000000-0000-0000-0000-00000000000a';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.fails($$select public.crm_unmerge_customers((select (r ->> 'merge_id')::uuid from m1))$$, 'changed since', 'undo refused when the kept customer changed since');
reset role;
alter table public.customers add constraint customers_phone_check check (phone ~ '^[6-9][0-9]{9}$') not valid;   -- (rolled back below anyway)

-- ───────────── leads
insert into public.customers (id, phone, name) values ('c2000000-0000-0000-0000-000000000001', '9820000002', 'Lead Person') on conflict do nothing;
insert into public.leads (id, name, phone, status, source, reg_no, note, customer_id, created_at) values
  ('a3000000-0000-0000-0000-00000000000a', 'Lead Person', '9820000002', 'new', 'website', 'KA01AB1234', 'paid booking note', 'c2000000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a3000000-0000-0000-0000-00000000000b', 'Lead Person', '9820000002', 'new', 'website', 'KA01AB1234', 'second enquiry note', null, now() - interval '9 days'),
  ('a3000000-0000-0000-0000-00000000000c', 'Lead Person', '9820000002', 'new', 'website', 'KA01AB1234', null, null, now() - interval '30 days');
update public.leads set area = 'Test Area' where id = 'a3000000-0000-0000-0000-00000000000b';
insert into public.leads (id, name, phone, status, source, reg_no) values ('a3000000-0000-0000-0000-00000000000d', 'Lead Person', '9820000002', 'new', 'website', 'KA01AB1234');
-- A pays 500 (booking ID is given by the existing trigger), and D pays 300: two real separate paid bookings
insert into public.ledger_entries (entry_type, lead_id, amount, collected_by, method) values ('customer_payment', 'a3000000-0000-0000-0000-00000000000a', 500, 'company_manual', 'upi'), ('customer_payment', 'a3000000-0000-0000-0000-00000000000d', 300, 'company_manual', 'upi');
select pg_temp.ok((select booking_id from public.leads where id = 'a3000000-0000-0000-0000-00000000000a') is not null and (select booking_id from public.leads where id = 'a3000000-0000-0000-0000-00000000000d') is not null, 'both paid leads have a booking ID');
-- B carries children in every table we can seed cheaply
insert into public.mechanics (id, name, phone) values ('d3000000-0000-0000-0000-000000000001', 'Test Mechanic', '9830000001') on conflict do nothing;
insert into public.garages (id, name, mobile) values ('d4000000-0000-0000-0000-000000000001', 'Test Garage', '9830000002') on conflict do nothing;
insert into public.messages (lead_id, phone, direction, body) values ('a3000000-0000-0000-0000-00000000000b', '9820000002', 'in', 'hello');
insert into public.crm_activities (lead_id, kind, body) values ('a3000000-0000-0000-0000-00000000000b', 'note', 'called once');
insert into public.crm_tickets (lead_id, category, title) values ('a3000000-0000-0000-0000-00000000000b', 'escalation', 'test ticket');
insert into public.lead_ratings (lead_id, rating) values ('a3000000-0000-0000-0000-00000000000b', 5);
insert into public.booking_notifications (lead_id, kind) values ('a3000000-0000-0000-0000-00000000000b', 'team_issue');
insert into public.handovers (lead_id, kind, code_hash, code_expires_at) values ('a3000000-0000-0000-0000-00000000000b', 'pickup', 'hash-placeholder', now() + interval '1 day');
insert into public.garage_assignments (lead_id, garage_id) values ('a3000000-0000-0000-0000-00000000000b', 'd4000000-0000-0000-0000-000000000001');
insert into public.tech_job_links (lead_id, mechanic_id, token_hash, expires_at) values ('a3000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-000000000001', 'hash-placeholder', now() + interval '1 day');
insert into public.ledger_entries (entry_type, lead_id, amount, reason, collected_by) values ('write_off', 'a3000000-0000-0000-0000-00000000000b', 50, 'test write off', 'company_manual');
insert into public.invoices (id, lead_id, ref, number, customer_name, has_gst, gst_rate, basis, taxable, cgst, sgst, total) values ('a4000000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-00000000000b', 'T-REF-LB', 'T-INV-LB', 'Lead Person', false, 0, 'incl', 100, 0, 0, 100);
insert into public.warranty_cards (code, lead_id, customer_name, done_on, valid_until) values ('TESTCARD0001', 'a3000000-0000-0000-0000-00000000000b', 'Lead Person', current_date, current_date + 30);

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- detection: A+B and B+D group (B is unpaid), A and D are never paired with each other
select pg_temp.ok((select count(*) from public.crm_duplicate_leads() where group_key = '9820000002') = 4, 'one lead group for the phone (the two paid bookings are only linked through the unpaid ones)');
select pg_temp.ok((select reason from public.crm_duplicate_leads() where group_key = '9820000002' limit 1) like '%same_vehicle%', 'reason code same_vehicle reported');
reset role;
-- detection of the 3 reason codes and of what must NOT group
insert into public.leads (id, name, phone, status, source, preferred_date, created_at) values
  ('a5000000-0000-0000-0000-000000000001', 'Date Dup', '9840000001', 'new', 'website', current_date + 10, now() - interval '20 days'),
  ('a5000000-0000-0000-0000-000000000002', 'Date Dup', '9840000001', 'new', 'website', current_date + 12, now() - interval '40 days'),
  ('a5000000-0000-0000-0000-000000000003', 'Fresh Dup', '9840000002', 'new', 'website', null, now() - interval '3 hours'),
  ('a5000000-0000-0000-0000-000000000004', 'Fresh Dup', '9840000002', 'new', 'website', null, now() - interval '1 hour'),
  ('a5000000-0000-0000-0000-000000000005', 'Far Apart', '9840000003', 'new', 'website', current_date + 10, now() - interval '20 days'),
  ('a5000000-0000-0000-0000-000000000006', 'Far Apart', '9840000003', 'new', 'website', current_date + 30, now() - interval '5 days'),
  ('a5000000-0000-0000-0000-000000000007', 'Two Paid', '9840000004', 'new', 'website', null, now() - interval '3 hours'),
  ('a5000000-0000-0000-0000-000000000008', 'Two Paid', '9840000004', 'new', 'website', null, now() - interval '2 hours'),
  ('a5000000-0000-0000-0000-000000000009', 'Junk Dup', '9840000005', 'new', 'website', null, now() - interval '3 hours'),
  ('a5000000-0000-0000-0000-00000000000a', 'Junk Dup', '9840000005', 'new', 'website', null, now() - interval '2 hours');
update public.leads set status = 'junk', junk_reason = 'test' where id = 'a5000000-0000-0000-0000-00000000000a';
insert into public.ledger_entries (entry_type, lead_id, amount, collected_by, method) values ('customer_payment', 'a5000000-0000-0000-0000-000000000007', 100, 'company_manual', 'upi'), ('customer_payment', 'a5000000-0000-0000-0000-000000000008', 100, 'company_manual', 'upi');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select reason from public.crm_duplicate_leads() where group_key = '9840000001' limit 1) = 'close_dates', 'preferred dates within 3 days');
select pg_temp.ok((select reason from public.crm_duplicate_leads() where group_key = '9840000002' limit 1) = 'new_within_48h', 'created within 48 hours, no booking ID');
select pg_temp.ok(not exists (select 1 from public.crm_duplicate_leads() where group_key = '9840000003'), 'dates 20 days apart and created 15 days apart are not duplicates');
select pg_temp.ok(not exists (select 1 from public.crm_duplicate_leads() where group_key = '9840000004'), 'two paid bookings with booking IDs are never grouped');
select pg_temp.ok(not exists (select 1 from public.crm_duplicate_leads() where group_key = '9840000005'), 'junk leads are not grouped');
-- refusals
select pg_temp.fails($$select public.crm_merge_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000a', 'same lead')$$, 'different leads', 'same id refused');
select pg_temp.fails($$select public.crm_merge_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000d', 'looks the same')$$, 'booking ID', 'two booking IDs refused');
select pg_temp.fails($$select public.crm_merge_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b', '')$$, 'reason', 'empty reason refused');
select pg_temp.fails($$select public.crm_merge_leads('a3000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000001', 'other person')$$, 'different phone', 'different phones refused');
select pg_temp.fails($$select public.crm_merge_leads('a5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000009', 'other person')$$, 'different phone', 'different phones refused (2)');
reset role;
-- two paid without a booking ID (booking id cleared by hand) is still refused
update public.leads set booking_id = null where id = 'a5000000-0000-0000-0000-000000000007';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select public.crm_merge_leads('a5000000-0000-0000-0000-000000000007', 'a5000000-0000-0000-0000-000000000008', 'both paid')$$, 'booking ID|paid', 'two paid refused');
reset role;

-- merge B (unpaid) into A (paid) as the OWNER, asking to keep B: the paid booking must survive anyway
create temp table fl as select pg_temp.fp_children('public.leads'::regclass, 'a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b') as c,
  pg_temp.fp_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b') as r,
  (select coalesce(sum(amount), 0) from public.ledger_entries where lead_id in ('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b')) as ledger,
  (select coalesce(sum(total), 0) from public.invoices where lead_id in ('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b')) as inv,
  (select coalesce(sum(paid_amount), 0) from public.leads) as paid_all;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table ml as select public.crm_merge_leads('a3000000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-00000000000a', 'same enquiry twice') as r;
grant select on ml to authenticated;
reset role;
select pg_temp.ok((select r ->> 'kept' from ml) = 'a3000000-0000-0000-0000-00000000000a' and (select r ->> 'dropped' from ml) = 'a3000000-0000-0000-0000-00000000000b', 'the paid lead survives even when the caller named the other one');
select pg_temp.ok((select deleted_at is not null and deleted_reason like 'merged into %' from public.leads where id = 'a3000000-0000-0000-0000-00000000000b'), 'dropped lead is soft deleted with a reason');
select pg_temp.ok(pg_temp.residual('public.leads'::regclass, 'a3000000-0000-0000-0000-00000000000b') = 0, 'nothing in ANY table (messages, activities, ledger, invoices, ratings, notifications, garage, job links, handovers, warranty, tickets, all FKs) still points at the dropped lead');
select pg_temp.ok((select count(*) from public.messages where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1 and (select count(*) from public.lead_ratings where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.garage_assignments where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1 and (select count(*) from public.tech_job_links where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.warranty_cards where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1 and (select count(*) from public.booking_notifications where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.handovers where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1 and (select count(*) from public.crm_tickets where lead_id = 'a3000000-0000-0000-0000-00000000000a') = 1, 'seeded child rows now sit on the kept lead');
select pg_temp.ok((select coalesce(sum(amount), 0) from public.ledger_entries where lead_id = 'a3000000-0000-0000-0000-00000000000a') = (select ledger from fl)
  and (select coalesce(sum(total), 0) from public.invoices where lead_id = 'a3000000-0000-0000-0000-00000000000a') = (select inv from fl), 'ledger and invoice totals are the same before and after (moved, not copied)');
select pg_temp.ok((select coalesce(sum(paid_amount), 0) from public.leads) = (select paid_all from fl) and (select paid_amount from public.leads where id = 'a3000000-0000-0000-0000-00000000000a') = 500, 'paid amounts across all leads do not double count');
select pg_temp.ok((select note from public.leads where id = 'a3000000-0000-0000-0000-00000000000a') like E'paid booking note\nMerged from %: second enquiry note' and (select area from public.leads where id = 'a3000000-0000-0000-0000-00000000000a') = 'Test Area', 'note appended under Merged from, empty fields filled, nothing overwritten');
select pg_temp.ok((select ref_aliases from public.leads where id = 'a3000000-0000-0000-0000-00000000000a') @> array[(select ref from public.leads where id = 'a3000000-0000-0000-0000-00000000000b')], 'old reference kept as an alias on the kept lead');
select pg_temp.ok((select count(*) from public.audit_log where action = 'leads_merged' and details ->> 'merge' = (select r ->> 'merge_id' from ml)) = 1, 'lead merge is in the audit log');
select pg_temp.ok((select count(*) from public.crm_duplicate_leads() where lead_id = 'a3000000-0000-0000-0000-00000000000b') = 0, 'merged lead leaves the duplicate list');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_merge_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b', 'again') ->> 'already_merged') = 'true'
  and (public.crm_merge_leads('a3000000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-00000000000a', 'again reversed') ->> 'already_merged') = 'true', 'double merge is a no-op');
reset role;
select pg_temp.ok((select count(*) from public.lead_merges where kept = 'a3000000-0000-0000-0000-00000000000a') = 1, 'one lead merge row');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- a change on the kept lead since the merge blocks the undo; changing it back allows it
reset role;
update public.leads set note = 'edited by someone' where id = 'a3000000-0000-0000-0000-00000000000a';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select public.crm_unmerge_leads((select (r ->> 'merge_id')::uuid from ml))$$, 'changed since', 'undo refused after a later edit');
reset role;
update public.leads set note = (select snapshot -> 'kept_changed' -> 'note' ->> 'after' from public.lead_merges where id = (select (r ->> 'merge_id')::uuid from ml)) where id = 'a3000000-0000-0000-0000-00000000000a';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.crm_unmerge_leads((select (r ->> 'merge_id')::uuid from ml));
reset role;
select pg_temp.ok((select c from fl) = pg_temp.fp_children('public.leads'::regclass, 'a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b'), 'unmerge puts every child row back exactly (all FK tables) ');
select pg_temp.ok((select r from fl) = pg_temp.fp_leads('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-00000000000b'), 'unmerge restores both lead rows exactly');
select pg_temp.ok((select coalesce(sum(paid_amount), 0) from public.leads) = (select paid_all from fl), 'paid total unchanged after undo');
select pg_temp.ok((select unmerged_at is not null from public.lead_merges where id = (select (r ->> 'merge_id')::uuid from ml)) and (select count(*) from public.audit_log where action = 'leads_unmerged') = 1, 'undo recorded and audited');

rollback;
select 'ALL MERGE SQL CHECKS PASSED' as result;
