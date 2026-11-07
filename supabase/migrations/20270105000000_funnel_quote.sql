-- Funnel and proper quote document. Every statement is safe to repeat. Not applied anywhere: tested on the local Postgres harness only.
-- Rollback (owner-run, only if needed):
--   drop function if exists public.crm_funnel(date, date, text, text, uuid, text), public.crm_funnel_options(), public.crm_quote_link(uuid), public.funnel_targets();
--   alter table public.job_quotes drop column if exists quote_no, drop column if exists valid_until, drop column if exists change_request, drop column if exists changes_at, drop column if exists terms;
--   then re-run 20261228000000_paid_confirmation.sql to restore crm_quote_send, crm_quote_get and quote_decide.

-- 1. The quote document: a number, a validity date, one-line terms, and the customer's "ask for changes" message.
alter table public.job_quotes
  add column if not exists quote_no       text,
  add column if not exists valid_until    timestamptz,
  add column if not exists change_request text check (char_length(change_request) <= 500),
  add column if not exists changes_at     timestamptz,
  add column if not exists terms          text check (char_length(terms) <= 240);
alter table public.job_quotes drop constraint if exists job_quotes_status_check;
alter table public.job_quotes add constraint job_quotes_status_check check (status in ('draft','sent','approved','declined','superseded','changes_requested'));

