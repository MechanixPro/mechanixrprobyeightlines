-- Customer journey, part 1: the customer adds details, photos and reports issues on the private tracking link; Crew and Admin see them and resolve issues.
-- Design: docs/superpowers/specs/2026-11-06-customer-journey-and-mechanic-link-design.md
-- Idempotent and safe to dry-run: create-if-not-exists, create-or-replace, on-conflict, drop-then-create for constraints and policies. Old rows are not changed.
-- Roll back (as the database owner):
--   drop function if exists public.booking_lead_by_token(text), public.booking_editable(public.leads), public.booking_details_save(text, jsonb), public.booking_details_get(text), public.booking_photo_reserve(text),
--     public.booking_photo_add(text, text, int), public.booking_issue_report(text, text, text), public.crm_booking_updates(uuid), public.crm_issue_resolve(uuid, text), public.crm_open_issues(text, int),
--     public.booking_photo_ok(text), public.booking_photos_purge(int);
--   drop policy if exists booking_updates_desk_read on storage.objects; drop table if exists public.booking_issues, public.booking_photos, public.booking_details;
--   (the notification kinds and labels widened here are harmless to old code; to narrow them re-run the constraint and notification_finish from 20261228000000.)

-- ───────────────────────── Notification kinds: on-the-way email (customer) and team issue alert ─────────────────────────
alter table public.booking_notifications drop constraint if exists booking_notifications_kind_check;
alter table public.booking_notifications add constraint booking_notifications_kind_check
  check (kind ~ '^(confirm_email|receipt_email|confirm_whatsapp|team_paid|team_link_unpaid|team_unassigned|quote_email|quote_whatsapp|team_quote_decision|eta_email|eta_whatsapp|ontheway_email|team_issue)(:[0-9]{1,3})?$');

create or replace function public.notification_finish(p_lead uuid, p_kind text, p_status text, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
declare label text := case split_part(p_kind, ':', 1) when 'confirm_email' then 'Confirmation email' when 'receipt_email' then 'Fee receipt email' when 'confirm_whatsapp' then 'WhatsApp confirmation'
  when 'team_paid' then 'Team alert: paid booking' when 'quote_email' then 'Quote email' when 'quote_whatsapp' then 'Quote WhatsApp' when 'team_quote_decision' then 'Team alert: quote decision' when 'eta_email' then 'Delivery update email' when 'eta_whatsapp' then 'Delivery update WhatsApp'
  when 'team_link_unpaid' then 'Team alert: link unpaid' when 'team_unassigned' then 'Team alert: no mechanic' when 'ontheway_email' then 'On-the-way email' when 'team_issue' then 'Team alert: customer issue' else p_kind end;
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status'; end if;
  update public.booking_notifications set status = p_status, error = left(p_error, 200), sent_at = case when p_status = 'sent' then now() else sent_at end where lead_id = p_lead and kind = p_kind;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'note', label || ' ' || p_status || coalesce(': ' || left(p_error, 120), ''));
end; $$;
revoke all on function public.notification_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_finish(uuid, text, text, text) to service_role;

