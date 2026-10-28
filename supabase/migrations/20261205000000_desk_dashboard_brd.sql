-- Sales dashboard BRD: follow-up numbers and rep capacity, export audit log, and bulk lead import with a duplicate check.

-- 1. Follow-ups and rep capacity. Supervisors with team performance see every active Care Buddy; everyone sees their own line.
create or replace function public.crm_followup_capacity(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  f timestamptz := coalesce((p_from::timestamp at time zone 'Asia/Kolkata'), date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  t timestamptz := coalesce(((p_to + 1)::timestamp at time zone 'Asia/Kolkata'), now() + interval '1 day');
  d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  cap int := coalesce((select (value #>> '{}')::int from public.settings where key = 'crm_lead_capacity'), 30);
  allv boolean; res jsonb;
begin
  perform public.crm_need_role(); perform public.crm_need_page('dashboard');
  allv := public.crm_can('view_all_leads');
  with o as (
    select * from public.leads l where l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent') and (allv or l.crm_owner = me or l.crm_owner is null)
  )
  select jsonb_build_object(
    'capacity', cap,
    'overdue',  (select count(*) from o where crm_next_action_at < now()),
    'today',    (select count(*) from o where crm_next_action_at >= now() and crm_next_action_at < d0 + interval '1 day'),
    'upcoming', (select count(*) from o where crm_next_action_at >= d0 + interval '1 day'),
    'none',     (select count(*) from o where crm_next_action_at is null and crm_owner is not null),
    'contacts', (select count(*) from public.crm_activities a join public.leads l on l.id = a.lead_id where a.kind in ('call','whatsapp') and a.created_at >= f and a.created_at < t and (allv or l.crm_owner = me or l.crm_owner is null))
  ) into res;
  if public.crm_can('view_team_performance') then
    res := res || jsonb_build_object('agents', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id, 'name', u.name,
      'open', x.open, 'overdue', x.overdue, 'today', x.today, 'contacts', x.contacts, 'capacity', cap,
      'load_pct', case when cap > 0 then round(x.open * 100.0 / cap) else 0 end) order by u.name)
      from public.crm_users u cross join lateral (
        select count(*) filter (where l.status in ('new','contacted','quoted','payment_sent')) open,
               count(*) filter (where l.status in ('new','contacted','quoted','payment_sent') and l.crm_next_action_at < now()) overdue,
               count(*) filter (where l.status in ('new','contacted','quoted','payment_sent') and l.crm_next_action_at >= now() and l.crm_next_action_at < d0 + interval '1 day') today,
               (select count(*) from public.crm_activities a where a.actor = u.user_id and a.kind in ('call','whatsapp') and a.created_at >= f and a.created_at < t) contacts
        from public.leads l where l.deleted_at is null and l.crm_owner = u.user_id) x
      where u.active), '[]'::jsonb));
  end if;
  return res;
end; $$;

-- 2. Export audit log: the desk calls this before it hands over a file.
create or replace function public.crm_log_export(p_what text, p_format text, p_rows integer, p_filters jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('export');
  if p_format not in ('csv','xlsx','pdf') then raise exception 'unknown format' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'crm_export', jsonb_build_object('what', left(coalesce(p_what, ''), 40), 'format', p_format, 'rows', coalesce(p_rows, 0), 'filters', coalesce(p_filters, '{}'::jsonb)));
end; $$;

-- 3. Bulk import: name and mobile are required. Rows that repeat a mobile number already open in the last 30 days, or earlier in the same file, are skipped and returned.
create or replace function public.crm_import_leads(p_rows jsonb, p_source text default 'phone') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; ph text; nm text; ar text; created int := 0; dups jsonb := '[]'::jsonb; bad jsonb := '[]'::jsonb; seen text[] := '{}'; i int := 0; nid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  if p_source not in ('phone','walk_in','instagram','whatsapp','website','app') then raise exception 'unknown source' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'no rows' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'import at most 500 rows at a time' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    ph := regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9]', '', 'g'); if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
    nm := trim(coalesce(r ->> 'name', '')); ar := nullif(left(trim(coalesce(r ->> 'area', '')), 40), '');
    if ph !~ '^[6-9][0-9]{9}$' or char_length(nm) not between 2 and 60 then bad := bad || jsonb_build_array(jsonb_build_object('row', i, 'name', left(nm, 60), 'phone', coalesce(r ->> 'phone', ''))); continue; end if;
    if ph = any(seen) or exists (select 1 from public.leads where phone = ph and deleted_at is null and status in ('new','contacted','quoted','payment_sent') and created_at > now() - interval '30 days') then
      dups := dups || jsonb_build_array(jsonb_build_object('row', i, 'name', nm, 'phone', ph)); continue; end if;
    seen := seen || ph;
    insert into public.leads (name, phone, area, source, status, crm_owner, consent_whatsapp) values (nm, ph, ar, p_source, 'new', null, false) returning id into nid;
    insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Imported from a file (' || p_source || ')');
    created := created + 1;
  end loop;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'crm_import', jsonb_build_object('created', created, 'duplicates', jsonb_array_length(dups), 'invalid', jsonb_array_length(bad), 'source', p_source));
  return jsonb_build_object('created', created, 'duplicates', dups, 'invalid', bad);
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_followup_capacity(date,date)','crm_log_export(text,text,integer,jsonb)','crm_import_leads(jsonb,text)']) loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
insert into public.settings (key, value) values ('crm_lead_capacity', '30'::jsonb) on conflict (key) do nothing;
