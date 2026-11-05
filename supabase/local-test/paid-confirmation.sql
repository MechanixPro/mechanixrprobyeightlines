-- Behaviour test for 20261228000000_paid_confirmation.sql on a LOCAL scratch Postgres (never Supabase). Run by tests/paid-sql.test.mjs, or by hand: sh supabase/local-test/run.sh
-- Each check raises an exception on failure, so psql with ON_ERROR_STOP=1 fails loudly. Placeholders only: no real names, numbers or emails.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','admin@example.invalid'),('00000000-0000-0000-0000-0000000000a9','owner@example.invalid'),('00000000-0000-0000-0000-0000000000b2','nobody@example.invalid'),('00000000-0000-0000-0000-0000000000c3','sales@example.invalid'),('00000000-0000-0000-0000-0000000000e5','techlead@example.invalid');
insert into public.admins (user_id, name, role) values ('00000000-0000-0000-0000-0000000000a1','Staff Admin','staff'),('00000000-0000-0000-0000-0000000000a9','Owner Admin','owner');
insert into public.crm_users (user_id, name, role, active) values ('00000000-0000-0000-0000-0000000000c3','Sales Agent','sales',true);
insert into public.crm_users (user_id, name, role, designation, active) values ('00000000-0000-0000-0000-0000000000e5','Tech Lead','support','tech_lead',true);
insert into public.mechanics (id, name, phone, active, onboarding_status) values ('00000000-0000-0000-0000-0000000000d4','Ravi Kumar','9000000001',true,'live');
insert into public.leads (id, name, phone, preferred_date, preferred_slot, status, confirm_fee, vehicle, area, pincode, source)
  values ('11111111-1111-1111-1111-111111111111','Test Customer','9876543210', current_date + 1,'morning','payment_sent',49,'bike','HSR Layout','560102','website');

-- fee table: nothing outside 49..99 can be stored
select pg_temp.fails($$update public.services set price = 30 where id = 'confirm_std'$$, 'confirm_fee_range', 'a fee below 49 is refused');
select pg_temp.fails($$update public.services set price = 150 where id = 'confirm_big'$$, 'confirm_fee_range', 'a fee above 99 is refused');
select pg_temp.ok((select array_agg(price order by id) from public.services where id like 'confirm\_%') = array[99,99,69,49], 'default fees: big 99, car 99, mid 69, std 49');
select pg_temp.fails($$update public.leads set confirm_fee = 120 where id = '11111111-1111-1111-1111-111111111111'$$, 'confirm_fee_check', 'a lead fee above 99 is refused');

-- confirmed only when paid
select pg_temp.fails($$update public.leads set status = 'scheduled' where id = '11111111-1111-1111-1111-111111111111'$$, 'waiting for the confirmation fee', 'unpaid cannot be scheduled');
select pg_temp.fails($$update public.leads set booking_id = 'MP-26-27-0001' where id = '11111111-1111-1111-1111-111111111111'$$, 'waiting for the confirmation fee', 'unpaid cannot get a booking ID by hand');
update public.leads set status = 'paid' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok((select booking_id is not null and confirm_paid_at is not null from public.leads where id = '11111111-1111-1111-1111-111111111111'), 'paid gives the booking ID and the paid time');
select pg_temp.ok(exists (select 1 from public.crm_activities where lead_id = '11111111-1111-1111-1111-111111111111' and body like 'Confirmation fee of Rs 49 paid%'), 'a history line says it was paid');

-- secrets and the door code are made once
select pg_temp.ok((public.booking_open_secrets('11111111-1111-1111-1111-111111111111') ->> 'track_token') = (public.booking_open_secrets('11111111-1111-1111-1111-111111111111') ->> 'track_token'), 'same tracking token every time');
select pg_temp.ok((select count(*) from public.handovers where lead_id = '11111111-1111-1111-1111-111111111111' and kind = 'start') = 1, 'one open door code');
select pg_temp.ok((select door_code ~ '^[0-9]{4}$' from public.booking_secrets), 'the code is 4 digits');

-- notifications: claimed once, failed ones can retry, sent ones cannot, Resend forces
select pg_temp.ok(public.notification_claim('11111111-1111-1111-1111-111111111111','confirm_email') and not public.notification_claim('11111111-1111-1111-1111-111111111111','confirm_email'), 'a second claim gets nothing');
select public.notification_finish('11111111-1111-1111-1111-111111111111','confirm_email','failed','boom');
select pg_temp.ok(public.notification_claim('11111111-1111-1111-1111-111111111111','confirm_email'), 'a failed one can be claimed again');
select public.notification_finish('11111111-1111-1111-1111-111111111111','confirm_email','sent');
select pg_temp.ok(not public.notification_claim('11111111-1111-1111-1111-111111111111','confirm_email') and public.notification_claim('11111111-1111-1111-1111-111111111111','confirm_email', true), 'sent is never repeated unless Resend forces it');
select pg_temp.fails($$select public.notification_claim('11111111-1111-1111-1111-111111111111','bogus')$$, 'booking_notifications_kind_check', 'unknown kinds are refused');

