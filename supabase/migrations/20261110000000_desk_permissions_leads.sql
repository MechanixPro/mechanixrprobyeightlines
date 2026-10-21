-- Care Buddy desk, part 1: permissions, leads list and summary, dispositions, deletion, targets and dashboard.
-- Design: docs/superpowers/specs/2026-10-22-care-buddy-desk-design.md. Agents still have no table access: everything is a security definer function.

-- ───────────────────────── Columns ─────────────────────────
alter table public.crm_users add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.crm_users add column if not exists designation text check (designation in ('sales','support'));
alter table public.crm_users add column if not exists monthly_target integer not null default 60 check (monthly_target between 0 and 5000);
alter table public.leads add column if not exists disposition text check (char_length(disposition) <= 60);
alter table public.leads add column if not exists sub_disposition text check (char_length(sub_disposition) <= 60);
alter table public.leads add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.crm_activities drop constraint if exists crm_activities_kind_check;
alter table public.crm_activities add constraint crm_activities_kind_check check (kind in ('call','whatsapp','note','status','assign','create','edit','delete','restore'));

create table if not exists public.crm_dispositions (
  id serial primary key,
  disposition text not null,
  sub_disposition text not null,
  sort integer not null default 0,
  active boolean not null default true,
  unique (disposition, sub_disposition)
);
alter table public.crm_dispositions enable row level security;
drop policy if exists crm_dispositions_owner on public.crm_dispositions;
create policy crm_dispositions_owner on public.crm_dispositions for all to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.crm_dispositions (disposition, sub_disposition, sort) values
  ('Interested','Needs a quote',10),('Interested','Wants a callback',11),('Interested','Will confirm later',12),
  ('Follow-up','Callback requested',20),('Follow-up','Waiting for customer',21),('Follow-up','Waiting for payment',22),
  ('Not reachable','Rang, no answer',30),('Not reachable','Switched off',31),('Not reachable','Busy, call back',32),
  ('Not interested','Price too high',40),('Not interested','Booked elsewhere',41),('Not interested','Not needed now',42),
  ('Wrong enquiry','Wrong number',50),('Wrong enquiry','Not a bike service',51),('Wrong enquiry','Spam or test',52),
  ('Out of area','Outside Bengaluru',60),
  ('Booked','Slot fee paid',70),('Booked','Scheduled',71)
on conflict do nothing;

-- ───────────────────────── Permissions ─────────────────────────
create or replace function public.crm_pages() returns text[] language sql immutable as $$
  select array['dashboard','inbox','leads','rsa','tickets','garage_visits','garages','mechanics','knowledge','team'];
$$;
create or replace function public.crm_actions() returns text[] language sql immutable as $$
  select array['view_all_leads','assign_leads','take_leads','add_leads','edit_leads','delete_leads','create_bookings','edit_targets','manage_users',
    'view_attribution','view_team_performance','send_payment_link','create_coupons','edit_price_list','view_reports','export','close_chats',
    'create_tickets','resolve_tickets','view_legal_tickets','manage_rsa','schedule_visits','manage_garages','view_garage_bank','manage_mechanics',
    'edit_knowledge','review_knowledge'];
$$;

create or replace function public.crm_preset(p_role text, p_designation text default null) returns jsonb language plpgsql immutable as $$
declare pages text[]; acts text[]; r jsonb := jsonb_build_object('pages', '{}'::jsonb, 'actions', '{}'::jsonb); x text; role text := coalesce(p_role, 'sales');
begin
  if role = 'supervisor' then pages := public.crm_pages(); acts := public.crm_actions();
  elsif coalesce(p_designation, role) = 'support' or role = 'support' then
    pages := array['dashboard','inbox','leads','rsa','tickets','knowledge','garage_visits'];
    acts := array['take_leads','add_leads','edit_leads','create_bookings','close_chats','create_tickets','resolve_tickets','manage_rsa'];
  else
    pages := array['dashboard','inbox','leads','tickets','knowledge'];
    acts := array['take_leads','add_leads','edit_leads','create_bookings','close_chats','create_tickets','send_payment_link'];
  end if;
  foreach x in array public.crm_pages() loop r := jsonb_set(r, array['pages', x], to_jsonb(x = any (pages))); end loop;
  foreach x in array public.crm_actions() loop r := jsonb_set(r, array['actions', x], to_jsonb(x = any (acts))); end loop;
  return r;
end; $$;

