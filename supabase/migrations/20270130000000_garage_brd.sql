-- Garage app, from the client's BRD: a 15 minute accept window, Decline with a reason, cancel requests, a receiving checklist with odometer and damage, announcements,
-- a view-only profile, a performance summary, bank and working-hours change requests, and a view-only mode for a suspended garage. Additive and idempotent.
-- Money rules the BRD leaves undecided (penalty amounts, per-garage commission, inspection fee) are NOT built here: declines and cancel requests are counted and shown, nothing is charged.
-- Rollback: drop the functions and tables created below, drop the added columns on garage_assignments, and re-run garage_session_check from 20270101000000_garage_app.sql and garage_live_leads from 20270122000000_live_leads.sql.

-- 1. Offers: expire after 15 minutes, can be declined with a reason, can be cancel-requested after accepting.
alter table public.garage_assignments add column if not exists offer_expires_at timestamptz default (now() + interval '15 minutes');
alter table public.garage_assignments add column if not exists cancel_kind text check (cancel_kind in ('declined', 'expired', 'garage_cancelled', 'desk'));
alter table public.garage_assignments add column if not exists cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200);
alter table public.garage_assignments add column if not exists cancelled_at timestamptz;

create table if not exists public.garage_cancel_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.garage_assignments(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  garage_id uuid not null references public.garages(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid, decided_at timestamptz, decision_note text check (decision_note is null or char_length(decision_note) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists garage_cancel_one_pending on public.garage_cancel_requests (assignment_id) where status = 'pending';
alter table public.garage_cancel_requests enable row level security;
revoke all on public.garage_cancel_requests from public, anon, authenticated;

create table if not exists public.garage_change_requests (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references public.garages(id) on delete cascade,
  kind text not null check (kind in ('bank', 'hours')),
  details jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(reason) between 5 and 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid, decided_at timestamptz, decision_note text check (decision_note is null or char_length(decision_note) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists garage_change_one_pending on public.garage_change_requests (garage_id, kind) where status = 'pending';
alter table public.garage_change_requests enable row level security;
revoke all on public.garage_change_requests from public, anon, authenticated;

-- Decline an offer that has not been accepted. The reason is required. Returns how many declines this garage has made this week (the first one is the free one).
create or replace function public.garage_decline(p_access uuid, p_assignment uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; r text := btrim(coalesce(p_reason, '')); n int;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into g from public.garages where id = ac.garage_id and deleted_at is null;
  if g.status = 'paused' or g.ops_state = 'suspended' then return jsonb_build_object('ok', false, 'error', 'Your account is suspended. You can view past jobs but not make changes.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if a.status <> 'sent' then return jsonb_build_object('ok', false, 'error', 'This job is already accepted or closed.'); end if;
  if char_length(r) < 5 or char_length(r) > 200 then return jsonb_build_object('ok', false, 'error', 'Tell us why, in 5 to 200 characters.'); end if;
  if public.crm_has_pii(r) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the reason.'); end if;
  update public.garage_assignments set status = 'cancelled', cancel_kind = 'declined', cancel_reason = r, cancelled_at = now(), updated_at = now() where id = a.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (a.lead_id, null, 'assign', 'Garage ' || g.name || ' declined the job: ' || r || '. It is back with Dispatch.');
  insert into public.audit_log (actor, action, details) values (null, 'garage_declined', jsonb_build_object('garage', g.id, 'assignment', a.id));
  select count(*) into n from public.garage_assignments where garage_id = g.id and cancel_kind = 'declined' and cancelled_at >= now() - interval '7 days';
  return jsonb_build_object('ok', true, 'declined_this_week', n, 'free_used', n > 1);
end $$;

-- Offers nobody accepted within the window go back to Dispatch (called by the desk automation every few minutes).
create or replace function public.garage_offers_expire() returns int language plpgsql security definer set search_path = public as $$
declare x record; n int := 0;
begin
  for x in select a.id, a.lead_id, g.name from public.garage_assignments a join public.garages g on g.id = a.garage_id
            where a.status = 'sent' and a.offer_expires_at is not null and a.offer_expires_at < now() for update of a skip locked loop
    update public.garage_assignments set status = 'cancelled', cancel_kind = 'expired', cancel_reason = 'Not accepted in 15 minutes', cancelled_at = now(), updated_at = now() where id = x.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (x.lead_id, null, 'assign', 'Garage ' || x.name || ' did not accept within 15 minutes. The job is back with Dispatch.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- After accepting, a garage can only ASK to cancel. The desk approves or declines.
create or replace function public.garage_cancel_request(p_access uuid, p_assignment uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; r text := btrim(coalesce(p_reason, ''));
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into g from public.garages where id = ac.garage_id and deleted_at is null;
  if g.status = 'paused' or g.ops_state = 'suspended' then return jsonb_build_object('ok', false, 'error', 'Your account is suspended. You can view past jobs but not make changes.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if a.status not in ('received', 'in_work') then return jsonb_build_object('ok', false, 'error', 'A cancel request is for a job you have accepted and not finished.'); end if;
  if char_length(r) < 5 or char_length(r) > 200 then return jsonb_build_object('ok', false, 'error', 'Tell us why, in 5 to 200 characters.'); end if;
  if public.crm_has_pii(r) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the reason.'); end if;
  if exists (select 1 from public.garage_cancel_requests where assignment_id = a.id and status = 'pending') then return jsonb_build_object('ok', false, 'error', 'You already asked. The team will reply.'); end if;
  insert into public.garage_cancel_requests (assignment_id, lead_id, garage_id, reason) values (a.id, a.lead_id, g.id, r);
  insert into public.crm_activities (lead_id, actor, kind, body) values (a.lead_id, null, 'note', 'Garage ' || g.name || ' asked to cancel: ' || r);
  return jsonb_build_object('ok', true);
end $$;

-- Bank details and working hours: the garage asks, the desk approves. A bank request carries no numbers (the team takes the documents on WhatsApp).
create or replace function public.garage_change_request(p_access uuid, p_kind text, p_details jsonb, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare ac public.garage_access; g public.garages; r text := btrim(coalesce(p_reason, '')); d jsonb := '{}'::jsonb; od text; ot text; ct text;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into g from public.garages where id = ac.garage_id and deleted_at is null;
  if g.status = 'paused' or g.ops_state = 'suspended' then return jsonb_build_object('ok', false, 'error', 'Your account is suspended. You can view past jobs but not make changes.'); end if;
  if p_kind not in ('bank', 'hours') then return jsonb_build_object('ok', false, 'error', 'Choose bank details or working hours.'); end if;
  if char_length(r) < 5 or char_length(r) > 200 then return jsonb_build_object('ok', false, 'error', 'Tell us why, in 5 to 200 characters.'); end if;
  if public.crm_has_pii(r) then return jsonb_build_object('ok', false, 'error', 'Do not type account or ID numbers here. The team will ask for the documents on WhatsApp.'); end if;
  if p_kind = 'hours' then
    od := left(btrim(coalesce(p_details ->> 'open_days', '')), 40); ot := coalesce(p_details ->> 'open_time', ''); ct := coalesce(p_details ->> 'close_time', '');
    if od = '' or ot !~ '^[0-2][0-9]:[0-5][0-9]$' or ct !~ '^[0-2][0-9]:[0-5][0-9]$' or ot >= ct then return jsonb_build_object('ok', false, 'error', 'Give the days and an opening time before the closing time.'); end if;
    d := jsonb_build_object('open_days', od, 'open_time', ot, 'close_time', ct);
  end if;
  if exists (select 1 from public.garage_change_requests where garage_id = g.id and kind = p_kind and status = 'pending') then return jsonb_build_object('ok', false, 'error', 'You already have this request open. The team will reply.'); end if;
  insert into public.garage_change_requests (garage_id, kind, details, reason) values (g.id, p_kind, d, r);
  insert into public.audit_log (actor, action, details) values (null, 'garage_change_requested', jsonb_build_object('garage', g.id, 'kind', p_kind));
  return jsonb_build_object('ok', true);
end $$;

-- The garage's own requests, newest first.
create or replace function public.garage_requests_mine(p_garage uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select 'change'::text as type, c.kind, c.status, c.reason, c.decision_note as note, c.created_at from public.garage_change_requests c where c.garage_id = p_garage
    union all
    select 'cancel', 'cancel', q.status, q.reason, q.decision_note, q.created_at from public.garage_cancel_requests q where q.garage_id = p_garage
    order by created_at desc limit 12) x;
$$;

-- 2. Receiving checklist: condition, damage, odometer. Required before the garage goes on to the code and inspection.
create table if not exists public.garage_receiving (
  assignment_id uuid primary key references public.garage_assignments(id) on delete cascade,
  odometer_km integer not null check (odometer_km between 0 and 999999),
  checks jsonb not null default '{}'::jsonb,
  damage text check (damage is null or char_length(damage) <= 300),
  photos text[] not null default '{}',
  at timestamptz not null default now()
);
alter table public.garage_receiving enable row level security;
revoke all on public.garage_receiving from public, anon, authenticated;

create or replace function public.garage_receiving_save(p_access uuid, p_assignment uuid, p_odometer int, p_checks jsonb, p_damage text, p_photos text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; dm text := nullif(btrim(coalesce(p_damage, '')), ''); ph text[] := coalesce(p_photos, '{}'); p text; k text; v text; clean jsonb := '{}'::jsonb;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into g from public.garages where id = ac.garage_id and deleted_at is null;
  if g.status = 'paused' or g.ops_state = 'suspended' then return jsonb_build_object('ok', false, 'error', 'Your account is suspended. You can view past jobs but not make changes.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id;
  if not found or a.status not in ('received', 'in_work') then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if p_odometer is null or p_odometer < 0 or p_odometer > 999999 then return jsonb_build_object('ok', false, 'error', 'Enter the odometer reading in kilometres.'); end if;
  if dm is not null and (char_length(dm) > 300 or public.crm_has_pii(dm)) then return jsonb_build_object('ok', false, 'error', 'Keep the damage note short and without ID or bank numbers.'); end if;
  if jsonb_typeof(coalesce(p_checks, 'null'::jsonb)) <> 'object' then return jsonb_build_object('ok', false, 'error', 'Answer the checklist.'); end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p_checks) loop
    if k not in ('body', 'lights', 'tyres', 'fuel', 'accessories') or v not in ('ok', 'issue') then return jsonb_build_object('ok', false, 'error', 'Answer the checklist.'); end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  if (select count(*) from jsonb_object_keys(clean)) < 5 then return jsonb_build_object('ok', false, 'error', 'Answer every point on the checklist.'); end if;
  if cardinality(ph) < 1 or cardinality(ph) > 6 then return jsonb_build_object('ok', false, 'error', 'Add 1 to 6 photos of the vehicle as received.'); end if;
  foreach p in array ph loop
    if p not like g.id::text || '/' || a.id::text || '/%' then return jsonb_build_object('ok', false, 'error', 'A photo is not valid. Take it again.'); end if;
  end loop;
  insert into public.garage_receiving (assignment_id, odometer_km, checks, damage, photos) values (a.id, p_odometer, clean, dm, ph)
    on conflict (assignment_id) do update set odometer_km = excluded.odometer_km, checks = excluded.checks, damage = excluded.damage, photos = excluded.photos, at = now();
  insert into public.crm_activities (lead_id, actor, kind, body) values (a.lead_id, null, 'note', 'Garage ' || g.name || ' recorded the receiving checklist: ' || p_odometer || ' km' || case when dm is not null then ', damage noted' else '' end || '.');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.garage_receiving_get(p_assignment uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('done', true, 'odometer_km', odometer_km, 'checks', checks, 'damage', damage, 'at', at) from public.garage_receiving where assignment_id = p_assignment), jsonb_build_object('done', false));
$$;

-- 3. Announcements from the team to every partner garage.
create table if not exists public.garage_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 3 and 600),
  kind text not null default 'info' check (kind in ('info', 'policy', 'alert')),
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);
create table if not exists public.garage_announcement_reads (
  announcement_id uuid not null references public.garage_announcements(id) on delete cascade,
  garage_id uuid not null references public.garages(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (announcement_id, garage_id)
);
alter table public.garage_announcements enable row level security; alter table public.garage_announcement_reads enable row level security;
revoke all on public.garage_announcements, public.garage_announcement_reads from public, anon, authenticated;

create or replace function public.crm_announcement_save(p_title text, p_body text, p_kind text default 'info', p_days int default 30) returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := btrim(coalesce(p_title, '')); b text := btrim(coalesce(p_body, '')); nid uuid;
begin
  perform public.garage_staff_need();
  if char_length(t) < 3 or char_length(t) > 80 then raise exception 'the title must be 3 to 80 characters' using errcode = 'P0001'; end if;
  if char_length(b) < 3 or char_length(b) > 600 then raise exception 'the message must be 3 to 600 characters' using errcode = 'P0001'; end if;
  if p_kind not in ('info', 'policy', 'alert') then raise exception 'choose info, policy or alert' using errcode = 'P0001'; end if;
  if public.crm_has_pii(b) or public.crm_has_pii(t) then raise exception 'remove ID, bank or card numbers' using errcode = 'P0001'; end if;
  insert into public.garage_announcements (title, body, kind, expires_at, created_by) values (t, b, p_kind, now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))), auth.uid()) returning id into nid;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_announcement', jsonb_build_object('id', nid, 'kind', p_kind));
  return jsonb_build_object('ok', true, 'id', nid);
end $$;
create or replace function public.crm_announcement_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'kind', a.kind, 'active', a.active and (a.expires_at is null or a.expires_at > now()), 'created_at', a.created_at, 'expires_at', a.expires_at,
    'read', (select count(*) from public.garage_announcement_reads r where r.announcement_id = a.id)) order by a.created_at desc) from (select * from public.garage_announcements order by created_at desc limit 30) a), '[]'::jsonb);
end $$;
create or replace function public.crm_announcement_archive(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  update public.garage_announcements set active = false where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.garage_announcements_list(p_garage uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'kind', a.kind, 'at', a.created_at,
    'read', exists (select 1 from public.garage_announcement_reads r where r.announcement_id = a.id and r.garage_id = p_garage)) order by a.created_at desc), '[]'::jsonb)
    from (select * from public.garage_announcements where active and (expires_at is null or expires_at > now()) order by created_at desc limit 20) a;
$$;
create or replace function public.garage_announcement_read(p_garage uuid, p_id uuid) returns void language sql security definer set search_path = public as $$
  insert into public.garage_announcement_reads (announcement_id, garage_id) select p_id, p_garage where exists (select 1 from public.garage_announcements where id = p_id) on conflict do nothing;
$$;

-- 4. View-only profile and a performance summary (ratings are from the customers; counts only, nothing charged).
create or replace function public.garage_profile(p_garage uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', g.name, 'code', g.code, 'owner_name', g.owner_name, 'address', g.address, 'landmark', g.landmark, 'pincode', g.pincode, 'city', g.city, 'categories', g.categories, 'bays', g.bays,
    'open_days', g.open_days, 'open_time', g.open_time, 'close_time', g.close_time, 'status', g.status, 'suspended', (g.status = 'paused' or g.ops_state = 'suspended'))
    from public.garages g where g.id = p_garage and g.deleted_at is null;
$$;
create or replace function public.garage_performance(p_garage uuid) returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (select a.id, a.lead_id, a.status, a.cancel_kind, a.cancelled_at, a.returned_at from public.garage_assignments a where a.garage_id = p_garage),
       rt as (select r.rating from public.lead_ratings r where r.lead_id in (select lead_id from mine where status in ('ready', 'returned')))
  select jsonb_build_object(
    'rating_avg', (select round(avg(rating)::numeric, 1) from rt), 'rating_count', (select count(*) from rt),
    'completed_month', (select count(*) from mine where status in ('ready', 'returned') and coalesce(returned_at, now()) >= date_trunc('month', now())),
    'declined_week', (select count(*) from mine where cancel_kind = 'declined' and cancelled_at >= now() - interval '7 days'),
    'declined_month', (select count(*) from mine where cancel_kind = 'declined' and cancelled_at >= date_trunc('month', now())),
    'expired_month', (select count(*) from mine where cancel_kind = 'expired' and cancelled_at >= date_trunc('month', now())),
    'cancelled_month', (select count(*) from mine where cancel_kind = 'garage_cancelled' and cancelled_at >= date_trunc('month', now())),
    'complaints_open', (select count(*) from public.booking_issues i where i.lead_id in (select lead_id from mine) and i.status = 'open'),
    'complaints_month', (select count(*) from public.booking_issues i where i.lead_id in (select lead_id from mine) and i.created_at >= date_trunc('month', now())));
$$;

-- 5. The desk: one queue for cancel requests and change requests, and the decisions.
create or replace function public.crm_garage_requests_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select 'cancel'::text as type, q.id, g.name as garage, q.reason, null::jsonb as details, q.status, q.created_at, l.booking_id as ref
      from public.garage_cancel_requests q join public.garages g on g.id = q.garage_id join public.leads l on l.id = q.lead_id where q.status = 'pending' or q.decided_at >= now() - interval '14 days'
    union all
    select c.kind, c.id, g.name, c.reason, c.details, c.status, c.created_at, null
      from public.garage_change_requests c join public.garages g on g.id = c.garage_id where c.status = 'pending' or c.decided_at >= now() - interval '14 days'
    limit 60) x), '[]'::jsonb);
