-- J3: the garage starts work only after the customer's one-time code is confirmed (same flag the mechanic flow uses).
-- Rollback: re-run the garage_progress_set definition from 20270101000000_garage_app.sql (same signature).
create or replace function public.garage_progress_set(p_access uuid, p_assignment uuid, p_event text, p_photos text[] default '{}', p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; l public.leads; ph text[] := coalesce(p_photos, '{}'); p text; nt text := public.crm_clean_text(p_note, 300); target text; ord text[] := array['sent','received','in_work','ready']; stage_moved boolean := false;
begin
  if p_event not in ('received','work_started','ready') then return jsonb_build_object('ok', false, 'error', 'Choose a valid update.'); end if;
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  select * into g from public.garages where id = a.garage_id;
  select * into l from public.leads where id = a.lead_id for update;
  target := case p_event when 'received' then 'received' when 'work_started' then 'in_work' else 'ready' end;
  if a.status not in ('sent','received','in_work','ready') then return jsonb_build_object('ok', false, 'error', 'This job is closed.'); end if;
  if array_position(ord, a.status) >= array_position(ord, target) then return jsonb_build_object('ok', true, 'already', true, 'status', a.status); end if;   -- the same tap twice changes nothing
  if p_event = 'work_started' and a.status = 'sent' then return jsonb_build_object('ok', false, 'error', 'Mark Vehicle received first.'); end if;
  if p_event = 'ready' and a.status <> 'in_work' then return jsonb_build_object('ok', false, 'error', case when a.status = 'sent' then 'Mark Vehicle received first.' else 'Mark Work started first.' end); end if;
  -- J3: same rule as the mechanic flow: no work before the customer's one-time code is confirmed (handovers kind 'start', verified_at). Leads with no code and no paid confirmation are not held.
  if p_event = 'work_started' and (l.confirm_fee is not null or exists (select 1 from public.handovers h where h.lead_id = l.id and h.kind = 'start'))
     and not exists (select 1 from public.handovers h where h.lead_id = l.id and h.kind = 'start' and h.verified_at is not null) then
    return jsonb_build_object('ok', false, 'blocked', 'code', 'error', 'Enter the customer''s code first. Work can start once the code is confirmed.');
  end if;
  if p_event = 'work_started' and l.confirm_fee is not null and not public.quote_is_approved(l.id) then
    return jsonb_build_object('ok', false, 'blocked', 'quote', 'error', 'The customer has not approved the quote yet. Send your estimate. Work can start once the customer approves.');
  end if;
  if nt is not null and public.crm_has_pii(nt) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the note.'); end if;
  if cardinality(ph) > 4 then return jsonb_build_object('ok', false, 'error', 'Send at most 4 photos.'); end if;
  foreach p in array ph loop
    if p !~ ('^' || a.garage_id::text || '/' || a.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then return jsonb_build_object('ok', false, 'error', 'A photo is not valid. Take it again.'); end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'garage-updates' and o.name = p) then return jsonb_build_object('ok', false, 'error', 'A photo did not finish uploading. Try again.'); end if;
  end loop;
  update public.garage_assignments set status = target, updated_at = now(),
    received_at = case when p_event = 'received' then now() else received_at end, started_at = case when p_event = 'work_started' then now() else started_at end, ready_at = case when p_event = 'ready' then now() else ready_at end where id = a.id;
  insert into public.garage_progress (assignment_id, event, photos, note, access_id) values (a.id, p_event, ph, nt, ac.id);
  if p_event = 'ready' and l.visit_stage in ('picked_up','repair_doorstep') then
    update public.leads set visit_stage = 'ready', visit_stage_at = now() where id = l.id; stage_moved := true;
  end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Partner garage (' || g.name || ') ' || case p_event when 'received' then 'received the vehicle' when 'work_started' then 'started the work' else 'marked the vehicle ready for return' end
    || case when cardinality(ph) > 0 then ' with ' || cardinality(ph) || ' photo(s)' else '' end || case when stage_moved then '. Visit stage is now Ready' else '' end);
  insert into public.audit_log (action, details) values ('garage_' || p_event, jsonb_build_object('lead', l.ref, 'garage', g.id, 'access', ac.id, 'photos', cardinality(ph)));
  return jsonb_build_object('ok', true, 'status', target, 'lead_id', l.id, 'stage_moved', stage_moved);
end; $$;
revoke all on function public.garage_progress_set(uuid, uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.garage_progress_set(uuid, uuid, text, text[], text) to service_role;
