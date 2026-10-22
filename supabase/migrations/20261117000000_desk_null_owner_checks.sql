-- Care Buddy desk, part 8: a missing owner must never count as "allowed". SQL treats NULL as unknown, so a check like (owner = me) on an unowned row let people through.

create or replace function public.crm_update_booking(p_id uuid, p jsonb, p_expected timestamptz) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; adds text[]; svc text; total int; changes text[] := '{}'; pin text; slot text; pdate date; v_brand text; v_model text; bid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_id and deleted_at is null for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('view_all_leads') or coalesce(l.crm_owner = auth.uid(), false)) then raise exception 'this booking belongs to a colleague' using errcode = '42501'; end if;
  if p_expected is distinct from l.updated_at then raise exception 'this booking changed, reload it before saving' using errcode = '40001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the booking.' using errcode = 'P0001'; end if;
  if l.status in ('paid','scheduled','completed') and (p ? 'service_id' or p ? 'addons') then raise exception 'the service of a confirmed booking is changed in the admin' using errcode = 'P0001'; end if;
  if p ? 'pincode' then pin := nullif(trim(p ->> 'pincode'), ''); if pin is null or not public.crm_pin_ok(pin) then raise exception 'the PIN code must be inside the Bengaluru service area' using errcode = 'P0001'; end if; if pin is distinct from l.pincode then changes := changes || ('PIN ' || coalesce(l.pincode, '-') || ' to ' || pin); end if; end if;
  if p ? 'preferred_slot' then slot := nullif(p ->> 'preferred_slot', ''); if slot is not null and slot not in ('morning','afternoon','evening','asap') then raise exception 'choose a valid time slot' using errcode = 'P0001'; end if; if slot is distinct from l.preferred_slot then changes := changes || ('slot ' || coalesce(l.preferred_slot, '-') || ' to ' || coalesce(slot, '-')); end if; end if;
  if p ? 'preferred_date' then begin pdate := nullif(p ->> 'preferred_date', '')::date; exception when others then raise exception 'preferred date is not valid' using errcode = 'P0001'; end;
    if pdate is not null and pdate < (now() at time zone 'Asia/Kolkata')::date then raise exception 'the preferred date cannot be in the past' using errcode = 'P0001'; end if;
    if pdate is distinct from l.preferred_date then changes := changes || ('date ' || coalesce(l.preferred_date::text, '-') || ' to ' || coalesce(pdate::text, '-')); end if; end if;
  svc := coalesce(nullif(p ->> 'service_id', ''), l.service_id);
  adds := case when p ? 'addons' then coalesce(array(select jsonb_array_elements_text(p -> 'addons')), '{}') else l.addons end;
  if (p ? 'service_id' or p ? 'addons') then total := public.crm_booking_price(svc, adds); if svc is distinct from l.service_id then changes := changes || ('service ' || coalesce(l.service_id, '-') || ' to ' || svc); end if; if adds is distinct from l.addons then changes := changes || 'add-ons changed'::text; end if; end if;
  if p ? 'notes' and public.crm_clean_text(p ->> 'notes', 1000) is distinct from l.notes then changes := changes || 'requirements updated'::text; end if;
  if p ? 'area' and public.crm_clean_text(p ->> 'area', 80) is distinct from l.area then changes := changes || 'area updated'::text; end if;
  if p ? 'address' and public.crm_clean_text(p ->> 'address', 200) is distinct from l.address then changes := changes || 'address updated'::text; end if;
  if p ? 'mechanic_id' then perform public.crm_require('assign_leads'); if nullif(p ->> 'mechanic_id', '')::uuid is distinct from l.mechanic_id then changes := changes || 'mechanic changed'::text; end if; end if;
  if p ? 'brand' or p ? 'model' then
    v_brand := public.crm_clean_text(p ->> 'brand', 40); v_model := public.crm_clean_text(p ->> 'model', 60);
    if l.bike_id is not null then update public.bikes set brand = coalesce(v_brand, public.bikes.brand), model = coalesce(v_model, public.bikes.model) where id = l.bike_id; bid := l.bike_id;
    elsif l.customer_id is not null then insert into public.bikes (customer_id, brand, model) values (l.customer_id, v_brand, v_model) returning id into bid; end if;
    changes := changes || 'bike updated'::text;
  end if;
  update public.leads set
    area = case when p ? 'area' then public.crm_clean_text(p ->> 'area', 80) else area end,
    pincode = case when p ? 'pincode' then pin else pincode end,
    address = case when p ? 'address' then public.crm_clean_text(p ->> 'address', 200) else address end,
    notes = case when p ? 'notes' then public.crm_clean_text(p ->> 'notes', 1000) else notes end,
    preferred_slot = case when p ? 'preferred_slot' then slot else preferred_slot end,
    preferred_date = case when p ? 'preferred_date' then pdate else preferred_date end,
    service_id = svc, addons = adds, est_total = coalesce(total, est_total), bike_id = coalesce(bid, bike_id),
    mechanic_id = case when p ? 'mechanic_id' then nullif(p ->> 'mechanic_id', '')::uuid else mechanic_id end
  where id = p_id;
  if cardinality(changes) > 0 then
    insert into public.crm_activities (lead_id, actor, kind, body) values (p_id, auth.uid(), 'note', left(array_to_string(changes, '; '), 900));
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'booking_edited_in_desk', jsonb_build_object('lead', p_id, 'changes', changes));
  end if;
  return jsonb_build_object('ok', true, 'updated_at', (select updated_at from public.leads where id = p_id), 'changes', to_jsonb(changes));
end; $$;

create or replace function public.crm_ticket_visible(t public.crm_tickets) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case when t.legal then public.crm_can('view_legal_tickets')
    else public.crm_can('view_all_leads') or coalesce(t.owner = auth.uid(), false) or coalesce(t.created_by = auth.uid(), false) end, false);
$$;

revoke all on function public.crm_update_booking(uuid, jsonb, timestamptz), public.crm_ticket_visible(public.crm_tickets) from public;
grant execute on function public.crm_update_booking(uuid, jsonb, timestamptz), public.crm_ticket_visible(public.crm_tickets) to authenticated;