-- ───────────────────────── Tables (closed to anon and signed-in users; only security definer functions and the service role touch them) ─────────────────────────
create table if not exists public.booking_details (
  lead_id      uuid primary key references public.leads(id) on delete cascade,
  landmark     text check (char_length(landmark) <= 120),
  access_note  text check (char_length(access_note) <= 200),          -- gate, parking, floor
  reg_no       text check (reg_no ~ '^[A-Z0-9 -]{4,13}$'),
  kms          integer check (kms between 0 and 999999),
  vehicle_note text check (char_length(vehicle_note) <= 300),
  issue_text   text check (char_length(issue_text) <= 600),            -- "what is the issue"
  saves        integer not null default 1,
  updated_at   timestamptz not null default now()
);
create table if not exists public.booking_photos (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  path       text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  bytes      integer check (bytes between 1 and 1572864),
  created_at timestamptz not null default now()
);
create index if not exists booking_photos_lead_idx on public.booking_photos (lead_id);
create table if not exists public.booking_issues (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  category         text not null check (category in ('late','mechanic','payment','safety','other')),
  body             text not null check (char_length(body) between 3 and 500),
  status           text not null default 'open' check (status in ('open','resolved')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolved_by_name text check (char_length(resolved_by_name) <= 80),
  resolve_note     text check (char_length(resolve_note) <= 200)
);
create index if not exists booking_issues_open_idx on public.booking_issues (status, created_at desc);
create index if not exists booking_issues_lead_idx on public.booking_issues (lead_id, created_at);
alter table public.booking_details enable row level security;
alter table public.booking_photos enable row level security;
alter table public.booking_issues enable row level security;
revoke all on public.booking_details, public.booking_photos, public.booking_issues from public, anon, authenticated;

-- Private bucket: images only, 1.5 MB each. Uploads go through one-time signed URLs from the booking-update function; the folder is the lead id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('booking-updates', 'booking-updates', false, 1572864, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

-- ───────────────────────── Internal helpers (no grants) ─────────────────────────
create or replace function public.booking_lead_by_token(p_token text) returns public.leads language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return null; end if;
  select ld.* into l from public.booking_secrets s join public.leads ld on ld.id = s.lead_id where s.track_token = p_token and ld.deleted_at is null;
  if not found then return null; end if;
  return l;
end; $$;
revoke all on function public.booking_lead_by_token(text) from public, anon, authenticated;

-- Details can be changed until work starts: not after the repair began, the vehicle was picked up, or the job was closed or completed.
create or replace function public.booking_editable(l public.leads) returns boolean language sql immutable as $$
  select l.status not in ('completed','lost','junk') and coalesce(l.visit_stage, '') not in ('repair_doorstep','picked_up','ready','returned');
$$;
revoke all on function public.booking_editable(public.leads) from public, anon, authenticated;

-- ───────────────────────── Customer side (service role: the booking-update function proves the token and rate-limits) ─────────────────────────
create or replace function public.booking_details_get(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); d public.booking_details;
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into d from public.booking_details where lead_id = l.id;
  return jsonb_build_object('ok', true, 'editable', public.booking_editable(l),
    'details', jsonb_build_object('landmark', d.landmark, 'access_note', d.access_note, 'reg_no', d.reg_no, 'kms', d.kms, 'vehicle_note', d.vehicle_note, 'issue_text', d.issue_text, 'updated_at', d.updated_at),
    'photos', jsonb_build_object('count', (select count(*) from public.booking_photos where lead_id = l.id), 'max', 3),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category', i.category, 'body', i.body, 'status', i.status, 'created_at', i.created_at, 'resolved_at', i.resolved_at) order by i.created_at desc)
      from (select * from public.booking_issues where lead_id = l.id order by created_at desc limit 10) i), '[]'::jsonb));
end; $$;
revoke all on function public.booking_details_get(text) from public, anon, authenticated;
grant execute on function public.booking_details_get(text) to service_role;