end $$;
create or replace function public.crm_garage_request_decide(p_type text, p_id uuid, p_decision text, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := nullif(btrim(coalesce(p_note, '')), ''); q public.garage_cancel_requests; c public.garage_change_requests; a public.garage_assignments;
begin
  perform public.garage_staff_need();
  if p_decision not in ('approved', 'declined') then raise exception 'choose approve or decline' using errcode = '22023'; end if;
  if p_decision = 'declined' and n is null then raise exception 'say why' using errcode = '22023'; end if;
  if n is not null and (char_length(n) > 200 or public.crm_has_pii(n)) then raise exception 'keep the note short, without ID or bank numbers' using errcode = '22023'; end if;
  if p_type = 'cancel' then
    select * into q from public.garage_cancel_requests where id = p_id for update;
    if not found or q.status <> 'pending' then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.garage_cancel_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = n where id = p_id;
    if p_decision = 'approved' then
      select * into a from public.garage_assignments where id = q.assignment_id for update;
      if found and a.status in ('received', 'in_work') then
        update public.garage_assignments set status = 'cancelled', cancel_kind = 'garage_cancelled', cancel_reason = q.reason, cancelled_at = now(), updated_at = now() where id = a.id;
        insert into public.crm_activities (lead_id, actor, kind, body) values (q.lead_id, auth.uid(), 'assign', 'Garage cancel request approved. The job is back with Dispatch.');
      end if;
    else
      insert into public.crm_activities (lead_id, actor, kind, body) values (q.lead_id, auth.uid(), 'note', 'Garage cancel request declined: ' || n);
    end if;
  elsif p_type in ('bank', 'hours') then
    select * into c from public.garage_change_requests where id = p_id and kind = p_type for update;
    if not found or c.status <> 'pending' then raise exception 'not found' using errcode = 'P0002'; end if;
    update public.garage_change_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = n where id = p_id;
    if p_decision = 'approved' and p_type = 'hours' then
      update public.garages set open_days = c.details ->> 'open_days', open_time = c.details ->> 'open_time', close_time = c.details ->> 'close_time' where id = c.garage_id;
    end if;
  else raise exception 'unknown request' using errcode = '22023'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_request_' || p_decision, jsonb_build_object('type', p_type, 'id', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- 6. Grants. Garage functions are for the service role (the garage-app function checks the session first); the desk functions check the staff role themselves.
revoke all on function public.garage_decline(uuid, uuid, text), public.garage_offers_expire(), public.garage_cancel_request(uuid, uuid, text), public.garage_change_request(uuid, text, jsonb, text), public.garage_requests_mine(uuid),
  public.garage_receiving_save(uuid, uuid, int, jsonb, text, text[]), public.garage_receiving_get(uuid), public.garage_announcements_list(uuid), public.garage_announcement_read(uuid, uuid), public.garage_profile(uuid), public.garage_performance(uuid) from public, anon, authenticated;
grant execute on function public.garage_decline(uuid, uuid, text), public.garage_offers_expire(), public.garage_cancel_request(uuid, uuid, text), public.garage_change_request(uuid, text, jsonb, text), public.garage_requests_mine(uuid),
  public.garage_receiving_save(uuid, uuid, int, jsonb, text, text[]), public.garage_receiving_get(uuid), public.garage_announcements_list(uuid), public.garage_announcement_read(uuid, uuid), public.garage_profile(uuid), public.garage_performance(uuid) to service_role;
revoke all on function public.crm_announcement_save(text, text, text, int), public.crm_announcement_list(), public.crm_announcement_archive(uuid), public.crm_garage_requests_list(), public.crm_garage_request_decide(text, uuid, text, text) from public, anon;
grant execute on function public.crm_announcement_save(text, text, text, int), public.crm_announcement_list(), public.crm_announcement_archive(uuid), public.crm_garage_requests_list(), public.crm_garage_request_decide(text, uuid, text, text) to authenticated;

-- 7. A suspended garage can sign in and look; the garage-app function refuses every change. A declined or expired job is not offered again to the same garage in Live leads.
create or replace function public.garage_session_check(p_access uuid, p_ver int) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.garage_access; g public.garages;
begin
  select * into a from public.garage_access where id = p_access;
  if not found or not a.active or a.revoked_at is not null or a.session_version <> p_ver then return jsonb_build_object('ok', false); end if;
  select * into g from public.garages where id = a.garage_id;
  if g.id is null or g.deleted_at is not null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'access_id', a.id, 'garage_id', a.garage_id, 'garage_name', g.name, 'label', a.label, 'suspended', (g.status = 'paused' or g.ops_state = 'suspended'));
