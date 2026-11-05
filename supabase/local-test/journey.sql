-- Behaviour test for the customer journey migrations (20261229..20261231) on a LOCAL scratch Postgres (never Supabase). Run after paid-confirmation.sql by run.sh.
-- Permission matrix: customer (token), mechanic (job token), sales agent, Technician lead, supervisor/owner, admin, stranger, anon. Placeholders only: no real names, numbers or emails.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- people: a9 owner (supervisor), a1 staff admin, c3 sales agent, e5 Technician lead, b2 stranger. Reuses the users made by paid-confirmation.sql; adds a second sales agent c4 and a second mechanic.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c4','agent2@example.invalid') on conflict do nothing;
insert into public.crm_users (user_id, name, role, active) values ('00000000-0000-0000-0000-0000000000c4','Second Agent','sales',true) on conflict do nothing;
insert into public.mechanics (id, name, phone, active, onboarding_status) values ('00000000-0000-0000-0000-0000000000d5','Other Mechanic','9000000002',true,'live') on conflict do nothing;
insert into public.customers (id, phone, name) values ('00000000-0000-0000-0000-00000000cc01','9876543299','Test Customer') on conflict do nothing;

-- lead A: paid bike, assigned to Ravi (d4), unowned. lead B: same customer, earlier completed booking. lead C: owned by agent c3 (agent c4 must not see it). lead D: another mechanic's job.
insert into public.leads (id, name, phone, customer_id, preferred_date, preferred_slot, status, confirm_fee, vehicle, area, pincode, lat, lng, source) values
 ('aaaaaaaa-0000-0000-0000-00000000000a','Test Customer','9876543299','00000000-0000-0000-0000-00000000cc01', current_date,'morning','payment_sent',69,'bike','HSR Layout','560102',12.91,77.64,'website'),
 ('aaaaaaaa-0000-0000-0000-00000000000b','Test Customer','9876543299','00000000-0000-0000-0000-00000000cc01', current_date - 20,'morning','payment_sent',49,'bike','HSR Layout','560102',null,null,'website'),
 ('aaaaaaaa-0000-0000-0000-00000000000c','Owned Customer','9876500001',null, current_date + 1,'evening','payment_sent',49,'bike','Indiranagar','560038',null,null,'website'),
 ('aaaaaaaa-0000-0000-0000-00000000000d','Other Job','9876500002',null, current_date,'afternoon','payment_sent',99,'car','Whitefield','560066',null,null,'website');
