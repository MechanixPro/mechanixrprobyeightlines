-- Care Buddy desk, part 2: garages and hubs, garage visits, mechanic onboarding, price list and bookings that sync with the admin.
-- Agents have no table access; everything is a security definer function that checks crm_can(...).

-- ───────────────────────── Hubs (the 24 micro-zones of the coverage plan) ─────────────────────────
create table if not exists public.garage_hubs (
  id integer primary key, name text not null, direction text not null check (direction in ('N','NE','E','SE','S','SW','W','NW')), ring text not null check (ring in ('core','inner','outer'))
);
alter table public.garage_hubs enable row level security;
drop policy if exists garage_hubs_owner on public.garage_hubs;
create policy garage_hubs_owner on public.garage_hubs for all to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.garage_hubs (id, name, direction, ring) values
 (1,'Malleshwaram – RT Nagar','N','core'),(2,'Hebbal','N','inner'),(3,'Yelahanka – Devanahalli','N','outer'),
 (4,'Indiranagar – Domlur','NE','core'),(5,'Hennur – Thanisandra','NE','inner'),(6,'Kannamangala – Budigere','NE','outer'),
 (7,'Marathahalli','E','core'),(8,'Whitefield – KR Puram','E','inner'),(9,'Hoskote Road – Kadugodi','E','outer'),
 (10,'Bellandur – HSR belt','SE','core'),(11,'Sarjapur Road','SE','inner'),(12,'Attibele – Gunjur','SE','outer'),
 (13,'BTM – Madiwala','S','core'),(14,'Electronic City – Bommanahalli','S','inner'),(15,'Chandapura – Anekal','S','outer'),
 (16,'JP Nagar – Banashankari','SW','core'),(17,'RR Nagar – Kengeri','SW','inner'),(18,'Bidadi – Harohalli','SW','outer'),
 (19,'Rajajinagar – Vijayanagar','W','core'),(20,'Nagarbhavi – Magadi Road','W','inner'),(21,'Magadi Road outskirts','W','outer'),
 (22,'Yeshwanthpur – Mathikere','NW','core'),(23,'Peenya – Jalahalli','NW','inner'),(24,'Dasarahalli – Nelamangala','NW','outer')
on conflict (id) do nothing;

-- Suggested hub for a point, measured from the city centre (MG Road); the desk lets the user override it: ring by distance (10 and 20 km), direction by compass sector
create or replace function public.crm_suggest_hub(p_lat numeric, p_lng numeric) returns integer language plpgsql immutable as $$
declare la1 double precision := radians(12.9716); lo1 double precision := radians(77.5946); la2 double precision; lo2 double precision; dlat double precision; dlon double precision;
  a double precision; km double precision; brg double precision; idx int; ring int;
begin
  if p_lat is null or p_lng is null then return null; end if;
  la2 := radians(p_lat); lo2 := radians(p_lng); dlat := la2 - la1; dlon := lo2 - lo1;
  a := sin(dlat / 2) ^ 2 + cos(la1) * cos(la2) * sin(dlon / 2) ^ 2; km := 6371 * 2 * asin(sqrt(a));
  if km > 35 then return null; end if;
  brg := mod((degrees(atan2(sin(dlon) * cos(la2), cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dlon))) + 360)::numeric, 360::numeric);
  idx := floor(mod((brg + 22.5)::numeric, 360::numeric) / 45)::int;
  ring := case when km < 10 then 0 when km < 20 then 1 else 2 end;
  return idx * 3 + ring + 1;
end; $$;

