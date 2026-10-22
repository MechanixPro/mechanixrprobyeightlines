-- Care Buddy desk, part 5: short pick-lists for forms, readable from the pages that need them (a support login has Garage Visits and RSA Cases but not the full Garages page).

create or replace function public.crm_garage_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_page_ok('garages') or public.crm_page_ok('garage_visits') or public.crm_page_ok('rsa')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'pincode', pincode, 'status', status) order by name) from public.garages where deleted_at is null), '[]'::jsonb);
end; $$;

create or replace function public.crm_mechanic_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_page_ok('mechanics') or public.crm_page_ok('rsa') or public.crm_page_ok('garages')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'area', area, 'skills', skills) order by name) from public.mechanics where active and onboarding_status in ('live','pilot')), '[]'::jsonb);
end; $$;

revoke all on function public.crm_garage_picker(), public.crm_mechanic_picker() from public;
grant execute on function public.crm_garage_picker(), public.crm_mechanic_picker() to authenticated;
