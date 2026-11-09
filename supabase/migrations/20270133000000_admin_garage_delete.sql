-- Admin can delete a garage by hand (and bring it back). Additive and idempotent. Owner and admin only.
-- Delete is a soft delete: the garage disappears from every list and picker, its app access is switched off and its onboarding links stop working,
-- but its jobs, history, KYC record and money records stay (nothing is erased). A garage with an open job cannot be deleted: move or finish the job first.
-- Rollback: drop function public.admin_garage_delete(uuid), public.admin_garage_restore(uuid).
create or replace function public.admin_garage_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.garages; n int;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_id for update;
  if not found or g.deleted_at is not null then raise exception 'garage not found' using errcode = 'P0002'; end if;
  select count(*) into n from public.garage_assignments where garage_id = p_id and status in ('sent', 'received', 'in_work', 'ready');
  if n > 0 then raise exception 'This garage has % open job(s). Move or finish them first.', n using errcode = 'P0001'; end if;
  update public.garages set deleted_at = now(), ops_state = 'inactive' where id = p_id;
  update public.garage_access set active = false, revoked_at = coalesce(revoked_at, now()) where garage_id = p_id;
  update public.partner_onboarding_links set revoked_at = now() where partner_kind = 'garage' and partner_id = p_id and revoked_at is null;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'garage_deleted', 'garage', p_id);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_deleted', jsonb_build_object('garage', p_id));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.admin_garage_restore(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.garages;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_id for update;
  if not found or g.deleted_at is null then raise exception 'garage not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.garages x where x.mobile = g.mobile and x.deleted_at is null) then raise exception 'Another garage now uses this mobile number.' using errcode = 'P0001'; end if;
  update public.garages set deleted_at = null where id = p_id;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'garage_restored', 'garage', p_id);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_restored', jsonb_build_object('garage', p_id));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.admin_garage_deleted_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'mobile', g.mobile, 'deleted_at', g.deleted_at) order by g.deleted_at desc) from public.garages g where g.deleted_at is not null), '[]'::jsonb);
end $$;
revoke all on function public.admin_garage_delete(uuid), public.admin_garage_restore(uuid), public.admin_garage_deleted_list() from public, anon;
grant execute on function public.admin_garage_delete(uuid), public.admin_garage_restore(uuid), public.admin_garage_deleted_list() to authenticated;
