-- Quotes waiting: sent quotes the customer has not decided on. Read-only. Rollback: drop function public.crm_quotes_waiting();
-- A lead's latest quote must be status 'sent' (not approved, declined, changes_requested or superseded) and not expired.
-- Supervisors and admins see all leads, agents only the leads they own. The quote total is returned to admins only, never to supervisors or agents.
create or replace function public.crm_quotes_waiting() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean; adm boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  boss := public.crm_can('view_all_leads'); adm := coalesce(public.is_admin(), false);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'sent_at', q.sent_at,
      'total', case when adm then q.total end, 'owner', public.crm_name(l.crm_owner)) order by q.sent_at)
    from public.leads l
    join lateral (select * from public.job_quotes jq where jq.lead_id = l.id and jq.status <> 'draft' order by jq.version desc limit 1) q on true
    where l.deleted_at is null and l.status not in ('lost','junk','completed')
      and q.status = 'sent' and q.sent_at is not null and q.sent_at <= now() - interval '2 hours'
      and (q.valid_until is null or q.valid_until > now())
      and (boss or coalesce(l.crm_owner = me, false))), '[]'::jsonb);
end; $$;
revoke all on function public.crm_quotes_waiting() from public, anon;
grant execute on function public.crm_quotes_waiting() to authenticated;
