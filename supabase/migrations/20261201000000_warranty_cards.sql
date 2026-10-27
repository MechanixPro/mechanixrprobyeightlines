-- Warranty cards: one per booking, issued when the booking is completed and fully paid. The customer opens a card page (QR / link) that confirms it is genuine.
create table if not exists public.warranty_cards (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  lead_id       uuid not null unique references public.leads(id) on delete cascade,
  customer_name text not null,
  phone         text,
  vehicle_reg   text,
  bike_label    text,
  service_name  text,
  done_on       date not null,
  valid_until   date not null,
  days          int  not null default 30,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.warranty_cards enable row level security;
drop policy if exists warranty_admin_read on public.warranty_cards;
create policy warranty_admin_read on public.warranty_cards for select to authenticated using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Bookings that are completed, have a live invoice, and where what the customer paid (less refunds, ignoring reversed entries) covers the invoice total. Service role only.
create or replace function public.warranty_candidates(p_since timestamptz)
returns table (lead_id uuid, ref text, name text, phone text, completed_at timestamptz, total numeric, paid numeric, service_id text, bike_id uuid, consent boolean)
language sql security definer set search_path = public as $$
  with inv as (
    select l.id, l.ref, l.name, l.phone, l.completed_at, l.service_id, l.bike_id, coalesce(l.consent_whatsapp, false) as consent,
      (select v.total from public.invoices v where v.lead_id = l.id and v.voided_at is null order by v.revision desc limit 1) as total,
      coalesce((select sum(case when e.entry_type = 'customer_payment' then e.amount when e.entry_type = 'refund' then -e.amount else 0 end)
        from public.ledger_entries e where e.lead_id = l.id and e.entry_type in ('customer_payment', 'refund')
          and not exists (select 1 from public.ledger_entries r where r.reverses_id = e.id)), 0) as paid
    from public.leads l
    where l.deleted_at is null and l.status = 'completed' and l.completed_at is not null and l.completed_at >= p_since
      and not exists (select 1 from public.warranty_cards w where w.lead_id = l.id)
  )
  select id, ref, name, phone, completed_at, total, paid, service_id, bike_id, consent from inv where total > 0 and paid >= total - 0.5 limit 40;
$$;
revoke all on function public.warranty_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.warranty_candidates(timestamptz) to service_role;

insert into public.settings (key, value) values ('warranty_since', to_jsonb(now()::text)), ('warranty_days', '30'::jsonb) on conflict (key) do nothing;
