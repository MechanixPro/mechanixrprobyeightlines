-- Going live now also switches a mechanic on (active), because an independent mechanic who applies on the website starts inactive so nobody can assign a job before the KYC is approved.
-- Same signature; additive. Rollback: re-run kyc_onboard from 20270116000000_partner_kyc.sql.
create or replace function public.kyc_onboard(p_kind text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.partner_kyc;
begin
  perform public.kyc_need_admin();
  select * into k from public.partner_kyc where partner_kind = p_kind and partner_id = p_id;
  if not found or k.decision <> 'approved' then raise exception 'approve the KYC first' using errcode = 'P0001'; end if;
  if p_kind = 'garage' then update public.garages set status = 'live' where id = p_id and deleted_at is null; else update public.mechanics set onboarding_status = 'live', active = true where id = p_id; end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'onboarded', p_kind, p_id);
  return jsonb_build_object('ok', true);
end $$;
