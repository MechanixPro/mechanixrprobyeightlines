-- Admin Bookings: who is handling each lead (the Crew owner's name). Read only. Owner and admin only.
-- Rollback: drop function public.admin_lead_owners();
create or replace function public.admin_lead_owners() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'owner_name', public.crm_name(l.crm_owner)))
    from public.leads l where l.crm_owner is not null and l.deleted_at is null), '[]'::jsonb);
end $$;
revoke all on function public.admin_lead_owners() from public, anon;
grant execute on function public.admin_lead_owners() to authenticated;