-- ───────────────────────── Garages ─────────────────────────
create table if not exists public.garages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('GR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5))),
  name text not null check (char_length(name) between 2 and 80),
  legal_name text check (char_length(legal_name) <= 120),
  trade_id text check (char_length(trade_id) <= 40),
  owner_name text check (char_length(owner_name) <= 80),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  address text, landmark text, pincode text check (pincode ~ '^[0-9]{6}$'), city text not null default 'Bengaluru',
  lat numeric check (lat between 12.4 and 13.7), lng numeric check (lng between 77.0 and 78.2),
  categories text[] not null default '{}', open_days text, open_time text check (open_time ~ '^[0-2][0-9]:[0-5][0-9]$'), close_time text check (close_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  bays integer check (bays between 1 and 60), hub_id integer references public.garage_hubs(id),
  status text not null default 'applied' check (status in ('applied','visited','kyc_done','trained','pilot','live','paused')),
  paused_from text, tier text check (tier in ('bronze','silver','gold')), score integer check (score between 0 and 100), rating numeric(3,2), rework_count integer not null default 0,
  on_leave_until date, paused_until date, paused_reason text check (char_length(paused_reason) <= 200),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index if not exists garages_mobile_uq on public.garages (mobile) where deleted_at is null;
create unique index if not exists garages_trade_uq on public.garages (lower(trade_id)) where trade_id is not null and deleted_at is null;
create index if not exists garages_status_idx on public.garages (status);
alter table public.garages enable row level security;
drop policy if exists garages_owner on public.garages;
create policy garages_owner on public.garages for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Bank details are kept to the minimum: holder name, last four digits, IFSC and UPI id. Full account numbers belong in the payout system only.
create table if not exists public.garage_bank (
  garage_id uuid primary key references public.garages(id) on delete cascade,
  holder_name text not null, account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'), ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'), upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9]{2,}$'),
  verified boolean not null default false, updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
alter table public.garage_bank enable row level security;
drop policy if exists garage_bank_owner on public.garage_bank;
create policy garage_bank_owner on public.garage_bank for all to authenticated using (public.is_owner()) with check (public.is_owner());

create table if not exists public.garage_visits (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references public.garages(id) on delete cascade,
  kind text not null check (kind in ('onboarding','inspection','follow_up')),
  scheduled_at timestamptz not null, address text, inspector uuid references auth.users(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','done','cancelled','no_show')),
  scores jsonb, score integer check (score between 0 and 100), notes text check (char_length(notes) <= 1000),
  ticket_id uuid, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists garage_visits_when_idx on public.garage_visits (scheduled_at);
alter table public.garage_visits enable row level security;
drop policy if exists garage_visits_owner on public.garage_visits;
create policy garage_visits_owner on public.garage_visits for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.crm_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists garages_touch on public.garages; create trigger garages_touch before update on public.garages for each row execute function public.crm_touch();
drop trigger if exists garage_visits_touch on public.garage_visits; create trigger garage_visits_touch before update on public.garage_visits for each row execute function public.crm_touch();

-- ───────────────────────── Mechanics: onboarding fields on the existing table ─────────────────────────
alter table public.mechanics add column if not exists onboarding_status text not null default 'live' check (onboarding_status in ('applied','visited','kyc_done','trained','pilot','live','paused'));
alter table public.mechanics add column if not exists skills text[] not null default '{}';
alter table public.mechanics add column if not exists tools jsonb not null default '{}'::jsonb;
alter table public.mechanics add column if not exists pincodes text[] not null default '{}';
alter table public.mechanics add column if not exists shift text check (shift in ('morning','day','evening','full'));
alter table public.mechanics add column if not exists languages text[] not null default '{}';
alter table public.mechanics add column if not exists garage_id uuid references public.garages(id) on delete set null;
alter table public.mechanics add column if not exists hub_id integer references public.garage_hubs(id);
alter table public.mechanics add column if not exists rating numeric(3,2);
alter table public.mechanics add column if not exists rework_count integer not null default 0;
alter table public.mechanics add column if not exists docs jsonb not null default '{}'::jsonb;
update public.mechanics set onboarding_status = 'paused' where not active and onboarding_status = 'live';

-- ───────────────────────── Validation helpers ─────────────────────────
create or replace function public.crm_pin_ok(p text) returns boolean language sql stable security definer set search_path = public as $$
  select p ~ '^[0-9]{6}$' and (exists (select 1 from public.service_pincodes where pin = p and active) or p ~ '^5600[0-9]{2}$' or p ~ '^5601(0[0-9]|10)$');
$$;
create or replace function public.crm_clean_text(p text, p_max int) returns text language sql immutable as $$ select nullif(left(trim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max), ''); $$;

create or replace function public.crm_garage_errors(p jsonb, p_existing uuid default null) returns text[] language plpgsql stable security definer set search_path = public as $$
declare e text[] := '{}'; m text := regexp_replace(coalesce(p ->> 'mobile', ''), '[^0-9]', '', 'g'); c text; cats text[]; pin text := nullif(trim(p ->> 'pincode'), '');
  lat numeric; lng numeric; b int;
begin
  if length(m) = 12 and m like '91%' then m := substr(m, 3); end if;
  if char_length(coalesce(trim(p ->> 'name'), '')) < 2 then e := e || 'Garage name is required'::text; end if;
  if m !~ '^[6-9][0-9]{9}$' then e := e || 'Owner mobile must be a 10-digit number'::text; end if;
  if exists (select 1 from public.garages g where g.mobile = m and g.deleted_at is null and g.id is distinct from p_existing) then e := e || 'This mobile number already belongs to a garage'::text; end if;
  if nullif(trim(p ->> 'trade_id'), '') is not null and exists (select 1 from public.garages g where lower(g.trade_id) = lower(trim(p ->> 'trade_id')) and g.deleted_at is null and g.id is distinct from p_existing) then e := e || 'This trade id already exists'::text; end if;
  if char_length(coalesce(trim(p ->> 'address'), '')) < 6 then e := e || 'Full address is required'::text; end if;
  if pin is null or not public.crm_pin_ok(pin) then e := e || 'PIN code must be inside the Bengaluru service area'::text; end if;
  begin lat := (p ->> 'lat')::numeric; lng := (p ->> 'lng')::numeric; exception when others then lat := null; lng := null; end;
  if lat is null or lng is null or lat not between 12.4 and 13.7 or lng not between 77.0 and 78.2 then e := e || 'GPS coordinates are required and must be near Bengaluru'::text; end if;
  cats := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'categories') = 'array' then p -> 'categories' else '[]'::jsonb end)), '{}');
  if cardinality(cats) = 0 then e := e || 'Choose at least one service category'::text;
  else foreach c in array cats loop if c not in ('2-wheeler','4-wheeler','heavy','ev','bodywork') then e := e || ('Unknown category: ' || left(c, 20)); end if; end loop; end if;
  if coalesce(p ->> 'open_time', '') !~ '^[0-2][0-9]:[0-5][0-9]$' or coalesce(p ->> 'close_time', '') !~ '^[0-2][0-9]:[0-5][0-9]$' then e := e || 'Opening and closing time are required as HH:MM'::text; end if;
  begin b := (p ->> 'bays')::int; exception when others then b := null; end;
  if b is null or b not between 1 and 60 then e := e || 'Number of repair bays is required (1 to 60)'::text; end if;
  if char_length(coalesce(trim(p ->> 'open_days'), '')) < 3 then e := e || 'Working days are required'::text; end if;
  if public.crm_has_pii(p::text) then e := e || 'Remove Aadhaar, PAN or card numbers from the details'::text; end if;
  return e;
end; $$;

