-- Mechanix Pro — initial schema (website + admin panel + WhatsApp automation)
-- Designed so the same database serves the future web app and Play Store / App Store apps.
-- Run in Supabase: SQL Editor → paste → Run  (or `supabase db push`).

create extension if not exists pgcrypto;

-- ───────────────────────── Catalogue (prices editable from admin) ─────────────────────────
create table if not exists public.services (
  id          text primary key,
  kind        text not null default 'service' check (kind in ('service','addon')),
  name        text not null,
  description text,
  price       integer not null check (price >= 0 and price < 100000),
  sort        integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.services (id, kind, name, description, price, sort) values
  ('basic','service','Basic service','Oil level check, chain lube, brake adjust, wash',799,1),
  ('general','service','General service','Engine oil change, filter clean, 20-point check',1299,2),
  ('full','service','Full service','General service plus throttle body clean, brake pads check, polish',1999,3),
  ('repair','service','Repair or problem check','Inspection visit; repair quoted before work starts',199,4),
  ('sos','service','Roadside emergency','Puncture, battery or breakdown; mechanic dispatched now',349,5),
  ('wash','addon','Foam wash',null,199,10),
  ('chain','addon','Chain clean and lube',null,149,11),
  ('brake','addon','Brake tuning',null,99,12),
  ('tyre','addon','Tyre and puncture check',null,49,13),
  ('battery','addon','Battery health test',null,0,14)
on conflict (id) do nothing;

-- ───────────────────────── Customers & bikes (shared with future apps) ─────────────────────────
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
  name        text,
  auth_user   uuid unique references auth.users(id) on delete set null,  -- linked when the customer app adds login
  created_at  timestamptz not null default now()
);
create table if not exists public.bikes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  brand       text,
  model       text,
  nickname    text,
  big_bike    boolean not null default false,
  reg_no      text,
  created_at  timestamptz not null default now()
);

-- ───────────────────────── Leads / bookings ─────────────────────────
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('MP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),
  customer_id      uuid references public.customers(id) on delete set null,
  bike_id          uuid references public.bikes(id) on delete set null,
  name             text not null check (char_length(name) between 2 and 60),
  phone            text not null check (phone ~ '^[6-9][0-9]{9}$'),
  area             text,
  service_id       text references public.services(id),
  addons           text[] not null default '{}',
  est_total        integer,
  preferred_date   date,
  preferred_slot   text,
  notes            text,
  source           text not null default 'website' check (source in ('website','whatsapp','phone','walk_in','app')),
  page             text,
  utm              jsonb not null default '{}'::jsonb,
  status           text not null default 'new'
                   check (status in ('new','contacted','quoted','payment_sent','paid','scheduled','completed','lost')),
  assigned_to      text,
  amount_due       integer,
  payment_link     text,
  payment_link_id  text,
  paid_amount      integer,
  paid_at          timestamptz,
  ai_enabled       boolean not null default true,
  consent_whatsapp boolean not null default false,
  opted_out        boolean not null default false,
  last_customer_msg_at timestamptz,
  followup_step    integer not null default 0,
  next_followup_at timestamptz,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists leads_phone_idx    on public.leads (phone, created_at desc);
create index if not exists leads_status_idx   on public.leads (status, created_at desc);
create index if not exists leads_followup_idx on public.leads (next_followup_at) where next_followup_at is not null;
create index if not exists leads_ip_idx       on public.leads (ip_hash, created_at desc);

-- ───────────────────────── WhatsApp conversation log ─────────────────────────
create table if not exists public.messages (
  id            bigserial primary key,
  lead_id       uuid references public.leads(id) on delete cascade,
  phone         text not null,
  direction     text not null check (direction in ('in','out')),
  sender        text not null default 'customer' check (sender in ('customer','ai','staff','system')),
  body          text,
  wa_message_id text unique,
  created_at    timestamptz not null default now()
);
create index if not exists messages_lead_idx on public.messages (lead_id, created_at);

-- ───────────────────────── Admin, settings, audit ─────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('ai_enabled', 'true'),
  ('booking_advance', '199'),
  ('big_bike_surcharge', '300'),
  ('quiet_hours', '{"start": 21, "end": 9}'),
  ('business_info', '{"hours": "8 AM to 9 PM, all days", "areas": "HSR Layout, Koramangala, BTM Layout, Bellandur, Sarjapur Road, Electronic City, Marathahalli, Bommanahalli, JP Nagar", "warranty": "15 days on labour"}')
on conflict (key) do nothing;

create table if not exists public.audit_log (
  id         bigserial primary key,
  actor      uuid default auth.uid(),
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner');
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
drop trigger if exists services_touch on public.services;
create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();

-- Paid / closed leads stop all automated follow-ups.
create or replace function public.stop_followups_when_closed() returns trigger language plpgsql as $$
begin
  if new.status in ('paid','scheduled','completed','lost') or new.opted_out then
    new.next_followup_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists leads_stop_followups on public.leads;
create trigger leads_stop_followups before insert or update on public.leads for each row execute function public.stop_followups_when_closed();

-- ───────────────────────── Row-level security ─────────────────────────
alter table public.services  enable row level security;
alter table public.customers enable row level security;
alter table public.bikes     enable row level security;
alter table public.leads     enable row level security;
alter table public.messages  enable row level security;
alter table public.admins    enable row level security;
alter table public.settings  enable row level security;
alter table public.audit_log enable row level security;

-- Public website can read active prices only. Everything else is admin-only.
-- Leads are written by the `submit-lead` Edge Function with the service role, never directly by the browser.
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon, authenticated using (active or public.is_admin());
drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists customers_admin on public.customers;
create policy customers_admin on public.customers for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists bikes_admin on public.bikes;
create policy bikes_admin on public.bikes for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads for select to authenticated using (public.is_admin());
drop policy if exists leads_admin_update on public.leads;
create policy leads_admin_update on public.leads for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists leads_admin_insert on public.leads;
create policy leads_admin_insert on public.leads for insert to authenticated with check (public.is_admin());
drop policy if exists messages_admin_read on public.messages;
create policy messages_admin_read on public.messages for select to authenticated using (public.is_admin());
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated using (public.is_admin());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for select to authenticated using (public.is_admin());
drop policy if exists settings_owner_write on public.settings;
create policy settings_owner_write on public.settings for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());
drop policy if exists audit_admin_insert on public.audit_log;
create policy audit_admin_insert on public.audit_log for insert to authenticated with check (public.is_admin() and actor = auth.uid());

-- Live updates in the admin panel
do $$ begin
  begin alter publication supabase_realtime add table public.leads; exception when others then null; end;
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
end $$;

-- ───────────────────────── After running this file ─────────────────────────
-- 1) Authentication → Users → "Add user" (your email + strong password).
-- 2) Make that user an admin:
--    insert into public.admins (user_id, name, role)
--    select id, 'Owner', 'owner' from auth.users where email = 'you@example.com';
-- 3) Schedule follow-ups (Database → Extensions: enable pg_cron and pg_net), then:
--    select cron.schedule('mxp-followups', '*/10 * * * *', $cron$
--      select net.http_post(
--        url := 'https://<project-ref>.supabase.co/functions/v1/follow-up',
--        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--        body := '{}'::jsonb);
--    $cron$);
