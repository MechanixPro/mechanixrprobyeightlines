-- Order ID = invoice number, in one serial series per financial year (April to March): MP-26-27-0001, MP-26-27-0002, ...
-- Every booking gets its serial ID when it is created. Its invoice uses the very same number. Runs once on old data:
-- every older booking is numbered in the order it was created, and its earlier random ID is kept in old_ref so links already sent still work.
alter table public.leads add column if not exists old_ref text;
create index if not exists leads_old_ref_idx on public.leads (old_ref) where old_ref is not null;
create table if not exists public.order_counters (fy text primary key, last_seq integer not null default 0);
alter table public.order_counters enable row level security;

create or replace function public.order_ref_next(p_at timestamptz default now()) returns text language plpgsql security definer set search_path = public as $$
declare y integer; f text; s integer;
begin
  y := extract(year from ((p_at at time zone 'Asia/Kolkata') - interval '3 months'))::integer;
  f := lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  insert into public.order_counters (fy, last_seq) values (f, 1) on conflict (fy) do update set last_seq = public.order_counters.last_seq + 1 returning last_seq into s;
  return 'MP-' || f || '-' || lpad(s::text, 4, '0');
end $$;
revoke all on function public.order_ref_next(timestamptz) from public, anon, authenticated;

create or replace function public.leads_serial_ref() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ref is null or new.ref !~ '^MP-[0-9]{2}-[0-9]{2}-[0-9]{4}$' then new.ref := public.order_ref_next(coalesce(new.created_at, now())); end if;
  return new;
end $$;
drop trigger if exists leads_serial_ref_tr on public.leads;
create trigger leads_serial_ref_tr before insert on public.leads for each row execute function public.leads_serial_ref();

do $$
begin
  if exists (select 1 from public.leads where ref !~ '^MP-[0-9]{2}-[0-9]{2}-[0-9]{4}$') then
    delete from public.order_counters;
    create temp table _o on commit drop as
      select id, ref as old, 'MP-' || fy || '-' || lpad((row_number() over (partition by fy order by created_at, id))::text, 4, '0') as new_ref, fy from (
        select id, ref, created_at, lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0') as fy from (
          select id, ref, created_at, extract(year from ((created_at at time zone 'Asia/Kolkata') - interval '3 months'))::integer as y from public.leads) a) b;
    update public.leads l set old_ref = coalesce(l.old_ref, l.ref), ref = o.new_ref from _o o where o.id = l.id;
    insert into public.order_counters (fy, last_seq) select fy, count(*) from _o group by fy;
  end if;
end $$;

-- The invoice number is the order ID. Invoices already made are moved onto it; the number they had before stays in old_number.
create or replace function public.invoice_no_alloc(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select ref into n from public.leads where id = p_lead for update;
  if not found then raise exception 'Booking not found'; end if;
  insert into public.invoice_numbers (lead_id, fy, seq, number) values (p_lead, substr(n, 4, 5), nullif(right(n, 4), '')::integer, n)
    on conflict (lead_id) do update set number = excluded.number, fy = excluded.fy, seq = excluded.seq;
  return n;
end $$;
revoke all on function public.invoice_no_alloc(uuid) from public, anon, authenticated;
grant execute on function public.invoice_no_alloc(uuid) to service_role;

update public.invoice_numbers n set number = l.ref, fy = substr(l.ref, 4, 5), seq = right(l.ref, 4)::integer from public.leads l where l.id = n.lead_id and n.number <> l.ref;
update public.invoices i set old_number = coalesce(i.old_number, i.number),
  number = l.ref || (case when coalesce(i.doc_key, 'A') <> 'A' then '-' || i.doc_key else '' end) || (case when i.revision > 1 then '-R' || i.revision else '' end)
  from public.leads l where l.id = i.lead_id and i.number is distinct from (l.ref || (case when coalesce(i.doc_key, 'A') <> 'A' then '-' || i.doc_key else '' end) || (case when i.revision > 1 then '-R' || i.revision else '' end));