-- ───────────────────────── Garage functions ─────────────────────────
create or replace function public.crm_garage_save(p jsonb, p_commit boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare gid_in uuid := nullif(p ->> 'id', '')::uuid; errs text[]; m text; hub int; cats text[]; v_lat numeric; v_lng numeric; nid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages');
  errs := public.crm_garage_errors(p, gid_in);
  if cardinality(errs) > 0 then return jsonb_build_object('ok', false, 'errors', to_jsonb(errs)); end if;
  m := regexp_replace(p ->> 'mobile', '[^0-9]', '', 'g'); if length(m) = 12 and m like '91%' then m := substr(m, 3); end if;
  v_lat := (p ->> 'lat')::numeric; v_lng := (p ->> 'lng')::numeric; hub := coalesce(nullif(p ->> 'hub_id', '')::int, public.crm_suggest_hub(v_lat, v_lng));
  cats := array(select jsonb_array_elements_text(p -> 'categories'));
  if not p_commit then return jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'hub_id', hub); end if;
  if gid_in is null then
    insert into public.garages (name, legal_name, trade_id, owner_name, mobile, address, landmark, pincode, lat, lng, categories, open_days, open_time, close_time, bays, hub_id, notes, created_by)
    values (public.crm_clean_text(p ->> 'name', 80), public.crm_clean_text(p ->> 'legal_name', 120), public.crm_clean_text(p ->> 'trade_id', 40), public.crm_clean_text(p ->> 'owner_name', 80), m,
      public.crm_clean_text(p ->> 'address', 300), public.crm_clean_text(p ->> 'landmark', 120), p ->> 'pincode', v_lat, v_lng, cats, public.crm_clean_text(p ->> 'open_days', 60), p ->> 'open_time', p ->> 'close_time',
      (p ->> 'bays')::int, hub, public.crm_clean_text(p ->> 'notes', 1000), auth.uid()) returning garages.id into nid;
  else
    update public.garages set name = public.crm_clean_text(p ->> 'name', 80), legal_name = public.crm_clean_text(p ->> 'legal_name', 120), trade_id = public.crm_clean_text(p ->> 'trade_id', 40),
      owner_name = public.crm_clean_text(p ->> 'owner_name', 80), mobile = m, address = public.crm_clean_text(p ->> 'address', 300), landmark = public.crm_clean_text(p ->> 'landmark', 120), pincode = p ->> 'pincode',
      lat = v_lat, lng = v_lng, categories = cats, open_days = public.crm_clean_text(p ->> 'open_days', 60), open_time = p ->> 'open_time', close_time = p ->> 'close_time', bays = (p ->> 'bays')::int,
      hub_id = hub, notes = public.crm_clean_text(p ->> 'notes', 1000)
    where garages.id = gid_in and deleted_at is null returning garages.id into nid;
    if nid is null then raise exception 'garage not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), case when gid_in is null then 'garage_created' else 'garage_updated' end, jsonb_build_object('garage', nid));
  return jsonb_build_object('ok', true, 'id', nid, 'hub_id', hub);
end; $$;

-- Import: rows is an array of garage objects. Dry run reports every problem; a real run saves the valid rows and reports the rest.
create or replace function public.crm_garage_import(p_rows jsonb, p_dry boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare i int := 0; r jsonb; out jsonb := '[]'::jsonb; res jsonb; seen_m text[] := '{}'; seen_t text[] := '{}'; m text; t text; ok_n int := 0; bad_n int := 0; local_err text[];
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages');
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'send a list of garages' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'import at most 500 garages at a time' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; local_err := '{}';
    m := regexp_replace(coalesce(r ->> 'mobile', ''), '[^0-9]', '', 'g'); if length(m) = 12 and m like '91%' then m := substr(m, 3); end if;
    t := lower(coalesce(nullif(trim(r ->> 'trade_id'), ''), ''));
    if m = any (seen_m) then local_err := local_err || 'Duplicate mobile inside this file'::text; end if;
    if t <> '' and t = any (seen_t) then local_err := local_err || 'Duplicate trade id inside this file'::text; end if;
    res := public.crm_garage_save(r, false);
    if not (res ->> 'ok')::boolean or cardinality(local_err) > 0 then
      bad_n := bad_n + 1;
      out := out || jsonb_build_object('row', i, 'ok', false, 'name', r ->> 'name', 'errors', coalesce(res -> 'errors', '[]'::jsonb) || to_jsonb(local_err));
    else
      seen_m := seen_m || m; if t <> '' then seen_t := seen_t || t; end if;
      if not p_dry then res := public.crm_garage_save(r, true); end if;
      ok_n := ok_n + 1; out := out || jsonb_build_object('row', i, 'ok', true, 'name', r ->> 'name', 'hub_id', res ->> 'hub_id');
    end if;
  end loop;
  return jsonb_build_object('dry_run', p_dry, 'ok', ok_n, 'failed', bad_n, 'rows', out);
end; $$;

create or replace function public.crm_garage_list(p_status text default null, p_search text default null, p_hub integer default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role(); perform public.crm_need_page('garages');
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'owner_name', g.owner_name, 'mobile', g.mobile, 'pincode', g.pincode, 'hub_id', g.hub_id, 'hub', h.name,
      'direction', h.direction, 'status', g.status, 'tier', g.tier, 'score', g.score, 'rating', g.rating, 'bays', g.bays, 'categories', g.categories, 'on_leave_until', g.on_leave_until, 'paused_until', g.paused_until,
      'open_now', (g.status in ('live','pilot') and (g.on_leave_until is null or g.on_leave_until < current_date) and (g.paused_until is null or g.paused_until < current_date)),
      'next_visit', (select min(v.scheduled_at) from public.garage_visits v where v.garage_id = g.id and v.status = 'scheduled' and v.scheduled_at > now()),
      'mechanics', (select count(*) from public.mechanics m where m.garage_id = g.id)) order by g.created_at desc)
    from public.garages g left join public.garage_hubs h on h.id = g.hub_id
    where g.deleted_at is null and (p_status is null or g.status = p_status) and (p_hub is null or g.hub_id = p_hub)
      and (q is null or g.name ilike '%' || q || '%' or g.mobile like '%' || q || '%' or g.code ilike '%' || q || '%' or g.owner_name ilike '%' || q || '%')), '[]'::jsonb);
end; $$;

create or replace function public.crm_garage_hub_summary() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('garages');
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'direction', h.direction, 'ring', h.ring,
      'garages', (select count(*) from public.garages g where g.hub_id = h.id and g.deleted_at is null),
      'live', (select count(*) from public.garages g where g.hub_id = h.id and g.deleted_at is null and g.status in ('live','pilot'))) order by h.id) from public.garage_hubs h), '[]'::jsonb);
end; $$;

