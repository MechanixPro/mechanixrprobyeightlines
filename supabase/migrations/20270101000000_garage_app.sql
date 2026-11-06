-- Partner garage app: each garage opens a private link + PIN screen at /garage/ with the jobs sent to it. Design: docs/superpowers/specs/2026-11-06-partner-garage-app-design.md
-- Idempotent and safe to dry-run: create-if-not-exists, create-or-replace, on-conflict, drop-then-create for constraints, policies and triggers. Nothing here changes an old lead or garage.
-- Roll back (as the database owner, in this order):
--   drop trigger if exists leads_garage_sync_tr on public.leads; drop function if exists public.garage_lead_sync();
--   drop policy if exists garage_updates_desk_read on storage.objects; drop function if exists public.garage_photo_ok(text);
--   drop function if exists public.garage_login(text, text), public.garage_session_check(uuid, int), public.garage_progress_set(uuid, uuid, text, text[], text), public.garage_estimate_save(uuid, uuid, jsonb, text, int, date, boolean),
--     public.garage_contact_view(uuid, uuid), public.quote_is_approved(uuid), public.garage_staff_need(),
--     public.crm_garage_access_create(uuid, text, text), public.crm_garage_pin_reset(uuid, text), public.crm_garage_revoke(uuid), public.crm_garage_enable(uuid), public.crm_garage_link_new(uuid), public.crm_garage_access_list(uuid),
--     public.crm_garage_assign(uuid, uuid, text, timestamptz), public.crm_garage_assignments_list(text, uuid), public.crm_garage_estimates_inbox(text), public.crm_garage_estimate_review(uuid, boolean, text),
--     public.crm_garage_settlement_set(uuid, numeric, boolean, text);
--   drop table if exists public.garage_settlements, public.garage_estimates, public.garage_progress, public.garage_assignments, public.garage_access;
--   delete from storage.objects where bucket_id = 'garage-updates'; delete from storage.buckets where id = 'garage-updates';
--   (the two notification kinds widened below are harmless to old code; to narrow them re-run the constraint and notification_finish from 20261229000000.)

-- ───────────────────────── Notification kinds: team alerts when a garage sends an estimate or marks Ready ─────────────────────────
alter table public.booking_notifications drop constraint if exists booking_notifications_kind_check;
alter table public.booking_notifications add constraint booking_notifications_kind_check
  check (kind ~ '^(confirm_email|receipt_email|confirm_whatsapp|team_paid|team_link_unpaid|team_unassigned|quote_email|quote_whatsapp|team_quote_decision|eta_email|eta_whatsapp|ontheway_email|team_issue|team_garage_estimate|team_garage_ready)(:[0-9]{1,3})?$');

create or replace function public.notification_finish(p_lead uuid, p_kind text, p_status text, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
declare label text := case split_part(p_kind, ':', 1) when 'confirm_email' then 'Confirmation email' when 'receipt_email' then 'Fee receipt email' when 'confirm_whatsapp' then 'WhatsApp confirmation'
  when 'team_paid' then 'Team alert: paid booking' when 'quote_email' then 'Quote email' when 'quote_whatsapp' then 'Quote WhatsApp' when 'team_quote_decision' then 'Team alert: quote decision' when 'eta_email' then 'Delivery update email' when 'eta_whatsapp' then 'Delivery update WhatsApp'
  when 'team_link_unpaid' then 'Team alert: link unpaid' when 'team_unassigned' then 'Team alert: no mechanic' when 'ontheway_email' then 'On-the-way email' when 'team_issue' then 'Team alert: customer issue'
  when 'team_garage_estimate' then 'Team alert: garage estimate' when 'team_garage_ready' then 'Team alert: garage says ready' else p_kind end;
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status'; end if;
  update public.booking_notifications set status = p_status, error = left(p_error, 200), sent_at = case when p_status = 'sent' then now() else sent_at end where lead_id = p_lead and kind = p_kind;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'note', label || ' ' || p_status || coalesce(': ' || left(p_error, 120), ''));
end; $$;
revoke all on function public.notification_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_finish(uuid, text, text, text) to service_role;

