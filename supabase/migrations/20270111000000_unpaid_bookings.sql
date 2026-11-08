-- Not paid yet: /book/ customers who opened a payment order but have not paid. Read-only. Rollback: drop function public.crm_unpaid_bookings();
-- A lead qualifies when rzp_order_id is set, confirm_paid_at is null, it was created 15 minutes to 3 days ago, status is new/contacted/quoted/payment_sent and it is not deleted.
-- Supervisors and admins see all; agents see leads they own, or unowned leads if they may take leads (same scoping as crm_web_leads). The fee is returned to admins only.
create or replace function public.crm_unpaid_bookings() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean; adm boolean; take boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  boss := public.crm_can('view_all_leads'); adm := coalesce(public.is_admin(), false); take := public.crm_can('take_leads');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'vehicle', l.vehicle, 'service', s.name,
      'created_at', l.created_at, 'confirm_fee', case when adm then l.confirm_fee end, 'owner', public.crm_name(l.crm_owner)) order by l.created_at desc)
    from public.leads l left join public.services s on s.id = l.service_id
    where l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent')
      and l.rzp_order_id is not null and l.confirm_paid_at is null
      and l.created_at <= now() - interval '15 minutes' and l.created_at >= now() - interval '3 days'
      and (boss or coalesce(l.crm_owner = me, false) or (l.crm_owner is null and take))), '[]'::jsonb);
end; $$;
revoke all on function public.crm_unpaid_bookings() from public, anon;
grant execute on function public.crm_unpaid_bookings() to authenticated;
