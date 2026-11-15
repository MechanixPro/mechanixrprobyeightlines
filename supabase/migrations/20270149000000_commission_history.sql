-- Commission change history: every edit of a job's commission records the previous and new percentage and amounts, who made it, when, and why. Additive; nothing existing is changed.
-- Rollback: drop function public.admin_commission_history(uuid); drop function public.admin_commission_set(jsonb, text); drop table public.job_commission_history; then recreate admin_commission_set(jsonb) from 20270148000000_job_commission.sql.
create table if not exists public.job_commission_history (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  changed_at   timestamptz not null default now(),
  changed_by   uuid,
  reason       text,
  old_pct      integer, new_pct integer not null,
  old_company  numeric(12,2), new_company numeric(12,2) not null,
  old_earnings numeric(12,2), new_earnings numeric(12,2) not null,
  old_adjust   numeric(12,2), new_adjust numeric(12,2) not null default 0
);
create index if not exists job_commission_history_lead on public.job_commission_history (lead_id, changed_at desc);
alter table public.job_commission_history enable row level security;
revoke all on public.job_commission_history from public, anon, authenticated;

create or replace function public.admin_commission_set(p_row jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare o public.job_commission; why text := left(btrim(coalesce(p_reason, '')), 200); lid uuid := (p_row->>'lead_id')::uuid;
begin
  perform public.kyc_need_admin();
  select * into o from public.job_commission where lead_id = lid for update;
  if found and ((o.pct is distinct from (p_row->>'pct')::integer) or (o.adjust is distinct from coalesce((p_row->>'adjust')::numeric, 0))) and length(why) < 3 then
    raise exception 'say why the commission is changed' using errcode = 'P0001';
  end if;
  insert into public.job_commission (lead_id, garage_id, mechanic_id, place, service_base, gst, total, pct, rate_source, adjust, adjust_note, earnings, company, updated_at, updated_by)
  values (lid, nullif(p_row->>'garage_id', '')::uuid, nullif(p_row->>'mechanic_id', '')::uuid, coalesce(p_row->>'place', 'garage'), (p_row->>'service_base')::numeric, coalesce((p_row->>'gst')::numeric, 0), coalesce((p_row->>'total')::numeric, 0),
          (p_row->>'pct')::integer, left(p_row->>'rate_source', 40), coalesce((p_row->>'adjust')::numeric, 0), left(p_row->>'adjust_note', 200), (p_row->>'earnings')::numeric, (p_row->>'company')::numeric, now(), auth.uid())
  on conflict (lead_id) do update set place = excluded.place, service_base = excluded.service_base, gst = excluded.gst, total = excluded.total, pct = excluded.pct, rate_source = excluded.rate_source,
    adjust = excluded.adjust, adjust_note = excluded.adjust_note, earnings = excluded.earnings, company = excluded.company, updated_at = now(), updated_by = auth.uid();
  if not found or o.lead_id is null or o.pct is distinct from (p_row->>'pct')::integer or o.adjust is distinct from coalesce((p_row->>'adjust')::numeric, 0) or o.company is distinct from (p_row->>'company')::numeric then
    insert into public.job_commission_history (lead_id, changed_by, reason, old_pct, new_pct, old_company, new_company, old_earnings, new_earnings, old_adjust, new_adjust)
    values (lid, auth.uid(), nullif(why, ''), o.pct, (p_row->>'pct')::integer, o.company, (p_row->>'company')::numeric, o.earnings, (p_row->>'earnings')::numeric, o.adjust, coalesce((p_row->>'adjust')::numeric, 0));
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'commission_snapshot_set', jsonb_build_object('lead', lid, 'pct', p_row->>'pct', 'adjust', p_row->>'adjust', 'reason', why));
end $$;

create or replace function public.admin_commission_history(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('changed_at', h.changed_at, 'by', public.crm_name(h.changed_by), 'reason', h.reason, 'old_pct', h.old_pct, 'new_pct', h.new_pct,
    'old_company', h.old_company, 'new_company', h.new_company, 'old_earnings', h.old_earnings, 'new_earnings', h.new_earnings) order by h.changed_at desc) from public.job_commission_history h where h.lead_id = p_lead), '[]'::jsonb);
end $$;

drop function if exists public.admin_commission_set(jsonb);
revoke all on function public.admin_commission_set(jsonb, text), public.admin_commission_history(uuid) from public, anon;
grant execute on function public.admin_commission_set(jsonb, text), public.admin_commission_history(uuid) to authenticated;
