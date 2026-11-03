-- Desk: two new "Interested" sub-dispositions that move the lead on.
--   Technician assigned: sets the technician on the lead.
--   Booking confirmed:   sets the technician, the date and the slot, and moves the booking to Scheduled.
-- The lead's owner may do this (no assign_leads needed); people who see all leads may do it on any lead, the same rule as crm_log.
-- Scheduled + technician is what the desk's journey uses to WhatsApp the customer the booking confirmation with the technician's name.

insert into public.crm_dispositions (disposition, sub_disposition, sort, active) values
  ('Interested','Technician assigned',14,true),('Interested','Booking confirmed',15,true)
on conflict (disposition, sub_disposition) do update set sort = excluded.sort, active = true;

-- Shared checks for both: may this person move this lead, and is this technician one we can send?
create or replace function public.crm_move_guard(p_id uuid, p_mechanic uuid) returns public.leads language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads;
begin
  perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_id for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('view_all_leads') or l.crm_owner = auth.uid() or l.crm_owner is null) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.crm_owner is null and r <> 'supervisor' then raise exception 'take the lead first' using errcode = 'P0001';
  elsif l.crm_owner is distinct from auth.uid() and not public.crm_can('view_all_leads') then raise exception 'this lead belongs to a colleague' using errcode = '42501';
  end if;
  if l.status in ('lost','completed') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  if p_mechanic is null or not exists (select 1 from public.mechanics where id = p_mechanic and active and onboarding_status in ('live','pilot')) then
    raise exception 'choose a live technician' using errcode = 'P0001';
  end if;
  return l;
end; $$;
revoke all on function public.crm_move_guard(uuid, uuid) from public, anon, authenticated;

create or replace function public.crm_assign_technician(p_id uuid, p_mechanic uuid, p_note text default null, p_next_action timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads; nm text; body text := nullif(trim(p_note), ''); changed boolean;
begin
  l := public.crm_move_guard(p_id, p_mechanic);
  if public.crm_has_pii(body) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001'; end if;
  if body is not null and char_length(body) > 500 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  if p_next_action is not null and (p_next_action < now() - interval '5 minutes' or p_next_action > now() + interval '60 days') then raise exception 'the follow-up must be within the next 60 days' using errcode = 'P0001'; end if;
  select name into nm from public.mechanics where id = p_mechanic;
  changed := l.mechanic_id is distinct from p_mechanic;
  update public.leads set mechanic_id = p_mechanic, disposition = 'Interested', sub_disposition = 'Technician assigned',
    crm_next_action_at = coalesce(p_next_action, crm_next_action_at), crm_first_contact_at = coalesce(crm_first_contact_at, now())
  where id = p_id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_id, auth.uid(), 'note', concat_ws(' · ', 'Disposition: Interested / Technician assigned', 'Technician: ' || nm, body,
    case when p_next_action is not null then 'Next: ' || to_char(p_next_action at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') end));
  return jsonb_build_object('ok', true, 'changed', changed, 'mechanic_name', nm);
end; $$;

create or replace function public.crm_confirm_booking(p_id uuid, p_mechanic uuid, p_date date, p_slot text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads; nm text; body text := nullif(trim(p_note), '');
begin
  l := public.crm_move_guard(p_id, p_mechanic);
  if p_date is null then raise exception 'choose the date' using errcode = 'P0001'; end if;
  if p_date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'the date is in the past' using errcode = 'P0001'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date + 60 then raise exception 'pick a date within 60 days' using errcode = 'P0001'; end if;
  if p_slot is null or p_slot not in ('morning','afternoon','evening','asap') then raise exception 'choose a time slot' using errcode = 'P0001'; end if;
  if public.crm_has_pii(body) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001'; end if;
  if body is not null and char_length(body) > 500 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  select name into nm from public.mechanics where id = p_mechanic;
  -- Confirming the same booking twice changes nothing, so the customer is not messaged twice.
  if l.status = 'scheduled' and l.mechanic_id = p_mechanic and l.preferred_date = p_date and l.preferred_slot = p_slot then
    return jsonb_build_object('ok', true, 'already', true, 'mechanic_name', nm);
  end if;
  update public.leads set mechanic_id = p_mechanic, preferred_date = p_date, preferred_slot = p_slot, status = 'scheduled',
    disposition = 'Interested', sub_disposition = 'Booking confirmed', crm_next_action_at = null, crm_first_contact_at = coalesce(crm_first_contact_at, now())
  where id = p_id;
  insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_id, auth.uid(), 'status',
    concat_ws(' · ', 'Disposition: Interested / Booking confirmed', 'Technician: ' || nm, 'Visit: ' || to_char(p_date, 'DD Mon') || ' ' || p_slot, body), 'scheduled');
  return jsonb_build_object('ok', true, 'already', false, 'mechanic_name', nm);
end; $$;

revoke all on function public.crm_assign_technician(uuid, uuid, text, timestamptz), public.crm_confirm_booking(uuid, uuid, date, text, text) from public;
grant execute on function public.crm_assign_technician(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.crm_confirm_booking(uuid, uuid, date, text, text) to authenticated;