end; $$;

create or replace function public.garage_live_leads(p_garage uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages; s jsonb; radius numeric; maxjobs int; openjobs int;
begin
  select * into g from public.garages where id = p_garage and deleted_at is null and status in ('live', 'pilot') and ops_state = 'active' and is_open;
  if not found then return jsonb_build_object('available', false, 'leads', '[]'::jsonb); end if;
  select value into s from public.settings where key = 'auto_assign_garage';
  radius := coalesce((s ->> 'radius_km')::numeric, 15); maxjobs := coalesce((s ->> 'max_open_jobs')::int, 3);
  select count(*) into openjobs from public.garage_assignments where garage_id = p_garage and status in ('sent', 'received', 'in_work', 'ready');
  if openjobs >= maxjobs then return jsonb_build_object('available', true, 'full', true, 'leads', '[]'::jsonb); end if;
  return jsonb_build_object('available', true, 'full', false, 'leads', coalesce((
    select jsonb_agg(x order by x.sort_at) from (
      select l.id as id, l.booking_id as ref, coalesce(sv.name, 'Bike service') as service, case when l.vehicle = 'car' then 'car' else 'bike' end as vehicle_type,
             nullif(btrim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), '') as model, l.area as area, l.pincode as pin,
             l.preferred_date as slot_date, l.preferred_slot as slot_part,
             public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) as distance_km,
             coalesce(l.preferred_date::timestamptz, l.created_at) as sort_at
        from public.leads l
        left join public.services sv on sv.id = l.service_id
        left join public.bikes b on b.id = l.bike_id
       where l.deleted_at is null and l.confirm_paid_at is not null and l.status in ('paid', 'scheduled') and l.mechanic_id is null
         and (l.preferred_date is null or l.preferred_date >= (now() at time zone 'Asia/Kolkata')::date)
         and not exists (select 1 from public.garage_assignments a where a.lead_id = l.id and a.status in ('sent', 'received', 'in_work', 'ready'))
         and not exists (select 1 from public.garage_assignments d where d.lead_id = l.id and d.garage_id = p_garage and d.cancel_kind in ('declined', 'expired'))
         and (
           (public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) is not null and public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) <= radius)
           or (public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) is null and g.pincode is not null and l.pincode = g.pincode)
         )
       limit 20
    ) x), '[]'::jsonb));
end $$;
