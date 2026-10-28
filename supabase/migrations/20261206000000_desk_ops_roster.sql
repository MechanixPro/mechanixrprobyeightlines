-- Desk: garage operating state and daily intake, mechanic performance, and the Care Buddy duty roster.

-- Garages: an operating state next to the onboarding stage, and how many jobs a garage takes in a day.
alter table public.garages add column if not exists ops_state text not null default 'active' check (ops_state in ('active','inactive','suspended','maintenance'));
alter table public.garages add column if not exists daily_capacity integer check (daily_capacity between 1 and 200);
alter table public.garages add column if not exists ops_note text check (char_length(ops_note) <= 200);

create or replace function public.crm_garage_ops_set(p_id uuid, p_state text, p_capacity integer, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages');
  if p_state not in ('active','inactive','suspended','maintenance') then raise exception 'unknown state' using errcode = 'P0001'; end if;
  if p_capacity is not null and p_capacity not between 1 and 200 then raise exception 'daily capacity must be between 1 and 200' using errcode = 'P0001'; end if;
  if p_state in ('suspended','maintenance') and coalesce(trim(p_note), '') = '' then raise exception 'say why in the note' using errcode = 'P0001'; end if;
  update public.garages set ops_state = p_state, daily_capacity = p_capacity, ops_note = nullif(left(trim(coalesce(p_note, '')), 200), ''), updated_at = now() where id = p_id and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_ops_set', jsonb_build_object('garage', p_id, 'state', p_state, 'capacity', p_capacity));
end; $$;

-- Today's load per garage: jobs booked for today (India date) for the garage's mechanics, against the daily intake. A garage is open to dispatch when it is live or in pilot, active, not on leave or paused, and below its limit.
create or replace function public.crm_garage_load() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d0 date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.crm_need_role(); perform public.crm_need_page('garages');
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'ops_state', g.ops_state, 'ops_note', g.ops_note, 'capacity', g.daily_capacity, 'today', x.n,
      'full', g.daily_capacity is not null and x.n >= g.daily_capacity,
      'dispatchable', g.status in ('live','pilot') and g.ops_state = 'active' and (g.on_leave_until is null or g.on_leave_until < current_date) and (g.paused_until is null or g.paused_until < current_date) and not (g.daily_capacity is not null and x.n >= g.daily_capacity)))
    from public.garages g cross join lateral (
      select count(*) n from public.leads l join public.mechanics m on m.id = l.mechanic_id where m.garage_id = g.id and l.deleted_at is null and l.preferred_date = d0 and l.status in ('paid','scheduled','completed')) x
    where g.deleted_at is null), '[]'::jsonb);
end; $$;

-- Mechanic performance over a date range: jobs given, jobs completed, average hours from payment to completion, and the customers' average rating. Acceptance rate is not recorded anywhere yet.
create or replace function public.crm_mechanic_performance(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f timestamptz := coalesce((p_from::timestamp at time zone 'Asia/Kolkata'), date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  t timestamptz := coalesce(((p_to + 1)::timestamp at time zone 'Asia/Kolkata'), now() + interval '1 day');
begin
  perform public.crm_need_role(); perform public.crm_need_page('mechanics');
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'assigned', x.assigned, 'completed', x.completed,
      'completion_pct', case when x.assigned > 0 then round(x.completed * 100.0 / x.assigned) else null end,
      'avg_hours', x.avg_hours, 'rating', x.rating, 'rated', x.rated, 'rework', m.rework_count))
    from public.mechanics m cross join lateral (
      select count(*) assigned, count(*) filter (where l.status = 'completed') completed,
        round((avg(extract(epoch from (l.completed_at - l.paid_at)) / 3600) filter (where l.status = 'completed' and l.completed_at is not null and l.paid_at is not null and l.completed_at > l.paid_at))::numeric, 1) avg_hours,
        round(avg(r.rating)::numeric, 1) rating, count(r.rating) rated
      from public.leads l left join public.lead_ratings r on r.lead_id = l.id
      where l.mechanic_id = m.id and l.deleted_at is null and l.created_at >= f and l.created_at < t and l.status <> 'lost') x), '[]'::jsonb);
end; $$;

-- Duty roster for Care Buddies. No row for a day means the person is working.
create table if not exists public.crm_roster (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  status text not null check (status in ('working','off','leave')),
  note text check (char_length(note) <= 100),
  primary key (user_id, day)
);
alter table public.crm_roster enable row level security;

create or replace function public.crm_roster_get(p_from date default null, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, (now() at time zone 'Asia/Kolkata')::date); n int := least(greatest(coalesce(p_days, 7), 1), 31);
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  return jsonb_build_object('from', f, 'days', n,
    'users', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', u.name) order by u.name) from public.crm_users u where u.active), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'day', r.day, 'status', r.status)) from public.crm_roster r where r.day >= f and r.day < f + n), '[]'::jsonb));
end; $$;

create or replace function public.crm_roster_set(p_user uuid, p_day date, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  if p_status not in ('working','off','leave') then raise exception 'unknown status' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.crm_users where user_id = p_user) then raise exception 'person not found' using errcode = 'P0002'; end if;
  if p_status = 'working' then delete from public.crm_roster where user_id = p_user and day = p_day;
  else insert into public.crm_roster (user_id, day, status) values (p_user, p_day, p_status) on conflict (user_id, day) do update set status = excluded.status; end if;
end; $$;

-- Who is on duty today (anyone signed in to the desk may see it).
create or replace function public.crm_on_duty() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d0 date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.crm_need_role();
  return jsonb_build_object('on', coalesce((select jsonb_agg(u.name order by u.name) from public.crm_users u where u.active and not exists (select 1 from public.crm_roster r where r.user_id = u.user_id and r.day = d0)), '[]'::jsonb),
    'off', coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'status', r.status) order by u.name) from public.crm_users u join public.crm_roster r on r.user_id = u.user_id and r.day = d0 where u.active), '[]'::jsonb));
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_garage_ops_set(uuid,text,integer,text)','crm_garage_load()','crm_mechanic_performance(date,date)','crm_roster_get(date,integer)','crm_roster_set(uuid,date,text)','crm_on_duty()']) loop
    execute 'revoke all on function public.' || f || ' from public, anon'; execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
