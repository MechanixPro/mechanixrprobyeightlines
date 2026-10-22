-- Care Buddy desk, part 13: the Team screen also shows when each scheduled job last ran, even on a quiet run that logs nothing.
create or replace function public.crm_automation_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('manage_users');
  return jsonb_build_object(
    'switches', jsonb_build_object('rating', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_auto_rating'), true), 'sla', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_sla_alerts'), true),
      'report', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_daily_report'), true), 'campaigns_ready', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'desk_campaigns_ready'), false)),
    'campaigns', coalesce((select value from public.settings where key = 'desk_campaigns'), '{}'::jsonb),
    'heartbeat', jsonb_build_object('automation', (select value from public.settings where key = 'desk_automation_heartbeat'), 'poll', (select value from public.settings where key = 'desk_poll_heartbeat')),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.job, 'ran_at', j.ran_at, 'ok', j.ok, 'summary', j.summary) order by j.job) from (select distinct on (job) job, ran_at, ok, summary from public.crm_automation_log order by job, ran_at desc) j), '[]'::jsonb),
    'ratings_30d', (select jsonb_build_object('count', count(*), 'avg', round(avg(rating)::numeric, 2)) from public.lead_ratings where created_at > now() - interval '30 days'),
    'cron', coalesce((select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)) from cron.job where jobname like 'desk-%'), '[]'::jsonb));
end; $$;
revoke all on function public.crm_automation_status() from public;
grant execute on function public.crm_automation_status() to authenticated;
