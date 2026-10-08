-- Issues, refunds and warranty redo requests, tracked against a booking. Refund money is still paid back by the owner through Razorpay; this table is the record.
create table if not exists public.issues (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads(id) on delete set null,
  kind        text not null check (kind in ('complaint','refund','warranty')),
  status      text not null default 'open' check (status in ('open','in_progress','resolved')),
  amount      integer check (amount is null or amount between 0 and 100000),
  note        text check (char_length(note) <= 1000),
  resolution  text check (char_length(resolution) <= 1000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists issues_status_idx on public.issues (status, created_at desc);
create index if not exists issues_lead_idx on public.issues (lead_id);
alter table public.issues enable row level security;
drop policy if exists issues_admin_all on public.issues;
create policy issues_admin_all on public.issues for all to authenticated using (public.is_admin()) with check (public.is_admin());
