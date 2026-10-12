-- Money ledger. Every rupee event is one row that is never edited or deleted; a mistake is cancelled by a 'reversal' row with a reason.
-- customer_payment / refund: collected_by says who holds the money (company_manual, company_portal, mechanic).
-- write_off clears a customer balance with no cash. remittance = mechanic hands money to Mechanix Pro. payout = Mechanix Pro pays the mechanic.
create table if not exists public.ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  occurred_on    date not null default (now() at time zone 'Asia/Kolkata')::date,
  entry_type     text not null check (entry_type in ('customer_payment','refund','write_off','remittance','payout','reversal')),
  lead_id        uuid references public.leads(id) on delete restrict,
  invoice_id     uuid references public.invoices(id) on delete set null,
  mechanic_id    uuid references public.mechanics(id) on delete set null,
  amount         numeric(12,2) not null check (amount > 0),
  collected_by   text check (collected_by in ('company_manual','company_portal','mechanic')),
  method         text,
  reference      text,
  gateway_fee    numeric(12,2) not null default 0,
  gateway_txn_id text,
  reverses_id    uuid references public.ledger_entries(id),
  reason         text,
  note           text,
  source         text not null default 'admin' check (source in ('admin','gateway','opening')),
  created_by     uuid,
  check (entry_type not in ('customer_payment','refund') or (lead_id is not null and collected_by is not null)),
  check (entry_type not in ('remittance','payout') or mechanic_id is not null),
  check (entry_type <> 'reversal' or (reverses_id is not null and coalesce(reason,'') <> '')),
  check (entry_type <> 'write_off' or (lead_id is not null and coalesce(reason,'') <> ''))
);
create index if not exists ledger_lead_idx on public.ledger_entries (lead_id);
create index if not exists ledger_mech_idx on public.ledger_entries (mechanic_id);
create unique index if not exists ledger_gateway_txn_uq on public.ledger_entries (gateway_txn_id) where gateway_txn_id is not null;
create unique index if not exists ledger_one_reversal_uq on public.ledger_entries (reverses_id) where reverses_id is not null;
alter table public.ledger_entries enable row level security;
create policy ledger_admin_read on public.ledger_entries for select to authenticated using (public.is_admin());
create policy ledger_admin_add on public.ledger_entries for insert to authenticated with check (public.is_admin());
revoke update, delete on public.ledger_entries from authenticated, anon;

-- leads.paid_amount is now always what the ledger says: payments less refunds, ignoring cancelled entries.
create or replace function public.sync_lead_paid() returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid; amt numeric;
begin
  lid := coalesce(new.lead_id, (select lead_id from public.ledger_entries where id = new.reverses_id));
  if lid is null then return new; end if;
  select coalesce(sum(case e.entry_type when 'customer_payment' then e.amount when 'refund' then -e.amount else 0 end), 0) into amt
    from public.ledger_entries e
   where e.lead_id = lid and e.entry_type in ('customer_payment','refund')
     and not exists (select 1 from public.ledger_entries r where r.reverses_id = e.id);
  update public.leads set paid_amount = greatest(0, round(amt)), paid_at = case when amt > 0 then coalesce(paid_at, now()) else null end where id = lid;
  return new;
end $$;
drop trigger if exists ledger_sync_paid on public.ledger_entries;
create trigger ledger_sync_paid after insert on public.ledger_entries for each row execute function public.sync_lead_paid();

-- invoices.via gains 'generated' (an invoice made without printing or emailing).
alter table public.invoices drop constraint if exists invoices_via_check;
alter table public.invoices add constraint invoices_via_check check (via in ('print','email','rebuilt','generated'));

-- Opening balances: money already recorded on bookings becomes one ledger row each, so nothing is lost and totals match.
-- Razorpay-paid bookings (audit log has a payment_received with a payment id) count as portal; the rest as manual.
insert into public.ledger_entries (lead_id, amount, entry_type, collected_by, method, source, reference, note, occurred_on)
select l.id, l.paid_amount, 'customer_payment',
       case when exists (select 1 from public.audit_log a where a.action = 'payment_received' and a.details->>'lead' = l.ref and a.details ? 'payment_id') then 'company_portal' else 'company_manual' end,
       'opening balance', 'opening', 'opening', 'Carried over from the booking before the ledger started',
       (coalesce(l.paid_at, l.created_at) at time zone 'Asia/Kolkata')::date
  from public.leads l
 where coalesce(l.paid_amount, 0) > 0
   and not exists (select 1 from public.ledger_entries e where e.lead_id = l.id);
