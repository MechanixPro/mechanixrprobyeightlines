-- 1. Admins (not only the owner) can use the garage pickers and the Admin Garages screen: crm_garage_picker used a Crew-only guard, so an admin who is not in the Crew list could not send a booking to a partner garage.
-- 2. admin_garage_list / admin_garage_get / admin_garage_save: the Admin Garages screen (owner and admin only), same checks as Crew's crm_garage_save.
-- 3. garage_code_issue: a partner garage can ask for the customer's code (OTP) for a vehicle it has accepted when no code exists yet. The code is shown only on the customer's tracking page; it is never returned to the garage.
-- Additive. Rollback: re-run crm_garage_picker from 20270113000000_mechanic_available.sql; drop function public.admin_garage_list(), public.admin_garage_get(uuid), public.admin_garage_save(jsonb), public.garage_code_issue(uuid, uuid).
create or replace function public.crm_garage_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.flow_need();
  if not (public.is_admin() or public.crm_page_ok('garages') or public.crm_page_ok('garage_visits') or public.crm_page_ok('rsa')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'pincode', pincode, 'status', status, 'available', coalesce(is_open, true)) order by (not coalesce(is_open, true)), name) from public.garages where deleted_at is null), '[]'::jsonb);
end; $$;
revoke all on function public.crm_garage_picker() from public;
grant execute on function public.crm_garage_picker() to authenticated;

create or replace function public.admin_garage_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'owner_name', g.owner_name, 'mobile', g.mobile, 'pincode', g.pincode, 'status', g.status) order by g.name) from public.garages g where g.deleted_at is null), '[]'::jsonb);
end $$;
create or replace function public.admin_garage_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_id and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('garage', jsonb_build_object('id', g.id, 'name', g.name, 'owner_name', g.owner_name, 'mobile', g.mobile, 'address', g.address, 'landmark', g.landmark, 'pincode', g.pincode, 'lat', g.lat, 'lng', g.lng,
    'categories', g.categories, 'open_days', g.open_days, 'open_time', g.open_time, 'close_time', g.close_time, 'bays', g.bays, 'notes', g.notes));
end $$;
create or replace function public.admin_garage_save(p jsonb, p_commit boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare gid_in uuid := nullif(p ->> 'id', '')::uuid; errs text[]; m text; hub int; cats text[]; v_lat numeric; v_lng numeric; nid uuid;
begin
  perform public.kyc_need_admin();
  errs := public.crm_garage_errors(p, gid_in);
  if cardinality(errs) > 0 then return jsonb_build_object('ok', false, 'errors', to_jsonb(errs)); end if;
  m := regexp_replace(p ->> 'mobile', '[^0-9]', '', 'g'); if length(m) = 12 and m like '91%' then m := substr(m, 3); end if;
  v_lat := (p ->> 'lat')::numeric; v_lng := (p ->> 'lng')::numeric; hub := coalesce(nullif(p ->> 'hub_id', '')::int, public.crm_suggest_hub(v_lat, v_lng));
  cats := array(select jsonb_array_elements_text(p -> 'categories'));
  if not p_commit then return jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'hub_id', hub); end if;
  if gid_in is null then
    insert into public.garages (name, legal_name, trade_id, owner_name, mobile, address, landmark, pincode, lat, lng, categories, open_days, open_time, close_time, bays, hub_id, notes, created_by)
    values (public.crm_clean_text(p ->> 'name', 80), public.crm_clean_text(p ->> 'legal_name', 120), public.crm_clean_text(p ->> 'trade_id', 40), public.crm_clean_text(p ->> 'owner_name', 80), m,
      public.crm_clean_text(p ->> 'address', 300), public.crm_clean_text(p ->> 'landmark', 120), p ->> 'pincode', v_lat, v_lng, cats, public.crm_clean_text(p ->> 'open_days', 60), p ->> 'open_time', p ->> 'close_time',
      (p ->> 'bays')::int, hub, public.crm_clean_text(p ->> 'notes', 1000), auth.uid()) returning garages.id into nid;
  else
    update public.garages set name = public.crm_clean_text(p ->> 'name', 80), owner_name = public.crm_clean_text(p ->> 'owner_name', 80), mobile = m, address = public.crm_clean_text(p ->> 'address', 300),
      landmark = public.crm_clean_text(p ->> 'landmark', 120), pincode = p ->> 'pincode', lat = v_lat, lng = v_lng, categories = cats, open_days = public.crm_clean_text(p ->> 'open_days', 60),
      open_time = p ->> 'open_time', close_time = p ->> 'close_time', bays = (p ->> 'bays')::int, hub_id = hub, notes = public.crm_clean_text(p ->> 'notes', 1000)
    where garages.id = gid_in and deleted_at is null returning garages.id into nid;
    if nid is null then raise exception 'garage not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), case when gid_in is null then 'garage_created' else 'garage_updated' end, jsonb_build_object('garage', nid, 'by', 'admin'));
  return jsonb_build_object('ok', true, 'id', nid, 'hub_id', hub);
end $$;
revoke all on function public.admin_garage_list(), public.admin_garage_get(uuid), public.admin_garage_save(jsonb, boolean) from public, anon;
grant execute on function public.admin_garage_list(), public.admin_garage_get(uuid), public.admin_garage_save(jsonb, boolean) to authenticated;

create or replace function public.garage_code_issue(p_access uuid, p_assignment uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare ac public.garage_access; a public.garage_assignments; l public.leads; g public.garages; latest record;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if a.status not in ('received', 'in_work') then return jsonb_build_object('ok', false, 'error', 'Accept the job first.'); end if;
  select * into l from public.leads where id = a.lead_id and deleted_at is null;
  if not found or l.status = 'lost' then return jsonb_build_object('ok', false, 'error', 'This job is closed.'); end if;
  if exists (select 1 from public.handovers h where h.lead_id = l.id and h.kind = 'start' and h.verified_at is not null) then return jsonb_build_object('ok', true, 'already', true); end if;
  if l.confirm_fee is not null and l.confirm_paid_at is null then return jsonb_build_object('ok', false, 'error', 'The customer has not paid the confirmation fee yet. The team will contact them.'); end if;
  perform public.booking_open_secrets(l.id);
  select * into latest from public.handovers h where h.lead_id = l.id and h.kind = 'start' order by h.created_at desc limit 1;
  if found and latest.verified_at is null and latest.locked_at is not null then return jsonb_build_object('ok', false, 'error', 'Too many wrong codes. The team will send a new code.'); end if;
  if found and latest.verified_at is null and latest.locked_at is null and latest.code_expires_at > now() then return jsonb_build_object('ok', true, 'already', true); end if;
  perform public.booking_door_code_new(l.id, null);
  select * into g from public.garages where id = a.garage_id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Partner garage (' || g.name || ') asked for the customer''s code. The customer sees it on their tracking page.');
  insert into public.audit_log (action, details) values ('garage_code_issue', jsonb_build_object('lead', l.ref, 'garage', g.id, 'access', ac.id));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.garage_code_issue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.garage_code_issue(uuid, uuid) to service_role;
