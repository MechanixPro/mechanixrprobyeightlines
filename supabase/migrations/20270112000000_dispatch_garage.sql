-- Dispatch shows the partner garage a booking was sent to (from garage_assignments) and whether the garage has opened it.
-- Additive: crm_dispatch_list keeps every existing key and gains garage_id, garage_name, garage_assigned_at, garage_seen_at, garage_status.
-- A booking with a garage counts as assigned (so it leaves the "needs a mechanic" group). No new table or column; rollback = re-run 20261228000000_paid_confirmation.sql's crm_dispatch_list.
create or replace function public.crm_dispatch_list(p_days int default 3) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.flow_need();
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians')) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'assigned') , row ->> 'preferred_date', (row ->> 'slot_rank')::int, row ->> 'created_at') from (
    select jsonb_build_object('id', l.id, 'booking_id', l.booking_id, 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'pincode', l.pincode, 'vehicle', l.vehicle,
      'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'service_name', s.name, 'preferred_date', l.preferred_date, 'preferred_slot', l.preferred_slot,
      'slot_rank', case l.preferred_slot when 'asap' then 0 when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 4 end,
      'assigned', (l.mechanic_id is not null or ga.id is not null)::text, 'mechanic_id', l.mechanic_id, 'mechanic_name', m.name, 'visit_stage', l.visit_stage, 'confirm_fee', l.confirm_fee, 'review', l.confirm_fee_review, 'created_at', l.created_at,
      'garage_id', ga.garage_id, 'garage_name', g.name, 'garage_assigned_at', ga.assigned_at, 'garage_seen_at', ga.received_at, 'garage_status', ga.status) as row
    from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id left join public.mechanics m on m.id = l.mechanic_id
    left join public.garage_assignments ga on ga.lead_id = l.id and ga.status in ('sent','received','in_work','ready') left join public.garages g on g.id = ga.garage_id
    where l.deleted_at is null and l.status in ('paid','scheduled') and l.preferred_date between today - 1 and today + greatest(1, least(coalesce(p_days, 3), 30))) q), '[]'::jsonb);
end; $$;
revoke all on function public.crm_dispatch_list(int) from public, anon;
grant execute on function public.crm_dispatch_list(int) to authenticated;
