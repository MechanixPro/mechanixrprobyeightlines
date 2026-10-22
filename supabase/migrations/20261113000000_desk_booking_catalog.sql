-- Care Buddy desk, part 4: what the booking screens need to read. Agents never see the services table; they get a fixed safe list.

create or replace function public.crm_booking_catalog() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_can('create_bookings') or public.crm_can('edit_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'description', description) order by sort, id) from public.services where kind = 'service' and active), '[]'::jsonb),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, id) from public.services where kind = 'addon' and active), '[]'::jsonb));
end; $$;

create or replace function public.crm_coupon_check(p_code text, p_service text, p_addons text[] default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tot int; d int;
begin
  perform public.crm_need_role(); perform public.crm_require('create_bookings');
  tot := public.crm_booking_price(p_service, p_addons); d := public.crm_coupon_discount(p_code, tot);
  return jsonb_build_object('subtotal', tot, 'discount', d, 'total', tot - d, 'valid', d > 0);
end; $$;

-- The lead sheet also needs the fields a booking edit works on
create or replace function public.crm_lead(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads; sla int;
begin
  select * into l from public.leads where id = p_id and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return jsonb_build_object(
    'lead', (select jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'area', l.area, 'pincode', l.pincode, 'address', l.address,
        'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'brand', b.brand, 'model', b.model, 'service_id', l.service_id, 'addons', to_jsonb(l.addons), 'service_name', s.name, 'source', l.source,
        'campaign', l.utm ->> 'utm_campaign', 'utm_source', l.utm ->> 'utm_source', 'status', l.status, 'crm_owner', l.crm_owner,
        'owner_name', public.crm_name(l.crm_owner), 'est_total', l.est_total, 'coupon_code', l.coupon_code, 'coupon_discount', l.coupon_discount, 'notes', l.notes, 'preferred_date', l.preferred_date,
        'preferred_slot', l.preferred_slot, 'job_place', l.job_place, 'disposition', l.disposition, 'sub_disposition', l.sub_disposition, 'created_at', l.created_at, 'updated_at', l.updated_at, 'crm_next_action_at', l.crm_next_action_at,
        'crm_first_contact_at', l.crm_first_contact_at, 'crm_lost_reason', l.crm_lost_reason, 'crm_won_at', l.crm_won_at,
        'is_late', (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
        'overdue', (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')))
      from (select 1) x left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body, 'status_to', a.status_to,
        'actor', public.crm_name(a.actor), 'created_at', a.created_at) order by a.created_at desc)
      from public.crm_activities a where a.lead_id = l.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
      from (select * from public.messages where lead_id = l.id order by created_at desc limit 30) m), '[]'::jsonb));
end; $$;

revoke all on function public.crm_booking_catalog(), public.crm_coupon_check(text, text, text[]), public.crm_lead(uuid) from public;
grant execute on function public.crm_booking_catalog(), public.crm_coupon_check(text, text, text[]), public.crm_lead(uuid) to authenticated;
