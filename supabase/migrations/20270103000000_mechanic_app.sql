-- Mechanic app (/mechanic/) and the garage dashboard additions: a private link + PIN per mechanic, Available/Busy, last known location, and the garage's shop location and Open/Closed switch.
-- Same security pattern as the garage app (20270101000000): bcrypt PIN in Postgres, 5 wrong tries lock 15 minutes, link token stored only as a SHA-256 hash, signed stateless session from the Edge Function.
-- Idempotent and safe to dry-run: add-column-if-not-exists, create-if-not-exists, create-or-replace. Nothing here changes an existing lead, invoice or ledger row.
-- Roll back (as the database owner, in this order):
--   create or replace crm_garage_access_list from 20270101000000_garage_app.sql (it drops the new fields);
--   drop function if exists public.mechanic_login(text, text), public.mechanic_session_check(uuid, int), public.mechanic_status_set(uuid, text, numeric, numeric, int), public.mechanic_open_job(uuid, uuid),
--     public.garage_location_set(uuid, numeric, numeric, int), public.garage_open_set(uuid, boolean), public.mechanic_staff_need(),
--     public.crm_mechanic_access_create(uuid, text), public.crm_mechanic_link_new(uuid), public.crm_mechanic_pin_reset(uuid, text), public.crm_mechanic_revoke(uuid), public.crm_mechanic_enable(uuid), public.crm_mechanic_access_list(uuid);
--   drop table if exists public.mechanic_access;
--   alter table public.mechanics drop column if exists availability, drop column if exists availability_at, drop column if exists last_lat, drop column if exists last_lng, drop column if exists last_loc_acc, drop column if exists last_loc_at;
--   alter table public.garages drop column if exists is_open, drop column if exists is_open_at, drop column if exists shop_lat, drop column if exists shop_lng, drop column if exists shop_loc_acc, drop column if exists shop_loc_at;

-- ───────────────────────── Columns ─────────────────────────
alter table public.mechanics add column if not exists availability text not null default 'available' check (availability in ('available','busy'));
alter table public.mechanics add column if not exists availability_at timestamptz;
alter table public.mechanics add column if not exists last_lat numeric(9,6) check (last_lat between 6 and 38);
alter table public.mechanics add column if not exists last_lng numeric(9,6) check (last_lng between 68 and 98);
alter table public.mechanics add column if not exists last_loc_acc integer check (last_loc_acc between 0 and 100000);
alter table public.mechanics add column if not exists last_loc_at timestamptz;

-- The shop location a garage's phone reports. Kept apart from garages.lat / lng (the address point Crew types in, limited to Bengaluru) so a phone reading never overwrites desk data.
alter table public.garages add column if not exists is_open boolean not null default true;
alter table public.garages add column if not exists is_open_at timestamptz;
alter table public.garages add column if not exists shop_lat numeric(9,6) check (shop_lat between 6 and 38);
alter table public.garages add column if not exists shop_lng numeric(9,6) check (shop_lng between 68 and 98);
alter table public.garages add column if not exists shop_loc_acc integer check (shop_loc_acc between 0 and 100000);
alter table public.garages add column if not exists shop_loc_at timestamptz;

