-- Email: an optional address on bookings, marketing consent kept on the customer, and a log of every email sent.
alter table public.leads
  add column if not exists email text check (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(email) <= 120),
  add column if not exists email_marketing boolean not null default false;

alter table public.customers
  add column if not exists email text check (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(email) <= 120),
  add column if not exists email_marketing_consent boolean not null default false,
  add column if not exists email_unsubscribed_at timestamptz;
create index if not exists customers_email_idx on public.customers (email) where email is not null;

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads(id) on delete set null,
  to_email    text not null,
  template    text not null,
  status      text not null check (status in ('sent','failed','skipped')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists email_log_created_idx on public.email_log (created_at desc);
alter table public.email_log enable row level security;
drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log for select to authenticated using (public.is_admin());