-- ───────────────────────── Tables (closed to anon and signed-in users; only the functions below and the service role touch them) ─────────────────────────
-- One row per access. Today one per garage ('Owner'); more rows (staff PINs) can be added later with another label.
create table if not exists public.garage_access (
  id               uuid primary key default gen_random_uuid(),
  garage_id        uuid not null references public.garages(id) on delete cascade,
  label            text not null default 'Owner' check (char_length(label) between 1 and 40),
  link_hash        text not null unique,                                   -- SHA-256 of the private link token; the token is shown once, never stored
  pin_hash         text not null,                                          -- bcrypt (pgcrypto crypt) of the 4 to 6 digit PIN
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  active           boolean not null default true,
  revoked_at       timestamptz,
  session_version  int not null default 1,                                 -- raised on PIN reset, link change or switch-off: older sessions stop working
  last_login_at    timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create unique index if not exists garage_access_one_label on public.garage_access (garage_id, label) where revoked_at is null;

create table if not exists public.garage_assignments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  garage_id    uuid not null references public.garages(id) on delete restrict,
  status       text not null default 'sent' check (status in ('sent','received','in_work','ready','returned','cancelled')),
  eta          timestamptz,
  notes        text check (char_length(notes) <= 500),                      -- from Crew: work needed and what was found
  assigned_by  uuid,
  assigned_at  timestamptz not null default now(),
  received_at  timestamptz, started_at timestamptz, ready_at timestamptz, returned_at timestamptz,
  updated_at   timestamptz not null default now()
);
-- One active assignment per lead.
create unique index if not exists garage_assignments_one_open on public.garage_assignments (lead_id) where status in ('sent','received','in_work','ready');
create index if not exists garage_assignments_garage_idx on public.garage_assignments (garage_id, status, assigned_at desc);

create table if not exists public.garage_progress (
  id            bigserial primary key,
  assignment_id uuid not null references public.garage_assignments(id) on delete cascade,
  event         text not null check (event in ('received','work_started','ready')),
  photos        text[] not null default '{}',
  note          text check (char_length(note) <= 300),
  access_id     uuid references public.garage_access(id) on delete set null,
  at            timestamptz not null default now()
);
create index if not exists garage_progress_idx on public.garage_progress (assignment_id, at);

create table if not exists public.garage_estimates (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.garage_assignments(id) on delete cascade,
  lines               jsonb not null default '[]'::jsonb,                 -- [{kind: parts|labour|other, name, amount}] amounts before GST
  notes               text check (char_length(notes) <= 500),
  hours               int check (hours between 1 and 72),
  return_day          date,
  status              text not null default 'draft' check (status in ('draft','submitted','approved','rejected','converted')),
  submitted_at        timestamptz,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_note         text check (char_length(review_note) <= 300),
  converted_quote_id  uuid references public.job_quotes(id) on delete set null,
  created_at          timestamptz not null default now(),
  check (hours is null or return_day is null)
);
create unique index if not exists garage_estimates_one_open on public.garage_estimates (assignment_id) where status in ('draft','submitted');