create or replace function public.crm_garage_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages; b public.garage_bank; can_bank boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('garages'); can_bank := public.crm_can('view_garage_bank');
  select * into g from public.garages where id = p_id and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  select * into b from public.garage_bank where garage_id = p_id;
  return jsonb_build_object('garage', to_jsonb(g) - 'deleted_at', 'hub', (select name from public.garage_hubs where id = g.hub_id),
    'bank', case when b.garage_id is null then null when can_bank then jsonb_build_object('holder_name', b.holder_name, 'account_last4', b.account_last4, 'ifsc', b.ifsc, 'upi_id', b.upi_id, 'verified', b.verified)
      else jsonb_build_object('holder_name', left(b.holder_name, 1) || '••••', 'account_last4', '••••', 'ifsc', '••••••••', 'upi_id', '••••••', 'verified', b.verified, 'masked', true) end,
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'scheduled_at', v.scheduled_at, 'status', v.status, 'score', v.score, 'inspector', public.crm_name(v.inspector)) order by v.scheduled_at desc) from public.garage_visits v where v.garage_id = p_id), '[]'::jsonb),
    'mechanics', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'status', m.onboarding_status)) from public.mechanics m where m.garage_id = p_id), '[]'::jsonb));
end; $$;

create or replace function public.crm_garage_bank_set(p_id uuid, p_holder text, p_last4 text, p_ifsc text, p_upi text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages'); perform public.crm_require('view_garage_bank');
  if public.crm_has_pii(p_holder) or public.crm_has_pii(p_upi) then raise exception 'Do not enter full account or card numbers here. Use the last four digits only.' using errcode = 'P0001'; end if;
  if coalesce(p_last4, '') !~ '^[0-9]{4}$' then raise exception 'Enter only the last 4 digits of the account number' using errcode = 'P0001'; end if;
  if upper(coalesce(p_ifsc, '')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'IFSC code looks wrong' using errcode = 'P0001'; end if;
  if nullif(p_upi, '') is not null and p_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9]{2,}$' then raise exception 'UPI id looks wrong' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.garages where id = p_id and deleted_at is null) then raise exception 'garage not found' using errcode = 'P0002'; end if;
  insert into public.garage_bank (garage_id, holder_name, account_last4, ifsc, upi_id, updated_by) values (p_id, left(trim(p_holder), 80), p_last4, upper(p_ifsc), nullif(p_upi, ''), auth.uid())
  on conflict (garage_id) do update set holder_name = excluded.holder_name, account_last4 = excluded.account_last4, ifsc = excluded.ifsc, upi_id = excluded.upi_id, verified = false, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_bank_set', jsonb_build_object('garage', p_id));
end; $$;

-- Pipeline: forward one step at a time. Pause and resume are separate. Going live needs the checklist below.
create or replace function public.crm_pipeline_next(p_from text) returns text language sql immutable as $$
  select case p_from when 'applied' then 'visited' when 'visited' then 'kyc_done' when 'kyc_done' then 'trained' when 'trained' then 'pilot' when 'pilot' then 'live' else null end;
$$;
create or replace function public.crm_garage_set_status(p_id uuid, p_status text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare g public.garages; why text := nullif(trim(p_note), ''); has_bank boolean;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages');
  select * into g from public.garages where id = p_id and deleted_at is null for update;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  if p_status = 'paused' then
    if g.status = 'paused' then return g.status; end if;
    if why is null then raise exception 'say why you are pausing this garage' using errcode = 'P0001'; end if;
    update public.garages set paused_from = status, status = 'paused', paused_reason = left(why, 200) where id = p_id;
  elsif g.status = 'paused' then
    if p_status is distinct from g.paused_from then raise exception 'resume to the stage it was paused at (%)', g.paused_from using errcode = 'P0001'; end if;
    update public.garages set status = paused_from, paused_from = null, paused_reason = null, paused_until = null where id = p_id;
  else
    if public.crm_pipeline_next(g.status) is distinct from p_status then raise exception 'move one step at a time: next is %', coalesce(public.crm_pipeline_next(g.status), 'none') using errcode = 'P0001'; end if;
    if p_status = 'live' then
      select exists (select 1 from public.garage_bank where garage_id = p_id) into has_bank;
      if coalesce(g.score, 0) < 70 then raise exception 'a garage needs an inspection score of 70 or more to go live' using errcode = 'P0001'; end if;
      if not has_bank then raise exception 'add the payout details before going live' using errcode = 'P0001'; end if;
      if g.lat is null or g.lng is null or g.hub_id is null then raise exception 'GPS and hub are required before going live' using errcode = 'P0001'; end if;
    end if;
    update public.garages set status = p_status where id = p_id;
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_status', jsonb_build_object('garage', p_id, 'to', p_status, 'note', left(coalesce(why, ''), 200)));
  return (select status from public.garages where id = p_id);
end; $$;

create or replace function public.crm_garage_set_availability(p_id uuid, p_on_leave_until date default null, p_paused_until date default null, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_garages');
  update public.garages set on_leave_until = p_on_leave_until, paused_until = p_paused_until, paused_reason = coalesce(public.crm_clean_text(p_reason, 200), paused_reason) where id = p_id and deleted_at is null;
end; $$;

-- ───────────────────────── Garage visits ─────────────────────────
create or replace function public.crm_visit_schedule(p_garage uuid, p_kind text, p_when timestamptz, p_address text default null, p_inspector uuid default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; addr text;
begin
  perform public.crm_need_role(); perform public.crm_require('schedule_visits');
  if p_when < now() - interval '1 hour' then raise exception 'pick a future date and time' using errcode = 'P0001'; end if;
  if p_inspector is not null and not exists (select 1 from public.crm_users where user_id = p_inspector and active) and not exists (select 1 from public.admins where user_id = p_inspector) then raise exception 'that person cannot be an inspector' using errcode = 'P0001'; end if;
  select coalesce(nullif(p_address, ''), address) into addr from public.garages where id = p_garage and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  if public.crm_has_pii(p_notes) then raise exception 'Remove ID or card numbers from the notes.' using errcode = 'P0001'; end if;
  insert into public.garage_visits (garage_id, kind, scheduled_at, address, inspector, notes, created_by) values (p_garage, p_kind, p_when, addr, p_inspector, public.crm_clean_text(p_notes, 1000), auth.uid()) returning id into nid;
  return nid;
end; $$;

create or replace function public.crm_visit_update(p_id uuid, p_when timestamptz default null, p_address text default null, p_inspector uuid default null, p_status text default null, p_notes text default null, p_clear_inspector boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('schedule_visits');
  if p_status is not null and p_status not in ('scheduled','done','cancelled','no_show') then raise exception 'unknown status' using errcode = 'P0001'; end if;
  if p_inspector is not null and not exists (select 1 from public.crm_users where user_id = p_inspector and active) and not exists (select 1 from public.admins where user_id = p_inspector) then raise exception 'that person cannot be an inspector' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p_notes) then raise exception 'Remove ID or card numbers from the notes.' using errcode = 'P0001'; end if;
  update public.garage_visits set scheduled_at = coalesce(p_when, scheduled_at), address = coalesce(public.crm_clean_text(p_address, 300), address),
    inspector = case when p_clear_inspector then null else coalesce(p_inspector, inspector) end, status = coalesce(p_status, status), notes = coalesce(public.crm_clean_text(p_notes, 1000), notes) where id = p_id;
  if not found then raise exception 'visit not found' using errcode = 'P0002'; end if;
end; $$;

-- Complete a visit with the 100-point scorecard of the coverage plan
create or replace function public.crm_visit_complete(p_id uuid, p_scores jsonb, p_notes text default null) returns integer language plpgsql security definer set search_path = public as $$
declare maxes jsonb := '{"gap":20,"capacity":15,"tools":15,"range":10,"compliance":10,"reputation":10,"pricing":10,"warranty":10}'::jsonb; k text; v int; tot int := 0; gid uuid; new_tier text;
begin
  perform public.crm_need_role(); perform public.crm_require('schedule_visits');
  for k in select jsonb_object_keys(maxes) loop
    v := coalesce((p_scores ->> k)::int, 0);
    if v < 0 or v > (maxes ->> k)::int then raise exception 'score for % must be between 0 and %', k, maxes ->> k using errcode = 'P0001'; end if;
    tot := tot + v;
  end loop;
  update public.garage_visits set status = 'done', scores = p_scores, score = tot, notes = coalesce(public.crm_clean_text(p_notes, 1000), notes) where id = p_id returning garage_id into gid;
  if gid is null then raise exception 'visit not found' using errcode = 'P0002'; end if;
  new_tier := case when tot >= 90 then 'gold' when tot >= 80 then 'silver' when tot >= 70 then 'bronze' else null end;
  update public.garages set score = tot, tier = coalesce(new_tier, garages.tier), status = case when status = 'applied' then 'visited' else status end where id = gid;
  return tot;
end; $$;

create or replace function public.crm_visits_list(p_from date default null, p_to date default null, p_status text default null, p_inspector uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('garage_visits');
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'garage_id', v.garage_id, 'garage', g.name, 'garage_code', g.code, 'mobile', g.mobile, 'kind', v.kind, 'scheduled_at', v.scheduled_at, 'address', v.address,
      'inspector_id', v.inspector, 'inspector', public.crm_name(v.inspector), 'status', v.status, 'score', v.score, 'notes', v.notes) order by v.scheduled_at)
    from public.garage_visits v join public.garages g on g.id = v.garage_id
    where (p_from is null or v.scheduled_at >= (p_from::timestamp at time zone 'Asia/Kolkata')) and (p_to is null or v.scheduled_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
      and (p_status is null or v.status = p_status) and (p_inspector is null or v.inspector = p_inspector)), '[]'::jsonb);
end; $$;

-- ───────────────────────── Mechanics ─────────────────────────
create or replace function public.crm_mechanic_list(p_status text default null, p_search text default null, p_skill text default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role(); perform public.crm_need_page('mechanics');
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'area', m.area, 'status', m.onboarding_status, 'skills', m.skills, 'pincodes', m.pincodes, 'shift', m.shift,
      'languages', m.languages, 'garage_id', m.garage_id, 'garage', g.name, 'hub_id', m.hub_id, 'rating', m.rating, 'rework_count', m.rework_count, 'docs', m.docs, 'tools', m.tools,
      'experience_years', m.experience_years, 'certified', m.certified, 'active', m.active, 'docs_done', (select count(*) from jsonb_each_text(m.docs) where value = 'true')) order by m.created_at desc)
    from public.mechanics m left join public.garages g on g.id = m.garage_id
    where (p_status is null or m.onboarding_status = p_status) and (p_skill is null or p_skill = any (m.skills))
      and (q is null or m.name ilike '%' || q || '%' or m.phone like '%' || q || '%')), '[]'::jsonb);
