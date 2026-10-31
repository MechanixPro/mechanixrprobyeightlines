-- Put the invoices issued before the numbering series in one proper series too (MP/26-27/0001, 0002, ... in the order first issued).
-- The number each one was issued with is kept in old_number, so an old invoice can still be found by its old number. Runs once.
alter table public.invoices add column if not exists old_number text;
do $$
begin
  if exists (select 1 from public.invoices where old_number is null and number like 'INV-%') then
    delete from public.invoice_numbers; delete from public.invoice_counters;
    create temp table _first on commit drop as
      select lead_id, min(issued_at) as first_at from public.invoices group by lead_id;
    create temp table _seq on commit drop as
      select lead_id, first_at, y from (
        select lead_id, first_at,
          (case when extract(month from (first_at at time zone 'Asia/Kolkata')) >= 4 then extract(year from (first_at at time zone 'Asia/Kolkata')) else extract(year from (first_at at time zone 'Asia/Kolkata')) - 1 end)::integer as y
        from _first) t;
    create temp table _num on commit drop as
      select lead_id, lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0') as fy, (row_number() over (partition by y order by first_at, lead_id))::integer as seq from _seq;
    insert into public.invoice_numbers (lead_id, fy, seq, number)
      select lead_id, fy, seq, 'MP/' || fy || '/' || lpad(seq::text, 4, '0') from _num;
    insert into public.invoice_counters (fy, last_seq) select fy, max(seq) from _num group by fy;
    update public.invoices i set old_number = i.number,
      number = n.number || (case when coalesce(i.doc_key, 'A') <> 'A' then '-' || i.doc_key else '' end) || (case when i.revision > 1 then '-R' || i.revision else '' end)
      from public.invoice_numbers n where n.lead_id = i.lead_id and i.old_number is null;
  end if;
end $$;
