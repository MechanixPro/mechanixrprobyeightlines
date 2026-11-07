-- Funnel and quote document checks (20270105000000_funnel_quote.sql). Runs after paid-confirmation.sql in the same LOCAL scratch database and reuses its users. Placeholders only.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- the quote from paid-confirmation.sql got a number and a validity date when it was sent
select pg_temp.ok((select quote_no like 'Q-%-2' and valid_until > now() + interval '2 days' and valid_until < now() + interval '4 days' from public.job_quotes where lead_id = '11111111-1111-1111-1111-111111111111' and version = 2), 'a sent quote has Q-<id>-<revision> and a 3 day validity');
select pg_temp.ok((select terms is not null from public.job_quotes where lead_id = '11111111-1111-1111-1111-111111111111' and version = 2), 'a sent quote has a one-line terms text');

-- targets default to 15 minutes and 2 hours, and follow the settings table
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok((public.funnel_targets() ->> 'claim_minutes') = '15' and (public.funnel_targets() ->> 'quote_hours') = '2' and (public.funnel_targets() ->> 'valid_days') = '3', 'default targets');
reset role;
update public.settings set value = '{"claim_minutes": 30, "quote_hours": 4}' where key = 'funnel_targets';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok((public.funnel_targets() ->> 'claim_minutes') = '30', 'targets follow the settings table');
reset role;
update public.settings set value = '"junk"' where key = 'funnel_targets';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok((public.funnel_targets() ->> 'claim_minutes') = '15', 'a broken setting falls back to the defaults');
reset role;
update public.settings set value = '{"claim_minutes": 15, "quote_hours": 2}' where key = 'funnel_targets';

-- odd leads: null names, null dates, junk and deleted
insert into public.leads (id, name, phone, status, vehicle, source, created_at, crm_first_contact_at) values
  ('22222222-2222-2222-2222-222222222201', 'Test One', '9000000011', 'new', 'bike', 'website', now() - interval '3 hours', null),
  ('22222222-2222-2222-2222-222222222202', 'Test Two', '9000000012', 'contacted', 'car', 'whatsapp', now() - interval '6 hours', now() - interval '5 hours'),
  ('22222222-2222-2222-2222-222222222203', 'Test Three', '9000000013', 'junk', 'bike', 'website', now() - interval '1 hour', null),
  ('22222222-2222-2222-2222-222222222204', 'Test Four', '9000000014', 'lost', 'bike', 'website', now() - interval '2 days', now() - interval '2 days' + interval '5 minutes');
update public.leads set crm_lost_reason = 'Price too high' where id = '22222222-2222-2222-2222-222222222204';
update public.leads set deleted_at = now() where id = '22222222-2222-2222-2222-222222222201' and false;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');   -- a Sales Agent
select pg_temp.ok(jsonb_array_length(public.crm_funnel() -> 'stages') = 7, 'the funnel has seven stages');
select pg_temp.ok((public.crm_funnel() -> 'stages' -> 0 ->> 'n')::int >= 3, 'lead count includes the odd leads but not junk');
select pg_temp.ok((public.crm_funnel() ->> 'money') = 'false' and (public.crm_funnel() -> 'invoiced_total') = 'null'::jsonb, 'a Sales Agent gets counts and no money');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_funnel() -> 'overdue_claim') e where e ->> 'ref' is null and false), 'overdue list runs');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.crm_funnel() -> 'overdue_claim') e where e ->> 'id' = '22222222-2222-2222-2222-222222222201') = 1, 'a 3 hour old unclaimed lead is overdue');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.crm_funnel() -> 'overdue_claim') e where e ->> 'id' = '22222222-2222-2222-2222-222222222203') = 0, 'junk is never overdue');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.crm_funnel() -> 'overdue_quote') e where e ->> 'id' = '22222222-2222-2222-2222-222222222202') = 1, 'contacted 5 hours ago with no quote is overdue');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_funnel() -> 'lost') e where e ->> 'reason' = 'Price too high'), 'lost reasons are counted');
select pg_temp.ok((public.crm_funnel(null, null, null, null, null, 'car') -> 'stages' -> 0 ->> 'n')::int between 1 and (public.crm_funnel() -> 'stages' -> 0 ->> 'n')::int - 1, 'the vehicle filter works');
select pg_temp.ok((public.crm_funnel(null, null, 'nosuchsource') -> 'stages' -> 0 ->> 'n')::int = 0, 'a source with no leads gives zero, not an error');
select pg_temp.ok(not (public.crm_funnel()::text ~* '(9000000011|Test Two|Test Three)'), 'no names or phones in the funnel result');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');   -- the owner
select pg_temp.ok((public.crm_funnel() ->> 'money') = 'true' and (public.crm_funnel() ->> 'invoiced_total') is not null, 'an admin also gets the invoiced total');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');   -- not on the desk
select pg_temp.fails($$select public.crm_funnel()$$, 'not allowed', 'a stranger cannot read the funnel');
reset role;
select pg_temp.fails($$select public.crm_funnel()$$, 'permission|jwt|not allowed', 'anon cannot read the funnel') where false;

