-- Care Buddy desk, part 12: automation. Run log, alert de-duplication, customer ratings, and the switches supervisors control.

create table if not exists public.crm_automation_log (
  id bigserial primary key, job text not null, ran_at timestamptz not null default now(), ok boolean not null default true, summary jsonb not null default '{}'::jsonb
);
create index if not exists crm_automation_log_job_idx on public.crm_automation_log (job, ran_at desc);
create table if not exists public.crm_alerts_sent (
  lead_id uuid not null references public.leads(id) on delete cascade, kind text not null, sent_at timestamptz not null default now(), primary key (lead_id, kind)
);
create table if not exists public.lead_ratings (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.leads add column if not exists rating_requested_at timestamptz;
alter table public.crm_automation_log enable row level security; alter table public.crm_alerts_sent enable row level security; alter table public.lead_ratings enable row level security;
drop policy if exists crm_automation_log_owner on public.crm_automation_log; create policy crm_automation_log_owner on public.crm_automation_log for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists crm_alerts_sent_owner on public.crm_alerts_sent; create policy crm_alerts_sent_owner on public.crm_alerts_sent for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists lead_ratings_owner on public.lead_ratings; create policy lead_ratings_owner on public.lead_ratings for all to authenticated using (public.is_owner()) with check (public.is_owner());

insert into public.settings (key, value) values ('desk_auto_rating', 'true'), ('desk_sla_alerts', 'true'), ('desk_daily_report', 'true'), ('desk_campaigns_ready', 'false') on conflict (key) do nothing;

-- The switches and the last run of each job, for the Team screen (supervisors only)
create or replace function public.crm_automation_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  return jsonb_build_object(
    'switches', jsonb_build_object('rating', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_auto_rating'), true), 'sla', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_sla_alerts'), true),
      'report', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_daily_report'), true), 'campaigns_ready', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_campaigns_ready'), false)),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.job, 'ran_at', j.ran_at, 'ok', j.ok, 'summary', j.summary) order by j.job) from (select distinct on (job) job, ran_at, ok, summary from public.crm_automation_log order by job, ran_at desc) j), '[]'::jsonb),
    'ratings_30d', (select jsonb_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2)) from public.lead_ratings where created_at > now() - interval '30 days'),
    'cron', coalesce((select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)) from cron.job where jobname like 'desk-%'), '[]'::jsonb));
end; $$;

create or replace function public.crm_automation_set(p_switch text, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
declare k text := case p_switch when 'rating' then 'desk_auto_rating' when 'sla' then 'desk_sla_alerts' when 'report' then 'desk_daily_report' end;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  if k is null then raise exception 'unknown switch' using errcode = 'P0001'; end if;
  insert into public.settings (key, value) values (k, to_jsonb(coalesce(p_on, false))) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'desk_automation_switch', jsonb_build_object('switch', p_switch, 'on', p_on));
end; $$;

-- A lead's rating, for the lead sheet; and the averages for the dashboard
create or replace function public.crm_lead_rating(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.crm_need_role();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, public.crm_need_role()) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_build_object('rating', r.rating, 'comment', r.comment, 'at', r.created_at) from public.lead_ratings r where r.lead_id = p_lead), jsonb_build_object('rating', null, 'requested_at', l.rating_requested_at));
end; $$;

create or replace function public.crm_rating_summary(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('dashboard');
  return (select jsonb_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2), 'low', count(*) filter (where rating <= 3),
    'dist', jsonb_build_object('1', count(*) filter (where rating = 1), '2', count(*) filter (where rating = 2), '3', count(*) filter (where rating = 3), '4', count(*) filter (where rating = 4), '5', count(*) filter (where rating = 5)))
    from public.lead_ratings where created_at >= coalesce((p_from::timestamp at time zone 'Asia/Kolkata'), now() - interval '30 days') and created_at < coalesce(((p_to + 1)::timestamp at time zone 'Asia/Kolkata'), now() + interval '1 day'));
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_automation_status()','crm_automation_set(text,boolean)','crm_lead_rating(uuid)','crm_rating_summary(date,date)']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
