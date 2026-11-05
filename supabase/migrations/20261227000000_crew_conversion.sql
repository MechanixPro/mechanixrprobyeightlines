-- Crew conversion: clear booking steps, a Call now queue, required lost reasons, a conversion view.
-- Nothing new in the status list: the steps are worked out from the status, the first contact time and the booking ID.
-- Bodies are copied from the latest migrations (crm_log 20261110, crm_set_outcome 20261212, crm_queue 20261108 + 20261214, crm_leads_list / crm_my_leads / crm_web_leads 20261226)
-- with only what is named here changed. Old leads keep the reason they were lost with: nothing is rewritten.

-- ───────────────────────── 1. Lost reasons: one fixed list ─────────────────────────
-- The list the desk offers. "Other" needs a note of at least 5 characters (checked in crm_log and crm_set_outcome, where the note is).
create or replace function public.crm_lost_reasons() returns text[] language sql immutable as $$
  select array['Price too high','No answer (after 3 tries)','Wrong area','Bought elsewhere','Not now / later','Not a real enquiry','Other']
$$;
revoke all on function public.crm_lost_reasons() from public, anon;
grant execute on function public.crm_lost_reasons() to authenticated;

create or replace function public.crm_log(p_id uuid, p_kind text, p_body text default null, p_next_action timestamptz default null,
  p_status text default null, p_lost_reason text default null, p_disposition text default null, p_sub_disposition text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r text := public.crm_need_role(); l public.leads; body text := nullif(trim(p_body), '');
  rank_old int; rank_new int; new_status text; touched boolean;
  ranks constant text[] := array['new','contacted','quoted','payment_sent'];
begin
  perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_id for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('view_all_leads') or l.crm_owner = auth.uid() or l.crm_owner is null) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if p_kind not in ('call','whatsapp','note','status') then raise exception 'unknown action' using errcode = 'P0001'; end if;
  if public.crm_has_pii(body) or public.crm_has_pii(p_lost_reason) then
    raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001';
  end if;
  if body is not null and char_length(body) > 1000 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  if p_kind = 'note' and body is null and p_status is null and p_disposition is null then raise exception 'write the note first' using errcode = 'P0001'; end if;
  if l.crm_owner is null and r <> 'supervisor' then raise exception 'take the lead first' using errcode = 'P0001';
  elsif l.crm_owner is distinct from auth.uid() and not public.crm_can('view_all_leads') then raise exception 'this lead belongs to a colleague' using errcode = '42501';
  end if;
  if p_disposition is not null and not exists (select 1 from public.crm_dispositions where disposition = p_disposition and sub_disposition = coalesce(p_sub_disposition, sub_disposition) and active) then
    raise exception 'choose a disposition from the list' using errcode = 'P0001';
  end if;

  new_status := coalesce(nullif(p_status, ''), l.status);
  touched := p_kind in ('call','whatsapp') or (new_status is distinct from l.status);

  if new_status is distinct from l.status then
    if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already confirmed' using errcode = 'P0001'; end if;
    if new_status = 'lost' then
      if not (coalesce(p_lost_reason, '') = any (public.crm_lost_reasons())) then
        raise exception 'choose why the lead was lost' using errcode = 'P0001';
      end if;
      if p_lost_reason = 'Other' and char_length(coalesce(body, '')) < 5 then raise exception 'add a note of at least 5 characters to explain "Other"' using errcode = 'P0001'; end if;
    elsif new_status = any (ranks) then
      rank_old := array_position(ranks, l.status); rank_new := array_position(ranks, new_status);
      if l.status = 'lost' then
        if r <> 'supervisor' then raise exception 'only a supervisor can reopen a lost lead' using errcode = '42501'; end if;
      elsif rank_new < rank_old then raise exception 'a lead cannot move backwards' using errcode = 'P0001';
      end if;
    else
      raise exception 'agents cannot set that status; payment sets it' using errcode = 'P0001';
    end if;
  end if;

  if new_status in ('new','contacted','quoted','payment_sent') and (p_kind <> 'note' or new_status is distinct from l.status) then
    if p_next_action is null then raise exception 'set the next follow-up before saving' using errcode = 'P0001'; end if;
    if p_next_action < now() - interval '5 minutes' then raise exception 'the follow-up must be in the future' using errcode = 'P0001'; end if;
    if p_next_action > now() + interval '60 days' then raise exception 'pick a follow-up within 60 days' using errcode = 'P0001'; end if;
  end if;

  update public.leads set
    status = new_status,
    crm_next_action_at = case when new_status = 'lost' then null when p_next_action is not null then p_next_action else crm_next_action_at end,
    crm_lost_reason = case when new_status = 'lost' then p_lost_reason when new_status is distinct from l.status then null else crm_lost_reason end,
    crm_first_contact_at = case when touched and crm_first_contact_at is null then now() else crm_first_contact_at end,
    disposition = coalesce(p_disposition, disposition),
    sub_disposition = case when p_disposition is not null then p_sub_disposition else sub_disposition end
  where id = p_id;

  insert into public.crm_activities (lead_id, actor, kind, body, status_to)
    values (p_id, auth.uid(), case when new_status is distinct from l.status and p_kind = 'note' then 'status' else p_kind end,
      concat_ws(' · ', case when new_status = 'lost' then 'Lost: ' || p_lost_reason end,
        case when p_disposition is not null then 'Disposition: ' || p_disposition || coalesce(' / ' || p_sub_disposition, '') end, body,
        case when p_next_action is not null then 'Next: ' || to_char(p_next_action at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') end),
      case when new_status is distinct from l.status then new_status end);
end; $$;
revoke all on function public.crm_log(uuid, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public.crm_log(uuid, text, text, timestamptz, text, text, text, text) to authenticated;

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
    if not (coalesce(p_lost_reason, '') = any (public.crm_lost_reasons())) then raise exception 'choose why the lead was lost' using errcode = 'P0001'; end if;
    if p_lost_reason = 'Other' and char_length(coalesce(body, '')) < 5 then raise exception 'add a note of at least 5 characters to explain "Other"' using errcode = 'P0001'; end if;
    update public.leads set status = 'lost', crm_next_action_at = null, crm_lost_reason = p_lost_reason, crm_first_contact_at = coalesce(crm_first_contact_at, now()) where id = p_id;
    insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_id, auth.uid(), 'status', concat_ws(' · ', 'Lost: ' || p_lost_reason, body), 'lost');
  end if;
end; $$;
revoke all on function public.crm_set_outcome(uuid, text, text, text) from public;
grant execute on function public.crm_set_outcome(uuid, text, text, text) to authenticated;

-- Any other way of closing a lead as lost (the admin panel writes the table directly) must carry a reason from the list too.
-- Restoring a junk lead that was lost keeps its old reason, so that move is let through.
create or replace function public.leads_lost_reason_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'lost' and old.status is distinct from 'lost' and old.status is distinct from 'junk'
     and not (coalesce(new.crm_lost_reason, '') = any (public.crm_lost_reasons())) then
    raise exception 'choose why the lead was lost' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists leads_lost_reason_guard_tr on public.leads;
create trigger leads_lost_reason_guard_tr before update of status on public.leads for each row execute function public.leads_lost_reason_guard();

-- ───────────────────────── 2. Call now queue ─────────────────────────
-- Open leads nobody has contacted yet (no call or message logged), oldest first. Website leads are included: they are the ones that sat unanswered.
-- Junk, lost, booked and confirmed leads are left out. Agents see their own and unassigned leads; people who see all leads see everyone's.
create or replace function public.crm_call_queue() returns table (id uuid, name text, phone text, area text, bike text, service_name text, source text, utm_source text,
  vehicle text, status text, crm_owner uuid, owner_name text, created_at timestamptz, crm_first_contact_at timestamptz, booking_id text, wait_minutes integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  return query
  select l.id, l.name, l.phone, l.area, nullif(trim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), ''), s.name, l.source, l.utm ->> 'utm_source',
    l.vehicle, l.status, l.crm_owner, public.crm_name(l.crm_owner), l.created_at, l.crm_first_contact_at, l.booking_id,
    greatest(0, floor(extract(epoch from (now() - l.created_at)) / 60))::integer
  from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent') and l.booking_id is null and l.crm_first_contact_at is null
    and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
  order by l.created_at asc limit 300;
end; $$;
revoke all on function public.crm_call_queue() from public, anon;
grant execute on function public.crm_call_queue() to authenticated;

-- ───────────────────────── 3. Conversion view ─────────────────────────
-- One row per lead in the dates (India time), junk and deleted left out, for the people the caller may see. The desk adds the rows up (crm/crm-rules.js conversionReport).
create or replace function public.crm_conversion_rows(p_from date default null, p_to date default null)
returns table (id uuid, created_at timestamptz, crm_first_contact_at timestamptz, status text, booking_id text, vehicle text, source text, platform text, crm_lost_reason text, crm_owner uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('dashboard');
  return query
  select l.id, l.created_at, l.crm_first_contact_at, l.status, l.booking_id, l.vehicle, l.source, coalesce(nullif(l.utm ->> 'utm_source', ''), l.source), l.crm_lost_reason, l.crm_owner
  from public.leads l
  where l.deleted_at is null and l.status <> 'junk'
    and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
    and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
    and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
  order by l.created_at desc limit 5000;
end; $$;
revoke all on function public.crm_conversion_rows(date, date) from public, anon;
grant execute on function public.crm_conversion_rows(date, date) to authenticated;

-- ───────────────────────── 4. Mark done (admin only) ─────────────────────────
-- The last step of a booking. Only a scheduled booking that has its ID. The completion time and the won time are set by the existing triggers.
create or replace function public.crm_mark_done(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'only an admin can mark a job done' using errcode = '42501'; end if;
  select * into l from public.leads where id = p_id and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.status = 'completed' then return; end if;
  if l.status <> 'scheduled' or l.booking_id is null then raise exception 'schedule the job before marking it done' using errcode = 'P0001'; end if;
  update public.leads set status = 'completed' where id = p_id;
  insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_id, auth.uid(), 'status', 'Marked done', 'completed');
end; $$;
revoke all on function public.crm_mark_done(uuid) from public, anon;
grant execute on function public.crm_mark_done(uuid) to authenticated;

-- ───────────────────────── 5. Lists return what the step bar needs ─────────────────────────
-- Same columns as before plus booking_id and vehicle (My day) or first_contact_at (Leads, Web leads).
drop function if exists public.crm_queue(text, text);
create or replace function public.crm_queue(p_view text default 'mine', p_search text default null)
returns table (id uuid, ref text, name text, phone text, area text, bike text, service_name text, source text, campaign text, utm_source text,
  status text, crm_owner uuid, owner_name text, est_total integer, notes text, preferred_date date, preferred_slot text, created_at timestamptz,
  crm_next_action_at timestamptz, crm_first_contact_at timestamptz, crm_lost_reason text, crm_won_at timestamptz, is_late boolean, overdue boolean, booking_id text, vehicle text)
language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); sla int; q text := nullif(trim(p_search), '');
begin
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes';
  sla := coalesce(sla, 15);
  if p_view = 'all' and r <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  return query
  select l.id, l.ref, l.name, l.phone, l.area, nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), s.name, l.source,
         l.utm ->> 'utm_campaign', l.utm ->> 'utm_source', l.status, l.crm_owner, public.crm_name(l.crm_owner), l.est_total, l.notes, l.preferred_date,
         l.preferred_slot, l.created_at, l.crm_next_action_at, l.crm_first_contact_at, l.crm_lost_reason, l.crm_won_at,
         (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
         (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')),
         l.booking_id, l.vehicle
  from public.crm_desk_leads l
  left join public.bikes b on b.id = l.bike_id
  left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%')
    and case p_view
      when 'mine'       then l.crm_owner = auth.uid() and l.status in ('new','contacted','quoted','payment_sent')
      when 'unassigned' then l.crm_owner is null and l.status = 'new'
      when 'won'        then l.crm_owner = auth.uid() and l.status in ('paid','scheduled','completed')
      when 'lost'       then l.crm_owner = auth.uid() and l.status = 'lost'
      when 'all'        then true
      else false end
  order by
    case when p_view in ('mine','unassigned','all') then
      case when l.crm_first_contact_at is null and l.status = 'new' then 0
           when l.crm_next_action_at is not null and l.crm_next_action_at < now() then 1 else 2 end
    else 0 end,
    case when p_view in ('mine','unassigned','all') then coalesce(l.crm_next_action_at, l.created_at) else l.created_at end,
    l.created_at desc
  limit 300;
end; $$;

drop function if exists public.crm_leads_list(text, text, uuid, date, date, integer, text);
create or replace function public.crm_leads_list(p_filter text default 'all', p_search text default null, p_owner uuid default null,
  p_from date default null, p_to date default null, p_limit integer default 500, p_vehicle text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text, vehicle text, first_contact_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), ''); sla int; allv boolean;
begin
  perform public.crm_need_role(); perform public.crm_require('view_all_leads');
  -- view_all_leads is required for the full table; people without it use crm_my_leads (own and unassigned only)
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return query
  select l.id, l.ref, l.name, l.phone, l.source, coalesce(nullif(l.utm ->> 'utm_source', ''), l.source), l.status, l.crm_owner, public.crm_name(l.crm_owner), l.disposition, l.sub_disposition,
    l.crm_next_action_at, l.created_at, greatest(l.updated_at, (select max(a.created_at) from public.crm_activities a where a.lead_id = l.id)),
    l.area, nullif(trim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), ''), s.name, l.est_total,
    (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id, l.vehicle, l.crm_first_contact_at
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    and (p_filter = 'junk') = (l.status = 'junk')
    and (p_owner is null or l.crm_owner = p_owner)
    and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
    and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
    and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
    and case p_filter
      when 'all' then true
      when 'mine' then l.crm_owner = auth.uid()
      when 'unassigned' then l.crm_owner is null
      when 'new' then l.status = 'new'
      when 'followups' then l.crm_next_action_at is not null and l.crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and l.status in ('new','contacted','quoted','payment_sent')
      when 'converted' then l.status in ('paid','scheduled','completed')
      when 'won' then l.status = 'completed'
      when 'lost' then l.status = 'lost'
      when 'junk' then l.status = 'junk'
      else false end
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end; $$;

drop function if exists public.crm_my_leads(text, text, text);
create or replace function public.crm_my_leads(p_filter text default 'mine', p_search text default null, p_vehicle text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text, vehicle text, first_contact_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), ''); sla int;
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return query
  select l.id, l.ref, l.name, l.phone, l.source, coalesce(nullif(l.utm ->> 'utm_source', ''), l.source), l.status, l.crm_owner, public.crm_name(l.crm_owner), l.disposition, l.sub_disposition,
    l.crm_next_action_at, l.created_at, greatest(l.updated_at, (select max(a.created_at) from public.crm_activities a where a.lead_id = l.id)),
    l.area, nullif(trim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), ''), s.name, l.est_total,
    (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id, l.vehicle, l.crm_first_contact_at
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null and (l.crm_owner = auth.uid() or l.crm_owner is null)
    and (p_filter = 'junk') = (l.status = 'junk')
    and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    and case p_filter
      when 'mine' then l.crm_owner = auth.uid() and l.status in ('new','contacted','quoted','payment_sent')
      when 'unassigned' then l.crm_owner is null
      when 'followups' then l.crm_owner = auth.uid() and l.crm_next_action_at is not null and l.crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and l.status in ('new','contacted','quoted','payment_sent')
      when 'converted' then l.crm_owner = auth.uid() and l.status in ('paid','scheduled','completed')
      when 'won' then l.crm_owner = auth.uid() and l.status = 'completed'
      when 'lost' then l.crm_owner = auth.uid() and l.status = 'lost'
      when 'junk' then l.crm_owner = auth.uid() and l.status = 'junk'
      when 'all' then true
      else false end
  order by l.created_at desc limit 500;
end; $$;

create or replace function public.crm_web_leads(p_filter text default 'open', p_search text default null, p_vehicle text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role();
  if not (public.crm_can('take_leads') or public.crm_can('view_all_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at') desc) from (
    select jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'vehicle', l.vehicle, 'name', l.name, 'phone', l.phone, 'area', l.area, 'service', s.name, 'status', l.status, 'first_contact_at', l.crm_first_contact_at,
      'est_total', l.est_total, 'created_at', l.created_at, 'owner', public.crm_name(l.crm_owner), 'owner_id', l.crm_owner,
      'when', nullif(concat_ws(' ', l.preferred_date::text, l.preferred_slot), '')) as x
    from public.leads l left join public.services s on s.id = l.service_id
    where l.source = 'website' and l.deleted_at is null
      and (case when coalesce(p_filter, 'open') = 'open' then l.status in ('new','contacted','quoted','payment_sent') when p_filter = 'junk' then l.status = 'junk' else l.status <> 'junk' end)
      and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
      and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
      and (q is null or l.name ilike '%' || q || '%' or l.phone ilike '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    order by l.created_at desc limit 300) t), '[]'::jsonb);
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_queue(text,text)','crm_leads_list(text,text,uuid,date,date,integer,text)','crm_my_leads(text,text,text)','crm_web_leads(text,text,text)']) loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