end; $$;

create or replace function public.crm_mechanic_save(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare mid_in uuid := nullif(p ->> 'id', '')::uuid; ph text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9]', '', 'g'); sk text[]; pins text[]; langs text[]; x text; nid uuid; v_docs jsonb := '{}'::jsonb; v_tools jsonb := '{}'::jsonb;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_mechanics');
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'Mobile must be a 10-digit number' using errcode = 'P0001'; end if;
  if char_length(coalesce(trim(p ->> 'name'), '')) < 2 or char_length(trim(p ->> 'name')) > 60 then raise exception 'Enter the mechanic name (2 to 60 letters)' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN or card numbers from the details' using errcode = 'P0001'; end if;
  sk := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'skills') = 'array' then p -> 'skills' else '[]'::jsonb end)), '{}');
  foreach x in array sk loop if x not in ('two-wheeler','scooter','royal-enfield','electric','tyre','battery','superbike') then raise exception 'Unknown skill: %', left(x, 20) using errcode = 'P0001'; end if; end loop;
  pins := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'pincodes') = 'array' then p -> 'pincodes' else '[]'::jsonb end)), '{}');
  foreach x in array pins loop if not public.crm_pin_ok(x) then raise exception 'PIN % is outside the service area', left(x, 10) using errcode = 'P0001'; end if; end loop;
  langs := coalesce(array(select left(jsonb_array_elements_text(case when jsonb_typeof(p -> 'languages') = 'array' then p -> 'languages' else '[]'::jsonb end), 20)), '{}');
  if p ->> 'shift' is not null and p ->> 'shift' not in ('morning','day','evening','full') then raise exception 'Unknown shift' using errcode = 'P0001'; end if;
  foreach x in array array['agreement','training','photo','id_seen','address_seen'] loop v_docs := jsonb_set(v_docs, array[x], to_jsonb(coalesce((p -> 'docs' ->> x)::boolean, false))); end loop;
  foreach x in array array['toolkit','puncture_kit','jump_starter','chain_tools','torque_wrench','scanner'] loop v_tools := jsonb_set(v_tools, array[x], to_jsonb(coalesce((p -> 'tools' ->> x)::boolean, false))); end loop;
  if exists (select 1 from public.mechanics m where m.phone = ph and m.id is distinct from mid_in) then raise exception 'A mechanic with this mobile already exists' using errcode = 'P0001'; end if;
  if mid_in is null then
    insert into public.mechanics (name, phone, area, active, onboarding_status, skills, tools, pincodes, shift, languages, garage_id, hub_id, specialties, experience_years, docs, city, notes)
    values (public.crm_clean_text(p ->> 'name', 60), ph, public.crm_clean_text(p ->> 'area', 80), false, 'applied', sk, v_tools, pins, p ->> 'shift', langs, nullif(p ->> 'garage_id', '')::uuid, nullif(p ->> 'hub_id', '')::int,
      public.crm_clean_text(p ->> 'specialties', 120), coalesce(nullif(p ->> 'experience_years', '')::int, 0), v_docs, 'Bengaluru', public.crm_clean_text(p ->> 'notes', 500)) returning mechanics.id into nid;
  else
    update public.mechanics set name = public.crm_clean_text(p ->> 'name', 60), phone = ph, area = public.crm_clean_text(p ->> 'area', 80), skills = sk, tools = v_tools, pincodes = pins, shift = p ->> 'shift', languages = langs,
      garage_id = nullif(p ->> 'garage_id', '')::uuid, hub_id = nullif(p ->> 'hub_id', '')::int, specialties = public.crm_clean_text(p ->> 'specialties', 120), experience_years = coalesce(nullif(p ->> 'experience_years', '')::int, experience_years),
      docs = v_docs, notes = public.crm_clean_text(p ->> 'notes', 500)
    where mechanics.id = mid_in returning mechanics.id into nid;
    if nid is null then raise exception 'mechanic not found' using errcode = 'P0002'; end if;
  end if;
  return nid;
