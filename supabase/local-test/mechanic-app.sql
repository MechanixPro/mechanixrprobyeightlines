-- Behaviour test for 20270103000000_mechanic_app.sql on a LOCAL scratch Postgres (never Supabase). Run after garage.sql by run.sh. Placeholders only: no real names, numbers or emails.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
-- people (made by paid-confirmation.sql): a9 owner (supervisor), a1 staff admin, c3 sales agent, e5 Technician lead, b2 stranger
insert into public.mechanics (id, name, phone, area, payout_rate) values ('88888888-0000-0000-0000-00000000a001','Test Mechanic One','9000000021','HSR Layout',30),('88888888-0000-0000-0000-00000000b001','Test Mechanic Two','9000000022','Indiranagar',30);
insert into public.leads (id, name, phone, email, address, area, pincode, preferred_date, preferred_slot, status, confirm_fee, vehicle, job_place, source, notes) values
 ('77777777-1111-0000-0000-000000000001','Asha Rao','9876500201','asha.private@example.invalid','12, Private Lane, Test Nagar','HSR Layout','560102', current_date,'morning','payment_sent',49,'bike','doorstep','website',null),
 ('77777777-1111-0000-0000-000000000002','Vikram Shah','9876500202','vikram.private@example.invalid','99, Secret Road','Indiranagar','560038', current_date,'morning','payment_sent',49,'bike','doorstep','website',null);
update public.leads set status = 'paid' where id in ('77777777-1111-0000-0000-000000000001','77777777-1111-0000-0000-000000000002');
update public.leads set mechanic_id = '88888888-0000-0000-0000-00000000a001' where id = '77777777-1111-0000-0000-000000000001';
update public.leads set mechanic_id = '88888888-0000-0000-0000-00000000b001' where id = '77777777-1111-0000-0000-000000000002';
create temp table mk (tok text, aid uuid, mech uuid); grant all on mk to public;

-- ───────────── who may manage mechanic app access ─────────────
set role anon;
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000a001','4821')$$, 'permission denied', 'anon cannot create access');
select pg_temp.fails($$select public.mechanic_login('x','1234')$$, 'permission denied', 'anon cannot call the login function');
select pg_temp.fails($$select count(*) from public.mechanic_access$$, 'permission denied', 'anon cannot read access rows');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000a001','4821')$$, 'not allowed', 'a stranger is refused');
select pg_temp.fails($$select count(*) from public.mechanic_access$$, 'permission denied', 'a signed-in user cannot read access rows directly');
select pg_temp.fails($$select public.mechanic_login('x','1234')$$, 'permission denied', 'a signed-in user cannot call the login function');
select pg_temp.fails($$select public.mechanic_open_job('88888888-0000-0000-0000-00000000a001','77777777-1111-0000-0000-000000000001')$$, 'permission denied', 'a signed-in user cannot mint job links');
select pg_temp.fails($$select public.garage_location_set('99999999-0000-0000-0000-00000000a001', 12.9, 77.6)$$, 'permission denied', 'a signed-in user cannot set a garage location');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000a001','4821')$$, 'permission', 'a sales agent is refused');
select pg_temp.fails($$select public.crm_mechanic_access_list()$$, 'permission', 'a sales agent cannot list access');
-- the Technician lead (manage_technicians) may; staff admin and the owner may
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
insert into mk select split_part(public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000a001','4821') ->> 'link', '=', 2), null, '88888888-0000-0000-0000-00000000a001';
select pg_temp.ok((select tok ~ '^[0-9a-f]{48}$' from mk limit 1), 'the private link has a 192-bit token');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000a001','5821')$$, 'already has app access', 'a second access for the same mechanic is refused');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000b001','111111')$$, 'not all the same', 'a one-digit PIN is refused');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000b001','12')$$, '4 to 6', 'a short PIN is refused');
select pg_temp.fails($$select public.crm_mechanic_access_create('88888888-0000-0000-0000-0000000000ff','4821')$$, 'not found', 'an unknown mechanic is refused');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into mk select split_part(public.crm_mechanic_access_create('88888888-0000-0000-0000-00000000b001','739204') ->> 'link', '=', 2), null, '88888888-0000-0000-0000-00000000b001';
reset role;
update mk set aid = (select id from public.mechanic_access a where a.mechanic_id = mk.mech);
select pg_temp.ok((select count(*) from public.mechanic_access) = 2, 'two accesses exist');
select pg_temp.ok(not exists (select 1 from public.mechanic_access where link_hash in (select tok from mk)), 'the token itself is not stored');
select pg_temp.ok(not exists (select 1 from public.mechanic_access where pin_hash in ('4821','739204') or pin_hash !~ '^\$2'), 'PINs are stored as bcrypt hashes');
select pg_temp.ok(not exists (select 1 from public.audit_log where details::text ~ '4821|739204'), 'no PIN in the audit log');
-- the list never holds a hash
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok(jsonb_array_length(public.crm_mechanic_access_list()) = 2, 'the owner lists both');
select pg_temp.ok(public.crm_mechanic_access_list()::text !~ 'hash|\$2', 'no hash in the list');
select pg_temp.ok(jsonb_array_length(public.crm_mechanic_access_list('88888888-0000-0000-0000-00000000a001')) = 1, 'filter by mechanic');
reset role;

