-- Invoice numbers run in one unbroken series per financial year (April to March): MP/26-27/0001, MP/26-27/0002, and so on.
-- A booking gets its number the first time an invoice is made for it, and keeps it. Older invoices keep the number they were issued with.
create table if not exists public.invoice_counters (fy text primary key, last_seq integer not null default 0);
create table if not exists public.invoice_numbers (
  lead_id uuid primary key references public.leads(id) on delete restrict,
  fy text not null, seq integer, number text not null unique, created_at timestamptz not null default now()
);
alter table public.invoice_counters enable row level security;
alter table public.invoice_numbers enable row level security;
drop policy if exists invoice_numbers_admin_read on public.invoice_numbers;
create policy invoice_numbers_admin_read on public.invoice_numbers for select to authenticated using (public.is_admin());

create or replace function public.invoice_no_alloc(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare n text; f text; s integer; y integer;
begin
  perform 1 from public.leads where id = p_lead for update;
  if not found then raise exception 'Booking not found'; end if;
  select number into n from public.invoice_numbers where lead_id = p_lead;
  if found then return n; end if;
  -- an invoice saved before numbering was fixed keeps its own number
  select regexp_replace(number, '-R[0-9]+$', '') into n from public.invoices where lead_id = p_lead and coalesce(doc_key, 'A') = 'A' order by revision limit 1;
  if n is not null then
    insert into public.invoice_numbers (lead_id, fy, seq, number) values (p_lead, 'legacy', null, n) on conflict (lead_id) do nothing;
    return n;
  end if;
  y := extract(year from ((now() at time zone 'Asia/Kolkata') - interval '3 months'))::integer;
  f := lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  insert into public.invoice_counters (fy, last_seq) values (f, 1) on conflict (fy) do update set last_seq = public.invoice_counters.last_seq + 1 returning last_seq into s;
  n := 'MP/' || f || '/' || lpad(s::text, 4, '0');
  insert into public.invoice_numbers (lead_id, fy, seq, number) values (p_lead, f, s, n);
  return n;
end $$;
revoke all on function public.invoice_no_alloc(uuid) from public, anon, authenticated;
grant execute on function public.invoice_no_alloc(uuid) to service_role;

create or replace function public.invoice_no_for(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  return public.invoice_no_alloc(p_lead);
end $$;
revoke all on function public.invoice_no_for(uuid) from public, anon;
grant execute on function public.invoice_no_for(uuid) to authenticated;

-- A vehicle number can have letters and digits only, 4 to 12 of them (this also fits the BH series such as 22BH1234A).
alter table public.bikes drop constraint if exists bikes_reg_no_check;
alter table public.bikes add constraint bikes_reg_no_check check (reg_no is null or reg_no ~ '^[A-Z0-9]{4,12}$') not valid;