end; $$;

create or replace function public.crm_mechanic_set_status(p_id uuid, p_status text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare m public.mechanics; why text := nullif(trim(p_note), ''); k text;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_mechanics');
  select * into m from public.mechanics where id = p_id for update;
  if not found then raise exception 'mechanic not found' using errcode = 'P0002'; end if;
  if p_status = 'paused' then
    if why is null then raise exception 'say why you are pausing this mechanic' using errcode = 'P0001'; end if;
    update public.mechanics set onboarding_status = 'paused', active = false where id = p_id;
  else
    if m.onboarding_status = 'paused' then
      update public.mechanics set onboarding_status = 'live', active = true where id = p_id and p_status = 'live';
      if not found then raise exception 'a paused mechanic resumes as live' using errcode = 'P0001'; end if;
    else
      if public.crm_pipeline_next(m.onboarding_status) is distinct from p_status then raise exception 'move one step at a time: next is %', coalesce(public.crm_pipeline_next(m.onboarding_status), 'none') using errcode = 'P0001'; end if;
      if p_status = 'trained' and not coalesce((m.docs ->> 'agreement')::boolean, false) then raise exception 'the signed agreement is needed before training is marked done' using errcode = 'P0001'; end if;
      if p_status = 'live' then
        foreach k in array array['agreement','training','photo','id_seen','address_seen'] loop
          if not coalesce((m.docs ->> k)::boolean, false) then raise exception 'checklist not complete: %', k using errcode = 'P0001'; end if;
        end loop;
        if cardinality(m.skills) = 0 or cardinality(m.pincodes) = 0 then raise exception 'add skills and service PIN codes before going live' using errcode = 'P0001'; end if;
      end if;
      update public.mechanics set onboarding_status = p_status, active = (p_status = 'live') where id = p_id;
    end if;
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_status', jsonb_build_object('mechanic', p_id, 'to', p_status));
  return (select onboarding_status from public.mechanics where id = p_id);
end; $$;

-- ───────────────────────── Price list ─────────────────────────
create or replace function public.crm_price_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('edit_price_list');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'description', description, 'price', price, 'active', active, 'sort', sort) order by kind, sort, id) from public.services), '[]'::jsonb);
end; $$;
create or replace function public.crm_price_set(p_id text, p_price integer default null, p_name text default null, p_description text default null, p_active boolean default null) returns void language plpgsql security definer set search_path = public as $$
declare old integer;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_price_list');
  if p_price is not null and (p_price < 0 or p_price > 100000) then raise exception 'price must be between 0 and 100000' using errcode = 'P0001'; end if;
  select price into old from public.services where id = p_id;
  if not found then raise exception 'service not found' using errcode = 'P0002'; end if;
  update public.services set price = coalesce(p_price, price), name = coalesce(public.crm_clean_text(p_name, 80), name), description = coalesce(public.crm_clean_text(p_description, 300), description), active = coalesce(p_active, active) where id = p_id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'price_changed', jsonb_build_object('service', p_id, 'old', old, 'new', p_price));
end; $$;
create or replace function public.crm_price_add(p_id text, p_kind text, p_name text, p_price integer, p_description text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('edit_price_list');
  if p_kind not in ('service','addon') then raise exception 'kind must be service or addon' using errcode = 'P0001'; end if;
  if coalesce(p_id, '') !~ '^[a-z][a-z0-9_-]{1,29}$' then raise exception 'id must be lower-case letters, digits, - or _' using errcode = 'P0001'; end if;
  if p_price < 0 or p_price > 100000 then raise exception 'price must be between 0 and 100000' using errcode = 'P0001'; end if;
  insert into public.services (id, kind, name, description, price, sort, active) values (p_id, p_kind, public.crm_clean_text(p_name, 80), public.crm_clean_text(p_description, 300), p_price, 50, true);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'price_added', jsonb_build_object('service', p_id, 'price', p_price));
end; $$;