-- ───────────── login (service role, like the Edge Function) ─────────────
create temp table ta as select tok from mk where mech = '88888888-0000-0000-0000-00000000a001'; create temp table tb as select tok from mk where mech = '88888888-0000-0000-0000-00000000b001'; grant all on ta, tb to public;
set role service_role;
select pg_temp.ok((public.mechanic_login('nope','4821') ->> 'error') = 'link', 'a malformed link is refused');
select pg_temp.ok((public.mechanic_login(repeat('0', 48),'4821') ->> 'error') = 'link', 'an unknown link is refused');
select pg_temp.ok((public.mechanic_login((select tok from ta),'1111') ->> 'left')::int = 4, 'a wrong PIN counts down');
select pg_temp.ok((public.mechanic_login((select tok from ta),'1111') ->> 'left')::int = 3, '3 tries left');
select pg_temp.ok((public.mechanic_login((select tok from ta),'12') ->> 'error') = 'pin', 'a short PIN counts as wrong');
select pg_temp.ok((public.mechanic_login((select tok from ta),'1111') ->> 'left')::int = 1, '1 try left');
select pg_temp.ok((public.mechanic_login((select tok from ta),'1111') ->> 'error') = 'locked', 'the 5th wrong PIN locks');
select pg_temp.ok((public.mechanic_login((select tok from ta),'4821') ->> 'error') = 'locked', 'the right PIN waits while locked');
select pg_temp.ok((public.mechanic_login((select tok from tb),'739204') ->> 'ok')::boolean, 'the other mechanic is not affected by the lock');
reset role;
update public.mechanic_access set locked_until = now() - interval '1 minute' where mechanic_id = '88888888-0000-0000-0000-00000000a001';
set role service_role;
create temp table sess (r jsonb); grant all on sess to public;
insert into sess select public.mechanic_login((select tok from ta),'4821');
select pg_temp.ok((select (r ->> 'ok')::boolean from sess), 'after 15 minutes the right PIN works');
select pg_temp.ok((select r::text !~ 'hash|\$2|4821' from sess), 'the login result holds no hash or PIN');
select pg_temp.ok((select (r ->> 'mechanic_name') = 'Test Mechanic One' and (r ->> 'area') = 'HSR Layout' from sess), 'name and area come back for the greeting');
select pg_temp.ok((public.mechanic_session_check((select (r ->> 'access_id')::uuid from sess), 1) ->> 'ok')::boolean, 'the session check passes');
select pg_temp.ok(not (public.mechanic_session_check((select (r ->> 'access_id')::uuid from sess), 2) ->> 'ok')::boolean, 'a wrong session version fails');
select pg_temp.ok(not (public.mechanic_session_check(gen_random_uuid(), 1) ->> 'ok')::boolean, 'an unknown access fails');
reset role;