-- 2. Targets the desk is measured against (editable in the settings table; the defaults are the owner's).
insert into public.settings (key, value) values
  ('funnel_targets', '{"claim_minutes": 15, "quote_hours": 2}'),
  ('quote_valid_days', '3')
on conflict (key) do nothing;

create or replace function public.funnel_targets() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t jsonb; d int;
begin
  perform public.flow_need();
  select value into t from public.settings where key = 'funnel_targets';
  begin select (value #>> '{}')::int into d from public.settings where key = 'quote_valid_days'; exception when others then d := null; end;
  return jsonb_build_object(
    'claim_minutes', case when jsonb_typeof(t -> 'claim_minutes') = 'number' and (t ->> 'claim_minutes')::numeric > 0 then (t ->> 'claim_minutes')::numeric else 15 end,
    'quote_hours',   case when jsonb_typeof(t -> 'quote_hours') = 'number' and (t ->> 'quote_hours')::numeric > 0 then (t ->> 'quote_hours')::numeric else 2 end,
    'valid_days',    coalesce(nullif(d, 0), 3));
end; $$;
revoke all on function public.funnel_targets() from public, anon;
grant execute on function public.funnel_targets() to authenticated;

-- 3. Sending a quote now stamps its number (Q-<booking ID or lead ref>-<revision>) and its validity date. Everything else is as before.
create or replace function public.crm_quote_send(p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; q public.job_quotes; days int := 3; vu timestamptz; qn text;
begin
  l := public.quote_guard(p_lead);
  select * into q from public.job_quotes where lead_id = p_lead and status = 'draft';
  if not found then raise exception 'save the quote first' using errcode = 'P0001'; end if;
  if q.eta_text is null or q.eta_kind is null then raise exception 'set the estimated delivery before sending the quote' using errcode = 'P0001'; end if;
  begin select coalesce(nullif((value #>> '{}')::int, 0), 3) into days from public.settings where key = 'quote_valid_days'; exception when others then days := 3; end;
  days := coalesce(days, 3);
  vu := now() + make_interval(days => days);
  qn := 'Q-' || coalesce(nullif(btrim(l.booking_id), ''), l.ref, left(l.id::text, 8)) || '-' || q.version;
  update public.job_quotes set status = 'superseded' where lead_id = p_lead and status in ('sent','approved','changes_requested') and id <> q.id;
  update public.job_quotes set status = 'sent', sent_at = now(), valid_until = vu, quote_no = qn, terms = coalesce(terms, 'Valid for ' || days || ' days. Work starts only after you approve. GST is included in the total.') where id = q.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Quote ' || qn || ' sent: total Rs ' || q.total || ' incl. GST, balance Rs ' || q.balance || ', delivery ' || q.eta_text || ', valid to ' || to_char(vu at time zone 'Asia/Kolkata', 'DD Mon'));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'quote_sent', jsonb_build_object('lead', l.ref, 'version', q.version, 'total', q.total));
  return jsonb_build_object('version', q.version, 'quote_no', qn, 'valid_until', vu, 'total', q.total, 'balance', q.balance, 'eta_text', q.eta_text);
end; $$;
revoke all on function public.crm_quote_send(uuid) from public, anon;
grant execute on function public.crm_quote_send(uuid) to authenticated;

-- 4. The customer's answer: approve, decline with a reason, or ask for changes (a message the desk sees). A quote past its validity date cannot be approved.
create or replace function public.quote_decide(p_token text, p_version int, p_decision text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.booking_secrets; l public.leads; q public.job_quotes; why text := nullif(left(btrim(coalesce(p_reason, '')), case when p_decision = 'changes' then 500 else 200 end), ''); newst text;
begin
  if p_decision not in ('approve','decline','changes') then raise exception 'bad decision'; end if;
  select * into s from public.booking_secrets where track_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = s.lead_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into q from public.job_quotes where lead_id = l.id and version = p_version;
  if not found or q.status = 'draft' then return jsonb_build_object('ok', false, 'error', 'This quote is not available.'); end if;
  if q.status = 'superseded' then return jsonb_build_object('ok', false, 'error', 'This quote was replaced by a newer one. Reload the page.', 'superseded', true); end if;
  newst := case p_decision when 'approve' then 'approved' when 'decline' then 'declined' else 'changes_requested' end;
  if q.status = newst and p_decision <> 'changes' then return jsonb_build_object('ok', true, 'already', true, 'status', q.status, 'version', q.version); end if;
  if q.status in ('approved','declined') then return jsonb_build_object('ok', false, 'error', 'This quote was already ' || q.status || '. Call us to change it.', 'status', q.status); end if;
  if p_decision = 'changes' and why is null then return jsonb_build_object('ok', false, 'error', 'Tell us what you would like changed.'); end if;
  if p_decision = 'approve' and q.valid_until is not null and q.valid_until < now() then return jsonb_build_object('ok', false, 'error', 'This quote has expired. Please ask us for a fresh one.', 'expired', true); end if;
  if p_decision = 'changes' then
    update public.job_quotes set status = 'changes_requested', change_request = why, changes_at = now() where id = q.id and status in ('sent','changes_requested');
  else
    update public.job_quotes set status = newst, decided_at = now(), decided_via = 'link', decline_reason = case when p_decision = 'decline' then why end where id = q.id and status in ('sent','changes_requested');
  end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note',
    'Customer ' || case p_decision when 'approve' then 'approved' when 'decline' then 'declined' else 'asked for changes to' end || ' quote v' || q.version || ' on the tracking link' || coalesce('. ' || case when p_decision = 'changes' then 'Message: ' else 'Reason: ' end || why, ''));
  insert into public.audit_log (action, details) values ('quote_' || newst, jsonb_build_object('lead', l.ref, 'version', q.version));
  return jsonb_build_object('ok', true, 'status', newst, 'version', q.version);
end; $$;
revoke all on function public.quote_decide(text, int, text, text) from public, anon, authenticated;
grant execute on function public.quote_decide(text, int, text, text) to service_role;

-- 5. The quote for the Crew sheet and the printable page: the new fields, and 'expired' worked out from the date.
create or replace function public.crm_quote_get(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'ref', l.ref, 'booking_id', l.booking_id,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', q.version, 'quote_no', q.quote_no, 'status', q.status, 'expired', (q.status = 'sent' and q.valid_until is not null and q.valid_until < now()), 'valid_until', q.valid_until,
        'total', q.total, 'balance', q.balance, 'eta_text', q.eta_text, 'sent_at', q.sent_at, 'decided_at', q.decided_at, 'decided_via', q.decided_via, 'decided_by', public.crm_name(q.decided_by),
        'decline_reason', q.decline_reason, 'change_request', q.change_request, 'changes_at', q.changes_at) order by q.version desc) from public.job_quotes q where q.lead_id = p_lead), '[]'::jsonb),
    'latest', (select jsonb_build_object('version', q.version, 'quote_no', q.quote_no, 'status', q.status, 'expired', (q.status = 'sent' and q.valid_until is not null and q.valid_until < now()), 'valid_until', q.valid_until, 'terms', q.terms,
        'change_request', q.change_request, 'lines', q.lines, 'subtotal', q.subtotal, 'gst_rate', q.gst_rate, 'gst', q.gst, 'total', q.total, 'fee_credit', q.fee_credit, 'balance', q.balance, 'sent_at', q.sent_at,
        'eta_kind', q.eta_kind, 'eta_hours', q.eta_hours, 'eta_date', q.eta_date, 'eta_window', q.eta_window, 'eta_text', q.eta_text) from public.job_quotes q where q.lead_id = p_lead order by q.version desc limit 1));
end; $$;
revoke all on function public.crm_quote_get(uuid) from public, anon;
grant execute on function public.crm_quote_get(uuid) to authenticated;

-- 6. The funnel in one call. Counts and median hours for everyone on the desk; money only for an admin. No customer names, phones or addresses are returned (the overdue list carries the internal ref and the age only).
-- Stages (a lead counts in a stage when it reached it): lead, contacted, quote sent, quote approved, paid and booked, completed, invoiced. Junk and deleted leads are left out.
create or replace function public.crm_funnel(p_from date default null, p_to date default null, p_source text default null, p_campaign text default null, p_owner uuid default null, p_vehicle text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.flow_need(); adm boolean := public.is_admin(); tg jsonb := public.funnel_targets();
  f timestamptz := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Kolkata' end;
  t timestamptz := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Kolkata' end;
  cm numeric := (tg ->> 'claim_minutes')::numeric; qh numeric := (tg ->> 'quote_hours')::numeric; res jsonb;
begin
  with base as (
    select l.id, l.ref, l.status, l.vehicle, l.created_at, l.crm_first_contact_at as t_contact, l.crm_owner, l.crm_lost_reason,
           coalesce(l.confirm_paid_at, l.paid_at, l.confirmed_at) as t_paid, l.completed_at as t_done, l.booking_id,
           lower(coalesce(nullif(l.utm ->> 'utm_source', ''), l.source, 'unknown')) as src, l.campaign
    from public.leads l
    where l.deleted_at is null and l.status <> 'junk'
      and (public.crm_can('view_all_leads') or adm or l.crm_owner is null or l.crm_owner = auth.uid())
      and (f is null or l.created_at >= f) and (t is null or l.created_at < t)
      and (p_source is null or lower(coalesce(nullif(l.utm ->> 'utm_source', ''), l.source, 'unknown')) = lower(p_source))
      and (p_campaign is null or l.campaign = p_campaign)
      and (p_owner is null or l.crm_owner = p_owner)
      and (p_vehicle is null or l.vehicle = p_vehicle)
  ), q as (
    select b.id, min(jq.sent_at) as t_sent, min(jq.decided_at) filter (where jq.status = 'approved') as t_appr, bool_or(jq.status = 'approved') as appr
    from base b join public.job_quotes jq on jq.lead_id = b.id and jq.status <> 'draft' group by b.id
  ), inv as (
    select b.id, min(i.issued_at) as t_inv, sum(i.total) as inv_total from base b join public.invoices i on i.lead_id = b.id and i.voided_at is null group by b.id
  ), s as (
    select b.*, q.t_sent, coalesce(q.t_appr, case when q.appr then q.t_sent end) as t_appr, (q.id is not null and q.t_sent is not null) as has_q, coalesce(q.appr, false) as appr,
           inv.t_inv, inv.inv_total,
           (b.t_paid is not null or b.status in ('paid','scheduled','completed')) as paid,
           (b.t_done is not null or b.status = 'completed') as done
    from base b left join q on q.id = b.id left join inv on inv.id = b.id
  ), med as (
    select
      percentile_cont(0.5) within group (order by extract(epoch from (t_contact - created_at)) / 3600) filter (where t_contact is not null and t_contact >= created_at) as m_contact,
      percentile_cont(0.5) within group (order by extract(epoch from (t_sent - coalesce(t_contact, created_at))) / 3600) filter (where t_sent is not null and t_sent >= coalesce(t_contact, created_at)) as m_quote,
      percentile_cont(0.5) within group (order by extract(epoch from (t_appr - t_sent)) / 3600) filter (where t_appr is not null and t_sent is not null and t_appr >= t_sent) as m_appr,
      percentile_cont(0.5) within group (order by extract(epoch from (t_paid - coalesce(t_appr, t_sent, created_at))) / 3600) filter (where t_paid is not null and t_paid >= coalesce(t_appr, t_sent, created_at)) as m_paid,
      percentile_cont(0.5) within group (order by extract(epoch from (t_done - t_paid)) / 3600) filter (where t_done is not null and t_paid is not null and t_done >= t_paid) as m_done,
      percentile_cont(0.5) within group (order by extract(epoch from (t_inv - t_done)) / 3600) filter (where t_inv is not null and t_done is not null and t_inv >= t_done) as m_inv
    from s
  )
  select jsonb_build_object(
    'targets', tg, 'money', adm,
    'stages', jsonb_build_array(
      jsonb_build_object('key','lead','label','Lead','n',(select count(*) from s),'median_hours',null),
      jsonb_build_object('key','contacted','label','Contacted','n',(select count(*) from s where t_contact is not null or status in ('contacted','quoted','payment_sent','paid','scheduled','completed')),'median_hours',(select round(m_contact::numeric, 2) from med)),
      jsonb_build_object('key','quote_sent','label','Quote sent','n',(select count(*) from s where has_q),'median_hours',(select round(m_quote::numeric, 2) from med)),
      jsonb_build_object('key','quote_approved','label','Quote approved','n',(select count(*) from s where appr),'median_hours',(select round(m_appr::numeric, 2) from med)),
      jsonb_build_object('key','paid','label','Paid and booked','n',(select count(*) from s where paid),'median_hours',(select round(m_paid::numeric, 2) from med)),
      jsonb_build_object('key','completed','label','Completed','n',(select count(*) from s where done),'median_hours',(select round(m_done::numeric, 2) from med)),
      jsonb_build_object('key','invoiced','label','Invoiced','n',(select count(*) from s where t_inv is not null),'median_hours',(select round(m_inv::numeric, 2) from med))),
    'lost', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc, reason) from (select coalesce(nullif(btrim(crm_lost_reason), ''), 'No reason recorded') as reason, count(*) as n from s where status = 'lost' group by 1) x), '[]'::jsonb),
    'quote_outcomes', jsonb_build_object('sent', (select count(*) from s where has_q), 'approved', (select count(*) from s where appr),
        'declined', (select count(*) from public.job_quotes jq join s on s.id = jq.lead_id where jq.status = 'declined'),
        'changes', (select count(*) from public.job_quotes jq join s on s.id = jq.lead_id where jq.status = 'changes_requested'),
        'expired', (select count(*) from public.job_quotes jq join s on s.id = jq.lead_id where jq.status = 'sent' and jq.valid_until is not null and jq.valid_until < now())),
    'overdue_claim', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'vehicle', vehicle, 'age_min', round(extract(epoch from (now() - created_at)) / 60)) order by created_at) from s
        where status = 'new' and t_contact is null and crm_owner is null and created_at < now() - make_interval(mins => cm::int)), '[]'::jsonb),
    'overdue_quote', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'vehicle', vehicle, 'age_hours', round((extract(epoch from (now() - coalesce(t_contact, created_at))) / 3600)::numeric, 1)) order by coalesce(t_contact, created_at)) from s
        where not has_q and booking_id is null and status in ('new','contacted') and t_contact is not null and t_contact < now() - make_interval(secs => (qh * 3600)::int)), '[]'::jsonb),
    'invoiced_total', case when adm then (select coalesce(sum(inv_total), 0) from s) end
  ) into res;
  return res;
