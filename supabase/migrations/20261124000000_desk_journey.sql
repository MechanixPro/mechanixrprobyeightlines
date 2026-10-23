-- Care Buddy desk, part 14: journey messages on WhatsApp (quote ready, booking confirmed, service done) get their own switch.
insert into public.settings (key, value) values ('desk_auto_journey', 'true'), ('desk_journey_since', to_jsonb(now()::text)) on conflict (key) do nothing;

create or replace function public.crm_automation_set(p_switch text, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
declare k text := case p_switch when 'rating' then 'desk_auto_rating' when 'sla' then 'desk_sla_alerts' when 'report' then 'desk_daily_report' when 'journey' then 'desk_auto_journey' end;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  if k is null then raise exception 'unknown switch' using errcode = 'P0001'; end if;
  insert into public.settings (key, value) values (k, to_jsonb(coalesce(p_on, false))) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'desk_automation_switch', jsonb_build_object('switch', p_switch, 'on', p_on));
end; $$;
revoke all on function public.crm_automation_set(text, boolean) from public;
grant execute on function public.crm_automation_set(text, boolean) to authenticated;

create or replace function public.crm_automation_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  return jsonb_build_object(
    'switches', jsonb_build_object('rating', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_auto_rating'), true), 'sla', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_sla_alerts'), true),
      'journey', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_auto_journey'), true),
      'report', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_daily_report'), true), 'campaigns_ready', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_campaigns_ready'), false)),
    'campaigns', coalesce((select value from public.settings where key = 'desk_campaigns'), '{}'::jsonb),
    'heartbeat', jsonb_build_object('automation', (select value from public.settings where key = 'desk_automation_heartbeat'), 'poll', (select value from public.settings where key = 'desk_poll_heartbeat')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.job, 'ran_at', j.ran_at, 'ok', j.ok, 'summary', j.summary) order by j.job) from (select distinct on (job) job, ran_at, ok, summary from public.crm_automation_log order by job, ran_at desc) j), '[]'::jsonb),
    'ratings_30d', (select jsonb_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2)) from public.lead_ratings where created_at > now() - interval '30 days'),
    'cron', coalesce((select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)) from cron.job where jobname like 'desk-%'), '[]'::jsonb));
end; $$;
revoke all on function public.crm_automation_status() from public;
grant execute on function public.crm_automation_status() to authenticated;
