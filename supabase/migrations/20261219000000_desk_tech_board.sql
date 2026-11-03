-- Desk: the technician board for one day (today by default).
-- Every live or pilot technician with the booked jobs they have that day, and the booked jobs with nobody assigned.
-- Used by "Technicians today" on My day and to rank technicians in Edit booking (free in the slot, covers the PIN code).
create or replace function public.crm_tech_board(p_date date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  return jsonb_build_object('date', d,
    'techs', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'area', m.area, 'pincodes', to_jsonb(m.pincodes), 'shift', m.shift,
        'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'area', l.area, 'pincode', l.pincode, 'slot', l.preferred_slot, 'status', l.status) order by l.preferred_slot)
          from public.leads l where l.mechanic_id = m.id and l.deleted_at is null and l.preferred_date = d and l.status in ('paid','scheduled','completed')), '[]'::jsonb)) order by m.name)
      from public.mechanics m where m.active and m.onboarding_status in ('live','pilot')), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'area', l.area, 'slot', l.preferred_slot) order by l.preferred_slot)
      from public.leads l where l.mechanic_id is null and l.deleted_at is null and l.preferred_date = d and l.status in ('paid','scheduled')), '[]'::jsonb));
end; $$;
revoke all on function public.crm_tech_board(date) from public;
grant execute on function public.crm_tech_board(date) to authenticated;