-- ───────────────────────── Bookings that sync with the admin ─────────────────────────
-- A booking made here is the same leads row the admin uses: same customer, bike, service, add-ons, slot, address and quote.
create or replace function public.crm_coupon_discount(p_code text, p_subtotal integer) returns integer language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; d int; used int; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into c from public.coupons where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_-]', '', 'g'));
  if not found or not c.active then return 0; end if;
  if c.starts_on is not null and today < c.starts_on then return 0; end if;
  if c.ends_on is not null and today > c.ends_on then return 0; end if;
  if c.min_amount is not null and p_subtotal < c.min_amount then return 0; end if;
  if c.max_uses is not null then select count(*) into used from public.leads where coupon_code = c.code and status in ('paid','scheduled','completed'); if used >= c.max_uses then return 0; end if; end if;
  d := case when c.kind = 'percent' then floor(p_subtotal * c.value / 100.0)::int else c.value end;
  return greatest(0, least(d, p_subtotal));
end; $$;

create or replace function public.crm_booking_price(p_service text, p_addons text[]) returns integer language plpgsql stable security definer set search_path = public as $$
declare tot int; a text;
begin
  select price into tot from public.services where id = p_service and kind = 'service' and active;
  if tot is null then raise exception 'choose a valid service' using errcode = 'P0001'; end if;
  foreach a in array coalesce(p_addons, '{}') loop
    if not exists (select 1 from public.services where id = a and kind = 'addon' and active) then raise exception 'unknown add-on: %', left(a, 20) using errcode = 'P0001'; end if;
    tot := tot + (select price from public.services where id = a);
  end loop;
  return tot;
end; $$;