create table if not exists public.garage_settlements (
  assignment_id uuid primary key references public.garage_assignments(id) on delete cascade,
  amount        numeric(12,2) not null check (amount between 0 and 1000000),   -- entered by Admin per job; nothing is computed
  settled       boolean not null default false,
  settled_at    timestamptz,
  note          text check (char_length(note) <= 200),
  entered_by    uuid,
  updated_at    timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['garage_access','garage_assignments','garage_progress','garage_estimates','garage_settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.garage_progress_id_seq from public, anon, authenticated;

-- Private bucket: images only, 1.5 MB each (the phone compresses). Uploads go through one-time signed URLs from the garage-app function. Path: <garage id>/<assignment id>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garage-updates', 'garage-updates', false, 1572864, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1572864, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- ───────────────────────── Shared helpers ─────────────────────────
-- Same rule as the quote gate trigger: the latest sent or approved quote must be approved.
create or replace function public.quote_is_approved(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select q.status = 'approved' from public.job_quotes q where q.lead_id = p_lead and q.status in ('sent','approved') order by q.version desc limit 1), false);
$$;
revoke all on function public.quote_is_approved(uuid) from public, anon, authenticated;
grant execute on function public.quote_is_approved(uuid) to service_role;

-- Staff who may manage garages: admin or Crew with the manage_garages action (supervisor preset). Agents and technicians are refused.
create or replace function public.garage_staff_need() returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public.flow_need();
  if not public.flow_can('manage_garages') then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
end; $$;
revoke all on function public.garage_staff_need() from public, anon, authenticated;

-- Crew and Admin read the photos through signed URLs, only for assignments of leads they may see.
create or replace function public.garage_photo_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select public.flow_role() is not null and public.flow_can('manage_garages') and exists (
    select 1 from public.garage_assignments a join public.leads l on l.id = a.lead_id
    where a.id::text = split_part(p_name, '/', 2) and a.garage_id::text = split_part(p_name, '/', 1) and public.crm_can_see(l, public.flow_role()));
$$;
revoke all on function public.garage_photo_ok(text) from public, anon;
grant execute on function public.garage_photo_ok(text) to authenticated;
drop policy if exists garage_updates_desk_read on storage.objects;
create policy garage_updates_desk_read on storage.objects for select to authenticated using (bucket_id = 'garage-updates' and public.garage_photo_ok(name));

-- A job leaves the garage's list when the vehicle is returned or the lead is closed.
create or replace function public.garage_lead_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visit_stage = 'returned' and new.visit_stage is distinct from old.visit_stage then
    update public.garage_assignments set status = 'returned', returned_at = now(), updated_at = now() where lead_id = new.id and status in ('sent','received','in_work','ready');
  end if;
  if new.status in ('lost','junk') and new.status is distinct from old.status then
    update public.garage_assignments set status = 'cancelled', updated_at = now() where lead_id = new.id and status in ('sent','received','in_work','ready');
  end if;
  return new;
end $$;
drop trigger if exists leads_garage_sync_tr on public.leads;
create trigger leads_garage_sync_tr after update of visit_stage, status on public.leads for each row execute function public.garage_lead_sync();

-- ───────────────────────── Functions for the garage-app Edge Function (service role only) ─────────────────────────
-- Login: link token + PIN. 5 wrong PINs lock the access for 15 minutes. Returns what the function needs to sign a session; never the hashes.
create or replace function public.garage_login(p_token text, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_access; g public.garages; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into a from public.garage_access where link_hash = h for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  select * into g from public.garages where id = a.garage_id;
  if not a.active or a.revoked_at is not null or g.id is null or g.deleted_at is not null or g.status = 'paused' then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if a.locked_until is not null and a.locked_until > now() then return jsonb_build_object('ok', false, 'error', 'locked', 'until', a.locked_until); end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' or extensions.crypt(p_pin, a.pin_hash) <> a.pin_hash then
    update public.garage_access set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end where id = a.id;
    insert into public.audit_log (action, details) values ('garage_login_failed', jsonb_build_object('garage', a.garage_id, 'access', a.id));
    if a.failed_attempts + 1 >= 5 then return jsonb_build_object('ok', false, 'error', 'locked', 'until', now() + interval '15 minutes'); end if;
    return jsonb_build_object('ok', false, 'error', 'pin', 'left', 5 - (a.failed_attempts + 1));
  end if;
  update public.garage_access set failed_attempts = 0, locked_until = null, last_login_at = now() where id = a.id;
  insert into public.audit_log (action, details) values ('garage_login', jsonb_build_object('garage', a.garage_id, 'access', a.id));
  return jsonb_build_object('ok', true, 'access_id', a.id, 'garage_id', a.garage_id, 'garage_name', g.name, 'label', a.label, 'session_version', a.session_version);
end; $$;
revoke all on function public.garage_login(text, text) from public, anon, authenticated;
grant execute on function public.garage_login(text, text) to service_role;

-- Every request re-checks the access: switched off, revoked, PIN reset or garage paused ends the session.
create or replace function public.garage_session_check(p_access uuid, p_ver int) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.garage_access; g public.garages;
begin
  select * into a from public.garage_access where id = p_access;
  if not found or not a.active or a.revoked_at is not null or a.session_version <> p_ver then return jsonb_build_object('ok', false); end if;
  select * into g from public.garages where id = a.garage_id;
  if g.id is null or g.deleted_at is not null or g.status = 'paused' then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'access_id', a.id, 'garage_id', a.garage_id, 'garage_name', g.name, 'label', a.label);
end; $$;
revoke all on function public.garage_session_check(uuid, int) from public, anon, authenticated;
grant execute on function public.garage_session_check(uuid, int) to service_role;

-- Progress: Vehicle received, Work started, Ready for return. Atomic; photos must already be uploaded under this garage and job.
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

-- Estimate: save a draft or submit it to the Crew/Admin inbox. Nothing reaches the customer from here.
create or replace function public.garage_estimate_save(p_access uuid, p_assignment uuid, p_lines jsonb, p_notes text, p_hours int, p_day date, p_submit boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; l public.leads; ln jsonb; k text; nm text; am numeric; sub numeric := 0; clean jsonb := '[]'::jsonb; nt text := public.crm_clean_text(p_notes, 500); eid uuid; cnt int; today date := (now() at time zone 'Asia/Kolkata')::date; st text;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if a.status not in ('received','in_work') then return jsonb_build_object('ok', false, 'error', case when a.status = 'sent' then 'Mark Vehicle received before you send an estimate.' else 'This job is closed.' end); end if;
  select * into g from public.garages where id = a.garage_id; select * into l from public.leads where id = a.lead_id;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then return jsonb_build_object('ok', false, 'error', 'Add at least one line.'); end if;
  if jsonb_array_length(p_lines) > 20 then return jsonb_build_object('ok', false, 'error', 'At most 20 lines.'); end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    k := ln ->> 'kind'; nm := btrim(coalesce(ln ->> 'name', ''));
    if k not in ('parts','labour','other') then return jsonb_build_object('ok', false, 'error', 'Each line is parts, labour or other.'); end if;
    if char_length(nm) < 2 or char_length(nm) > 80 then return jsonb_build_object('ok', false, 'error', 'Each line needs a name (2 to 80 characters).'); end if;
    if public.crm_has_pii(nm) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the line names.'); end if;
    begin am := (ln ->> 'amount')::numeric; exception when others then return jsonb_build_object('ok', false, 'error', 'Each line needs an amount.'); end;
    if am is null or am < 0 or am > 100000 then return jsonb_build_object('ok', false, 'error', 'Each amount must be from 0 to 1,00,000.'); end if;
    sub := sub + round(am, 2); clean := clean || jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2));
  end loop;
  if nt is not null and public.crm_has_pii(nt) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the notes.'); end if;
  if p_hours is not null and p_day is not null then return jsonb_build_object('ok', false, 'error', 'Give the estimated hours or a return day, not both.'); end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 72) then return jsonb_build_object('ok', false, 'error', 'Estimated hours must be from 1 to 72.'); end if;
  if p_day is not null and (p_day < today or p_day > today + 60) then return jsonb_build_object('ok', false, 'error', 'Pick a return day within the next 60 days.'); end if;
  if p_submit and p_hours is null and p_day is null then return jsonb_build_object('ok', false, 'error', 'Give the estimated hours or a return day.'); end if;
  select id, status into eid, st from public.garage_estimates where assignment_id = a.id and status in ('draft','submitted');
  if st = 'submitted' then return jsonb_build_object('ok', false, 'error', 'Your estimate is with the Mechanix Pro team for review.'); end if;
  if eid is null then
    insert into public.garage_estimates (assignment_id, lines, notes, hours, return_day) values (a.id, clean, nt, p_hours, p_day) returning id into eid;
  else
    update public.garage_estimates set lines = clean, notes = nt, hours = p_hours, return_day = p_day where id = eid;
  end if;
  if p_submit then
    update public.garage_estimates set status = 'submitted', submitted_at = now() where id = eid;
    select count(*) into cnt from public.garage_estimates where assignment_id = a.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Partner garage (' || g.name || ') sent a repair estimate: Rs ' || sub || ' before GST. Waiting for review');
    insert into public.audit_log (action, details) values ('garage_estimate_submitted', jsonb_build_object('lead', l.ref, 'garage', g.id, 'estimate', eid, 'subtotal', sub));
  end if;
  return jsonb_build_object('ok', true, 'id', eid, 'submitted', coalesce(p_submit, false), 'subtotal', sub, 'gst', round(sub * 0.18, 2), 'total', sub + round(sub * 0.18, 2), 'lead_id', l.id, 'n', cnt);
