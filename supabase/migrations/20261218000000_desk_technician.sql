-- Desk: the technician (mechanic) on a booking.
-- 1. The lead sheet gets the technician's id, name and phone, so the team sees who is going and can WhatsApp them the job.
-- 2. The Leads table gets a Technician column.
-- 3. The Leads page may use the technician picker (it was only for the Mechanics, Roadside and Garages pages). Setting a technician still needs assign_leads (crm_update_booking checks it).
-- 4. crm_unstaffed_jobs lists booked jobs from today back that still have no technician, for the desk's alert.

do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_lead(uuid)'::regprocedure) into d;
  if position('mechanic_name' in d) > 0 then return; end if;
  n := replace(d, '''crm_won_at'', l.crm_won_at,', '''crm_won_at'', l.crm_won_at, ''mechanic_id'', l.mechanic_id, ''mechanic_name'', (select m.name from public.mechanics m where m.id = l.mechanic_id), ''mechanic_phone'', (select m.phone from public.mechanics m where m.id = l.mechanic_id),');
  if n = d then raise exception 'crm_lead was not patched'; end if;
  execute n;
end $$;

do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_leads_list(text,text,uuid,date,date,integer)'::regprocedure) into d;
  if position('mechanic_name' in d) > 0 then return; end if;
  -- pg_get_functiondef spells the return type out in full
  n := replace(d, 'updated_at timestamp with time zone)', 'updated_at timestamp with time zone, mechanic_id uuid, mechanic_name text)');
  n := replace(n, 'l.crm_lost_reason, l.updated_at', 'l.crm_lost_reason, l.updated_at, l.mechanic_id, (select m.name from public.mechanics m where m.id = l.mechanic_id)');
  if n = d or position('mechanic_name text' in n) = 0 or position('l.updated_at, l.mechanic_id' in n) = 0 then raise exception 'crm_leads_list was not patched'; end if;
  -- the returned columns change, so the old function has to go first
  drop function public.crm_leads_list(text,text,uuid,date,date,integer);
  execute n;
end $$;
revoke all on function public.crm_leads_list(text,text,uuid,date,date,integer) from public;
grant execute on function public.crm_leads_list(text,text,uuid,date,date,integer) to authenticated;

create or replace function public.crm_mechanic_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_page_ok('mechanics') or public.crm_page_ok('rsa') or public.crm_page_ok('garages') or public.crm_page_ok('leads')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'area', area, 'skills', skills) order by name) from public.mechanics where active and onboarding_status in ('live','pilot')), '[]'::jsonb);
end; $$;
revoke all on function public.crm_mechanic_picker() from public;
grant execute on function public.crm_mechanic_picker() to authenticated;

create or replace function public.crm_unstaffed_jobs() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not public.crm_can('assign_leads') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'area', l.area, 'preferred_date', l.preferred_date, 'preferred_slot', l.preferred_slot) order by l.preferred_date, l.preferred_slot)
    from public.leads l
    where l.deleted_at is null and l.mechanic_id is null and l.status in ('paid','scheduled')
      and l.preferred_date between (now() at time zone 'Asia/Kolkata')::date - 7 and (now() at time zone 'Asia/Kolkata')::date), '[]'::jsonb);
end; $$;
revoke all on function public.crm_unstaffed_jobs() from public;
grant execute on function public.crm_unstaffed_jobs() to authenticated;
