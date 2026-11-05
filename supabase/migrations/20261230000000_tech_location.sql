-- Customer journey, part 2: the mechanic shares his live location while a job is On the way or Arrived, and "My jobs" on the job link.
-- Design: docs/superpowers/specs/2026-11-06-customer-journey-and-mechanic-link-design.md
-- Idempotent and safe to dry-run. Nothing here changes an existing lead.
-- Roll back (as the database owner):
--   drop trigger if exists leads_e_tech_loc_purge_tr on public.leads;
--   drop function if exists public.leads_tech_loc_purge(), public.tech_location_put(text, numeric, numeric, int, int), public.tech_locations_purge(), public.booking_tech_location(text), public.crm_tech_location(uuid),
--     public.crm_tech_seen(uuid[]), public.tech_my_jobs(text), public.tech_open_job(text, uuid);
--   drop table if exists public.tech_locations;

-- ───────────────────────── Location points (closed to everyone; only the functions below touch it) ─────────────────────────
-- Only the last 20 points per job are kept; the newest is "where he is now". Rows go away when the job leaves On the way / Arrived (code verified), completes, is closed or reassigned, and after 24 hours at the latest.
create table if not exists public.tech_locations (
  id          bigserial primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  mechanic_id uuid not null references public.mechanics(id) on delete cascade,
  lat         numeric(9,6) not null check (lat between 6 and 38),
  lng         numeric(9,6) not null check (lng between 68 and 98),
  accuracy_m  integer check (accuracy_m between 0 and 100000),
  heading     integer check (heading between 0 and 359),
  recorded_at timestamptz not null default now()
);
create index if not exists tech_locations_lead_idx on public.tech_locations (lead_id, id desc);
alter table public.tech_locations enable row level security;
revoke all on public.tech_locations from public, anon, authenticated;