update public.leads set status = 'paid' where id in ('aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-00000000000d');
update public.leads set mechanic_id = '00000000-0000-0000-0000-0000000000d4' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
update public.leads set mechanic_id = '00000000-0000-0000-0000-0000000000d5' where id = 'aaaaaaaa-0000-0000-0000-00000000000d';
update public.leads set crm_owner = '00000000-0000-0000-0000-0000000000c3' where id = 'aaaaaaaa-0000-0000-0000-00000000000c';
select public.booking_open_secrets('aaaaaaaa-0000-0000-0000-00000000000a'); select public.booking_open_secrets('aaaaaaaa-0000-0000-0000-00000000000b'); select public.booking_open_secrets('aaaaaaaa-0000-0000-0000-00000000000c');
update public.leads set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
create temp table tk as select
  (select track_token from public.booking_secrets where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') as a,
  (select track_token from public.booking_secrets where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000c') as c;
grant select on tk to public;
-- a job link for lead A (token 'tt..' is a placeholder; only its hash is stored)
insert into public.tech_job_links (lead_id, mechanic_id, token_hash, expires_at) values
 ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000d4', encode(extensions.digest('job-token-a','sha256'),'hex'), now() + interval '7 days'),
 ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000d5', encode(extensions.digest('job-token-d','sha256'),'hex'), now() + interval '7 days');
create or replace function pg_temp.h(t text) returns text language sql as $$ select encode(extensions.digest(t,'sha256'),'hex') $$;

-- ───────────── customer details ─────────────
select pg_temp.ok((public.booking_details_get('nope') ->> 'ok') = 'false', 'a bad token reads nothing');
select pg_temp.ok((public.booking_details_get((select a from tk)) ->> 'editable') = 'true', 'details are editable before work starts');
select pg_temp.ok((public.booking_details_save((select a from tk), '{"landmark":"Near the temple","access_note":"Gate 2, park inside","reg_no":"ka 01 ab 1234","kms":"18500","vehicle_note":"Brake feels soft","issue_text":"Makes a noise at low speed"}') ->> 'ok') = 'true', 'saving works');
select pg_temp.ok((select reg_no = 'KA 01 AB 1234' and kms = 18500 and saves = 2 from public.booking_details where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'values are cleaned and stored');
select pg_temp.ok((public.booking_details_save((select a from tk), '{"landmark":"Near the temple"}') ->> 'unchanged') = 'true', 'saving the same thing again changes nothing');
select pg_temp.ok((public.booking_details_save((select a from tk), '{"reg_no":"!!"}') ->> 'field') = 'reg_no', 'a bad registration number is refused with its field');
select pg_temp.ok((public.booking_details_save((select a from tk), '{"kms":"12 km"}') ->> 'field') = 'kms', 'bad kilometres are refused');
select pg_temp.ok((select count(*) from public.crm_activities where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and body like 'Customer added or changed:%') = 1, 'one neutral history line, no customer text');
select pg_temp.ok(not exists (select 1 from public.crm_activities where body like '%Near the temple%' or body like '%Brake feels soft%'), 'customer text never goes in the history or logs');
select pg_temp.ok(not exists (select 1 from public.audit_log where details::text like '%temple%'), 'nor in the audit log');
select public.booking_details_save((select a from tk), '{"landmark":"x<script>y"}');
select pg_temp.ok((select landmark from public.booking_details where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 'x script y', 'angle brackets are stripped');
-- a customer's token cannot touch another booking: tokens are per booking
select pg_temp.ok((public.booking_details_get((select c from tk)) -> 'details' ->> 'landmark') is null, 'booking C has none of booking A''s details');

-- photos: 3 at most, only into the booking's own folder
select pg_temp.ok((public.booking_photo_reserve((select a from tk)) ->> 'left') = '3', 'three slots at the start');
select pg_temp.ok((public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000c/11111111-1111-1111-1111-111111111111.jpg', 100) ->> 'ok') = 'false', 'a path in another booking''s folder is refused');
select pg_temp.fails($$select public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/not-a-uuid.exe', 100)$$, 'booking_photos_path_check', 'only jpg, png, webp paths are stored');
select public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.jpg', 100);
select public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.png', 100);
select pg_temp.ok((public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.png', 100) ->> 'already') = 'true', 'the same photo twice is one photo');
select public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/33333333-3333-3333-3333-333333333333.webp', 100);
select pg_temp.ok((public.booking_photo_add((select a from tk), 'aaaaaaaa-0000-0000-0000-00000000000a/44444444-4444-4444-4444-444444444444.jpg', 100) ->> 'ok') = 'false', 'a fourth photo is refused');
select pg_temp.ok((public.booking_photo_reserve((select a from tk)) ->> 'ok') = 'false', 'no slots left');

-- issues: typed, deduplicated, capped
select pg_temp.ok((public.booking_issue_report((select a from tk), 'late', 'The mechanic has not come yet') ->> 'ok') = 'true', 'an issue is saved');
select pg_temp.ok((public.booking_issue_report((select a from tk), 'late', 'The mechanic has not come yet') ->> 'already') = 'true', 'the same issue within 10 minutes is one issue');
select pg_temp.ok((public.booking_issue_report((select a from tk), 'bogus', 'whatever') ->> 'field') = 'category', 'an unknown type is refused');
select pg_temp.ok((public.booking_issue_report((select a from tk), 'other', ' ') ->> 'field') = 'body', 'an empty issue is refused');
select public.booking_issue_report((select a from tk), 'payment', 'Charged twice I think'); select public.booking_issue_report((select a from tk), 'safety', 'Mechanic left tools'); select public.booking_issue_report((select a from tk), 'other', 'Something else one'); select public.booking_issue_report((select a from tk), 'other', 'Something else two');
select pg_temp.ok((public.booking_issue_report((select a from tk), 'other', 'Sixth open one') ->> 'ok') = 'false', 'at most 5 open issues on a booking');
select pg_temp.ok(not exists (select 1 from public.crm_activities where body like '%Charged twice%' or body like '%not come yet%'), 'issue text is not copied into the history');
select pg_temp.ok((select count(*) from public.crm_activities where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and body like 'Customer reported a problem%') = 5, 'five neutral history lines');
select pg_temp.ok((public.booking_issue_report((select c from tk), 'other', 'Issue on C only') ->> 'ok') = 'true', 'issue on booking C');

create temp table iss as select (select id from public.booking_issues where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000c') as c, (select id from public.booking_issues where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and category = 'late') as a_late;
grant select on iss to public;
-- work started: details and photos are locked (update the stage the same way the visit does)
select pg_temp.ok((public.booking_details_get((select a from tk)) -> 'issues' -> 0 ->> 'status') = 'open', 'the customer sees their issue as open');

-- ───────────── the desk: permissions ─────────────
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a')$$, 'not allowed', 'a stranger cannot read added details');
select pg_temp.fails($$select public.crm_open_issues('open', 10)$$, 'not allowed', 'a stranger cannot list issues');
select pg_temp.fails($$select public.crm_issue_resolve(gen_random_uuid(), null)$$, 'not allowed', 'a stranger cannot resolve');
select pg_temp.fails($$select public.crm_tech_location('aaaaaaaa-0000-0000-0000-00000000000a')$$, 'not allowed', 'a stranger cannot read the mechanic''s location');
select pg_temp.fails($$select public.crm_tech_seen(array['aaaaaaaa-0000-0000-0000-00000000000a']::uuid[])$$, 'not allowed', 'a stranger cannot read last seen');
select pg_temp.fails($$select count(*) from public.booking_issues$$, 'permission denied', 'a signed-in stranger cannot read the issues table');
select pg_temp.fails($$select count(*) from public.tech_locations$$, 'permission denied', 'nor the locations table');
select pg_temp.fails($$select public.booking_details_get('x')$$, 'permission denied', 'a signed-in user cannot call the customer functions');
select pg_temp.fails($$select public.tech_location_put('x', 12.9, 77.6)$$, 'permission denied', 'nor the mechanic function');
reset role;
set role anon;
select pg_temp.fails($$select count(*) from public.booking_details$$, 'permission denied', 'anon cannot read details');
select pg_temp.fails($$select count(*) from public.booking_photos$$, 'permission denied', 'anon cannot read photos');
select pg_temp.fails($$select count(*) from public.tech_locations$$, 'permission denied', 'anon cannot read locations');
select pg_temp.fails($$select public.booking_issue_report('x','late','abc')$$, 'permission denied', 'anon cannot call booking_issue_report');
select pg_temp.fails($$select public.booking_tech_location('x')$$, 'permission denied', 'anon cannot call booking_tech_location');
select pg_temp.fails($$select public.tech_my_jobs('x')$$, 'permission denied', 'anon cannot call tech_my_jobs');
select pg_temp.fails($$select public.booking_documents('x')$$, 'permission denied', 'anon cannot call booking_documents');
select pg_temp.fails($$select public.crm_open_issues('open', 10)$$, 'permission denied', 'anon cannot list issues');
reset role;
-- agent c3 owns lead C, so sees it; agent c4 does not; both see unowned lead A (existing visibility rule)
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select pg_temp.ok(public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a') -> 'details' ->> 'landmark' is not null, 'agent sees an unowned lead''s added details');
select pg_temp.ok(jsonb_array_length(public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a') -> 'photos') = 0, 'a sales agent gets no photo links');
select pg_temp.ok((public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'photo_count') = '3', 'but sees that there are 3');
select pg_temp.fails($$select public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000c')$$, 'lead not found', 'agent c4 cannot read agent c3''s lead');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.crm_open_issues('open', 50)) e where e ->> 'booking_id' is not null and (e ->> 'lead_id') = 'aaaaaaaa-0000-0000-0000-00000000000c') = 0, 'agent c4 does not see issues of agent c3''s lead in the list');
select pg_temp.fails($$select public.crm_issue_resolve((select c from iss), 'x')$$, 'issue not found', 'agent c4 cannot resolve an issue on a lead they cannot see');
select pg_temp.ok(not (public.crm_open_issues('open', 50)::text ~ '9876|address'), 'the list carries no phone number or street address');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok(jsonb_array_length(public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000c') -> 'issues') = 1, 'agent c3 sees the issue on their own lead');
select pg_temp.ok((public.crm_issue_resolve((select c from iss), 'Called the customer') ->> 'resolved_by') = 'Sales Agent', 'the agent resolves it and the name is kept');
select pg_temp.ok((public.crm_issue_resolve((select c from iss), 'again') ->> 'already') = 'true', 'resolving twice is harmless');
reset role;
-- Technician lead (assign and manage technicians): sees photos on a lead they can see
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select pg_temp.ok(jsonb_array_length(public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a') -> 'photos') = 3, 'the Technician lead gets the photo links');
select pg_temp.ok(public.booking_photo_ok('aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.jpg'), 'and the storage rule lets them read');
reset role;
-- admin (staff) and owner: superset
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(jsonb_array_length(public.crm_booking_updates('aaaaaaaa-0000-0000-0000-00000000000a') -> 'photos') = 3, 'an admin sees the photos');
select pg_temp.ok(public.booking_photo_ok('aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.jpg'), 'an admin passes the storage rule');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.crm_open_issues('open', 50))) = 5, 'an admin sees the 5 open issues of lead A (lead C''s is resolved)');
select pg_temp.ok((public.crm_issue_resolve((select a_late from iss), 'Mechanic is five minutes away') ->> 'resolved_by') = 'Staff Admin', 'the admin resolves; their name is kept');
select pg_temp.ok((select e ->> 'resolved_by' from jsonb_array_elements(public.crm_open_issues('resolved', 10)) e where e ->> 'category' = 'late') = 'Staff Admin', 'the resolved list says who');
reset role;
-- the sales agent has no photo access in storage terms
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select pg_temp.ok(not public.booking_photo_ok('aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.jpg'), 'a sales agent does not pass the photo storage rule');
reset role;

-- ───────────── live location ─────────────
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.92, 77.65, 20, 90) ->> 'stopped') = 'true', 'no location before On the way');
update public.leads set visit_stage = 'on_the_way', visit_stage_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((public.tech_location_put('bogus', 12.92, 77.65) ->> 'ok') = 'false', 'a bad token writes nothing');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-d'), 12.92, 77.65) ->> 'ok') = 'false', 'another mechanic''s link cannot write for this job');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 55.0, 77.65) ->> 'ok') = 'false', 'an impossible point is refused');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.92, 77.65, 20, 90) ->> 'ok') = 'true', 'On the way: the point is saved');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.9201, 77.6501, 20, 90) ->> 'throttled') = 'true', 'a point 0 seconds later is ignored');
do $$ begin for i in 1..24 loop update public.tech_locations set recorded_at = recorded_at - interval '30 seconds' where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a'; perform public.tech_location_put(encode(extensions.digest('job-token-a','sha256'),'hex'), 12.92 + i * 0.001, 77.65, 15, null); end loop; end $$;
select pg_temp.ok((select count(*) from public.tech_locations where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 20, 'only the last 20 points are kept');
select pg_temp.ok((public.booking_tech_location((select a from tk)) ->> 'live') = 'true' and (public.booking_tech_location((select a from tk)) ->> 'lat')::numeric = 12.944, 'the customer gets the newest point');
select pg_temp.ok(not (public.booking_tech_location((select a from tk)) ? 'trail') and (select count(*) from jsonb_object_keys(public.booking_tech_location((select a from tk)))) <= 6, 'and only the newest point, never a trail');
select pg_temp.ok((public.booking_tech_location((select c from tk)) ->> 'live') = 'false', 'another booking''s token sees nothing');
update public.tech_locations set recorded_at = now() - interval '11 minutes' where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((public.booking_tech_location((select a from tk)) ->> 'live') = 'false', 'a point older than 10 minutes is not shown to the customer');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.95, 77.66) ->> 'ok') = 'true', 'sharing continues after a gap');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_tech_location('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'seen') = 'true' and (public.crm_tech_location('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'mechanic') = 'Ravi', 'an admin sees last seen with the first name');
select pg_temp.ok((public.crm_tech_seen(array['aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-00000000000d']::uuid[]) -> 'aaaaaaaa-0000-0000-0000-00000000000a' ->> 'age_s')::int < 5, 'Dispatch last seen is fresh');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok((public.crm_tech_location('aaaaaaaa-0000-0000-0000-00000000000a') ->> 'seen') = 'true', 'a sales agent sees last seen on an unowned lead');
reset role;
update public.leads set visit_stage = 'arrived' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.9501, 77.6601) ->> 'ok') = 'true', 'Arrived: still allowed (until the code is verified)');
update public.leads set visit_stage = 'started' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) from public.tech_locations where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0, 'code verified: every point is deleted');
select pg_temp.ok((public.tech_location_put(pg_temp.h('job-token-a'), 12.95, 77.66) ->> 'stopped') = 'true', 'and no new point is accepted');
-- completion and reassignment purge too
update public.leads set visit_stage = 'on_the_way' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select public.tech_location_put(pg_temp.h('job-token-a'), 12.95, 77.66);
update public.leads set mechanic_id = '00000000-0000-0000-0000-0000000000d5' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) from public.tech_locations where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0, 'reassigning the job deletes the points');
update public.leads set mechanic_id = '00000000-0000-0000-0000-0000000000d4' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select public.tech_location_put(pg_temp.h('job-token-a'), 12.95, 77.66);
update public.leads set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) from public.tech_locations where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0, 'completing the job deletes the points');
update public.leads set status = 'scheduled', visit_stage = null where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
-- the 24 hour cleanup
update public.leads set visit_stage = 'on_the_way' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select public.tech_location_put(pg_temp.h('job-token-a'), 12.95, 77.66);
update public.tech_locations set recorded_at = now() - interval '25 hours' where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok(public.tech_locations_purge() = 1, 'the nightly cleanup removes points older than 24 hours');
update public.leads set visit_stage = null where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- details lock once work starts
update public.leads set visit_stage = 'ready' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select pg_temp.ok((public.booking_details_save((select a from tk), '{"landmark":"Changed"}') ->> 'locked') = 'true', 'details are locked once work has started');
select pg_temp.ok((public.booking_photo_reserve((select a from tk)) ->> 'locked') = 'true', 'and so are photos');
update public.booking_issues set status = 'resolved', resolved_at = now() where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and status = 'open' and category = 'other';
select pg_temp.ok((public.booking_issue_report((select a from tk), 'other', 'Still can report after work started') ->> 'ok') = 'true', 'issues can still be reported after work started');
update public.leads set visit_stage = null where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- ───────────── mechanic: my jobs ─────────────
select pg_temp.ok((public.tech_my_jobs('bogus') ->> 'ok') = 'false', 'a bad link lists nothing');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.tech_my_jobs(pg_temp.h('job-token-a')) -> 'jobs') j where j ->> 'id' like 'aaaaaaaa%') = 1 and not (public.tech_my_jobs(pg_temp.h('job-token-a'))::text like '%000000000d%'), 'the mechanic sees only his own jobs');
select pg_temp.ok(not (public.tech_my_jobs(pg_temp.h('job-token-a'))::text ~ '9876|phone|address'), 'the list has no phone or street address');
select pg_temp.ok((public.tech_open_job(pg_temp.h('job-token-a'), 'aaaaaaaa-0000-0000-0000-00000000000d') ->> 'ok') = 'false', 'he cannot open another mechanic''s job');
select pg_temp.ok((public.tech_open_job(pg_temp.h('job-token-a'), 'aaaaaaaa-0000-0000-0000-00000000000a') ->> 'same') = 'true', 'opening the current job is a no-op');
update public.leads set mechanic_id = '00000000-0000-0000-0000-0000000000d4' where id = 'aaaaaaaa-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) from jsonb_array_elements(public.tech_my_jobs(pg_temp.h('job-token-a')) -> 'jobs') j where j ->> 'id' like 'aaaaaaaa%') = 2, 'a second assigned job appears');
select pg_temp.ok((select (j ->> 'is_today') from jsonb_array_elements(public.tech_my_jobs(pg_temp.h('job-token-a')) -> 'jobs') j limit 1) = 'true', 'today comes first');
create temp table opened as select public.tech_open_job(pg_temp.h('job-token-a'), 'aaaaaaaa-0000-0000-0000-00000000000c') as r;
select pg_temp.ok((select (r ->> 'ok') = 'true' and (r ->> 'token') ~ '^[0-9a-f]{64}$' from opened), 'opening his own other job gives a new link');
select pg_temp.ok(exists (select 1 from public.tech_job_links where lead_id = 'aaaaaaaa-0000-0000-0000-00000000000c' and token_hash = pg_temp.h((select r ->> 'token' from opened)) and mechanic_id = '00000000-0000-0000-0000-0000000000d4'), 'the link is for the same mechanic and that job');
select pg_temp.ok((public.tech_my_jobs(pg_temp.h((select r ->> 'token' from opened))) -> 'jobs' -> 0 ->> 'id') is not null, 'the new link works as a login too');

