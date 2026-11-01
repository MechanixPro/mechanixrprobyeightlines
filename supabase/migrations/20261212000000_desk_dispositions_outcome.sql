-- Desk: the disposition list the team asked for (RNR, Follow-up, Awaiting confirmation, Not interested, Interested, then the rest),
-- and a separate Won / Lost action that is not mixed into the "what happened" note.
update public.leads set disposition = 'RNR' where disposition = 'Not reachable';
update public.crm_dispositions set disposition = 'RNR' where disposition = 'Not reachable';
insert into public.crm_dispositions (disposition, sub_disposition, sort) values
  ('Awaiting confirmation','Quote sent',30),('Awaiting confirmation','Payment link sent',31),('Awaiting confirmation','Customer to confirm',32)
on conflict do nothing;
update public.crm_dispositions set sort = case disposition
  when 'RNR' then 10 + (sort % 10) when 'Follow-up' then 20 + (sort % 10) when 'Awaiting confirmation' then 30 + (sort % 10)
  when 'Not interested' then 40 + (sort % 10) when 'Interested' then 50 + (sort % 10)
  when 'Wrong enquiry' then 60 + (sort % 10) when 'Out of area' then 70 + (sort % 10) when 'Booked' then 80 + (sort % 10) else sort end;

create or replace function public.crm_set_outcome(p_id uuid, p_outcome text, p_lost_reason text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads; body text := nullif(trim(p_note), '');
begin
  perform public.crm_require('edit_leads');
  if p_outcome not in ('won','lost') then raise exception 'unknown action' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_id for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.crm_owner is null and r <> 'supervisor' then raise exception 'take the lead first' using errcode = 'P0001';
  elsif l.crm_owner is distinct from auth.uid() and not public.crm_can('view_all_leads') then raise exception 'this lead belongs to a colleague' using errcode = '42501'; end if;
  if public.crm_has_pii(body) or public.crm_has_pii(p_lost_reason) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001'; end if;
  if body is not null and char_length(body) > 1000 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already won' using errcode = 'P0001'; end if;
  if p_outcome = 'won' then
    if l.status = 'lost' and r <> 'supervisor' then raise exception 'only a supervisor can reopen a lost lead' using errcode = '42501'; end if;
    update public.leads set status = 'scheduled', crm_next_action_at = null, crm_lost_reason = null, crm_first_contact_at = coalesce(crm_first_contact_at, now()),
      disposition = 'Booked', sub_disposition = 'Scheduled' where id = p_id;
    insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_id, auth.uid(), 'status', concat_ws(' · ', 'Won', body), 'scheduled');
  else
    if l.status = 'lost' then raise exception 'this lead is already lost' using errcode = 'P0001'; end if;
    if coalesce(p_lost_reason, '') not in ('Price too high','No answer','Wrong area','Booked elsewhere','Not interested','Other') then raise exception 'choose why the lead was lost' using errcode = 'P0001'; end if;
    if p_lost_reason = 'Other' and body is null then raise exception 'add a note to explain "Other"' using errcode = 'P0001'; end if;
    update public.leads set status = 'lost', crm_next_action_at = null, crm_lost_reason = p_lost_reason, crm_first_contact_at = coalesce(crm_first_contact_at, now()) where id = p_id;
    insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_id, auth.uid(), 'status', concat_ws(' · ', 'Lost: ' || p_lost_reason, body), 'lost');
  end if;
end; $$;
revoke all on function public.crm_set_outcome(uuid, text, text, text) from public;
grant execute on function public.crm_set_outcome(uuid, text, text, text) to authenticated;