-- The only writer. Service role only (the tech-job function). It takes the SHA-256 hash of the job token, so it checks the link itself: valid and not expired, the job is still assigned to the link's mechanic,
-- and the visit stage is on_the_way or arrived. A point less than 10 seconds after the last one is ignored.
create or replace function public.tech_location_put(p_token_hash text, p_lat numeric, p_lng numeric, p_acc int default null, p_heading int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.tech_job_links; l public.leads; last_at timestamptz;
begin
  select * into k from public.tech_job_links where token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if (k.reported_at is null and k.expires_at <= now()) or (k.reported_at is not null and k.reported_at + interval '30 days' <= now()) then return jsonb_build_object('ok', false, 'error', 'This link has expired.'); end if;
  select * into l from public.leads where id = k.lead_id and deleted_at is null;
  if not found or l.mechanic_id is distinct from k.mechanic_id or l.status in ('lost','junk','completed') then return jsonb_build_object('ok', false, 'error', 'This job is not assigned to you any more.'); end if;
  if coalesce(l.visit_stage, '') not in ('on_the_way','arrived') then return jsonb_build_object('ok', false, 'stopped', true, 'error', 'Location sharing is only for On the way and Arrived.'); end if;
  if p_lat is null or p_lng is null or p_lat not between 6 and 38 or p_lng not between 68 and 98 then return jsonb_build_object('ok', false, 'error', 'That location does not look right.'); end if;
  select max(recorded_at) into last_at from public.tech_locations where lead_id = l.id;
  if last_at is not null and last_at > now() - interval '10 seconds' then return jsonb_build_object('ok', true, 'throttled', true); end if;
  insert into public.tech_locations (lead_id, mechanic_id, lat, lng, accuracy_m, heading)
    values (l.id, k.mechanic_id, round(p_lat, 6), round(p_lng, 6), case when p_acc between 0 and 100000 then p_acc end, case when p_heading between 0 and 359 then p_heading end);
  delete from public.tech_locations where lead_id = l.id and id not in (select id from public.tech_locations where lead_id = l.id order by id desc limit 20);
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.tech_location_put(text, numeric, numeric, int, int) from public, anon, authenticated;
grant execute on function public.tech_location_put(text, numeric, numeric, int, int) to service_role;

-- Purge when the job moves on: any change of stage, status, mechanic or deletion that leaves On the way / Arrived removes the points.
create or replace function public.leads_tech_loc_purge() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null or new.status in ('completed','lost','junk') or coalesce(new.visit_stage, '') not in ('on_the_way','arrived') or new.mechanic_id is distinct from old.mechanic_id then
    delete from public.tech_locations where lead_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists leads_e_tech_loc_purge_tr on public.leads;
create trigger leads_e_tech_loc_purge_tr after update of visit_stage, status, mechanic_id, deleted_at on public.leads for each row execute function public.leads_tech_loc_purge();

-- Nightly cleanup, called by desk-automation: nothing older than 24 hours stays.
create or replace function public.tech_locations_purge() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.tech_locations where recorded_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.tech_locations_purge() from public, anon, authenticated;
grant execute on function public.tech_locations_purge() to service_role;

-- ───────────────────────── Customer: only the newest point, only while On the way or Arrived, only if under 10 minutes old, never a trail ─────────────────────────
create or replace function public.booking_tech_location(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); t public.tech_locations;
begin
  if l.id is null or coalesce(l.visit_stage, '') not in ('on_the_way','arrived') or l.status in ('completed','lost','junk') then return jsonb_build_object('live', false); end if;
  select * into t from public.tech_locations where lead_id = l.id order by id desc limit 1;
  if not found or t.recorded_at <= now() - interval '10 minutes' then return jsonb_build_object('live', false); end if;
  return jsonb_build_object('live', true, 'lat', t.lat, 'lng', t.lng, 'accuracy_m', t.accuracy_m, 'age_s', greatest(0, extract(epoch from (now() - t.recorded_at))::int), 'recorded_at', t.recorded_at);
end; $$;
revoke all on function public.booking_tech_location(text) from public, anon, authenticated;
grant execute on function public.booking_tech_location(text) to service_role;

-- ───────────────────────── Crew and Admin: last seen ─────────────────────────
create or replace function public.crm_tech_location(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; t public.tech_locations;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into t from public.tech_locations where lead_id = p_lead order by id desc limit 1;
  if not found then return jsonb_build_object('seen', false, 'stage', l.visit_stage); end if;
  return jsonb_build_object('seen', true, 'stage', l.visit_stage, 'lat', t.lat, 'lng', t.lng, 'accuracy_m', t.accuracy_m, 'age_s', greatest(0, extract(epoch from (now() - t.recorded_at))::int), 'at', t.recorded_at,
    'mechanic', (select split_part(m.name, ' ', 1) from public.mechanics m where m.id = t.mechanic_id));
end; $$;
revoke all on function public.crm_tech_location(uuid) from public, anon;
grant execute on function public.crm_tech_location(uuid) to authenticated;

-- For the Dispatch list: the newest point of each visible lead that has one, in one call.
create or replace function public.crm_tech_seen(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need();
begin
  return coalesce((select jsonb_object_agg(x.id::text, jsonb_build_object('lat', x.lat, 'lng', x.lng, 'age_s', x.age)) from (
    select distinct on (t.lead_id) l.id, t.lat, t.lng, greatest(0, extract(epoch from (now() - t.recorded_at))::int) as age
    from public.tech_locations t join public.leads l on l.id = t.lead_id
    where t.lead_id = any (coalesce(p_ids, '{}'::uuid[])) and l.deleted_at is null and public.crm_can_see(l, r)
    order by t.lead_id, t.id desc) x), '{}'::jsonb);
end; $$;
revoke all on function public.crm_tech_seen(uuid[]) from public, anon;
grant execute on function public.crm_tech_seen(uuid[]) to authenticated;

-- ───────────────────────── Mechanic: My jobs ─────────────────────────
-- /job/ has no separate login: the job link IS the mechanic's key. These two take the link's token hash. The list shows only this mechanic's own paid or scheduled jobs (area, slot, vehicle, stage; no phone, no street address).
-- Opening another job mints a normal job link for it (7 days), only if it is assigned to the same mechanic; the other links stay valid. At most 5 open links per job.
create or replace function public.tech_link_ok(k public.tech_job_links) returns boolean language sql immutable as $$
  select (k.reported_at is null and k.expires_at > now()) or (k.reported_at is not null and k.reported_at + interval '30 days' > now());
$$;
revoke all on function public.tech_link_ok(public.tech_job_links) from public, anon, authenticated;

create or replace function public.tech_my_jobs(p_token_hash text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k public.tech_job_links; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into k from public.tech_job_links where token_hash = p_token_hash;
  if not found or not public.tech_link_ok(k) then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  return jsonb_build_object('ok', true, 'today', today, 'jobs', coalesce((select jsonb_agg(row order by (row ->> 'is_today') desc, row ->> 'preferred_date', (row ->> 'slot_rank')::int) from (
    select jsonb_build_object('id', l.id, 'booking_id', l.booking_id, 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'preferred_date', l.preferred_date, 'preferred_slot', l.preferred_slot,
      'slot_rank', case l.preferred_slot when 'asap' then 0 when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 4 end, 'is_today', (l.preferred_date = today)::text,
      'vehicle', l.vehicle, 'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'service_name', s.name, 'stage', l.visit_stage, 'current', (l.id = k.lead_id)) as row
    from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
    where l.mechanic_id = k.mechanic_id and l.deleted_at is null and l.status in ('paid','scheduled') and (l.preferred_date is null or l.preferred_date >= today - 1)
    limit 20) q), '[]'::jsonb));
end; $$;
revoke all on function public.tech_my_jobs(text) from public, anon, authenticated;
grant execute on function public.tech_my_jobs(text) to service_role;

create or replace function public.tech_open_job(p_token_hash text, p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.tech_job_links; l public.leads; tok text;
begin
  select * into k from public.tech_job_links where token_hash = p_token_hash;
  if not found or not public.tech_link_ok(k) then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found or l.mechanic_id is distinct from k.mechanic_id or l.status not in ('paid','scheduled') then return jsonb_build_object('ok', false, 'error', 'That job is not assigned to you.'); end if;
  if l.id = k.lead_id then return jsonb_build_object('ok', true, 'same', true); end if;
  if (select count(*) from public.tech_job_links where lead_id = l.id and reported_at is null and expires_at > now()) >= 5 then return jsonb_build_object('ok', false, 'error', 'Too many open links for this job. Ask the desk.'); end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tech_job_links (lead_id, mechanic_id, token_hash, created_by, expires_at) values (l.id, k.mechanic_id, encode(extensions.digest(tok, 'sha256'), 'hex'), null, now() + interval '7 days');
  insert into public.audit_log (action, details) values ('tech_link_created', jsonb_build_object('lead', l.ref, 'via', 'my_jobs'));
  return jsonb_build_object('ok', true, 'token', tok);
end; $$;
revoke all on function public.tech_open_job(text, uuid) from public, anon, authenticated;
grant execute on function public.tech_open_job(text, uuid) to service_role;
