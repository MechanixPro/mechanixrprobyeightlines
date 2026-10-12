-- Online payments are settled by the gateway a day or two later. The settlement status is the one thing on a ledger row that may change; the money figures stay immutable.
alter table public.ledger_entries add column if not exists settlement_status text check (settlement_status in ('pending','settled'));
alter table public.ledger_entries add column if not exists settled_on date;
update public.ledger_entries set settlement_status = 'pending' where collected_by = 'company_portal' and entry_type = 'customer_payment' and settlement_status is null and source <> 'opening';

create or replace function public.set_settlement(entry_id uuid, settled boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.ledger_entries
     set settlement_status = case when settled then 'settled' else 'pending' end,
         settled_on = case when settled then (now() at time zone 'Asia/Kolkata')::date else null end
   where id = entry_id and entry_type = 'customer_payment' and collected_by = 'company_portal';
end $$;
revoke all on function public.set_settlement(uuid, boolean) from public, anon;
grant execute on function public.set_settlement(uuid, boolean) to authenticated;
