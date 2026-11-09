-- The Pro Check result on the booking sheet is read by the shared Crew and Admin screens, so crm_job_check uses the admin-aware check (flow_need) like the other shared functions.
-- Same signature and the same result; only the permission check changes. Additive.
-- Rollback: re-run crm_job_check from 20270121000000_pro_check.sql.
create or replace function public.crm_job_check(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return public.job_check_get(p_lead);
end; $$;
