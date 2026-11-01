-- Website bookings stay out of the desk's numbers and lists. The desk team works its own leads (calls, walk-ins, ones added by hand),
-- and website bookings have their own "Web leads" tab. They are still saved, still shown in the admin, and still emailed to the team at once.
create or replace view public.crm_desk_leads as select * from public.leads where source is distinct from 'website';
revoke all on public.crm_desk_leads from public, anon, authenticated;

do $$
declare f text; def text;
begin
  foreach f in array array['crm_dashboard','crm_followup_capacity','crm_leads_list','crm_leads_summary','crm_my_leads','crm_queue','crm_replies_waiting'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f;
    if def is not null and def !~ 'crm_desk_leads' then execute regexp_replace(def, 'public\.leads\y', 'public.crm_desk_leads', 'g'); end if;
  end loop;
end $$;

create or replace function public.crm_web_leads(p_filter text default 'open', p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role();
  if not (public.crm_can('take_leads') or public.crm_can('view_all_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at') desc) from (
    select jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'area', l.area, 'service', s.name, 'status', l.status,
      'est_total', l.est_total, 'created_at', l.created_at, 'owner', public.crm_name(l.crm_owner), 'owner_id', l.crm_owner,
      'when', nullif(concat_ws(' ', l.preferred_date::text, l.preferred_slot), '')) as x
    from public.leads l left join public.services s on s.id = l.service_id
    where l.source = 'website' and l.deleted_at is null
      and (case when coalesce(p_filter, 'open') = 'open' then l.status in ('new','contacted','quoted','payment_sent') else true end)
      and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
      and (q is null or l.name ilike '%' || q || '%' or l.phone ilike '%' || q || '%' or l.ref ilike '%' || q || '%')
    order by l.created_at desc limit 300) t), '[]'::jsonb);
end; $$;
revoke all on function public.crm_web_leads(text, text) from public, anon;
grant execute on function public.crm_web_leads(text, text) to authenticated;