end; $$;
revoke all on function public.crm_funnel(date, date, text, text, uuid, text) from public, anon;
grant execute on function public.crm_funnel(date, date, text, text, uuid, text) to authenticated;

-- 7. Values for the funnel's filter menus (last 180 days): sources, campaigns and Crew owners. Names of Crew members only, no customer data.
create or replace function public.crm_funnel_options() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.flow_need();
  return jsonb_build_object(
    'sources', coalesce((select jsonb_agg(s order by s) from (select distinct lower(coalesce(nullif(utm ->> 'utm_source', ''), source, 'unknown')) as s from public.leads where deleted_at is null and created_at > now() - interval '180 days') x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(c order by c) from (select distinct campaign as c from public.leads where deleted_at is null and campaign is not null and created_at > now() - interval '180 days') x), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('id', o, 'name', coalesce(public.crm_name(o), 'Unknown')) order by public.crm_name(o)) from (select distinct crm_owner as o from public.leads where deleted_at is null and crm_owner is not null and created_at > now() - interval '180 days') x), '[]'::jsonb));
end; $$;
revoke all on function public.crm_funnel_options() from public, anon;
grant execute on function public.crm_funnel_options() to authenticated;

-- 8. The customer's secret tracking link token, for the desk's "Copy link" button on a quote. Same people as may build the quote. Null when no link exists yet (it is made when the booking is paid).
create or replace function public.crm_quote_link(p_lead uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare l public.leads; tok text;
begin
  l := public.quote_guard(p_lead);
  select track_token into tok from public.booking_secrets where lead_id = p_lead;
  return tok;
end; $$;
revoke all on function public.crm_quote_link(uuid) from public, anon;
grant execute on function public.crm_quote_link(uuid) to authenticated;