-- anon cannot read the secrets, notifications or quotes
set role anon;
select pg_temp.fails($$select count(*) from public.booking_secrets$$, 'permission denied', 'anon cannot read booking_secrets');
select pg_temp.fails($$select count(*) from public.job_quotes$$, 'permission denied', 'anon cannot read quotes');
select pg_temp.fails($$select public.quote_decide('x', 1, 'approve')$$, 'permission denied', 'anon cannot call quote_decide');
reset role;

-- ADMIN (staff role, not on the Crew list) can do every step
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(jsonb_array_length(public.crm_dispatch_list(5)) = 1, 'admin sees the Dispatch list');
select pg_temp.ok((public.crm_assign_technician('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000d4','test') ->> 'mechanic_name') = 'Ravi Kumar', 'admin assigns a mechanic');
select pg_temp.ok(public.crm_tech_link('11111111-1111-1111-1111-111111111111') like 'https://mechanixpro.in/job/?t=%', 'admin makes the job link');
select pg_temp.ok((public.crm_handover_code('11111111-1111-1111-1111-111111111111','start') ->> 'kind') = 'start', 'admin makes a new door code');
select pg_temp.ok(public.crm_door_code('11111111-1111-1111-1111-111111111111') ~ '^[0-9]{4}$', 'admin reads the open code');
select pg_temp.ok(public.crm_resend_guard('11111111-1111-1111-1111-111111111111'), 'admin may press Resend');
select pg_temp.ok((public.crm_confirmation('11111111-1111-1111-1111-111111111111') ->> 'fee')::int = 49, 'admin reads the confirmation state');
select pg_temp.ok(jsonb_array_length(public.crm_notifications('11111111-1111-1111-1111-111111111111')) >= 1, 'admin reads the message log');
select pg_temp.fails($$select public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[{"kind":"parts","name":"Brake pad","amount":400}]', '{"kind":"hours","hours":3}')$$, 'after the mechanic has arrived', 'no quote before the code is verified');
reset role;
update public.leads set visit_stage = 'started' where id = '11111111-1111-1111-1111-111111111111';   -- what the mechanic does at the door
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[{"kind":"parts","name":"Brake pad","amount":400}]', '{}')$$, 'estimated delivery', 'a quote without a delivery estimate is refused');
select pg_temp.fails($$select public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[{"kind":"parts","name":"Brake pad","amount":400}]', '{"kind":"hours","hours":99}')$$, 'estimated delivery', 'hours above 72 are refused');
select pg_temp.fails($$select public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[]', '{"kind":"hours","hours":3}')$$, 'at least one line', 'an empty quote is refused');
select pg_temp.ok((public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[{"kind":"parts","name":"Brake pad","amount":400},{"kind":"labour","name":"Fitting","amount":150}]', '{"kind":"hours","hours":3}') ->> 'balance')::numeric = 600, 'GST at 18% and the fee credit give the balance: 550 + 99 - 49 = 600');
select pg_temp.ok((public.crm_quote_send('11111111-1111-1111-1111-111111111111') ->> 'version') = '1', 'admin sends quote v1');
select pg_temp.fails($$select public.crm_visit_mark('11111111-1111-1111-1111-111111111111', 'ready')$$, 'not started', 'cannot mark ready before work starts');
reset role;
select pg_temp.fails($$update public.leads set visit_stage = 'repair_doorstep' where id = '11111111-1111-1111-1111-111111111111'$$, 'has not approved', 'start work is blocked until the quote is approved');
select pg_temp.fails($$update public.leads set visit_stage = 'picked_up' where id = '11111111-1111-1111-1111-111111111111'$$, 'has not approved', 'pickup is blocked until the quote is approved');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_quote_phone_approve('11111111-1111-1111-1111-111111111111','said yes') ->> 'version') = '1', 'admin records a phone approval');
select pg_temp.ok((public.crm_quote_phone_approve('11111111-1111-1111-1111-111111111111','again') ->> 'already') = 'true', 'phone approval twice is harmless');
reset role;
select pg_temp.ok(exists (select 1 from public.crm_activities where lead_id = '11111111-1111-1111-1111-111111111111' and body like 'Quote v1 approved by phone, recorded by Staff Admin%'), 'the audit line names the admin who recorded the approval');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'quote_approved_phone' and (details ->> 'recorded_by') = '00000000-0000-0000-0000-0000000000a1'), 'the audit log keeps who recorded it');
update public.leads set visit_stage = 'repair_doorstep' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok((select visit_stage from public.leads) = 'repair_doorstep', 'after approval the work can start');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_quote_save('11111111-1111-1111-1111-111111111111', '[{"kind":"parts","name":"Brake pad","amount":400},{"kind":"parts","name":"Chain set","amount":900}]', '{"kind":"hours","hours":5}') ->> 'version') = '2', 'extra work found: a revised quote is version 2');
select pg_temp.ok((public.crm_quote_send('11111111-1111-1111-1111-111111111111') ->> 'version') = '2', 'the revised quote is sent');
reset role;
select pg_temp.ok((select status from public.job_quotes where version = 1) = 'superseded' and (select status from public.job_quotes where version = 2) = 'sent', 'the old quote is superseded and the new one waits for approval');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_quote_eta('11111111-1111-1111-1111-111111111111','{"kind":"hours","hours":8}') ->> 'eta_rev') = '1', 'admin updates the delivery estimate');
select pg_temp.ok((public.crm_quote_eta('11111111-1111-1111-1111-111111111111','{"kind":"hours","hours":8}') ->> 'changed') = 'false', 'the same estimate again changes nothing');
select pg_temp.ok((public.crm_visit_mark('11111111-1111-1111-1111-111111111111', 'ready') ->> 'stage') = 'ready', 'admin marks it ready');
select pg_temp.ok((public.crm_visit_mark('11111111-1111-1111-1111-111111111111', 'returned') ->> 'stage') = 'returned', 'admin marks a doorstep job delivered');
reset role;

