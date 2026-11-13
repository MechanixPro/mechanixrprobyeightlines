-- Hardening from the 2026-11-13 database audit. Safe to run twice (if-not-exists, create-or-replace, drop-then-create, guarded blocks).
-- Apply (as the project owner, in your own terminal):  npx supabase db query --linked -f supabase/migrations/20270145000000_hardening.sql
-- It changes no data. It adds indexes, one row lock, tighter manual-entry rules on the money ledger, and an audit row for every manual ledger entry.
-- Roll back by hand if needed:
--   drop index if exists public.audit_log_act_ts, public.audit_log_pay, public.audit_log_lead;
--   drop trigger if exists ledger_zz_manual_audit on public.ledger_entries; drop function if exists public.ledger_manual_audit();
--   drop policy if exists ledger_admin_add on public.ledger_entries; create policy ledger_admin_add on public.ledger_entries for insert to authenticated with check (public.is_admin());

-- 1. audit_log is also the payment-dedupe and rate-limit store, queried on every payment and login. These keep that fast as it grows.
create index if not exists audit_log_act_ts on public.audit_log (action, created_at desc);
create index if not exists audit_log_pay on public.audit_log ((details->>'payment_id')) where action = 'payment_received';
create index if not exists audit_log_lead on public.audit_log ((details->>'lead'));

-- 2. Two ledger rows for one booking at the same moment (a webhook retry and an admin entry) could leave leads.paid_amount short.
--    The same function as before, with the booking row locked first so the second sum sees the first row.
create or replace function public.sync_lead_paid() returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid; amt numeric;
begin
  lid := coalesce(new.lead_id, (select lead_id from public.ledger_entries where id = new.reverses_id));
  if lid is null then return new; end if;
  perform 1 from public.leads where id = lid for update;
  select coalesce(sum(case e.entry_type when 'customer_payment' then e.amount when 'refund' then -e.amount else 0 end), 0) into amt
    from public.ledger_entries e
   where e.lead_id = lid and e.entry_type in ('customer_payment','refund')
     and not exists (select 1 from public.ledger_entries r where r.reverses_id = e.id);
  update public.leads set paid_amount = greatest(0, round(amt)), paid_at = case when amt > 0 then coalesce(paid_at, now()) else null end where id = lid;
  return new;
end $$;

-- 3. A signed-in admin's browser can add ledger rows, but only as a manual 'admin' entry under their own id. (Gateway and opening rows come from the server.)
drop policy if exists ledger_admin_add on public.ledger_entries;
create policy ledger_admin_add on public.ledger_entries for insert to authenticated
  with check (public.is_admin() and source = 'admin' and (created_by is null or created_by = auth.uid()));

-- 4. Every manual ledger entry leaves an audit row (who, what, how much).
create or replace function public.ledger_manual_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'admin' then
    insert into public.audit_log (actor, action, details)
    values (coalesce(auth.uid(), new.created_by), 'ledger_manual_entry', jsonb_build_object('entry', new.id, 'type', new.entry_type, 'amount', new.amount, 'lead', new.lead_id, 'method', new.method));
  end if;
  return new;
end $$;
drop trigger if exists ledger_zz_manual_audit on public.ledger_entries;
create trigger ledger_zz_manual_audit after insert on public.ledger_entries for each row execute function public.ledger_manual_audit();
revoke all on function public.ledger_manual_audit() from public, anon, authenticated;

-- 5. Foreign-key indexes and money checks. Each block skips quietly if that table or column is not there.
do $$ declare s text; begin
  foreach s in array array[
    'create index if not exists bikes_customer_idx on public.bikes (customer_id)',
    'create index if not exists leads_customer_idx on public.leads (customer_id) where customer_id is not null',
    'create index if not exists ledger_invoice_idx on public.ledger_entries (invoice_id) where invoice_id is not null',
    'create index if not exists crm_tickets_lead_idx on public.crm_tickets (lead_id)',
    'create index if not exists rsa_cases_lead_idx on public.rsa_cases (lead_id)',
    'create unique index if not exists booking_refunds_ref_uq on public.booking_refunds (lead_id, reference) where reference is not null'
  ] loop
    begin execute s;
    exception when undefined_table or undefined_column or unique_violation then raise notice 'skipped: %', s; end;
  end loop;
end $$;
do $$ begin
  alter table public.ledger_entries drop constraint if exists ledger_fee_nonneg_ck;
  alter table public.ledger_entries add constraint ledger_fee_nonneg_ck check (gateway_fee is null or gateway_fee >= 0) not valid;
exception when undefined_column then raise notice 'skipped ledger_fee_nonneg_ck'; end $$;