-- ───────────── reset, new link, switch off, switch on ─────────────
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_mechanic_pin_reset((select aid from mk where mech = '88888888-0000-0000-0000-00000000a001'), '9035') ->> 'ok')::boolean, 'PIN reset');
select pg_temp.fails($$select public.crm_mechanic_pin_reset((select aid from mk limit 1), '2222')$$, 'not all the same', 'reset refuses a one-digit PIN');
reset role; set role service_role;
select pg_temp.ok(not (public.mechanic_session_check((select (r ->> 'access_id')::uuid from sess), 1) ->> 'ok')::boolean, 'the old session ends after a PIN reset');
select pg_temp.ok((public.mechanic_login((select tok from ta),'4821') ->> 'error') = 'pin', 'the old PIN no longer works');
select pg_temp.ok((public.mechanic_login((select tok from ta),'9035') ->> 'ok')::boolean, 'the new PIN works');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table newlink (tok text); grant all on newlink to public;
insert into newlink select split_part(public.crm_mechanic_link_new((select aid from mk where mech = '88888888-0000-0000-0000-00000000a001')) ->> 'link', '=', 2);
reset role; set role service_role;
select pg_temp.ok((public.mechanic_login((select tok from ta),'9035') ->> 'error') = 'link', 'the old link is dead after a new link');
select pg_temp.ok((public.mechanic_login((select tok from newlink),'9035') ->> 'ok')::boolean, 'the new link works');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(not (public.crm_mechanic_revoke((select aid from mk where mech = '88888888-0000-0000-0000-00000000a001')) ->> 'active')::boolean, 'switched off');
reset role; set role service_role;
select pg_temp.ok((public.mechanic_login((select tok from newlink),'9035') ->> 'error') = 'off', 'a switched-off access cannot log in');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_mechanic_enable((select aid from mk where mech = '88888888-0000-0000-0000-00000000a001')) ->> 'active')::boolean, 'switched back on');
reset role; set role service_role;
select pg_temp.ok((public.mechanic_login((select tok from newlink),'9035') ->> 'ok')::boolean, 'works again after enable');
reset role;
update public.mechanics set active = false where id = '88888888-0000-0000-0000-00000000a001';
set role service_role; select pg_temp.ok((public.mechanic_login((select tok from newlink),'9035') ->> 'error') = 'off', 'an inactive mechanic cannot log in'); reset role;
update public.mechanics set active = true where id = '88888888-0000-0000-0000-00000000a001';

-- ───────────── Available / Busy and the last known location ─────────────
set role service_role;
create temp table aid1 as select id from public.mechanic_access where mechanic_id = '88888888-0000-0000-0000-00000000a001'; grant all on aid1 to public;
select pg_temp.ok((public.mechanic_status_set((select id from aid1), 'busy') ->> 'availability') = 'busy', 'Busy');
select pg_temp.ok((select availability = 'busy' and last_lat is null from public.mechanics where id = '88888888-0000-0000-0000-00000000a001'), 'Busy stores no location');
select pg_temp.ok((public.mechanic_status_set((select id from aid1), 'available', 12.971599, 77.594563, 35) ->> 'located')::boolean, 'Available with a location');
select pg_temp.ok((select availability = 'available' and last_lat = 12.971599 and last_lng = 77.594563 and last_loc_acc = 35 and last_loc_at is not null from public.mechanics where id = '88888888-0000-0000-0000-00000000a001'), 'the last known location is stored');
select pg_temp.ok(not (public.mechanic_status_set((select id from aid1), 'available', 0, 0) ->> 'located')::boolean, 'a position outside India is not stored');
select pg_temp.ok((select last_lat = 12.971599 from public.mechanics where id = '88888888-0000-0000-0000-00000000a001'), 'the earlier position stays');
select pg_temp.ok(not (public.mechanic_status_set((select id from aid1), 'sleeping') ->> 'ok')::boolean, 'an unknown status is refused');
select pg_temp.ok(not (public.mechanic_status_set(gen_random_uuid(), 'busy') ->> 'ok')::boolean, 'an unknown access is refused');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_mechanic_access_list('88888888-0000-0000-0000-00000000a001') -> 0 ->> 'map_url') like 'https://www.google.com/maps?q=12.971599,77.594563', 'Crew and Admin see a map link');
select pg_temp.ok((public.crm_mechanic_access_list('88888888-0000-0000-0000-00000000a001') -> 0 ->> 'availability') = 'available', 'and the availability');
reset role;