-- p_d holds already-cleaned values (the function cleans them too); a key that is absent is left alone, an empty string clears it.
create or replace function public.booking_details_save(p_token text, p_d jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); d public.booking_details; changed text[] := '{}';
  v_land text; v_acc text; v_reg text; v_kms int; v_note text; v_issue text;
  clean text := '[\x01-\x1f\x7f<>]';
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if not public.booking_editable(l) then return jsonb_build_object('ok', false, 'locked', true, 'error', 'The work has started, so details cannot be changed here. Call or message us.'); end if;
  insert into public.booking_details (lead_id) values (l.id) on conflict (lead_id) do nothing;
  select * into d from public.booking_details where lead_id = l.id for update;
  v_land := d.landmark; v_acc := d.access_note; v_reg := d.reg_no; v_kms := d.kms; v_note := d.vehicle_note; v_issue := d.issue_text;
  if p_d ? 'landmark' then v_land := nullif(left(btrim(regexp_replace(coalesce(p_d ->> 'landmark', ''), clean, ' ', 'g')), 120), ''); end if;
  if p_d ? 'access_note' then v_acc := nullif(left(btrim(regexp_replace(coalesce(p_d ->> 'access_note', ''), clean, ' ', 'g')), 200), ''); end if;
  if p_d ? 'reg_no' then v_reg := nullif(upper(left(btrim(coalesce(p_d ->> 'reg_no', '')), 13)), ''); if v_reg is not null and v_reg !~ '^[A-Z0-9 -]{4,13}$' then return jsonb_build_object('ok', false, 'field', 'reg_no', 'error', 'Enter the registration number like KA 01 AB 1234, or leave it empty.'); end if; end if;
  if p_d ? 'kms' then
    if nullif(btrim(coalesce(p_d ->> 'kms', '')), '') is null then v_kms := null;
    elsif (p_d ->> 'kms') ~ '^[0-9]{1,6}$' then v_kms := (p_d ->> 'kms')::int;
    else return jsonb_build_object('ok', false, 'field', 'kms', 'error', 'Enter the kilometres as a number, or leave it empty.'); end if;
  end if;
  if p_d ? 'vehicle_note' then v_note := nullif(left(btrim(regexp_replace(coalesce(p_d ->> 'vehicle_note', ''), clean, ' ', 'g')), 300), ''); end if;
  if p_d ? 'issue_text' then v_issue := nullif(left(btrim(regexp_replace(coalesce(p_d ->> 'issue_text', ''), clean, ' ', 'g')), 600), ''); end if;
  if v_land is distinct from d.landmark then changed := changed || 'landmark'::text; end if;
  if v_acc is distinct from d.access_note then changed := changed || 'gate or parking note'::text; end if;
  if v_reg is distinct from d.reg_no then changed := changed || 'registration number'::text; end if;
  if v_kms is distinct from d.kms then changed := changed || 'kilometres'::text; end if;
  if v_note is distinct from d.vehicle_note then changed := changed || 'vehicle note'::text; end if;
  if v_issue is distinct from d.issue_text then changed := changed || 'issue description'::text; end if;
  if cardinality(changed) = 0 then return jsonb_build_object('ok', true, 'changed', '[]'::jsonb, 'unchanged', true); end if;
  update public.booking_details set landmark = v_land, access_note = v_acc, reg_no = v_reg, kms = v_kms, vehicle_note = v_note, issue_text = v_issue, saves = saves + 1, updated_at = now() where lead_id = l.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Customer added or changed: ' || array_to_string(changed, ', ') || '. See Added by customer.');
  insert into public.audit_log (action, details) values ('customer_details_saved', jsonb_build_object('lead', l.ref, 'fields', cardinality(changed)));
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end; $$;
revoke all on function public.booking_details_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.booking_details_save(text, jsonb) to service_role;

-- Before a photo upload: is the link valid, may details still change, and is there room (3 photos at most)?
create or replace function public.booking_photo_reserve(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); n int;
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if not public.booking_editable(l) then return jsonb_build_object('ok', false, 'locked', true, 'error', 'The work has started, so photos cannot be added here. Message us on WhatsApp.'); end if;
  select count(*) into n from public.booking_photos where lead_id = l.id;
  if n >= 3 then return jsonb_build_object('ok', false, 'error', 'You can add up to 3 photos.'); end if;
  return jsonb_build_object('ok', true, 'lead_id', l.id, 'left', 3 - n);
end; $$;
revoke all on function public.booking_photo_reserve(text) from public, anon, authenticated;
grant execute on function public.booking_photo_reserve(text) to service_role;

create or replace function public.booking_photo_add(p_token text, p_path text, p_bytes int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); n int;
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if not public.booking_editable(l) then return jsonb_build_object('ok', false, 'locked', true, 'error', 'The work has started, so photos cannot be added here. Message us on WhatsApp.'); end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> l.id::text then return jsonb_build_object('ok', false, 'error', 'This photo does not belong to this booking.'); end if;
  if exists (select 1 from public.booking_photos where path = p_path) then return jsonb_build_object('ok', true, 'already', true); end if;
  select count(*) into n from public.booking_photos where lead_id = l.id;
  if n >= 3 then return jsonb_build_object('ok', false, 'error', 'You can add up to 3 photos.'); end if;
  insert into public.booking_photos (lead_id, path, bytes) values (l.id, p_path, p_bytes);
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Customer added a photo (' || (n + 1) || ' of 3).');
  return jsonb_build_object('ok', true, 'count', n + 1);
