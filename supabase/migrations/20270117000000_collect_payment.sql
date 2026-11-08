-- P1 collect payment: the final-bill Razorpay link (id, url, amount only: no card or bank details), who asked to inspect first, and when the final payment was made.
-- rollback: alter table public.leads drop column if exists inspect_first, drop column if exists inspect_first_at, drop column if exists inspect_first_by, drop column if exists final_link_id, drop column if exists final_link_url, drop column if exists final_link_amount, drop column if exists final_paid_at, drop column if exists final_paid_method, drop column if exists final_paid_amount;
alter table public.leads add column if not exists inspect_first boolean not null default false;
alter table public.leads add column if not exists inspect_first_at timestamptz;
alter table public.leads add column if not exists inspect_first_by text;
alter table public.leads add column if not exists final_link_id text;
alter table public.leads add column if not exists final_link_url text;
alter table public.leads add column if not exists final_link_amount numeric(12,2);
alter table public.leads add column if not exists final_paid_at timestamptz;
alter table public.leads add column if not exists final_paid_method text check (final_paid_method in ('online','cash','upi'));
alter table public.leads add column if not exists final_paid_amount numeric(12,2);