-- ───────────── documents and past bookings ─────────────
select pg_temp.ok((public.booking_documents((select a from tk)) -> 'receipt' ->> 'amount') = '69', 'the fee receipt is listed');
select pg_temp.ok((public.booking_documents((select a from tk)) -> 'invoice') = 'null'::jsonb, 'no invoice yet');
select pg_temp.ok((public.booking_history((select a from tk)) -> 'rows' -> 0 ->> 'status') = 'completed' and jsonb_array_length(public.booking_history((select a from tk)) -> 'rows') = 1, 'one earlier booking, not this one');
select pg_temp.ok((public.booking_history((select a from tk)) -> 'rows' -> 0 ->> 'token') ~ '^[0-9a-f]{32}$', 'its own link is given because a token exists');
select pg_temp.ok(not (public.booking_history((select a from tk))::text ~ '9876|HSR|560102|Ravi'), 'no phone, address, PIN or mechanic in the list');
update public.settings set value = to_jsonb(false) where key = 'track_show_history';
select pg_temp.ok((public.booking_history((select a from tk)) ->> 'enabled') = 'false' and jsonb_array_length(public.booking_history((select a from tk)) -> 'rows') = 0, 'one setting turns the list off');
update public.settings set value = to_jsonb(true) where key = 'track_show_history';
select pg_temp.ok((public.booking_history((select c from tk)) ->> 'enabled') = 'true' and jsonb_array_length(public.booking_history((select c from tk)) -> 'rows') = 0, 'a booking with no customer record has no history');
select pg_temp.ok((public.booking_documents('nope') ->> 'ok') = 'false', 'a bad token has no documents');
-- notifications: new kinds are accepted and labelled
select pg_temp.ok(public.notification_claim('aaaaaaaa-0000-0000-0000-00000000000a','ontheway_email') and public.notification_claim('aaaaaaaa-0000-0000-0000-00000000000a','team_issue:1'), 'on-the-way and team issue kinds can be claimed once');
select public.notification_finish('aaaaaaaa-0000-0000-0000-00000000000a','team_issue:1','sent');
select pg_temp.ok(exists (select 1 from public.crm_activities where body = 'Team alert: customer issue sent'), 'the team issue alert is logged in the history');
select pg_temp.ok(not public.notification_claim('aaaaaaaa-0000-0000-0000-00000000000a','ontheway_email'), 'on-the-way email is claimed once');
select 'ALL JOURNEY SQL CHECKS PASSED' as result;
