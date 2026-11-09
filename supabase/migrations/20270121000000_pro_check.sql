-- Pro Check 20: a 20-point check and a test ride, saved per job. Additive and idempotent.
-- Rollback: drop function public.job_check_save(uuid, text, uuid, jsonb), public.job_check_get(uuid), public.crm_job_check(uuid); drop table public.job_checks;
create table if not exists public.job_checks (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  by_kind text not null check (by_kind in ('mechanic', 'garage')),
  by_id uuid,
  results jsonb not null default '{}'::jsonb,
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.job_checks enable row level security;

-- The 20 point keys and the test ride rules live here too, so the database refuses anything the apps should not send.
create or replace function public.job_check_keys() returns text[] language sql immutable as $$
  select array['brake_front','brake_rear','brake_cable_fluid','tyre_front','tyre_rear','tyre_pressure','engine_oil','engine_idle','air_filter','spark_plug','battery','lights','horn','chain','clutch','throttle','suspension_fork','stands','nuts_bolts','leak_noise'];
$$;

create or replace function public.job_check_valid(p jsonb) returns boolean language plpgsql immutable as $$
declare k text; v jsonb; t jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if p ? 'points' then
    if jsonb_typeof(p -> 'points') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(p -> 'points') loop
      if not (k = any (public.job_check_keys())) then return false; end if;
      if jsonb_typeof(v) <> 'object' or (v ->> 'r') not in ('ok', 'needs_attention', 'not_applicable') then return false; end if;
      if char_length(coalesce(v ->> 'n', '')) > 140 then return false; end if;
    end loop;
  end if;
  if p ? 'test_ride' and jsonb_typeof(p -> 'test_ride') <> 'null' then
    t := p -> 'test_ride';
    if jsonb_typeof(t) <> 'object' or (t ->> 'r') not in ('done_fine', 'done_note', 'not_done') then return false; end if;
    if (t ->> 'r') = 'not_done' and coalesce(t ->> 'why', '') not in ('no_safe_road', 'customer_declined', 'not_rideable') then return false; end if;
    if char_length(coalesce(t ->> 'n', '')) > 140 then return false; end if;
  end if;
  return true;
end $$;

create or replace function public.job_check_complete(p jsonb) returns boolean language plpgsql immutable as $$
declare k text;
begin
  if not public.job_check_valid(p) then return false; end if;
  foreach k in array public.job_check_keys() loop
    if not ((p -> 'points') ? k) then return false; end if;
  end loop;
  return (p -> 'test_ride') is not null and jsonb_typeof(p -> 'test_ride') = 'object';
end $$;

-- Service role only (the Edge Functions check who the technician is first).
create or replace function public.job_check_save(p_lead uuid, p_kind text, p_by uuid, p_results jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare done boolean;
begin
  if p_kind not in ('mechanic', 'garage') then raise exception 'unknown kind' using errcode = 'P0001'; end if;
  if not public.job_check_valid(p_results) then raise exception 'the check has a value that is not allowed' using errcode = 'P0001'; end if;
  done := public.job_check_complete(p_results);
  insert into public.job_checks (lead_id, by_kind, by_id, results, complete, updated_at, completed_at)
  values (p_lead, p_kind, p_by, p_results, done, now(), case when done then now() end)
  on conflict (lead_id) do update set by_kind = excluded.by_kind, by_id = excluded.by_id, results = excluded.results, complete = excluded.complete, updated_at = now(),
    completed_at = case when excluded.complete then coalesce(public.job_checks.completed_at, now()) else null end;
  return jsonb_build_object('ok', true, 'complete', done);
end $$;

create or replace function public.job_check_get(p_lead uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('results', results, 'complete', complete, 'completed_at', completed_at) from public.job_checks where lead_id = p_lead), jsonb_build_object('results', '{}'::jsonb, 'complete', false));
$$;

-- Crew and Admin: same permission scope as opening the lead (crm_lead raises for anyone who may not see it).
create or replace function public.crm_job_check(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  perform public.crm_lead(p_lead);
  return public.job_check_get(p_lead);
end $$;

revoke all on function public.job_check_keys(), public.job_check_valid(jsonb), public.job_check_complete(jsonb) from public, anon;
revoke all on function public.job_check_save(uuid, text, uuid, jsonb), public.job_check_get(uuid) from public, anon, authenticated;
grant execute on function public.job_check_save(uuid, text, uuid, jsonb), public.job_check_get(uuid) to service_role;
revoke all on function public.crm_job_check(uuid) from public, anon;
grant execute on function public.crm_job_check(uuid) to authenticated;
