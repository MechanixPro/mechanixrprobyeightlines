-- Saved copies of invoices. One row is saved each time an invoice is emailed or printed from the admin.
-- A copy keeps the GST figures and the mechanic's cut as they were at that moment, so the accountant's numbers never change later.
-- Nobody can edit or delete a copy; a changed invoice is saved as a new revision.
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete restrict,
  ref              text not null,
  number           text not null,
  revision         integer not null default 1 check (revision >= 1),
  issued_at        timestamptz not null default now(),
  via              text not null default 'print' check (via in ('print', 'email', 'rebuilt')),
  customer_id      uuid references public.customers(id) on delete set null,
  customer_name    text not null,
  customer_phone   text,
  customer_company text,
  customer_gstin   text,
  mechanic_id      uuid references public.mechanics(id) on delete set null,
  mechanic_name    text,
  has_gst          boolean not null,
  gst_rate         integer not null check (gst_rate in (0, 5, 12, 18)),
  basis            text not null check (basis in ('excl', 'incl')),
  taxable          numeric(12,2) not null,
  cgst             numeric(12,2) not null,
  sgst             numeric(12,2) not null,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  paid             numeric(12,2) not null default 0,
  balance          numeric(12,2) not null default 0,
  payout_basis     text not null default 'collected' check (payout_basis in ('collected', 'before_gst')),
  mechanic_rate    integer not null default 0 check (mechanic_rate between 0 and 100),
  mechanic_cut     numeric(12,2) not null default 0,
  company_share    numeric(12,2) not null default 0,
  payable_now      numeric(12,2) not null default 0,
  lines            jsonb not null default '[]'::jsonb,
  unique (lead_id, revision)
);
create index if not exists invoices_issued_idx on public.invoices (issued_at desc);
create index if not exists invoices_mechanic_idx on public.invoices (mechanic_id);
alter table public.invoices enable row level security;
create policy invoices_admin_read on public.invoices for select to authenticated using (public.is_admin());
create policy invoices_admin_add on public.invoices for insert to authenticated with check (public.is_admin());
revoke update, delete on public.invoices from authenticated, anon;
