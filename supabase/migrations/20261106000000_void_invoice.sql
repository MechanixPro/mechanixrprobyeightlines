-- "Delete invoice" hides an invoice from the register and the sales figures without erasing it: the saved copies stay in the database, marked with who, when and why.
-- Only the owner can do it, and the owner can restore. Money entries are handled the same way (a deleted payment is a dated reversal entry with a reason).
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists voided_by uuid;
alter table public.invoices add column if not exists void_reason text check (char_length(void_reason) <= 200);

create or replace function public.void_invoices(p_lead uuid, p_reason text) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'only the owner can delete an invoice'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is needed'; end if;
  update public.invoices set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 200) where lead_id = p_lead and voided_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.restore_invoices(p_lead uuid) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'only the owner can restore an invoice'; end if;
  update public.invoices set voided_at = null, voided_by = null, void_reason = null where lead_id = p_lead and voided_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.void_invoices(uuid, text), public.restore_invoices(uuid) from public, anon;
grant execute on function public.void_invoices(uuid, text), public.restore_invoices(uuid) to authenticated;