-- the customer's decision on the link: idempotent
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets), 2, 'approve', null) ->> 'status') = 'approved', 'customer approves v2 on the link');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets), 2, 'approve', null) ->> 'already') = 'true', 'the same tap twice is recorded once');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets), 2, 'decline', 'x') ->> 'ok') = 'false', 'a changed mind is refused (call us)');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets), 1, 'approve', null) ->> 'superseded') = 'true', 'an old quote cannot be approved');
select pg_temp.ok((public.quote_decide('00000000000000000000000000000000', 2, 'approve', null) ->> 'ok') = 'false', 'a wrong token does nothing');
select pg_temp.ok((select count(*) from public.crm_activities where body like 'Customer approved quote v2%') = 1, 'one history line for the approval');

-- people who are not admin and not Crew are refused everywhere
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.crm_dispatch_list(5)$$, 'not allowed', 'a stranger cannot see Dispatch');
select pg_temp.fails($$select public.crm_quote_send('11111111-1111-1111-1111-111111111111')$$, 'not allowed', 'a stranger cannot send a quote');
select pg_temp.fails($$select public.crm_quote_phone_approve('11111111-1111-1111-1111-111111111111')$$, 'not allowed', 'a stranger cannot record an approval');
select pg_temp.fails($$select public.crm_resend_guard('11111111-1111-1111-1111-111111111111')$$, 'not allowed', 'a stranger cannot Resend');
select pg_temp.fails($$select public.crm_handover_code('11111111-1111-1111-1111-111111111111','start')$$, 'not allowed', 'a stranger cannot make a code');
select pg_temp.fails($$select public.crm_paid_badges(array['11111111-1111-1111-1111-111111111111']::uuid[])$$, 'not allowed', 'a stranger cannot read badges');
-- a sales agent who does not own the lead keeps their limits
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_quote_send('11111111-1111-1111-1111-111111111111')$$, 'permission', 'a sales agent cannot send a quote on a lead they do not own');
select pg_temp.fails($$select public.crm_door_code('11111111-1111-1111-1111-111111111111')$$, 'permission', 'a sales agent cannot read the door code');
select pg_temp.ok(public.crm_dispatch_list(5) = '[]'::jsonb, 'a sales agent gets an empty Dispatch list');
-- the Technician lead may dispatch
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select pg_temp.ok(jsonb_array_length(public.crm_dispatch_list(5)) = 1, 'the Technician lead sees Dispatch');
select pg_temp.ok(public.crm_resend_guard('11111111-1111-1111-1111-111111111111'), 'the Technician lead may Resend');
reset role;
-- the owner (supervisor) passes too
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok(jsonb_array_length(public.crm_dispatch_list(5)) = 1, 'the owner sees Dispatch');
reset role;
-- an old-style lead (no fee) behaves as before: scheduling and booking IDs are not blocked
insert into public.leads (id, name, phone, preferred_date, preferred_slot, status, source) values ('22222222-2222-2222-2222-222222222222','Old Lead','9876500000', current_date + 1,'morning','new','website');
update public.leads set status = 'scheduled' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok((select booking_id is not null from public.leads where id = '22222222-2222-2222-2222-222222222222'), 'old leads still get an ID on scheduling');
select 'ALL PAID CONFIRMATION SQL CHECKS PASSED' as result;
