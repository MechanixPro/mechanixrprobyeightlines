-- The desk sees the same figures as the admin for a lead: the vehicle, the quote (before GST), the invoice total (GST on top after the cutover), what the customer has paid and what is left.
create or replace function public.crm_lead_money(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads; inv numeric; paid numeric; reg text; blabel text;
begin
  perform public.crm_need_role();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, public.crm_need_role()) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select v.total into inv from public.invoices v where v.lead_id = p_lead and v.voided_at is null order by v.revision desc limit 1;
  select coalesce(sum(case when e.entry_type = 'customer_payment' then e.amount when e.entry_type = 'refund' then -e.amount else 0 end), 0) into paid
    from public.ledger_entries e where e.lead_id = p_lead and e.entry_type in ('customer_payment', 'refund') and not exists (select 1 from public.ledger_entries r where r.reverses_id = e.id);
  select b.reg_no, nullif(trim(coalesce(nullif(b.brand, 'Other'), '') || ' ' || coalesce(b.model, '')), '') into reg, blabel
    from public.bikes b where b.id = l.bike_id or (l.bike_id is null and b.customer_id = l.customer_id) order by (b.id = l.bike_id) desc nulls last limit 1;
  return jsonb_build_object('vehicle_reg', upper(reg), 'bike', blabel, 'quote', l.est_total, 'invoice_total', inv, 'paid', paid, 'balance', case when inv is null then null else greatest(inv - paid, 0) end);
end; $$;
revoke all on function public.crm_lead_money(uuid) from public;
grant execute on function public.crm_lead_money(uuid) to authenticated;
