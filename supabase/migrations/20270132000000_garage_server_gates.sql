-- Server-side guards the review found missing: the 15 minute accept window and the receiving checklist are enforced in garage_progress_set, and the Requests list can no longer drop waiting requests.
-- Additive: replaces two functions with the same signatures. Rollback: re-run garage_progress_set from 20270115000000_garage_code_gate.sql and crm_garage_requests_list from 20270130000000_garage_brd.sql.
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
  -- Server-side 15 minute accept window (the app countdown and the 3-minute sweep are not the only guard): a sent job past its deadline cannot be accepted.
  if p_event = 'received' and a.status = 'sent' and a.offer_expires_at is not null and a.offer_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'The 15 minutes to accept have passed. The job has gone back to Dispatch.');
  end if;
  if p_event = 'work_started' and a.status = 'sent' then return jsonb_build_object('ok', false, 'error', 'Mark Vehicle received first.'); end if;
  if p_event = 'ready' and a.status <> 'in_work' then return jsonb_build_object('ok', false, 'error', case when a.status = 'sent' then 'Mark Vehicle received first.' else 'Mark Work started first.' end); end if;
  -- The receiving checklist must be saved before work starts. Jobs the garage accepted before 10 Nov 2026 (India time) are not held to it.
  if p_event = 'work_started' and not exists (select 1 from public.garage_receiving r where r.assignment_id = a.id)
     and not (a.received_at is not null and a.received_at < timestamptz '2026-11-10 00:00:00+05:30') then
    return jsonb_build_object('ok', false, 'blocked', 'receiving', 'error', 'Fill in the receiving checklist first.');
  end if;
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
create or replace function public.crm_garage_requests_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  -- Pending first, then newest, and only then the 60-row cut, so waiting requests are never pushed out by old decided ones.
  return coalesce((select jsonb_agg(y order by (y.status = 'pending') desc, y.created_at desc) from (
    select * from (
      select 'cancel'::text as type, q.id, g.name as garage, q.reason, null::jsonb as details, q.status, q.created_at, l.booking_id as ref
        from public.garage_cancel_requests q join public.garages g on g.id = q.garage_id join public.leads l on l.id = q.lead_id where q.status = 'pending' or q.decided_at >= now() - interval '14 days'
      union all
      select c.kind, c.id, g.name, c.reason, c.details, c.status, c.created_at, null
        from public.garage_change_requests c join public.garages g on g.id = c.garage_id where c.status = 'pending' or c.decided_at >= now() - interval '14 days'
    ) u order by (u.status = 'pending') desc, u.created_at desc limit 60) y), '[]'::jsonb);
end $$;
-- Skipping KYC is recorded once: repeat taps do not add more "skipped" rows to the history.
create or replace function public.mechanic_kyc_skip(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.mechanics set kyc_skipped_at = now() where id = p_id and kyc_skipped_at is null;
  if found then insert into public.partner_onboarding_log (action, partner_kind, partner_id) values ('kyc_skipped', 'mechanic', p_id); end if;
end $$;
revoke all on function public.mechanic_kyc_skip(uuid) from public, anon, authenticated;
