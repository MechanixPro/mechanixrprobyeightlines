-- J4: automatic assignment of paid bookings to a partner garage (default OFF).
-- Adds: settings row auto_assign_garage, and garage_auto_assign(lead, garage), callable only by the service role (desk-automation).
-- Manual assignment (crm_garage_assign, mechanic assignment) is not changed.
-- Roll back: drop function if exists public.garage_auto_assign(uuid, uuid); delete from public.settings where key = 'auto_assign_garage';

insert into public.settings (key, value) values ('auto_assign_garage', '{"enabled": false, "max_open_jobs": 3, "radius_km": 15}'::jsonb) on conflict (key) do nothing;

create or replace function public.garage_auto_assign(p_lead uuid, p_garage uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; g public.garages; nid uuid;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then return jsonb_build_object('assigned', false, 'reason', 'lead_not_found'); end if;
  -- Crew got there first, or it is no longer a paid booking waiting for someone
  if l.mechanic_id is not null then return jsonb_build_object('assigned', false, 'reason', 'has_mechanic'); end if;
  if l.confirm_paid_at is null or l.status not in ('paid', 'scheduled') then return jsonb_build_object('assigned', false, 'reason', 'not_paid_waiting'); end if;
  if exists (select 1 from public.garage_assignments where lead_id = p_lead and status in ('sent','received','in_work','ready')) then return jsonb_build_object('assigned', false, 'reason', 'has_garage'); end if;
  -- once per lead: if the desk already did this and Crew or the garage undid it, leave it to people
  if exists (select 1 from public.audit_log where action = 'garage_auto_assigned' and details ->> 'lead' = l.ref) then return jsonb_build_object('assigned', false, 'reason', 'already_auto'); end if;
  select * into g from public.garages where id = p_garage and deleted_at is null and status in ('live','pilot') and ops_state = 'active' and is_open;
  if not found then return jsonb_build_object('assigned', false, 'reason', 'garage_unavailable'); end if;
  insert into public.garage_assignments (lead_id, garage_id, notes, eta, assigned_by) values (p_lead, p_garage, null, null, null) returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'assign', 'Auto-assigned to garage ' || g.name);
  insert into public.audit_log (actor, action, details) values (null, 'garage_assigned', jsonb_build_object('lead', l.ref, 'garage', p_garage, 'assignment', nid, 'auto', true));
  insert into public.audit_log (actor, action, details) values (null, 'garage_auto_assigned', jsonb_build_object('lead', l.ref, 'garage', p_garage, 'assignment', nid));
  return jsonb_build_object('assigned', true, 'assignment_id', nid, 'garage', g.name);
end; $$;
revoke all on function public.garage_auto_assign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.garage_auto_assign(uuid, uuid) to service_role;