end; $$;
revoke all on function public.garage_estimate_save(uuid, uuid, jsonb, text, int, date, boolean) from public, anon, authenticated;
grant execute on function public.garage_estimate_save(uuid, uuid, jsonb, text, int, date, boolean) to service_role;

-- The garage opened a job detail that includes the customer's number: one history line and one audit row (no number in either), at most 40 per access per 10 minutes.
-- Returns false when the job is not open for this access or the limit is reached; the function then sends no number.
create or replace function public.garage_contact_view(p_access uuid, p_assignment uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; l public.leads;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return false; end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id and status in ('sent','received','in_work','ready');
  if not found then return false; end if;
  select * into l from public.leads where id = a.lead_id and deleted_at is null and status not in ('lost','junk','completed');
  if not found then return false; end if;
  if (select count(*) from public.audit_log where action = 'garage_contact_view' and details ->> 'access' = ac.id::text and created_at > now() - interval '10 minutes') >= 40 then return false; end if;
  select * into g from public.garages where id = a.garage_id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Partner garage viewed customer contact (' || g.name || ')');
  insert into public.audit_log (action, details) values ('garage_contact_view', jsonb_build_object('lead', l.ref, 'garage', g.id, 'access', ac.id));
  return true;
end; $$;
revoke all on function public.garage_contact_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.garage_contact_view(uuid, uuid) to service_role;

-- ───────────────────────── Crew and Admin functions (the screens come later) ─────────────────────────
create or replace function public.crm_garage_access_create(p_garage uuid, p_pin text, p_label text default 'Owner') returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text; aid uuid; g public.garages; lb text := coalesce(public.crm_clean_text(p_label, 40), 'Owner');
begin
  perform public.garage_staff_need();
  select * into g from public.garages where id = p_garage and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'the PIN must be 4 to 6 digits' using errcode = 'P0001'; end if;
  if p_pin ~ '^(.)\1+$' then raise exception 'choose a PIN that is not all the same digit' using errcode = 'P0001'; end if;
  if exists (select 1 from public.garage_access where garage_id = p_garage and label = lb and revoked_at is null) then raise exception 'this garage already has access: reset the PIN or revoke it first' using errcode = 'P0001'; end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.garage_access (garage_id, label, link_hash, pin_hash, created_by)
    values (p_garage, lb, encode(extensions.digest(tok, 'sha256'), 'hex'), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), auth.uid()) returning id into aid;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_access_created', jsonb_build_object('garage', p_garage, 'access', aid));
  return jsonb_build_object('access_id', aid, 'garage', g.name, 'link', 'https://mechanixpro.in/garage/?g=' || tok, 'note', 'This link is shown only now. Send it to the garage with the PIN.');
