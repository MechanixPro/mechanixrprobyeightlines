-- Commission snapshot per job: the split Admin worked out (service amount, percentage, adjustment, earnings, company share) is kept once, so Admin, the mechanic ledger and the Garage app
-- all read the same figures and a later change of the standard rate never rewrites a finished job. Collections (who received money) stay live from ledger_entries.
-- Additive only: no existing table or record is changed. Rollback: drop function public.admin_commission_list(), public.admin_commission_sync(jsonb), public.admin_commission_set(jsonb); drop table public.job_commission;
create table if not exists public.job_commission (
  lead_id      uuid primary key references public.leads(id) on delete cascade,
  garage_id    uuid references public.garages(id) on delete set null,
  mechanic_id  uuid references public.mechanics(id) on delete set null,
  place        text not null default 'garage' check (place in ('doorstep', 'garage')),
  service_base numeric(12,2) not null check (service_base >= 0),
  gst          numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  pct          integer not null check (pct between 0 and 100),
  rate_source  text,
  adjust       numeric(12,2) not null default 0,
  adjust_note  text,
  earnings     numeric(12,2) not null check (earnings >= 0),
  company      numeric(12,2) not null check (company >= 0),
  frozen_at    timestamptz not null default now(),
  updated_at   timestamptz,
  updated_by   uuid
);
alter table public.job_commission enable row level security;   -- no policy: only the functions below (and the service role) touch it
revoke all on public.job_commission from public, anon, authenticated;

create or replace function public.admin_commission_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(to_jsonb(c)) from public.job_commission c), '[]'::jsonb);
end $$;

-- First snapshot for jobs that have none. Never overwrites: a job that already has one is skipped.
create or replace function public.admin_commission_sync(p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  perform public.kyc_need_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception 'send at most 300 rows' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.job_commission (lead_id, garage_id, mechanic_id, place, service_base, gst, total, pct, rate_source, adjust, adjust_note, earnings, company, updated_by)
    values ((r->>'lead_id')::uuid, nullif(r->>'garage_id', '')::uuid, nullif(r->>'mechanic_id', '')::uuid, coalesce(r->>'place', 'garage'), (r->>'service_base')::numeric, coalesce((r->>'gst')::numeric, 0), coalesce((r->>'total')::numeric, 0),
            (r->>'pct')::integer, left(r->>'rate_source', 40), coalesce((r->>'adjust')::numeric, 0), left(r->>'adjust_note', 200), (r->>'earnings')::numeric, (r->>'company')::numeric, auth.uid())
    on conflict (lead_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- The owner corrects one job's commission in Admin (the existing Edit commission form): the snapshot follows, and the change is recorded in the audit log with who made it.
create or replace function public.admin_commission_set(p_row jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  insert into public.job_commission (lead_id, garage_id, mechanic_id, place, service_base, gst, total, pct, rate_source, adjust, adjust_note, earnings, company, updated_at, updated_by)
  values ((p_row->>'lead_id')::uuid, nullif(p_row->>'garage_id', '')::uuid, nullif(p_row->>'mechanic_id', '')::uuid, coalesce(p_row->>'place', 'garage'), (p_row->>'service_base')::numeric, coalesce((p_row->>'gst')::numeric, 0), coalesce((p_row->>'total')::numeric, 0),
          (p_row->>'pct')::integer, left(p_row->>'rate_source', 40), coalesce((p_row->>'adjust')::numeric, 0), left(p_row->>'adjust_note', 200), (p_row->>'earnings')::numeric, (p_row->>'company')::numeric, now(), auth.uid())
  on conflict (lead_id) do update set place = excluded.place, service_base = excluded.service_base, gst = excluded.gst, total = excluded.total, pct = excluded.pct, rate_source = excluded.rate_source,
    adjust = excluded.adjust, adjust_note = excluded.adjust_note, earnings = excluded.earnings, company = excluded.company, updated_at = now(), updated_by = auth.uid();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'commission_snapshot_set', jsonb_build_object('lead', p_row->>'lead_id', 'pct', p_row->>'pct', 'adjust', p_row->>'adjust'));
end $$;
revoke all on function public.admin_commission_list(), public.admin_commission_sync(jsonb), public.admin_commission_set(jsonb) from public, anon;
grant execute on function public.admin_commission_list(), public.admin_commission_sync(jsonb), public.admin_commission_set(jsonb) to authenticated;