end; $$;
revoke all on function public.booking_photo_add(text, text, int) from public, anon, authenticated;
grant execute on function public.booking_photo_add(text, text, int) to service_role;

-- "Report a problem with my booking": a typed issue, at most 5 open per booking, the same text twice within 10 minutes is one issue. n is the issue's number on this booking (for the team alert key).
create or replace function public.booking_issue_report(p_token text, p_category text, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); b text := nullif(left(btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x1f\x7f<>]', ' ', 'g')), 500), ''); i public.booking_issues; n int;
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if l.status in ('lost','junk') then return jsonb_build_object('ok', false, 'error', 'This booking is closed. Message us on WhatsApp.'); end if;
  if p_category not in ('late','mechanic','payment','safety','other') then return jsonb_build_object('ok', false, 'field', 'category', 'error', 'Choose what the problem is about.'); end if;
  if b is null or char_length(b) < 3 then return jsonb_build_object('ok', false, 'field', 'body', 'error', 'Tell us briefly what went wrong.'); end if;
  perform 1 from public.leads where id = l.id for update;   -- two taps at once wait for each other
  select * into i from public.booking_issues where lead_id = l.id and category = p_category and body = b and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
  if found then select count(*) into n from public.booking_issues where lead_id = l.id and created_at <= i.created_at; return jsonb_build_object('ok', true, 'already', true, 'id', i.id, 'n', n); end if;
  if (select count(*) from public.booking_issues where lead_id = l.id and status = 'open') >= 5 then return jsonb_build_object('ok', false, 'error', 'We already have several open problems on this booking. Our team will contact you.'); end if;
  insert into public.booking_issues (lead_id, category, body) values (l.id, p_category, b) returning * into i;
  select count(*) into n from public.booking_issues where lead_id = l.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Customer reported a problem (' || p_category || '). It is in Issues until someone resolves it.');
  insert into public.audit_log (action, details) values ('customer_issue_reported', jsonb_build_object('lead', l.ref, 'category', p_category));
  return jsonb_build_object('ok', true, 'id', i.id, 'n', least(n, 999), 'lead_id', l.id);
end; $$;
revoke all on function public.booking_issue_report(text, text, text) from public, anon, authenticated;
grant execute on function public.booking_issue_report(text, text, text) to service_role;

-- ───────────────────────── Desk side (Crew and Admin: the same functions) ─────────────────────────
-- Photos are visible to the people who dispatch (supervisor, admin, assign_leads, manage_technicians) and who can see the lead. Text and issues follow crm_can_see (agents: their own and unassigned leads).
create or replace function public.crm_booking_updates(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; d public.booking_details; see_photos boolean;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  see_photos := public.flow_can('assign_leads') or public.flow_can('manage_technicians');
  select * into d from public.booking_details where lead_id = p_lead;
  return jsonb_build_object('details', case when d.lead_id is null then null else jsonb_build_object('landmark', d.landmark, 'access_note', d.access_note, 'reg_no', d.reg_no, 'kms', d.kms, 'vehicle_note', d.vehicle_note, 'issue_text', d.issue_text, 'updated_at', d.updated_at) end,
    'photo_count', (select count(*) from public.booking_photos where lead_id = p_lead),
    'photos', case when see_photos then coalesce((select jsonb_agg(jsonb_build_object('path', p.path, 'at', p.created_at) order by p.created_at) from public.booking_photos p where p.lead_id = p_lead), '[]'::jsonb) else '[]'::jsonb end,
    'issues', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category', i.category, 'body', i.body, 'status', i.status, 'created_at', i.created_at, 'resolved_at', i.resolved_at, 'resolved_by', i.resolved_by_name, 'note', i.resolve_note) order by i.created_at desc) from public.booking_issues i where i.lead_id = p_lead), '[]'::jsonb));
end; $$;
revoke all on function public.crm_booking_updates(uuid) from public, anon;
grant execute on function public.crm_booking_updates(uuid) to authenticated;

create or replace function public.crm_issue_resolve(p_issue uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.flow_need(); i public.booking_issues; l public.leads; who text;
begin
  select * into i from public.booking_issues where id = p_issue for update;
  if not found then raise exception 'issue not found' using errcode = 'P0002'; end if;
  select * into l from public.leads where id = i.lead_id and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'issue not found' using errcode = 'P0002'; end if;
  if i.status = 'resolved' then return jsonb_build_object('ok', true, 'already', true, 'resolved_by', i.resolved_by_name, 'resolved_at', i.resolved_at); end if;
  who := coalesce(public.crm_name(auth.uid()), (select a.name from public.admins a where a.user_id = auth.uid()), 'a team member');
  update public.booking_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolved_by_name = left(who, 80), resolve_note = nullif(left(btrim(coalesce(p_note, '')), 200), '') where id = i.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Customer issue (' || i.category || ') resolved by ' || who || coalesce('. Note: ' || nullif(left(btrim(coalesce(p_note, '')), 200), ''), ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'customer_issue_resolved', jsonb_build_object('lead', l.ref, 'category', i.category));
  return jsonb_build_object('ok', true, 'resolved_by', who);
end; $$;
revoke all on function public.crm_issue_resolve(uuid, text) from public, anon;
grant execute on function public.crm_issue_resolve(uuid, text) to authenticated;

-- The Issues list: open ones by default (oldest first), or the resolved ones with who resolved them and when. Area, never the street address or phone.
create or replace function public.crm_open_issues(p_status text default 'open', p_limit int default 60) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need();
begin
  if p_status not in ('open','resolved','all') then raise exception 'bad status' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at')) from (
    select jsonb_build_object('id', i.id, 'lead_id', l.id, 'booking_id', l.booking_id, 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'category', i.category, 'body', i.body, 'status', i.status,
      'created_at', i.created_at, 'resolved_at', i.resolved_at, 'resolved_by', i.resolved_by_name, 'note', i.resolve_note) as x
    from public.booking_issues i join public.leads l on l.id = i.lead_id
    where l.deleted_at is null and public.crm_can_see(l, r) and (p_status = 'all' or i.status = p_status)
    order by case when i.status = 'open' then i.created_at end asc nulls last, i.resolved_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 60), 200))) q), '[]'::jsonb);