-- The permission set of the signed-in person. Owners always get everything.
create or replace function public.crm_perms() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cu public.crm_users;
begin
  if public.is_owner() then return public.crm_preset('supervisor'); end if;
  select * into cu from public.crm_users where user_id = auth.uid() and active;
  if not found then return '{"pages":{},"actions":{}}'::jsonb; end if;
  return case when cu.permissions = '{}'::jsonb then public.crm_preset(cu.role, cu.designation) else cu.permissions end;
end; $$;
create or replace function public.crm_can(p_action text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.crm_perms() -> 'actions' ->> p_action)::boolean, false);
$$;
create or replace function public.crm_page_ok(p_page text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.crm_perms() -> 'pages' ->> p_page)::boolean, false);
$$;
create or replace function public.crm_require(p_action text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_can(p_action) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
end; $$;
create or replace function public.crm_need_page(p_page text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_page_ok(p_page) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
end; $$;
revoke all on function public.crm_perms(), public.crm_can(text), public.crm_page_ok(text), public.crm_require(text), public.crm_need_page(text) from public;
grant execute on function public.crm_perms(), public.crm_can(text), public.crm_page_ok(text), public.crm_require(text), public.crm_need_page(text) to authenticated;

create or replace function public.crm_set_permissions(p_user uuid, p_perms jsonb, p_designation text default null) returns void
language plpgsql security definer set search_path = public as $$
declare clean jsonb := '{"pages":{},"actions":{}}'::jsonb; x text;
begin
  perform public.crm_require('manage_users');
  foreach x in array public.crm_pages() loop clean := jsonb_set(clean, array['pages', x], to_jsonb(coalesce((p_perms -> 'pages' ->> x)::boolean, false))); end loop;
  foreach x in array public.crm_actions() loop clean := jsonb_set(clean, array['actions', x], to_jsonb(coalesce((p_perms -> 'actions' ->> x)::boolean, false))); end loop;
  update public.crm_users set permissions = clean, designation = coalesce(p_designation, designation) where user_id = p_user;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'crm_permissions_set', jsonb_build_object('user', p_user));
end; $$;
create or replace function public.crm_reset_permissions(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin perform public.crm_require('manage_users'); update public.crm_users set permissions = '{}'::jsonb where user_id = p_user; end; $$;
create or replace function public.crm_preset_for(p_designation text) returns jsonb language sql stable as $$ select public.crm_preset(p_designation, p_designation); $$;
revoke all on function public.crm_set_permissions(uuid, jsonb, text), public.crm_reset_permissions(uuid), public.crm_preset_for(text) from public;
grant execute on function public.crm_set_permissions(uuid, jsonb, text), public.crm_reset_permissions(uuid), public.crm_preset_for(text) to authenticated;

-- crm_me now carries the permission set so the screens can hide what a person may not use
create or replace function public.crm_me() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); u record; sla int;
begin
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes';
  select coalesce(cu.name, a.name) as name, coalesce(cu.daily_target, 3) as target, coalesce(cu.monthly_target, 60) as mtarget, cu.designation as designation into u
    from (select 1) x left join public.crm_users cu on cu.user_id = auth.uid() left join public.admins a on a.user_id = auth.uid();
  return jsonb_build_object(
    'user_id', auth.uid(), 'name', u.name, 'role', r, 'designation', u.designation, 'daily_target', u.target, 'monthly_target', u.mtarget, 'sla_minutes', coalesce(sla, 15),
    'permissions', public.crm_perms(),
    'booked_today', (select count(*) from public.leads where crm_owner = auth.uid() and crm_won_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' and deleted_at is null),
    'pending_advance', (select count(*) from public.leads where crm_owner = auth.uid() and status = 'payment_sent' and deleted_at is null),
    'contacts_today', (select count(*) from public.crm_activities where actor = auth.uid() and kind in ('call','whatsapp') and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
end; $$;

-- ───────────────────────── Assignment is manual only ─────────────────────────
-- An agent no longer becomes the owner by writing a note or logging a contact: they must take the lead first.
create or replace function public.crm_claim(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.crm_need_role(); perform public.crm_require('take_leads');
  update public.leads set crm_owner = auth.uid() where id = p_id and crm_owner is null and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'someone already has this lead' using errcode = 'P0001'; end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_id, auth.uid(), 'assign', 'Took the lead');
end; $$;

create or replace function public.crm_assign(p_id uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  if p_user is not null and not exists (select 1 from public.crm_users where user_id = p_user and active) and not exists (select 1 from public.admins where user_id = p_user) then
    raise exception 'that person is not an active team member' using errcode = 'P0001';
  end if;
  update public.leads set crm_owner = p_user where id = p_id and deleted_at is null;
  insert into public.crm_activities (lead_id, actor, kind, body)
    values (p_id, auth.uid(), 'assign', case when p_user is null then 'Moved back to the unassigned queue' else 'Assigned to ' || coalesce(public.crm_name(p_user), 'a team member') end);
end; $$;

create or replace function public.crm_assign_many(p_ids uuid[], p_user uuid) returns integer language plpgsql security definer set search_path = public as $$
declare i uuid; n int := 0;
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  foreach i in array coalesce(p_ids, '{}') loop perform public.crm_assign(i, p_user); n := n + 1; end loop;
  return n;
end; $$;

-- crm_log: same rules as before, but a non-supervisor must own the lead (no automatic ownership), and edit_leads is required
create or replace function public.crm_log(p_id uuid, p_kind text, p_body text default null, p_next_action timestamptz default null,
  p_status text default null, p_lost_reason text default null, p_disposition text default null, p_sub_disposition text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r text := public.crm_need_role(); l public.leads; body text := nullif(trim(p_body), '');
  rank_old int; rank_new int; new_status text; touched boolean;
  ranks constant text[] := array['new','contacted','quoted','payment_sent'];
begin
  perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_id for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('view_all_leads') or l.crm_owner = auth.uid() or l.crm_owner is null) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if p_kind not in ('call','whatsapp','note','status') then raise exception 'unknown action' using errcode = 'P0001'; end if;
  if public.crm_has_pii(body) or public.crm_has_pii(p_lost_reason) then
    raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001';
  end if;
  if body is not null and char_length(body) > 1000 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  if p_kind = 'note' and body is null and p_status is null and p_disposition is null then raise exception 'write the note first' using errcode = 'P0001'; end if;
  if l.crm_owner is null and r <> 'supervisor' then raise exception 'take the lead first' using errcode = 'P0001';
  elsif l.crm_owner is distinct from auth.uid() and not public.crm_can('view_all_leads') then raise exception 'this lead belongs to a colleague' using errcode = '42501';
  end if;
  if p_disposition is not null and not exists (select 1 from public.crm_dispositions where disposition = p_disposition and sub_disposition = coalesce(p_sub_disposition, sub_disposition) and active) then
    raise exception 'choose a disposition from the list' using errcode = 'P0001';
  end if;

  new_status := coalesce(nullif(p_status, ''), l.status);
  touched := p_kind in ('call','whatsapp') or (new_status is distinct from l.status);

  if new_status is distinct from l.status then
    if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already confirmed' using errcode = 'P0001'; end if;
    if new_status = 'lost' then
      if coalesce(p_lost_reason, '') not in ('Price too high','No answer','Wrong area','Booked elsewhere','Not interested','Other') then
        raise exception 'choose why the lead was lost' using errcode = 'P0001';
      end if;
      if p_lost_reason = 'Other' and body is null then raise exception 'add a note to explain "Other"' using errcode = 'P0001'; end if;
    elsif new_status = any (ranks) then
      rank_old := array_position(ranks, l.status); rank_new := array_position(ranks, new_status);
      if l.status = 'lost' then
        if r <> 'supervisor' then raise exception 'only a supervisor can reopen a lost lead' using errcode = '42501'; end if;
      elsif rank_new < rank_old then raise exception 'a lead cannot move backwards' using errcode = 'P0001';
      end if;
    else
      raise exception 'agents cannot set that status; payment sets it' using errcode = 'P0001';
    end if;
  end if;

  if new_status in ('new','contacted','quoted','payment_sent') and (p_kind <> 'note' or new_status is distinct from l.status) then
    if p_next_action is null then raise exception 'set the next follow-up before saving' using errcode = 'P0001'; end if;
    if p_next_action < now() - interval '5 minutes' then raise exception 'the follow-up must be in the future' using errcode = 'P0001'; end if;
    if p_next_action > now() + interval '60 days' then raise exception 'pick a follow-up within 60 days' using errcode = 'P0001'; end if;
  end if;

  update public.leads set
    status = new_status,
    crm_next_action_at = case when new_status = 'lost' then null when p_next_action is not null then p_next_action else crm_next_action_at end,
    crm_lost_reason = case when new_status = 'lost' then p_lost_reason when new_status is distinct from l.status then null else crm_lost_reason end,
    crm_first_contact_at = case when touched and crm_first_contact_at is null then now() else crm_first_contact_at end,
    disposition = coalesce(p_disposition, disposition),
    sub_disposition = case when p_disposition is not null then p_sub_disposition else sub_disposition end
  where id = p_id;

  insert into public.crm_activities (lead_id, actor, kind, body, status_to)
    values (p_id, auth.uid(), case when new_status is distinct from l.status and p_kind = 'note' then 'status' else p_kind end,
      concat_ws(' · ', case when new_status = 'lost' then 'Lost: ' || p_lost_reason end,
        case when p_disposition is not null then 'Disposition: ' || p_disposition || coalesce(' / ' || p_sub_disposition, '') end, body,
        case when p_next_action is not null then 'Next: ' || to_char(p_next_action at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') end),
      case when new_status is distinct from l.status then new_status end);
end; $$;
drop function if exists public.crm_log(uuid, text, text, timestamptz, text, text);
revoke all on function public.crm_log(uuid, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public.crm_log(uuid, text, text, timestamptz, text, text, text, text) to authenticated;

-- ───────────────────────── Leads list, summary, deletion ─────────────────────────
create or replace function public.crm_leads_list(p_filter text default 'all', p_search text default null, p_owner uuid default null,
  p_from date default null, p_to date default null, p_limit integer default 500)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), ''); sla int; allv boolean;
begin
  perform public.crm_need_role(); perform public.crm_require('view_all_leads');
  -- view_all_leads is required for the full table; people without it use crm_my_leads (own and unassigned only)
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return query
  select l.id, l.ref, l.name, l.phone, l.source, coalesce(nullif(l.utm ->> 'utm_source', ''), l.source), l.status, l.crm_owner, public.crm_name(l.crm_owner), l.disposition, l.sub_disposition,
    l.crm_next_action_at, l.created_at, greatest(l.updated_at, (select max(a.created_at) from public.crm_activities a where a.lead_id = l.id)),
    l.area, nullif(trim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), ''), s.name, l.est_total,
    (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), l.crm_lost_reason, l.updated_at
  from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%')
    and (p_owner is null or l.crm_owner = p_owner)
    and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
    and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
    and case p_filter
      when 'all' then true
      when 'mine' then l.crm_owner = auth.uid()
      when 'unassigned' then l.crm_owner is null
      when 'new' then l.status = 'new'
      when 'followups' then l.crm_next_action_at is not null and l.crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and l.status in ('new','contacted','quoted','payment_sent')
      when 'converted' then l.status in ('paid','scheduled','completed')
      when 'won' then l.status = 'completed'
      when 'lost' then l.status = 'lost'
      else false end
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end; $$;

-- The same list for people without view_all_leads: only their own leads and the unassigned queue
create or replace function public.crm_my_leads(p_filter text default 'mine', p_search text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), ''); sla int;
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return query
  select l.id, l.ref, l.name, l.phone, l.source, coalesce(nullif(l.utm ->> 'utm_source', ''), l.source), l.status, l.crm_owner, public.crm_name(l.crm_owner), l.disposition, l.sub_disposition,
    l.crm_next_action_at, l.created_at, greatest(l.updated_at, (select max(a.created_at) from public.crm_activities a where a.lead_id = l.id)),
    l.area, nullif(trim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), ''), s.name, l.est_total,
    (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), l.crm_lost_reason, l.updated_at
  from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null and (l.crm_owner = auth.uid() or l.crm_owner is null)
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%')
    and case p_filter
      when 'mine' then l.crm_owner = auth.uid() and l.status in ('new','contacted','quoted','payment_sent')
      when 'unassigned' then l.crm_owner is null
      when 'followups' then l.crm_owner = auth.uid() and l.crm_next_action_at is not null and l.crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and l.status in ('new','contacted','quoted','payment_sent')
      when 'converted' then l.crm_owner = auth.uid() and l.status in ('paid','scheduled','completed')
      when 'won' then l.crm_owner = auth.uid() and l.status = 'completed'
      when 'lost' then l.crm_owner = auth.uid() and l.status = 'lost'
      when 'all' then true
      else false end
  order by l.created_at desc limit 500;
end; $$;

create or replace function public.crm_leads_summary(p_from date default null, p_to date default null, p_owner uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t int; c int; w int; f int; lo int; allv boolean; me uuid := auth.uid();
begin
  perform public.crm_need_role(); allv := public.crm_can('view_all_leads');
  select count(*),
    count(*) filter (where status in ('paid','scheduled','completed')),
    count(*) filter (where status = 'completed'),
    count(*) filter (where crm_next_action_at is not null and crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and status in ('new','contacted','quoted','payment_sent')),
    count(*) filter (where status = 'lost')
  into t, c, w, f, lo
  from public.leads l
  where deleted_at is null and (allv or crm_owner = me or crm_owner is null) and (p_owner is null or crm_owner = p_owner)
    and (p_from is null or created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')) and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'));
  return jsonb_build_object('all', t, 'converted', c, 'won', w, 'followups', f, 'lost', lo,
    'pct', jsonb_build_object('converted', case when t > 0 then round(c * 100.0 / t) else 0 end, 'won', case when t > 0 then round(w * 100.0 / t) else 0 end,
      'lost', case when t > 0 then round(lo * 100.0 / t) else 0 end, 'followups', case when t > 0 then round(f * 100.0 / t) else 0 end));
end; $$;

create or replace function public.crm_delete_leads(p_ids uuid[], p_reason text) returns integer language plpgsql security definer set search_path = public as $$
declare n int; why text := nullif(trim(p_reason), '');
begin
  perform public.crm_need_role(); perform public.crm_require('delete_leads');
  if why is null then raise exception 'say why you are deleting' using errcode = 'P0001'; end if;
  if public.crm_has_pii(why) then raise exception 'Remove ID or card numbers from the reason.' using errcode = 'P0001'; end if;
  update public.leads set deleted_at = now(), deleted_reason = left(why, 200) where id = any (p_ids) and deleted_at is null;
  get diagnostics n = row_count;
  insert into public.crm_activities (lead_id, actor, kind, body) select i, auth.uid(), 'delete', 'Deleted: ' || left(why, 200) from unnest(p_ids) i;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'crm_leads_deleted', jsonb_build_object('count', n, 'reason', left(why, 200)));
  return n;
end; $$;
create or replace function public.crm_restore_leads(p_ids uuid[]) returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.crm_need_role(); perform public.crm_require('delete_leads');
  update public.leads set deleted_at = null, deleted_reason = null where id = any (p_ids) and deleted_at is not null;
  get diagnostics n = row_count;
  insert into public.crm_activities (lead_id, actor, kind, body) select i, auth.uid(), 'restore', 'Restored' from unnest(p_ids) i;
  return n;
end; $$;

create or replace function public.crm_dispositions_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  return coalesce((select jsonb_agg(jsonb_build_object('disposition', disposition, 'sub', sub_disposition) order by sort, disposition) from public.crm_dispositions where active), '[]'::jsonb);
end; $$;

-- ───────────────────────── Targets and dashboard ─────────────────────────
insert into public.settings (key, value) values ('crm_team_daily_target', '10'), ('crm_team_monthly_target', '250') on conflict (key) do nothing;

create or replace function public.crm_set_targets(p_team_daily integer default null, p_team_monthly integer default null, p_user uuid default null, p_user_daily integer default null, p_user_monthly integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_require('edit_targets');
  if p_team_daily is not null then insert into public.settings (key, value) values ('crm_team_daily_target', to_jsonb(greatest(0, least(p_team_daily, 5000)))) on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
  if p_team_monthly is not null then insert into public.settings (key, value) values ('crm_team_monthly_target', to_jsonb(greatest(0, least(p_team_monthly, 50000)))) on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
  if p_user is not null then
    update public.crm_users set daily_target = coalesce(greatest(0, least(p_user_daily, 100)), daily_target), monthly_target = coalesce(greatest(0, least(p_user_monthly, 5000)), monthly_target) where user_id = p_user;
  end if;
end; $$;

create or replace function public.crm_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid(); allv boolean; day0 timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  mon0 timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  f timestamptz := coalesce((p_from::timestamp at time zone 'Asia/Kolkata'), date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  t timestamptz := coalesce(((p_to + 1)::timestamp at time zone 'Asia/Kolkata'), now() + interval '1 day');
  td int := coalesce((select (value #>> '{}')::int from public.settings where key = 'crm_team_daily_target'), 10);
  tm int := coalesce((select (value #>> '{}')::int from public.settings where key = 'crm_team_monthly_target'), 250);
  tot int; won int; lost int; chats_total int; chats_unreplied int; res jsonb;
begin
  perform public.crm_need_role(); perform public.crm_need_page('dashboard');
  allv := public.crm_can('view_all_leads');
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status = 'lost') into tot, won, lost
    from public.leads where deleted_at is null and created_at >= f and created_at < t and (allv or crm_owner = me or crm_owner is null);
  -- chats: a conversation is a phone number with messages in the last 30 days; unreplied = the last message is from the customer
  with last_msg as (
    select distinct on (phone) phone, direction from public.messages where created_at > now() - interval '30 days' order by phone, created_at desc)
  select count(*), count(*) filter (where direction = 'in') into chats_total, chats_unreplied from last_msg;
  res := jsonb_build_object(
    'range', jsonb_build_object('from', f, 'to', t),
    'chats', jsonb_build_object('total', chats_total, 'unreplied', chats_unreplied),
    'leads', jsonb_build_object('total', tot, 'won', won, 'lost', lost,
      'won_pct', case when tot > 0 then round(won * 100.0 / tot) else 0 end, 'lost_pct', case when tot > 0 then round(lost * 100.0 / tot) else 0 end),
    'unassigned', (select count(*) from public.leads where deleted_at is null and crm_owner is null and status in ('new','contacted','quoted','payment_sent')),
    'targets', jsonb_build_object(
      'team', jsonb_build_object('daily_target', td, 'monthly_target', tm,
        'daily_done', (select count(*) from public.leads where deleted_at is null and crm_won_at >= day0 and crm_owner in (select user_id from public.crm_users)),
        'monthly_done', (select count(*) from public.leads where deleted_at is null and crm_won_at >= mon0 and crm_owner in (select user_id from public.crm_users))),
      'me', jsonb_build_object('daily_target', coalesce((select daily_target from public.crm_users where user_id = me), 0), 'monthly_target', coalesce((select monthly_target from public.crm_users where user_id = me), 0),
        'daily_done', (select count(*) from public.leads where deleted_at is null and crm_won_at >= day0 and crm_owner = me),
        'monthly_done', (select count(*) from public.leads where deleted_at is null and crm_won_at >= mon0 and crm_owner = me))));
  if public.crm_can('view_team_performance') then
    res := res || jsonb_build_object('agents', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id, 'name', u.name, 'designation', u.designation, 'daily_target', u.daily_target, 'monthly_target', u.monthly_target,
      'assigned', x.assigned, 'won', x.won, 'lost', x.lost,
      'won_pct', case when x.assigned > 0 then round(x.won * 100.0 / x.assigned) else 0 end, 'lost_pct', case when x.assigned > 0 then round(x.lost * 100.0 / x.assigned) else 0 end,
      'daily_done', (select count(*) from public.leads l where l.deleted_at is null and l.crm_owner = u.user_id and l.crm_won_at >= day0),
      'monthly_done', (select count(*) from public.leads l where l.deleted_at is null and l.crm_owner = u.user_id and l.crm_won_at >= mon0)) order by u.name)
      from public.crm_users u cross join lateral (
        select count(*) assigned, count(*) filter (where l.status = 'completed') won, count(*) filter (where l.status = 'lost') lost
        from public.leads l where l.deleted_at is null and l.crm_owner = u.user_id and l.created_at >= f and l.created_at < t) x
      where u.active), '[]'::jsonb));
  end if;
  if public.crm_can('view_attribution') then
    res := res || jsonb_build_object('attribution', coalesce((select jsonb_agg(jsonb_build_object('platform', p, 'leads', n, 'booked', b, 'share', case when s > 0 then round(n * 100.0 / s) else 0 end) order by n desc)
      from (select coalesce(nullif(utm ->> 'utm_source', ''), source) p, count(*) n, count(*) filter (where status in ('paid','scheduled','completed')) b, sum(count(*)) over () s
            from public.leads where deleted_at is null and created_at >= f and created_at < t group by 1) q), '[]'::jsonb));
  end if;
  return res;
end; $$;

create or replace function public.crm_users_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_can('manage_users') or public.crm_can('assign_leads') or public.crm_can('edit_targets')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name, 'role', role, 'designation', designation, 'active', active, 'daily_target', daily_target, 'monthly_target', monthly_target,
    'custom_permissions', permissions <> '{}'::jsonb, 'permissions', case when public.crm_can('manage_users') then case when permissions = '{}'::jsonb then public.crm_preset(role, designation) else permissions end end) order by active desc, role, name)
    from public.crm_users), '[]'::jsonb);
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_assign_many(uuid[],uuid)','crm_leads_list(text,text,uuid,date,date,integer)','crm_my_leads(text,text)','crm_leads_summary(date,date,uuid)',
    'crm_delete_leads(uuid[],text)','crm_restore_leads(uuid[])','crm_dispositions_list()','crm_set_targets(integer,integer,uuid,integer,integer)','crm_dashboard(date,date)','crm_users_list()']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
