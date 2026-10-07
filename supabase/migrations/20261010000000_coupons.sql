-- Discount codes. Private to admins: the website never reads this table, the submit-lead function checks codes on the server.
create table if not exists public.coupons (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9_-]{3,20}$'),
  kind       text not null check (kind in ('percent','flat')),
  value      integer not null check (value > 0),
  min_amount integer not null default 0 check (min_amount >= 0),
  active     boolean not null default true,
  starts_on  date,
  ends_on    date,
  max_uses   integer check (max_uses > 0),
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  check (kind = 'flat' or value <= 100),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);
alter table public.coupons enable row level security;
drop policy if exists coupons_admin_read on public.coupons;
create policy coupons_admin_read on public.coupons for select to authenticated using (public.is_admin());
drop policy if exists coupons_owner_write on public.coupons;
create policy coupons_owner_write on public.coupons for all to authenticated using (public.is_owner()) with check (public.is_owner());

alter table public.leads
  add column if not exists coupon_code text,
  add column if not exists coupon_discount integer not null default 0;
create index if not exists leads_coupon_idx on public.leads (coupon_code) where coupon_code is not null;