end; $$;
revoke all on function public.crm_open_issues(text, int) from public, anon;
grant execute on function public.crm_open_issues(text, int) to authenticated;

-- Storage read for the desk (signed URLs minted from a Crew or Admin session). Same visibility rule as the photo list above.
create or replace function public.booking_photo_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select public.flow_role() is not null and (public.flow_can('assign_leads') or public.flow_can('manage_technicians')) and exists (
    select 1 from public.leads l where l.id::text = split_part(p_name, '/', 1) and public.crm_can_see(l, public.flow_role())
  );
$$;
revoke all on function public.booking_photo_ok(text) from public, anon;
grant execute on function public.booking_photo_ok(text) to authenticated;
drop policy if exists booking_updates_desk_read on storage.objects;
create policy booking_updates_desk_read on storage.objects for select to authenticated using (bucket_id = 'booking-updates' and public.booking_photo_ok(name));

-- Retention: customer photos are removed after the same number of months as the handover photos (settings key handover_keep_months, default 12). Nothing schedules it yet; run it by hand or from a cron.
create or replace function public.booking_photos_purge(p_months int default null) returns int language plpgsql security definer set search_path = public as $$
declare months int := coalesce(p_months, (select (value #>> '{}')::int from public.settings where key = 'handover_keep_months'), 12); cutoff timestamptz; n int;
begin
  if months < 1 then raise exception 'keep at least 1 month' using errcode = 'P0001'; end if;
  cutoff := now() - make_interval(months => months);
  select count(*) into n from public.booking_photos where created_at < cutoff;
  delete from storage.objects where bucket_id = 'booking-updates' and name in (select path from public.booking_photos where created_at < cutoff);
  delete from public.booking_photos where created_at < cutoff;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'booking_photos_purged', jsonb_build_object('photos', n, 'older_than', cutoff));
  return n;
end; $$;
revoke all on function public.booking_photos_purge(int) from public, anon, authenticated;
grant execute on function public.booking_photos_purge(int) to service_role;
