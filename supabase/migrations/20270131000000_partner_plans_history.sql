-- Partner plans (Bronze, Silver, Gold), mechanic KYC skip, and full partner history for Admin. Additive and idempotent.
-- The plan table records what the owner wrote: Bronze no deposit 35% commission; Silver 10,000 deposit for 3 months 30% commission, 50 to 80 orders a month;
-- Gold 20,000 deposit for 3 months 25% commission, 60 to 100 orders a month. "Commission" here is the Mechanix Pro share of a job.
-- It is RECORDED and SHOWN to the owner and admins only. It does not change any payout calculation (the existing per-job and per-mechanic rates stay as they are)
-- and nothing here takes a deposit: the deposit status is a manual record. No Crew or partner screen reads these functions.
-- Not the same as garages.tier, which is the quality grade worked out from the checklist score.
-- Rollback: drop function public.partner_plans_list(), public.partner_profile(text, uuid), public.partner_plan_set(text, uuid, text), public.partner_deposit_set(text, uuid, text),
--   public.partner_history(text, uuid), public.partner_all_list(), public.mechanic_kyc_state(uuid), public.mechanic_kyc_skip(uuid);
--   alter table public.garages drop column plan, drop column deposit_status, drop column deposit_received_at;
--   alter table public.mechanics drop column plan, drop column deposit_status, drop column deposit_received_at, drop column kyc_skipped_at; drop table public.partner_plans.

create table if not exists public.partner_plans (
  plan text primary key check (plan in ('bronze', 'silver', 'gold')),
  label text not null,
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  deposit_months integer not null default 0 check (deposit_months between 0 and 24),
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  orders_min integer check (orders_min >= 0),
  orders_max integer check (orders_max >= 0),
  sort integer not null default 0
);
alter table public.partner_plans enable row level security;
insert into public.partner_plans (plan, label, deposit_amount, deposit_months, commission_pct, orders_min, orders_max, sort) values
  ('bronze', 'Bronze', 0, 0, 35, null, null, 1),
  ('silver', 'Silver', 10000, 3, 30, 50, 80, 2),
  ('gold', 'Gold', 20000, 3, 25, 60, 100, 3)
on conflict (plan) do nothing;

alter table public.garages add column if not exists plan text not null default 'bronze' check (plan in ('bronze', 'silver', 'gold'));
alter table public.garages add column if not exists deposit_status text not null default 'not_required' check (deposit_status in ('not_required', 'pending', 'held', 'refunded'));
alter table public.garages add column if not exists deposit_received_at date;
alter table public.mechanics add column if not exists plan text not null default 'bronze' check (plan in ('bronze', 'silver', 'gold'));
alter table public.mechanics add column if not exists deposit_status text not null default 'not_required' check (deposit_status in ('not_required', 'pending', 'held', 'refunded'));
alter table public.mechanics add column if not exists deposit_received_at date;
alter table public.mechanics add column if not exists kyc_skipped_at timestamptz;

create or replace function public.partner_plans_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from public.partner_plans p), '[]'::jsonb);
end $$;

create or replace function public.partner_profile(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  perform public.kyc_need_admin();
  if p_kind = 'garage' then
    select g.plan, g.deposit_status, g.deposit_received_at, null::timestamptz as kyc_skipped_at into r from public.garages g where g.id = p_id;
  elsif p_kind = 'mechanic' then
    select m.plan, m.deposit_status, m.deposit_received_at, m.kyc_skipped_at into r from public.mechanics m where m.id = p_id;
  else raise exception 'unknown partner type' using errcode = 'P0001'; end if;
  if r is null then raise exception 'partner not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('plan', r.plan, 'deposit_status', r.deposit_status, 'deposit_received_at', r.deposit_received_at, 'kyc_skipped_at', r.kyc_skipped_at,
    'terms', (select to_jsonb(p) from public.partner_plans p where p.plan = r.plan));
end $$;

-- Set the plan. A plan with a deposit starts as "pending" (unless a deposit is already held); a plan without one clears pending. A held deposit is never changed here.
create or replace function public.partner_plan_set(p_kind text, p_id uuid, p_plan text) returns jsonb language plpgsql security definer set search_path = public as $$
declare dep numeric; cur text; nxt text;
begin
  perform public.kyc_need_admin();
  select deposit_amount into dep from public.partner_plans where plan = p_plan;
  if dep is null then raise exception 'Choose Bronze, Silver or Gold.' using errcode = 'P0001'; end if;
  if p_kind = 'garage' then select deposit_status into cur from public.garages where id = p_id;
  elsif p_kind = 'mechanic' then select deposit_status into cur from public.mechanics where id = p_id;
  else raise exception 'unknown partner type' using errcode = 'P0001'; end if;
  if cur is null then raise exception 'partner not found' using errcode = 'P0002'; end if;
  nxt := case when cur = 'held' then 'held' when dep > 0 then 'pending' else 'not_required' end;
  if p_kind = 'garage' then update public.garages set plan = p_plan, deposit_status = nxt where id = p_id;
  else update public.mechanics set plan = p_plan, deposit_status = nxt where id = p_id; end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'plan_set:' || p_plan, p_kind, p_id);
  return public.partner_profile(p_kind, p_id);
end $$;

