-- The ad click behind a WhatsApp "Ref: XXXXX" code. Saved by the log-click function only; admins can read it to link a booking to its ad click.
create table if not exists public.ad_clicks (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{5}$'),
  created_at timestamptz not null default now(),
  utm        jsonb not null default '{}'::jsonb,
  gclid      text,
  page       text,
  ip_hash    text
);
create index if not exists ad_clicks_created_idx on public.ad_clicks (created_at desc);
create index if not exists ad_clicks_ip_idx on public.ad_clicks (ip_hash, created_at desc);
alter table public.ad_clicks enable row level security;
create policy ad_clicks_admin_read on public.ad_clicks for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.ad_clicks from anon, authenticated;
