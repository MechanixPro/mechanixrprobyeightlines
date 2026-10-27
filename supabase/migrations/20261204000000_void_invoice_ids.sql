-- Delete or restore chosen invoice copies (by id) from a booking or the register. Owner only; copies are hidden, never erased.
create or replace function public.void_invoice_ids(p_ids uuid[], p_reason text) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'only the owner can delete an invoice'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is needed'; end if;
  update public.invoices set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 200) where id = any(p_ids) and voided_at is null;
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.restore_invoice_ids(p_ids uuid[]) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'only the owner can restore an invoice'; end if;
  update public.invoices set voided_at = null, voided_by = null, void_reason = null where id = any(p_ids) and voided_at is not null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.void_invoice_ids(uuid[], text), public.restore_invoice_ids(uuid[]) from public, anon;
grant execute on function public.void_invoice_ids(uuid[], text), public.restore_invoice_ids(uuid[]) to authenticated;
