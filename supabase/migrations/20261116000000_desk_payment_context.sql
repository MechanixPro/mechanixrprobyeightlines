-- Care Buddy desk, part 7: what the "send payment link" step needs to know, checked as the signed-in person.
-- The edge function calls this first, so the permission and ownership rules live in the database.

create or replace function public.crm_payment_context(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.crm_need_role(); perform public.crm_require('send_payment_link');
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (coalesce(l.crm_owner = auth.uid(), false) or public.crm_can('assign_leads')) then raise exception 'take the lead first' using errcode = '42501'; end if;
  if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already confirmed' using errcode = 'P0001'; end if;
  if l.status = 'lost' then raise exception 'this lead is closed as lost' using errcode = 'P0001'; end if;
  return jsonb_build_object('lead_id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'status', l.status, 'est_total', l.est_total, 'can_override', public.crm_can('assign_leads'),
    'existing_link', l.payment_link is not null, 'existing_amount', l.amount_due);
end; $$;

revoke all on function public.crm_payment_context(uuid) from public;
grant execute on function public.crm_payment_context(uuid) to authenticated;