-- ───────────── a fresh job link for the mechanic's own open job ─────────────
set role service_role;
create temp table jl (r jsonb); grant all on jl to public;
insert into jl select public.mechanic_open_job('88888888-0000-0000-0000-00000000a001','77777777-1111-0000-0000-000000000001');
select pg_temp.ok((select (r ->> 'ok')::boolean and (r ->> 'token') ~ '^[0-9a-f]{64}$' from jl), 'a 64-hex job token is minted');
select pg_temp.ok(exists (select 1 from public.tech_job_links k where k.lead_id = '77777777-1111-0000-0000-000000000001' and k.mechanic_id = '88888888-0000-0000-0000-00000000a001' and k.expires_at > now() + interval '6 days' and k.reported_at is null), 'a 7-day link row exists for this mechanic and job');
select pg_temp.ok(not exists (select 1 from public.tech_job_links k, jl where k.token_hash = (jl.r ->> 'token')), 'only the hash is stored');
select pg_temp.ok(not (public.mechanic_open_job('88888888-0000-0000-0000-00000000a001','77777777-1111-0000-0000-000000000002') ->> 'ok')::boolean, 'another mechanic''s job is refused');
select pg_temp.ok(not (public.mechanic_open_job('88888888-0000-0000-0000-00000000a001', gen_random_uuid()) ->> 'ok')::boolean, 'an unknown job is refused');
-- the link works on the existing /job/ function: the hash is found and valid
select pg_temp.ok((public.tech_my_jobs(encode(extensions.digest((select r ->> 'token' from jl), 'sha256'), 'hex')) ->> 'ok')::boolean, 'the existing /job/ code accepts the minted link');
-- no more than 5 open links: the oldest app-made ones are retired
do $$ begin for i in 1..7 loop perform public.mechanic_open_job('88888888-0000-0000-0000-00000000a001','77777777-1111-0000-0000-000000000001'); end loop; end $$;
select pg_temp.ok((select count(*) from public.tech_job_links where lead_id = '77777777-1111-0000-0000-000000000001' and reported_at is null and expires_at > now()) <= 5, 'at most 5 open links per job');
reset role;
-- a job whose link was reported cannot get another from the app
update public.tech_job_links set reported_at = now(), amount_collected = 100, company_share = 20 where id = (select id from public.tech_job_links where lead_id = '77777777-1111-0000-0000-000000000002' limit 1);
insert into public.tech_job_links (lead_id, mechanic_id, token_hash, expires_at, reported_at, amount_collected, company_share) values ('77777777-1111-0000-0000-000000000002','88888888-0000-0000-0000-00000000b001', repeat('b',64), now() + interval '7 days', now(), 100, 20);
set role service_role;
select pg_temp.ok((public.mechanic_open_job('88888888-0000-0000-0000-00000000b001','77777777-1111-0000-0000-000000000002') ->> 'error') = 'reported', 'a reported job says so');
reset role;

-- ───────────── garage additions: shop location and Open/Closed ─────────────
select pg_temp.ok((select is_open from public.garages where id = '99999999-0000-0000-0000-00000000a001'), 'garages start open');
set role service_role;
create temp table gaid as select id from public.garage_access where garage_id = '99999999-0000-0000-0000-00000000a001' limit 1; grant all on gaid to public;
select pg_temp.ok((public.garage_location_set((select id from gaid), 12.934533, 77.612345, 20) ->> 'ok')::boolean, 'the shop location is saved');
select pg_temp.ok(not (public.garage_location_set((select id from gaid), 91, 77) ->> 'ok')::boolean, 'an impossible position is refused');
select pg_temp.ok(not (public.garage_location_set(gen_random_uuid(), 12.9, 77.6) ->> 'ok')::boolean, 'an unknown access is refused');
select pg_temp.ok(not (public.garage_open_set((select id from gaid), false) ->> 'open')::boolean, 'Closed');
reset role;
select pg_temp.ok((select shop_lat = 12.934533 and shop_lng = 77.612345 and shop_loc_acc = 20 and shop_loc_at is not null and not is_open and lat is null from public.garages where id = '99999999-0000-0000-0000-00000000a001'), 'saved on the garage, apart from the desk''s own lat and lng');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select x ->> 'map_url' from jsonb_array_elements(public.crm_garage_access_list('99999999-0000-0000-0000-00000000a001')) x limit 1) = 'https://www.google.com/maps?q=12.934533,77.612345', 'Crew and Admin see the shop on a map');
select pg_temp.ok(jsonb_array_length(public.crm_garage_access_list()) = 2, 'the garage list still returns every access');
select pg_temp.ok(public.crm_garage_access_list()::text !~ 'hash|\$2', 'and still no hash');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_garage_access_list()$$, 'permission', 'a sales agent still cannot list garage access');
reset role;
select 'ALL MECHANIC APP SQL CHECKS PASSED' as result;