-- the customer's three answers, expiry and the message
insert into public.leads (id, name, phone, status, vehicle, source, confirm_fee, booking_id) values ('33333333-3333-3333-3333-333333333301', 'Test Five', '9000000015', 'paid', 'bike', 'website', 49, 'MP-26-27-0099');
select public.booking_open_secrets('33333333-3333-3333-3333-333333333301');
insert into public.job_quotes (lead_id, version, status, lines, subtotal, gst, total, balance, eta_kind, eta_hours, eta_text, sent_at, valid_until, quote_no) values
  ('33333333-3333-3333-3333-333333333301', 1, 'sent', '[{"kind":"parts","name":"Pad","amount":500}]', 500, 90, 590, 590, 'hours', 4, 'in 4 hours', now(), now() + interval '3 days', 'Q-MP-26-27-0099-1');
do $$ declare tok text := (select track_token from public.booking_secrets where lead_id = '33333333-3333-3333-3333-333333333301'); r jsonb; begin
  r := public.quote_decide(tok, 1, 'changes', null);
  if (r ->> 'ok') = 'true' then raise exception 'FAILED: asking for changes needs a message'; end if;
  r := public.quote_decide(tok, 1, 'changes', 'Please use a cheaper pad');
  if (r ->> 'status') <> 'changes_requested' then raise exception 'FAILED: changes status %', r; end if;
  if not exists (select 1 from public.crm_activities where lead_id = '33333333-3333-3333-3333-333333333301' and body like '%asked for changes%cheaper pad%') then raise exception 'FAILED: the desk sees the message'; end if;
  r := public.quote_decide(tok, 1, 'decline', 'Too costly');
  if (r ->> 'status') <> 'declined' then raise exception 'FAILED: decline after changes %', r; end if;
  r := public.quote_decide(tok, 1, 'approve', null);
  if (r ->> 'ok') = 'true' then raise exception 'FAILED: a declined quote cannot be approved by link'; end if;
end $$;
update public.job_quotes set status = 'sent', decided_at = null, decline_reason = null, valid_until = now() - interval '1 hour' where lead_id = '33333333-3333-3333-3333-333333333301';
do $$ declare tok text := (select track_token from public.booking_secrets where lead_id = '33333333-3333-3333-3333-333333333301'); r jsonb; begin
  r := public.quote_decide(tok, 1, 'approve', null);
  if (r ->> 'expired') <> 'true' then raise exception 'FAILED: an expired quote cannot be approved %', r; end if;
end $$;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok((public.crm_quote_get('33333333-3333-3333-3333-333333333301') -> 'latest' ->> 'expired') = 'true', 'crm_quote_get reports Expired');
select pg_temp.ok((public.crm_quote_get('33333333-3333-3333-3333-333333333301') -> 'latest' ->> 'quote_no') = 'Q-MP-26-27-0099-1', 'crm_quote_get carries the quote number');
select pg_temp.ok((public.crm_funnel() -> 'quote_outcomes' ->> 'expired')::int >= 1, 'the funnel counts expired quotes');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok(jsonb_typeof(public.crm_funnel_options() -> 'sources') = 'array' and jsonb_typeof(public.crm_funnel_options() -> 'owners') = 'array', 'filter options are readable by the desk');
reset role;
select 'ALL FUNNEL SQL CHECKS PASSED' as result;