end; $$;
create or replace function public.crm_garage_link_new(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); n int;
begin
  perform public.garage_staff_need();
  update public.garage_access set link_hash = encode(extensions.digest(tok, 'sha256'), 'hex'), session_version = session_version + 1 where id = p_access and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found or revoked' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_link_renewed', jsonb_build_object('access', p_access));
  return jsonb_build_object('link', 'https://mechanixpro.in/garage/?g=' || tok, 'note', 'The old link no longer works. This one is shown only now.');
end; $$;
create or replace function public.crm_garage_pin_reset(p_access uuid, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.garage_staff_need();
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'the PIN must be 4 to 6 digits' using errcode = 'P0001'; end if;
  if p_pin ~ '^(.)\1+$' then raise exception 'choose a PIN that is not all the same digit' using errcode = 'P0001'; end if;
  update public.garage_access set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null, session_version = session_version + 1 where id = p_access and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found or revoked' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_pin_reset', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true);
end; $$;
-- Revoke: switched off at once (sessions end). Enable: back on with the same link and PIN. A link that was revoked for good is replaced with crm_garage_link_new.
create or replace function public.crm_garage_revoke(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.garage_staff_need();
  update public.garage_access set active = false, session_version = session_version + 1 where id = p_access;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_access_off', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true, 'active', false);
end; $$;
create or replace function public.crm_garage_enable(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.garage_staff_need();
  update public.garage_access set active = true, revoked_at = null, failed_attempts = 0, locked_until = null where id = p_access;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_access_on', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true, 'active', true);
end; $$;
create or replace function public.crm_garage_access_list(p_garage uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'garage_id', x.garage_id, 'garage', g.name, 'label', x.label, 'active', x.active, 'revoked_at', x.revoked_at, 'locked_until', x.locked_until, 'last_login_at', x.last_login_at, 'created_at', x.created_at) order by x.created_at desc)
    from public.garage_access x join public.garages g on g.id = x.garage_id where p_garage is null or x.garage_id = p_garage), '[]'::jsonb);
