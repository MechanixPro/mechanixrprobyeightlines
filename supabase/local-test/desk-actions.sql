-- Desk action audit checks (20270101000000_desk_actions_technician_lead_restore.sql). Runs after paid-confirmation.sql in the same LOCAL scratch database; it reuses its users.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');   -- the Technician lead (manage_technicians, not assign_leads)
select pg_temp.ok(public.crm_can('manage_technicians') and not public.crm_can('assign_leads'), 'the Technician lead has manage_technicians and not assign_leads');
select pg_temp.ok((public.crm_tech_board(null) -> 'techs') is not null, 'the Technician lead can read the technician board');
select pg_temp.ok(jsonb_typeof(public.crm_unstaffed_jobs()) = 'array', 'the Technician lead can read the unstaffed jobs');
select pg_temp.ok(jsonb_array_length(public.crm_unstaffed_jobs()) >= 0, 'unstaffed jobs list works');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');   -- a Care Buddy with neither permission
select pg_temp.fails($$select public.crm_tech_board(null)$$, 'permission', 'a Care Buddy still cannot read the board');
select pg_temp.ok(public.crm_unstaffed_jobs() = '[]'::jsonb, 'a Care Buddy gets an empty unstaffed list');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');   -- the owner
select pg_temp.ok((public.crm_tech_board(null) -> 'techs') is not null, 'the owner can read the board');
reset role;
select 'ALL DESK ACTION SQL CHECKS PASSED' as result;
