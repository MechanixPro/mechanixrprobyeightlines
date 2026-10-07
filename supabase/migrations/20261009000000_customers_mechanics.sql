-- Customers can be blocked (spam) and annotated; mechanics get a roster; bookings can be assigned to a mechanic.
alter table public.customers
  add column if not exists blocked boolean not null default false,
  add column if not exists blocked_reason text check (char_length(blocked_reason) <= 200),
  add column if not exists notes text check (char_length(notes) <= 1000);

create table if not exists public.mechanics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 60),
  phone       text not null check (phone ~ '^[6-9][0-9]{9}$'),
  area        text,
  active      boolean not null default true,
  payout_rate integer not null default 0 check (payout_rate between 0 and 100),
  created_at  timestamptz not null default now()
);
alter table public.mechanics enable row level security;
drop policy if exists mechanics_admin_read on public.mechanics;
create policy mechanics_admin_read on public.mechanics for select to authenticated using (public.is_admin());
drop policy if exists mechanics_owner_write on public.mechanics;
create policy mechanics_owner_write on public.mechanics for all to authenticated using (public.is_owner()) with check (public.is_owner());

alter table public.leads add column if not exists mechanic_id uuid references public.mechanics(id) on delete set null;
create index if not exists leads_mechanic_idx on public.leads (mechanic_id) where mechanic_id is not null;