end; $$;

create or replace function public.crm_garage_assign(p_lead uuid, p_garage uuid, p_note text default null, p_eta timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; g public.garages; cur public.garage_assignments; nt text := public.crm_clean_text(p_note, 500); nid uuid;
begin
  perform public.garage_staff_need();
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into g from public.garages where id = p_garage and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  if l.status in ('lost','junk') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'waiting for the confirmation fee' using errcode = 'P0001'; end if;
  if nt is not null and public.crm_has_pii(nt) then raise exception 'remove ID, bank or card numbers from the note' using errcode = 'P0001'; end if;
  select * into cur from public.garage_assignments where lead_id = p_lead and status in ('sent','received','in_work','ready');
  if found then
    if cur.garage_id = p_garage then
      update public.garage_assignments set notes = coalesce(nt, notes), eta = coalesce(p_eta, eta), updated_at = now() where id = cur.id;
      insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_assignment_updated', jsonb_build_object('lead', l.ref, 'assignment', cur.id));
      return jsonb_build_object('assignment_id', cur.id, 'status', cur.status, 'garage', g.name, 'updated', true);
    end if;
    if cur.status in ('in_work','ready') then raise exception 'the garage has already started this job' using errcode = 'P0001'; end if;
    update public.garage_assignments set status = 'cancelled', updated_at = now() where id = cur.id;
  end if;
  insert into public.garage_assignments (lead_id, garage_id, notes, eta, assigned_by) values (p_lead, p_garage, nt, p_eta, auth.uid()) returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'assign', 'Sent to partner garage ' || g.name || coalesce('. Return expected ' || to_char(p_eta at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI'), ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_assigned', jsonb_build_object('lead', l.ref, 'garage', p_garage, 'assignment', nid));
  return jsonb_build_object('assignment_id', nid, 'status', 'sent', 'garage', g.name);
end; $$;

-- Lists never include the customer's phone, address or email.
create or replace function public.crm_garage_assignments_list(p_status text default null, p_lead uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'lead_id', a.lead_id, 'booking_id', l.booking_id, 'garage_id', a.garage_id, 'garage', g.name, 'status', a.status, 'eta', a.eta, 'notes', a.notes,
      'assigned_at', a.assigned_at, 'received_at', a.received_at, 'started_at', a.started_at, 'ready_at', a.ready_at, 'returned_at', a.returned_at,
      'progress', coalesce((select jsonb_agg(jsonb_build_object('event', p.event, 'at', p.at, 'photos', to_jsonb(p.photos), 'note', p.note) order by p.at) from public.garage_progress p where p.assignment_id = a.id), '[]'::jsonb),
      'settlement', (select jsonb_build_object('amount', s.amount, 'settled', s.settled, 'settled_at', s.settled_at, 'note', s.note) from public.garage_settlements s where s.assignment_id = a.id)) order by a.assigned_at desc)
    from public.garage_assignments a join public.garages g on g.id = a.garage_id join public.leads l on l.id = a.lead_id
    where (p_status is null or a.status = p_status) and (p_lead is null or a.lead_id = p_lead)), '[]'::jsonb);
end; $$;

create or replace function public.crm_garage_estimates_inbox(p_status text default 'submitted') returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'assignment_id', e.assignment_id, 'lead_id', a.lead_id, 'booking_id', l.booking_id, 'garage', g.name, 'status', e.status, 'lines', e.lines, 'notes', e.notes, 'hours', e.hours, 'return_day', e.return_day,
      'subtotal', (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(e.lines) x), 'gst', round((select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(e.lines) x) * 0.18, 2),
      'submitted_at', e.submitted_at, 'reviewed_at', e.reviewed_at, 'review_note', e.review_note, 'converted_quote_id', e.converted_quote_id) order by coalesce(e.submitted_at, e.created_at) desc)
    from public.garage_estimates e join public.garage_assignments a on a.id = e.assignment_id join public.garages g on g.id = a.garage_id join public.leads l on l.id = a.lead_id
    where p_status is null or e.status = p_status), '[]'::jsonb);