create or replace function public.crm_create_booking(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9]', '', 'g'); nm text := public.crm_clean_text(p ->> 'name', 60); pin text := nullif(trim(p ->> 'pincode'), ''); svc text := p ->> 'service_id';
  adds text[] := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'addons') = 'array' then p -> 'addons' else '[]'::jsonb end)), '{}');
  slot text := nullif(p ->> 'preferred_slot', ''); pdate date; src text := coalesce(nullif(p ->> 'source', ''), 'phone'); total int; disc int := 0; cid uuid; bid uuid; dup uuid; nid uuid; nref text;
  brand text := public.crm_clean_text(p ->> 'brand', 40); model text := public.crm_clean_text(p ->> 'model', 60); owner uuid := auth.uid(); mech uuid; code text := nullif(upper(regexp_replace(coalesce(p ->> 'coupon_code', ''), '[^A-Za-z0-9_-]', '', 'g')), ''); regno text := nullif(upper(regexp_replace(coalesce(p ->> 'reg_no', ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  perform public.crm_need_role(); perform public.crm_require('create_bookings');
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'enter a valid 10 digit mobile number' using errcode = 'P0001'; end if;
  if nm is null or char_length(nm) < 2 then raise exception 'enter the customer name' using errcode = 'P0001'; end if;
  if pin is null or not public.crm_pin_ok(pin) then raise exception 'the PIN code must be inside the Bengaluru service area' using errcode = 'P0001'; end if;
  if src not in ('website','whatsapp','phone','walk_in','instagram') then raise exception 'unknown source' using errcode = 'P0001'; end if;
  if slot is not null and slot not in ('morning','afternoon','evening','asap') then raise exception 'choose a valid time slot' using errcode = 'P0001'; end if;
  begin pdate := nullif(p ->> 'preferred_date', '')::date; exception when others then raise exception 'preferred date is not valid' using errcode = 'P0001'; end;
  if pdate is not null and pdate < (now() at time zone 'Asia/Kolkata')::date then raise exception 'the preferred date cannot be in the past' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the booking.' using errcode = 'P0001'; end if;
  if regno is not null and regno !~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$' then raise exception 'the registration number looks wrong' using errcode = 'P0001'; end if;
  total := public.crm_booking_price(svc, adds);
  if code is not null then disc := public.crm_coupon_discount(code, total); if disc = 0 then raise exception 'this coupon is not valid for this booking' using errcode = 'P0001'; end if; end if;
  select id into dup from public.leads where phone = ph and deleted_at is null and status in ('new','contacted','quoted','payment_sent') and created_at > now() - interval '30 days' order by created_at desc limit 1;
  if dup is not null then return jsonb_build_object('id', dup, 'duplicate', true); end if;
  if nullif(p ->> 'mechanic_id', '') is not null then perform public.crm_require('assign_leads'); mech := (p ->> 'mechanic_id')::uuid; end if;
  if nullif(p ->> 'owner_id', '') is not null then perform public.crm_require('assign_leads'); owner := (p ->> 'owner_id')::uuid; end if;
  insert into public.customers (phone, name, address, area) values (ph, nm, public.crm_clean_text(p ->> 'address', 200), public.crm_clean_text(p ->> 'area', 80)) on conflict (phone) do update set name = coalesce(public.customers.name, excluded.name) returning id into cid;
  if brand is not null or model is not null then insert into public.bikes (customer_id, brand, model, reg_no) values (cid, brand, model, regno) returning id into bid; end if;
  insert into public.leads (customer_id, bike_id, name, phone, area, pincode, address, service_id, addons, est_total, preferred_date, preferred_slot, notes, source, status, job_place, mechanic_id, coupon_code, coupon_discount, crm_owner, consent_whatsapp)
  values (cid, bid, nm, ph, public.crm_clean_text(p ->> 'area', 80), pin, public.crm_clean_text(p ->> 'address', 200), svc, adds, total, pdate, slot, public.crm_clean_text(p ->> 'notes', 1000), src, 'new',
    case when p ->> 'job_place' = 'garage' then 'garage' else 'doorstep' end, mech, code, disc, owner, false) returning id, ref into nid, nref;
  insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Booking created in the Care Buddy desk (' || src || ')');
  return jsonb_build_object('id', nid, 'ref', nref, 'duplicate', false, 'est_total', total, 'coupon_discount', disc);
end; $$;

create or replace function public.crm_update_booking(p_id uuid, p jsonb, p_expected timestamptz) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; adds text[]; svc text; total int; changes text[] := '{}'; pin text; slot text; pdate date; v_brand text; v_model text; bid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_id and deleted_at is null for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('view_all_leads') or l.crm_owner = auth.uid()) then raise exception 'this booking belongs to a colleague' using errcode = '42501'; end if;
  if p_expected is distinct from l.updated_at then raise exception 'this booking changed, reload it before saving' using errcode = '40001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the booking.' using errcode = 'P0001'; end if;
  if l.status in ('paid','scheduled','completed') and (p ? 'service_id' or p ? 'addons') then raise exception 'the service of a confirmed booking is changed in the admin' using errcode = 'P0001'; end if;
  if p ? 'pincode' then pin := nullif(trim(p ->> 'pincode'), ''); if pin is null or not public.crm_pin_ok(pin) then raise exception 'the PIN code must be inside the Bengaluru service area' using errcode = 'P0001'; end if; if pin is distinct from l.pincode then changes := changes || ('PIN ' || coalesce(l.pincode, '-') || ' to ' || pin); end if; end if;
  if p ? 'preferred_slot' then slot := nullif(p ->> 'preferred_slot', ''); if slot is not null and slot not in ('morning','afternoon','evening','asap') then raise exception 'choose a valid time slot' using errcode = 'P0001'; end if; if slot is distinct from l.preferred_slot then changes := changes || ('slot ' || coalesce(l.preferred_slot, '-') || ' to ' || coalesce(slot, '-')); end if; end if;
  if p ? 'preferred_date' then begin pdate := nullif(p ->> 'preferred_date', '')::date; exception when others then raise exception 'preferred date is not valid' using errcode = 'P0001'; end;
    if pdate is not null and pdate < (now() at time zone 'Asia/Kolkata')::date then raise exception 'the preferred date cannot be in the past' using errcode = 'P0001'; end if;
    if pdate is distinct from l.preferred_date then changes := changes || ('date ' || coalesce(l.preferred_date::text, '-') || ' to ' || coalesce(pdate::text, '-')); end if; end if;
  svc := coalesce(nullif(p ->> 'service_id', ''), l.service_id);
  adds := case when p ? 'addons' then coalesce(array(select jsonb_array_elements_text(p -> 'addons')), '{}') else l.addons end;
  if (p ? 'service_id' or p ? 'addons') then total := public.crm_booking_price(svc, adds); if svc is distinct from l.service_id then changes := changes || ('service ' || coalesce(l.service_id, '-') || ' to ' || svc); end if; if adds is distinct from l.addons then changes := changes || 'add-ons changed'::text; end if; end if;
  if p ? 'notes' and public.crm_clean_text(p ->> 'notes', 1000) is distinct from l.notes then changes := changes || 'requirements updated'::text; end if;
  if p ? 'area' and public.crm_clean_text(p ->> 'area', 80) is distinct from l.area then changes := changes || 'area updated'::text; end if;
  if p ? 'address' and public.crm_clean_text(p ->> 'address', 200) is distinct from l.address then changes := changes || 'address updated'::text; end if;
  if p ? 'mechanic_id' then perform public.crm_require('assign_leads'); if nullif(p ->> 'mechanic_id', '')::uuid is distinct from l.mechanic_id then changes := changes || 'mechanic changed'::text; end if; end if;
  if p ? 'brand' or p ? 'model' then
    v_brand := public.crm_clean_text(p ->> 'brand', 40); v_model := public.crm_clean_text(p ->> 'model', 60);
    if l.bike_id is not null then update public.bikes set brand = coalesce(v_brand, public.bikes.brand), model = coalesce(v_model, public.bikes.model) where id = l.bike_id; bid := l.bike_id;
    elsif l.customer_id is not null then insert into public.bikes (customer_id, brand, model) values (l.customer_id, v_brand, v_model) returning id into bid; end if;
    changes := changes || 'bike updated'::text;
  end if;
  update public.leads set
    area = case when p ? 'area' then public.crm_clean_text(p ->> 'area', 80) else area end,
    pincode = case when p ? 'pincode' then pin else pincode end,
    address = case when p ? 'address' then public.crm_clean_text(p ->> 'address', 200) else address end,
    notes = case when p ? 'notes' then public.crm_clean_text(p ->> 'notes', 1000) else notes end,
    preferred_slot = case when p ? 'preferred_slot' then slot else preferred_slot end,
    preferred_date = case when p ? 'preferred_date' then pdate else preferred_date end,
    service_id = svc, addons = adds, est_total = coalesce(total, est_total), bike_id = coalesce(bid, bike_id),
    mechanic_id = case when p ? 'mechanic_id' then nullif(p ->> 'mechanic_id', '')::uuid else mechanic_id end
  where id = p_id;
  if cardinality(changes) > 0 then
    insert into public.crm_activities (lead_id, actor, kind, body) values (p_id, auth.uid(), 'note', left(array_to_string(changes, '; '), 900));
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'booking_edited_in_desk', jsonb_build_object('lead', p_id, 'changes', changes));
  end if;
  return jsonb_build_object('ok', true, 'updated_at', (select updated_at from public.leads where id = p_id), 'changes', to_jsonb(changes));
end; $$;

-- Staff who can be sent on a visit (for the inspector dropdown)
create or replace function public.crm_inspectors() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name) order by name) from public.crm_users where active), '[]'::jsonb);
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_suggest_hub(numeric,numeric)','crm_pin_ok(text)','crm_clean_text(text,integer)','crm_garage_errors(jsonb,uuid)','crm_garage_save(jsonb,boolean)','crm_garage_import(jsonb,boolean)',
    'crm_garage_list(text,text,integer)','crm_garage_hub_summary()','crm_garage_get(uuid)','crm_garage_bank_set(uuid,text,text,text,text)','crm_pipeline_next(text)','crm_garage_set_status(uuid,text,text)',
    'crm_garage_set_availability(uuid,date,date,text)','crm_visit_schedule(uuid,text,timestamptz,text,uuid,text)','crm_visit_update(uuid,timestamptz,text,uuid,text,text,boolean)','crm_visit_complete(uuid,jsonb,text)',
    'crm_visits_list(date,date,text,uuid)','crm_mechanic_list(text,text,text)','crm_mechanic_save(jsonb)','crm_mechanic_set_status(uuid,text,text)','crm_price_list()','crm_price_set(text,integer,text,text,boolean)',
    'crm_price_add(text,text,text,integer,text)','crm_coupon_discount(text,integer)','crm_booking_price(text,text[])','crm_create_booking(jsonb)','crm_update_booking(uuid,jsonb,timestamptz)','crm_inspectors()']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