-- ───────────────────────── Access table (closed to anon and signed-in users) ─────────────────────────
create table if not exists public.mechanic_access (
  id               uuid primary key default gen_random_uuid(),
  mechanic_id      uuid not null references public.mechanics(id) on delete cascade,
  link_hash        text not null unique,                                   -- SHA-256 of the private link token; the token is shown once, never stored
  pin_hash         text not null,                                          -- bcrypt (pgcrypto crypt) of the 4 to 6 digit PIN
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  active           boolean not null default true,
  revoked_at       timestamptz,
  session_version  int not null default 1,                                 -- raised on PIN reset, link change or switch-off: older sessions stop working
  last_login_at    timestamptz,
  last_seen_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create unique index if not exists mechanic_access_one on public.mechanic_access (mechanic_id) where revoked_at is null;
alter table public.mechanic_access enable row level security;
revoke all on public.mechanic_access from public, anon, authenticated;

-- ───────────────────────── Functions for the mechanic-app Edge Function (service role only) ─────────────────────────
create or replace function public.mechanic_login(p_token text, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mechanic_access; m public.mechanics; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into a from public.mechanic_access where link_hash = h for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  select * into m from public.mechanics where id = a.mechanic_id;
  if not a.active or a.revoked_at is not null or m.id is null or not m.active then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if a.locked_until is not null and a.locked_until > now() then return jsonb_build_object('ok', false, 'error', 'locked', 'until', a.locked_until); end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' or extensions.crypt(p_pin, a.pin_hash) <> a.pin_hash then
    update public.mechanic_access set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end where id = a.id;
    insert into public.audit_log (action, details) values ('mechanic_login_failed', jsonb_build_object('mechanic', a.mechanic_id, 'access', a.id));
    if a.failed_attempts + 1 >= 5 then return jsonb_build_object('ok', false, 'error', 'locked', 'until', now() + interval '15 minutes'); end if;
    return jsonb_build_object('ok', false, 'error', 'pin', 'left', 5 - (a.failed_attempts + 1));
  end if;
  update public.mechanic_access set failed_attempts = 0, locked_until = null, last_login_at = now(), last_seen_at = now() where id = a.id;
  insert into public.audit_log (action, details) values ('mechanic_login', jsonb_build_object('mechanic', a.mechanic_id, 'access', a.id));
  return jsonb_build_object('ok', true, 'access_id', a.id, 'mechanic_id', a.mechanic_id, 'mechanic_name', m.name, 'area', m.area, 'session_version', a.session_version);
end; $$;
revoke all on function public.mechanic_login(text, text) from public, anon, authenticated;
grant execute on function public.mechanic_login(text, text) to service_role;

-- Every request re-checks the access (switched off, revoked, PIN reset or mechanic made inactive ends the session) and stamps last_seen_at at most every 5 minutes.
create or replace function public.mechanic_session_check(p_access uuid, p_ver int) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mechanic_access; m public.mechanics;
begin
  select * into a from public.mechanic_access where id = p_access;
  if not found or not a.active or a.revoked_at is not null or a.session_version <> p_ver then return jsonb_build_object('ok', false); end if;
  select * into m from public.mechanics where id = a.mechanic_id;
  if m.id is null or not m.active then return jsonb_build_object('ok', false); end if;
  if a.last_seen_at is null or a.last_seen_at < now() - interval '5 minutes' then update public.mechanic_access set last_seen_at = now() where id = a.id; end if;
  return jsonb_build_object('ok', true, 'access_id', a.id, 'mechanic_id', m.id, 'mechanic_name', m.name, 'area', m.area, 'payout_rate', m.payout_rate, 'availability', m.availability, 'availability_at', m.availability_at);
end; $$;
revoke all on function public.mechanic_session_check(uuid, int) from public, anon, authenticated;
grant execute on function public.mechanic_session_check(uuid, int) to service_role;

-- Available / Busy. Tapping Available may carry a position (the phone asked the mechanic first); it is stored as the last known location, never a trail.
create or replace function public.mechanic_status_set(p_access uuid, p_status text, p_lat numeric default null, p_lng numeric default null, p_acc int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mechanic_access; m public.mechanics; loc boolean := false;
begin
  if p_status not in ('available','busy') then return jsonb_build_object('ok', false, 'error', 'Choose Available or Busy.'); end if;
  select * into a from public.mechanic_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  update public.mechanics set availability = p_status, availability_at = now() where id = a.mechanic_id returning * into m;
  if p_status = 'available' and p_lat is not null and p_lng is not null and p_lat between 6 and 38 and p_lng between 68 and 98 then
    update public.mechanics set last_lat = round(p_lat, 6), last_lng = round(p_lng, 6), last_loc_acc = case when p_acc between 0 and 100000 then p_acc end, last_loc_at = now() where id = a.mechanic_id;
    loc := true;
  end if;
  insert into public.audit_log (action, details) values ('mechanic_status', jsonb_build_object('mechanic', a.mechanic_id, 'status', p_status, 'located', loc));
  return jsonb_build_object('ok', true, 'availability', p_status, 'located', loc);
end; $$;
revoke all on function public.mechanic_status_set(uuid, text, numeric, numeric, int) from public, anon, authenticated;
grant execute on function public.mechanic_status_set(uuid, text, numeric, numeric, int) to service_role;

-- A fresh job link (the same kind as the desk's /job/?t=...) for one of THIS mechanic's open jobs, so the OTP, photos, quote and visit steps run on the existing /job/ page.
-- Like tech_open_job: 7 days, at most 5 open links per job (the oldest app-made ones are retired first). A booking whose job link was already reported has one reported link we cannot re-show: the app says so.
create or replace function public.mechanic_open_job(p_mechanic uuid, p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; tok text; n int;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found or l.mechanic_id is distinct from p_mechanic or l.status not in ('paid','scheduled') then return jsonb_build_object('ok', false, 'error', 'That job is not assigned to you.'); end if;
  if exists (select 1 from public.tech_job_links where lead_id = l.id and reported_at is not null) then return jsonb_build_object('ok', false, 'error', 'reported'); end if;
  select count(*) into n from public.tech_job_links where lead_id = l.id and reported_at is null and expires_at > now();
  if n >= 5 then
    update public.tech_job_links set expires_at = now() where id in (select id from public.tech_job_links where lead_id = l.id and reported_at is null and expires_at > now() and created_by is null order by created_at limit n - 4);
  end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tech_job_links (lead_id, mechanic_id, token_hash, created_by, expires_at) values (l.id, p_mechanic, encode(extensions.digest(tok, 'sha256'), 'hex'), null, now() + interval '7 days');
  insert into public.audit_log (action, details) values ('tech_link_created', jsonb_build_object('lead', l.ref, 'via', 'mechanic_app'));
  return jsonb_build_object('ok', true, 'token', tok);
end; $$;
revoke all on function public.mechanic_open_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mechanic_open_job(uuid, uuid) to service_role;

-- ───────────────────────── Garage app additions (service role only, called by garage-app) ─────────────────────────
create or replace function public.garage_location_set(p_access uuid, p_lat numeric, p_lng numeric, p_acc int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare ac public.garage_access;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  if p_lat is null or p_lng is null or p_lat not between 6 and 38 or p_lng not between 68 and 98 then return jsonb_build_object('ok', false, 'error', 'That location does not look right.'); end if;
  update public.garages set shop_lat = round(p_lat, 6), shop_lng = round(p_lng, 6), shop_loc_acc = case when p_acc between 0 and 100000 then p_acc end, shop_loc_at = now() where id = ac.garage_id;
  insert into public.audit_log (action, details) values ('garage_location_set', jsonb_build_object('garage', ac.garage_id, 'access', ac.id));
  return jsonb_build_object('ok', true, 'at', now());
end; $$;
revoke all on function public.garage_location_set(uuid, numeric, numeric, int) from public, anon, authenticated;
grant execute on function public.garage_location_set(uuid, numeric, numeric, int) to service_role;

create or replace function public.garage_open_set(p_access uuid, p_open boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare ac public.garage_access;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  update public.garages set is_open = coalesce(p_open, true), is_open_at = now() where id = ac.garage_id;
  insert into public.audit_log (action, details) values ('garage_open_set', jsonb_build_object('garage', ac.garage_id, 'open', coalesce(p_open, true)));
  return jsonb_build_object('ok', true, 'open', coalesce(p_open, true));
end; $$;
revoke all on function public.garage_open_set(uuid, boolean) from public, anon, authenticated;
grant execute on function public.garage_open_set(uuid, boolean) to service_role;

-- ───────────────────────── Crew and Admin functions ─────────────────────────
-- Admin, or Crew with manage_technicians (the Technician lead and supervisor presets). Agents are refused.
create or replace function public.mechanic_staff_need() returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public.flow_need();
  if not public.flow_can('manage_technicians') then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
end; $$;
revoke all on function public.mechanic_staff_need() from public, anon, authenticated;

create or replace function public.crm_mechanic_access_create(p_mechanic uuid, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text; aid uuid; m public.mechanics;
begin
  perform public.mechanic_staff_need();
  select * into m from public.mechanics where id = p_mechanic;
  if not found then raise exception 'mechanic not found' using errcode = 'P0002'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'the PIN must be 4 to 6 digits' using errcode = 'P0001'; end if;
  if p_pin ~ '^(.)\1+$' then raise exception 'choose a PIN that is not all the same digit' using errcode = 'P0001'; end if;
  if exists (select 1 from public.mechanic_access where mechanic_id = p_mechanic and revoked_at is null) then raise exception 'this mechanic already has app access: reset the PIN or revoke it first' using errcode = 'P0001'; end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.mechanic_access (mechanic_id, link_hash, pin_hash, created_by)
    values (p_mechanic, encode(extensions.digest(tok, 'sha256'), 'hex'), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), auth.uid()) returning id into aid;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_access_created', jsonb_build_object('mechanic', p_mechanic, 'access', aid));
  return jsonb_build_object('access_id', aid, 'mechanic', m.name, 'link', 'https://mechanixpro.in/mechanic/?m=' || tok, 'note', 'This link is shown only now. Send it to the mechanic with the PIN.');
end; $$;
create or replace function public.crm_mechanic_link_new(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); n int;
begin
  perform public.mechanic_staff_need();
  update public.mechanic_access set link_hash = encode(extensions.digest(tok, 'sha256'), 'hex'), session_version = session_version + 1 where id = p_access and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found or revoked' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_link_renewed', jsonb_build_object('access', p_access));
  return jsonb_build_object('link', 'https://mechanixpro.in/mechanic/?m=' || tok, 'note', 'The old link no longer works. This one is shown only now.');
end; $$;
create or replace function public.crm_mechanic_pin_reset(p_access uuid, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.mechanic_staff_need();
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'the PIN must be 4 to 6 digits' using errcode = 'P0001'; end if;
  if p_pin ~ '^(.)\1+$' then raise exception 'choose a PIN that is not all the same digit' using errcode = 'P0001'; end if;
  update public.mechanic_access set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null, session_version = session_version + 1 where id = p_access and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found or revoked' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_pin_reset', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true);
end; $$;
create or replace function public.crm_mechanic_revoke(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.mechanic_staff_need();
  update public.mechanic_access set active = false, session_version = session_version + 1 where id = p_access;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_access_off', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true, 'active', false);
end; $$;
create or replace function public.crm_mechanic_enable(p_access uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.mechanic_staff_need();
  update public.mechanic_access set active = true, revoked_at = null, failed_attempts = 0, locked_until = null where id = p_access;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'access not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_access_on', jsonb_build_object('access', p_access));
  return jsonb_build_object('ok', true, 'active', true);
end; $$;
-- The list never holds a hash. last_lat / last_lng is where the mechanic's phone last said it was when he tapped Available.
create or replace function public.crm_mechanic_access_list(p_mechanic uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mechanic_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'mechanic_id', x.mechanic_id, 'mechanic', m.name, 'active', x.active, 'revoked_at', x.revoked_at, 'locked_until', x.locked_until, 'last_login_at', x.last_login_at, 'last_seen_at', x.last_seen_at, 'created_at', x.created_at,
      'availability', m.availability, 'availability_at', m.availability_at, 'last_lat', m.last_lat, 'last_lng', m.last_lng, 'last_loc_at', m.last_loc_at,
      'map_url', case when m.last_lat is not null then 'https://www.google.com/maps?q=' || m.last_lat || ',' || m.last_lng end) order by x.created_at desc)
    from public.mechanic_access x join public.mechanics m on m.id = x.mechanic_id where p_mechanic is null or x.mechanic_id = p_mechanic), '[]'::jsonb);
end; $$;

-- Garage access list, extended: the shop location the garage's phone reported, with a map link, and the Open/Closed switch. (Same name and arguments as before, so Crew and Admin keep working.)
create or replace function public.crm_garage_access_list(p_garage uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.garage_staff_need();
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'garage_id', x.garage_id, 'garage', g.name, 'label', x.label, 'active', x.active, 'revoked_at', x.revoked_at, 'locked_until', x.locked_until, 'last_login_at', x.last_login_at, 'created_at', x.created_at,
      'is_open', g.is_open, 'is_open_at', g.is_open_at, 'shop_lat', g.shop_lat, 'shop_lng', g.shop_lng, 'shop_loc_at', g.shop_loc_at,
      'map_url', case when g.shop_lat is not null then 'https://www.google.com/maps?q=' || g.shop_lat || ',' || g.shop_lng end) order by x.created_at desc)
    from public.garage_access x join public.garages g on g.id = x.garage_id where p_garage is null or x.garage_id = p_garage), '[]'::jsonb);
end; $$;

do $$ declare f text; begin
  foreach f in array array[
    'crm_mechanic_access_create(uuid, text)', 'crm_mechanic_link_new(uuid)', 'crm_mechanic_pin_reset(uuid, text)', 'crm_mechanic_revoke(uuid)', 'crm_mechanic_enable(uuid)', 'crm_mechanic_access_list(uuid)', 'crm_garage_access_list(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
