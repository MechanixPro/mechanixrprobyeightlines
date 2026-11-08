-- J2: Crew pick-lists mark partners who switched themselves off ("Not available") and list them last.
-- Mechanics already carry availability ('available'/'busy', 20270103) and garages is_open, so NO new column is added: the owner asked for a
-- column only if none existed. Additive: both functions keep every existing key and add 'available' (boolean).
-- Roll back: re-run the bodies in 20261114000000_desk_pickers.sql (crm_garage_picker) and 20261218000000_desk_technician.sql (crm_mechanic_picker).

create or replace function public.crm_garage_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_page_ok('garages') or public.crm_page_ok('garage_visits') or public.crm_page_ok('rsa')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'pincode', pincode, 'status', status, 'available', coalesce(is_open, true)) order by (not coalesce(is_open, true)), name) from public.garages where deleted_at is null), '[]'::jsonb);
end; $$;
revoke all on function public.crm_garage_picker() from public;
grant execute on function public.crm_garage_picker() to authenticated;

create or replace function public.crm_mechanic_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_page_ok('mechanics') or public.crm_page_ok('rsa') or public.crm_page_ok('garages') or public.crm_page_ok('leads')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'area', area, 'skills', skills, 'available', availability = 'available') order by (availability <> 'available'), name) from public.mechanics where active and onboarding_status in ('live','pilot')), '[]'::jsonb);
end; $$;
revoke all on function public.crm_mechanic_picker() from public;
grant execute on function public.crm_mechanic_picker() to authenticated;
