-- Admin board: which bookings are already with a garage, so a booking sent to a garage stops showing as unassigned.
-- Read only. Owner and admin only. Rollback: drop function public.admin_garage_open_jobs();
create or replace function public.admin_garage_open_jobs() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', ga.lead_id, 'garage_id', ga.garage_id, 'garage', g.name, 'status', ga.status))
    from public.garage_assignments ga join public.garages g on g.id = ga.garage_id where ga.status in ('sent', 'received', 'in_work', 'ready')), '[]'::jsonb);
end $$;
revoke all on function public.admin_garage_open_jobs() from public, anon;
grant execute on function public.admin_garage_open_jobs() to authenticated;