-- The deposit is recorded by hand: pending, held (received) or refunded. Nothing is charged by this.
create or replace function public.partner_deposit_set(p_kind text, p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare dep numeric; pl text;
begin
  perform public.kyc_need_admin();
  if p_status not in ('pending', 'held', 'refunded') then raise exception 'Choose pending, held or refunded.' using errcode = 'P0001'; end if;
  if p_kind = 'garage' then select plan into pl from public.garages where id = p_id;
  elsif p_kind = 'mechanic' then select plan into pl from public.mechanics where id = p_id;
  else raise exception 'unknown partner type' using errcode = 'P0001'; end if;
  if pl is null then raise exception 'partner not found' using errcode = 'P0002'; end if;
  select deposit_amount into dep from public.partner_plans where plan = pl;
  if coalesce(dep, 0) = 0 then raise exception 'This plan has no deposit.' using errcode = 'P0001'; end if;
  if p_kind = 'garage' then update public.garages set deposit_status = p_status, deposit_received_at = case when p_status = 'held' then current_date else deposit_received_at end where id = p_id;
  else update public.mechanics set deposit_status = p_status, deposit_received_at = case when p_status = 'held' then current_date else deposit_received_at end where id = p_id; end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'deposit:' || p_status, p_kind, p_id);
  return public.partner_profile(p_kind, p_id);
end $$;

-- Every garage and mechanic with plan and KYC state, for the "All partners" list.
create or replace function public.partner_all_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(x order by x.name) from (
    select 'garage'::text as kind, g.id, g.name, g.mobile as phone, g.status as status, g.plan, g.deposit_status, coalesce(k.decision, 'pending') as decision, (k.submitted_at is not null) as submitted,
           null::timestamptz as kyc_skipped_at
      from public.garages g left join public.partner_kyc k on k.partner_kind = 'garage' and k.partner_id = g.id where g.deleted_at is null
    union all
    select 'mechanic', m.id, m.name, m.phone, m.onboarding_status, m.plan, m.deposit_status, coalesce(k.decision, 'pending'), (k.submitted_at is not null), m.kyc_skipped_at
      from public.mechanics m left join public.partner_kyc k on k.partner_kind = 'mechanic' and k.partner_id = m.id
  ) x), '[]'::jsonb);
end $$;

-- Full history: the onboarding log (who did what and when, no document contents), and every booking the partner has had.
create or replace function public.partner_history(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ev jsonb; bk jsonb; sm jsonb;
begin
  perform public.kyc_need_admin();
  select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action) order by l.at desc), '[]'::jsonb) into ev
    from (select at, action from public.partner_onboarding_log where partner_kind = p_kind and partner_id = p_id and action not like 'page_call:%' order by at desc limit 200) l;
  if p_kind = 'garage' then
    select coalesce(jsonb_agg(x order by x.sort_at desc), '[]'::jsonb) into bk from (
      select ga.assigned_at as sort_at, coalesce(l.booking_id, l.ref) as ref, l.area, l.preferred_date, l.status as booking_status, l.paid_amount, ga.status as partner_status, ga.assigned_at
        from public.garage_assignments ga join public.leads l on l.id = ga.lead_id where ga.garage_id = p_id order by ga.assigned_at desc limit 300) x;
  elsif p_kind = 'mechanic' then
    select coalesce(jsonb_agg(x order by x.sort_at desc), '[]'::jsonb) into bk from (
      select l.created_at as sort_at, coalesce(l.booking_id, l.ref) as ref, l.area, l.preferred_date, l.status as booking_status, l.paid_amount, null::text as partner_status, l.created_at as assigned_at
        from public.leads l where l.mechanic_id = p_id order by l.created_at desc limit 300) x;
  else raise exception 'unknown partner type' using errcode = 'P0001'; end if;
  sm := jsonb_build_object('total', jsonb_array_length(bk),
    'completed', (select count(*) from jsonb_array_elements(bk) e where e ->> 'booking_status' = 'completed'),
    'paid_total', coalesce((select sum(coalesce((e ->> 'paid_amount')::numeric, 0)) from jsonb_array_elements(bk) e), 0));
  return jsonb_build_object('events', ev, 'bookings', bk, 'summary', sm);
end $$;

-- Mechanic app: KYC state and the "skip for now" choice. Called by the mechanic-app function only (service role).
create or replace function public.mechanic_kyc_state(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('decision', coalesce(k.decision, 'pending'), 'submitted', (k.submitted_at is not null and coalesce(k.decision, 'pending') <> 'rejected'),
    'skipped', (m.kyc_skipped_at is not null), 'reason', k.decision_reason)
  from public.mechanics m left join public.partner_kyc k on k.partner_kind = 'mechanic' and k.partner_id = m.id where m.id = p_id;
$$;
create or replace function public.mechanic_kyc_skip(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.mechanics set kyc_skipped_at = coalesce(kyc_skipped_at, now()) where id = p_id;
  insert into public.partner_onboarding_log (action, partner_kind, partner_id) values ('kyc_skipped', 'mechanic', p_id);
end $$;

revoke all on function public.partner_plans_list(), public.partner_profile(text, uuid), public.partner_plan_set(text, uuid, text), public.partner_deposit_set(text, uuid, text), public.partner_history(text, uuid), public.partner_all_list() from public, anon;
grant execute on function public.partner_plans_list(), public.partner_profile(text, uuid), public.partner_plan_set(text, uuid, text), public.partner_deposit_set(text, uuid, text), public.partner_history(text, uuid), public.partner_all_list() to authenticated;
revoke all on function public.mechanic_kyc_state(uuid), public.mechanic_kyc_skip(uuid) from public, anon, authenticated;