end; $$;

-- Approve: makes the DRAFT customer quote through crm_quote_save (Crew then sends it with the normal flow). Reject: tells the garage why. Nothing here reaches the customer.
create or replace function public.crm_garage_estimate_review(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.garage_estimates; a public.garage_assignments; l public.leads; nt text := public.crm_clean_text(p_note, 300); eta jsonb; qid uuid; q jsonb;
begin
  perform public.garage_staff_need();
  select * into e from public.garage_estimates where id = p_id for update;
  if not found then raise exception 'estimate not found' using errcode = 'P0002'; end if;
  if e.status <> 'submitted' then raise exception 'this estimate was already reviewed' using errcode = 'P0001'; end if;
  select * into a from public.garage_assignments where id = e.assignment_id;
  select * into l from public.leads where id = a.lead_id;
  if nt is not null and public.crm_has_pii(nt) then raise exception 'remove ID, bank or card numbers from the note' using errcode = 'P0001'; end if;
  if p_approve then
    if exists (select 1 from public.job_quotes where lead_id = l.id and status = 'draft') then raise exception 'there is already a draft quote for this booking: send or edit it first' using errcode = 'P0001'; end if;
    eta := case when e.hours is not null then jsonb_build_object('kind', 'hours', 'hours', e.hours) else jsonb_build_object('kind', 'date', 'date', e.return_day) end;
    q := public.crm_quote_save(l.id, e.lines, eta);
    select id into qid from public.job_quotes where lead_id = l.id and status = 'draft';
    update public.garage_estimates set status = 'converted', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nt, converted_quote_id = qid where id = e.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Garage estimate approved: draft quote v' || (q ->> 'version') || ' created. Review it and send it to the customer');
  else
    update public.garage_estimates set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nt where id = e.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Garage estimate rejected' || coalesce(': ' || nt, ''));
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), case when p_approve then 'garage_estimate_approved' else 'garage_estimate_rejected' end, jsonb_build_object('lead', l.ref, 'estimate', e.id));
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'converted' else 'rejected' end, 'quote', q);
end; $$;

create or replace function public.crm_garage_settlement_set(p_assignment uuid, p_amount numeric, p_settled boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; nt text := public.crm_clean_text(p_note, 200);
begin
  perform public.garage_staff_need();
  select * into a from public.garage_assignments where id = p_assignment;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
  if a.status not in ('ready','returned') then raise exception 'the garage has not finished this job yet' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 then raise exception 'enter an amount from 0 to 10,00,000' using errcode = 'P0001'; end if;
  if nt is not null and public.crm_has_pii(nt) then raise exception 'remove ID, bank or card numbers from the note' using errcode = 'P0001'; end if;
  insert into public.garage_settlements (assignment_id, amount, settled, settled_at, note, entered_by) values (p_assignment, round(p_amount, 2), coalesce(p_settled, false), case when p_settled then now() end, nt, auth.uid())
    on conflict (assignment_id) do update set amount = excluded.amount, settled = excluded.settled, settled_at = case when excluded.settled then coalesce(public.garage_settlements.settled_at, now()) end, note = excluded.note, entered_by = excluded.entered_by, updated_at = now();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_settlement_set', jsonb_build_object('assignment', p_assignment, 'amount', round(p_amount, 2), 'settled', coalesce(p_settled, false)));
  return jsonb_build_object('ok', true);
end; $$;

-- Explicit grants: signed-in staff only (the functions themselves refuse everyone who is not an admin or has manage_garages).
do $$ declare f text; begin
  foreach f in array array[
    'crm_garage_access_create(uuid, text, text)', 'crm_garage_link_new(uuid)', 'crm_garage_pin_reset(uuid, text)', 'crm_garage_revoke(uuid)', 'crm_garage_enable(uuid)', 'crm_garage_access_list(uuid)',
    'crm_garage_assign(uuid, uuid, text, timestamptz)', 'crm_garage_assignments_list(text, uuid)', 'crm_garage_estimates_inbox(text)', 'crm_garage_estimate_review(uuid, boolean, text)', 'crm_garage_settlement_set(uuid, numeric, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
