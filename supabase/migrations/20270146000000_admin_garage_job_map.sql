-- Admin Bookings "Assigned / To be assigned" filter: which garage each booking went to, including finished jobs.
-- Read only. Owner and admin only. Latest assignment per booking, ignoring cancelled ones. Rollback: drop function public.admin_garage_job_map();
create or replace function public.admin_garage_job_map() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', x.lead_id, 'garage_id', x.garage_id, 'garage', x.name, 'status', x.status))
    from (select distinct on (ga.lead_id) ga.lead_id, ga.garage_id, g.name, ga.status
            from public.garage_assignments ga join public.garages g on g.id = ga.garage_id
           where ga.status <> 'cancelled'
           order by ga.lead_id, (ga.status in ('sent', 'received', 'in_work', 'ready')) desc, ga.assigned_at desc) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_garage_job_map() from public, anon;
grant execute on function public.admin_garage_job_map() to authenticated;
