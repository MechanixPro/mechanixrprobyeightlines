-- S1b Sales targets. Per Crew member, a daily and a weekly target for calls, quotes sent and paid bookings, plus live progress.
-- Counts only, never money. Actuals come from tables that already exist: crm_activities (kind 'call' by actor), job_quotes (sent_at, by the person who made the quote,
-- else the lead owner) and leads (confirm_paid_at, else crm_won_at, for paid/scheduled/completed leads, by crm_owner). Days and weeks are India time; the week starts Monday.
create table if not exists public.sales_targets (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  period         text not null check (period in ('day','week')),
  calls          integer not null default 0 check (calls between 0 and 1000),
  quotes_sent    integer not null default 0 check (quotes_sent between 0 and 1000),
  paid_bookings  integer not null default 0 check (paid_bookings between 0 and 1000),
  effective_from date not null default ((now() at time zone 'Asia/Kolkata')::date),
  set_by         uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (user_id, period, effective_from)
);
create index if not exists sales_targets_user_idx on public.sales_targets (user_id, period, effective_from desc);
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_owner on public.sales_targets;
create policy sales_targets_owner on public.sales_targets for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Admin (owner) only. Sets today's targets for one person; running it again the same day replaces that day's row, an older row stays as history.
create or replace function public.crm_targets_set(p_user uuid, p_period text, p_calls integer, p_quotes integer, p_paid integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'only the admin can set targets' using errcode = '42501'; end if;
  if p_period not in ('day','week') then raise exception 'period must be day or week' using errcode = 'P0001'; end if;
  if p_calls is null or p_quotes is null or p_paid is null or least(p_calls, p_quotes, p_paid) < 0 or greatest(p_calls, p_quotes, p_paid) > 1000 then
    raise exception 'targets must be whole numbers from 0 to 1000' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.crm_users where user_id = p_user) then raise exception 'team member not found' using errcode = 'P0002'; end if;
  insert into public.sales_targets (user_id, period, calls, quotes_sent, paid_bookings, effective_from, set_by)
  values (p_user, p_period, p_calls, p_quotes, p_paid, (now() at time zone 'Asia/Kolkata')::date, auth.uid())
  on conflict (user_id, period, effective_from) do update set calls = excluded.calls, quotes_sent = excluded.quotes_sent, paid_bookings = excluded.paid_bookings, set_by = excluded.set_by, created_at = now();
end; $$;
revoke all on function public.crm_targets_set(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.crm_targets_set(uuid, text, integer, integer, integer) to authenticated;

-- Progress for today and this week. A person without view_all_leads gets only their own row. No money in the result.
create or replace function public.crm_targets_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.crm_need_role();
  all_rows boolean := public.is_owner() or public.crm_can('view_all_leads');
  nowi timestamp := now() at time zone 'Asia/Kolkata';
  d0 timestamptz := (date_trunc('day', nowi)) at time zone 'Asia/Kolkata';
  w0 timestamptz := (date_trunc('week', nowi)) at time zone 'Asia/Kolkata';
begin
  return jsonb_build_object('now_ist', to_char(nowi, 'YYYY-MM-DD"T"HH24:MI:SS'), 'can_see_all', all_rows, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', u.name, 'role', u.role,
      'day', jsonb_build_object('target', t.d, 'actual', jsonb_build_object(
        'calls', (select count(*) from public.crm_activities a where a.actor = u.user_id and a.kind = 'call' and a.created_at >= d0),
        'quotes_sent', (select count(*) from public.job_quotes q join public.leads l on l.id = q.lead_id where q.sent_at >= d0 and l.deleted_at is null and coalesce(q.created_by, l.crm_owner) = u.user_id),
        'paid_bookings', (select count(*) from public.leads l where l.deleted_at is null and l.status in ('paid','scheduled','completed') and l.crm_owner = u.user_id and coalesce(l.confirm_paid_at, l.crm_won_at) >= d0))),
      'week', jsonb_build_object('target', t.w, 'actual', jsonb_build_object(
        'calls', (select count(*) from public.crm_activities a where a.actor = u.user_id and a.kind = 'call' and a.created_at >= w0),
        'quotes_sent', (select count(*) from public.job_quotes q join public.leads l on l.id = q.lead_id where q.sent_at >= w0 and l.deleted_at is null and coalesce(q.created_by, l.crm_owner) = u.user_id),
        'paid_bookings', (select count(*) from public.leads l where l.deleted_at is null and l.status in ('paid','scheduled','completed') and l.crm_owner = u.user_id and coalesce(l.confirm_paid_at, l.crm_won_at) >= w0)))
    ) order by u.name)
    from public.crm_users u
    cross join lateral (select
      (select jsonb_build_object('calls', s.calls, 'quotes_sent', s.quotes_sent, 'paid_bookings', s.paid_bookings) from public.sales_targets s where s.user_id = u.user_id and s.period = 'day' and s.effective_from <= nowi::date order by s.effective_from desc limit 1) as d,
      (select jsonb_build_object('calls', s.calls, 'quotes_sent', s.quotes_sent, 'paid_bookings', s.paid_bookings) from public.sales_targets s where s.user_id = u.user_id and s.period = 'week' and s.effective_from <= nowi::date order by s.effective_from desc limit 1) as w) t
    where u.active and (all_rows or u.user_id = auth.uid())), '[]'::jsonb));
end; $$;
revoke all on function public.crm_targets_progress() from public, anon;
grant execute on function public.crm_targets_progress() to authenticated;
