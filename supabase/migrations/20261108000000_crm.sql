-- Mechanix CRM: a separate console for the hired Sales and Support team.
-- Agents have NO table policies. They work only through the security definer functions below, which return a fixed safe set
-- of columns (never money, payouts, prices or invoices). Design: docs/superpowers/specs/2026-10-21-crm-design.md

-- ───────────────────────── Tables and columns ─────────────────────────
create table if not exists public.crm_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 60),
  role         text not null check (role in ('sales','support','supervisor')),
  active       boolean not null default true,
  daily_target integer not null default 3 check (daily_target between 0 and 100),
  created_at   timestamptz not null default now()
);
alter table public.crm_users enable row level security;
drop policy if exists crm_users_owner on public.crm_users;
create policy crm_users_owner on public.crm_users for all to authenticated using (public.is_owner()) with check (public.is_owner());

create table if not exists public.crm_activities (
  id         bigserial primary key,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  actor      uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('call','whatsapp','note','status','assign','create')),
  body       text check (char_length(body) <= 1000),
  status_to  text,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_lead_idx on public.crm_activities (lead_id, created_at desc);
create index if not exists crm_activities_actor_idx on public.crm_activities (actor, created_at desc);
alter table public.crm_activities enable row level security;
drop policy if exists crm_activities_owner on public.crm_activities;
create policy crm_activities_owner on public.crm_activities for select to authenticated using (public.is_owner());

alter table public.leads add column if not exists crm_owner uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists crm_next_action_at timestamptz;
alter table public.leads add column if not exists crm_lost_reason text check (char_length(crm_lost_reason) <= 300);
alter table public.leads add column if not exists crm_first_contact_at timestamptz;
alter table public.leads add column if not exists crm_won_at timestamptz;
create index if not exists leads_crm_owner_idx on public.leads (crm_owner, status) where crm_owner is not null;

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('website','whatsapp','phone','walk_in','app','justdial','instagram'));

insert into public.settings (key, value) values ('crm_sla_minutes', '15') on conflict (key) do nothing;

-- The moment a lead is paid, scheduled or completed it counts as booked, whoever moved it (payment webhook, admin or agent).
create or replace function public.crm_stamp_won() returns trigger language plpgsql as $$
begin
  if new.status in ('paid','scheduled','completed') and new.crm_won_at is null then new.crm_won_at := now(); end if;
  return new;
end; $$;
drop trigger if exists leads_crm_won on public.leads;
create trigger leads_crm_won before insert or update of status on public.leads for each row execute function public.crm_stamp_won();

-- ───────────────────────── Helpers ─────────────────────────
-- Owners are supervisors of the CRM automatically; everyone else needs an active crm_users row.
create or replace function public.crm_role() returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.crm_users where user_id = auth.uid() and active),
    case when public.is_owner() then 'supervisor' end);
$$;
revoke all on function public.crm_role() from public;
grant execute on function public.crm_role() to authenticated;

create or replace function public.crm_name(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.crm_users where user_id = p_user), (select name from public.admins where user_id = p_user));
$$;
revoke all on function public.crm_name(uuid) from public;

-- Aadhaar, PAN, bank and card numbers must never be typed into a note.
create or replace function public.crm_has_pii(p text) returns boolean language plpgsql immutable as $$
declare m text[]; t text;
begin
  if p is null then return false; end if;
  if upper(p) ~ '[A-Z]{5}[0-9]{4}[A-Z]' then return true; end if;
  t := regexp_replace(p, '[ -]', '', 'g');
  for m in select regexp_matches(t, '[0-9]{12,}', 'g') loop
    if length(m[1]) = 12 and m[1] ~ '^91[6-9][0-9]{9}$' then continue; end if;  -- a phone number with +91
    return true;
  end loop;
  return false;
end; $$;

create or replace function public.crm_need_role() returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_role();
begin
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return r;
end; $$;
revoke all on function public.crm_need_role() from public;

-- Rows an agent may see: their own leads and the unassigned ones. Supervisors see all. Deleted bookings never show.
create or replace function public.crm_can_see(p_lead public.leads, p_role text) returns boolean language sql stable as $$
  select p_lead.deleted_at is null and (p_role = 'supervisor' or p_lead.crm_owner is null or p_lead.crm_owner = auth.uid());
$$;

-- ───────────────────────── Reads ─────────────────────────
create or replace function public.crm_me() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); u record; sla int;
begin
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes';
  select coalesce(cu.name, a.name) as name, coalesce(cu.daily_target, 3) as target into u
    from (select 1) x left join public.crm_users cu on cu.user_id = auth.uid() left join public.admins a on a.user_id = auth.uid();
  return jsonb_build_object(
    'user_id', auth.uid(), 'name', u.name, 'role', r, 'daily_target', u.target, 'sla_minutes', coalesce(sla, 15),
    'booked_today', (select count(*) from public.leads where crm_owner = auth.uid() and crm_won_at >= date_trunc('day', now()) and deleted_at is null),
    'pending_advance', (select count(*) from public.leads where crm_owner = auth.uid() and status = 'payment_sent' and deleted_at is null),
    'contacts_today', (select count(*) from public.crm_activities where actor = auth.uid() and kind in ('call','whatsapp') and created_at >= date_trunc('day', now())));
end; $$;

create or replace function public.crm_queue(p_view text default 'mine', p_search text default null)
returns table (id uuid, ref text, name text, phone text, area text, bike text, service_name text, source text, campaign text, utm_source text,
  status text, crm_owner uuid, owner_name text, est_total integer, notes text, preferred_date date, preferred_slot text, created_at timestamptz,
  crm_next_action_at timestamptz, crm_first_contact_at timestamptz, crm_lost_reason text, crm_won_at timestamptz, is_late boolean, overdue boolean)
language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); sla int; q text := nullif(trim(p_search), '');
begin
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes';
  sla := coalesce(sla, 15);
  if p_view = 'all' and r <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  return query
  select l.id, l.ref, l.name, l.phone, l.area, nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), s.name, l.source,
         l.utm ->> 'utm_campaign', l.utm ->> 'utm_source', l.status, l.crm_owner, public.crm_name(l.crm_owner), l.est_total, l.notes, l.preferred_date,
         l.preferred_slot, l.created_at, l.crm_next_action_at, l.crm_first_contact_at, l.crm_lost_reason, l.crm_won_at,
         (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
         (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent'))
  from public.leads l
  left join public.bikes b on b.id = l.bike_id
  left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%')
    and case p_view
      when 'mine'       then l.crm_owner = auth.uid() and l.status in ('new','contacted','quoted','payment_sent')
      when 'unassigned' then l.crm_owner is null and l.status = 'new'
      when 'won'        then l.crm_owner = auth.uid() and l.status in ('paid','scheduled','completed')
      when 'lost'       then l.crm_owner = auth.uid() and l.status = 'lost'
      when 'all'        then true
      else false end
  order by
    case when p_view in ('mine','unassigned','all') then
      case when l.crm_first_contact_at is null and l.status = 'new' then 0
           when l.crm_next_action_at is not null and l.crm_next_action_at < now() then 1 else 2 end
    else 0 end,
    case when p_view in ('mine','unassigned','all') then coalesce(l.crm_next_action_at, l.created_at) else l.created_at end,
    l.created_at desc
  limit 300;
end; $$;

create or replace function public.crm_lead(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads; sla int;
begin
  select * into l from public.leads where id = p_id;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return jsonb_build_object(
    'lead', (select jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'area', l.area,
        'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'service_name', s.name, 'source', l.source,
        'campaign', l.utm ->> 'utm_campaign', 'utm_source', l.utm ->> 'utm_source', 'status', l.status, 'crm_owner', l.crm_owner,
        'owner_name', public.crm_name(l.crm_owner), 'est_total', l.est_total, 'notes', l.notes, 'preferred_date', l.preferred_date,
        'preferred_slot', l.preferred_slot, 'created_at', l.created_at, 'crm_next_action_at', l.crm_next_action_at,
        'crm_first_contact_at', l.crm_first_contact_at, 'crm_lost_reason', l.crm_lost_reason, 'crm_won_at', l.crm_won_at,
        'is_late', (l.crm_first_contact_at is null and l.status = 'new' and l.created_at < now() - make_interval(mins => sla)),
        'overdue', (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')))
      from (select 1) x left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body, 'status_to', a.status_to,
        'actor', public.crm_name(a.actor), 'created_at', a.created_at) order by a.created_at desc)
      from public.crm_activities a where a.lead_id = l.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
      from (select * from public.messages where lead_id = l.id order by created_at desc limit 30) m), '[]'::jsonb));
end; $$;

-- ───────────────────────── Writes ─────────────────────────
create or replace function public.crm_claim(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role(); n int;
begin
  update public.leads set crm_owner = auth.uid() where id = p_id and crm_owner is null and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'someone already has this lead' using errcode = 'P0001'; end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_id, auth.uid(), 'assign', 'Took the lead');
end; $$;

create or replace function public.crm_assign(p_id uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role();
begin
  if r <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  if p_user is not null and not exists (select 1 from public.crm_users where user_id = p_user and active) and not exists (select 1 from public.admins where user_id = p_user) then
    raise exception 'that person is not an active team member' using errcode = 'P0001';
  end if;
  update public.leads set crm_owner = p_user where id = p_id and deleted_at is null;
  insert into public.crm_activities (lead_id, actor, kind, body)
    values (p_id, auth.uid(), 'assign', case when p_user is null then 'Moved back to the unassigned queue' else 'Assigned to ' || coalesce(public.crm_name(p_user), 'a team member') end);
end; $$;

-- The one function agents use to record what happened. It enforces the sales rules.
create or replace function public.crm_log(p_id uuid, p_kind text, p_body text default null, p_next_action timestamptz default null,
  p_status text default null, p_lost_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r text := public.crm_need_role(); l public.leads; body text := nullif(trim(p_body), '');
  rank_old int; rank_new int; new_status text; touched boolean;
  ranks constant text[] := array['new','contacted','quoted','payment_sent'];
begin
  select * into l from public.leads where id = p_id for update;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if p_kind not in ('call','whatsapp','note','status') then raise exception 'unknown action' using errcode = 'P0001'; end if;
  if public.crm_has_pii(body) or public.crm_has_pii(p_lost_reason) then
    raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note. Never record them here.' using errcode = 'P0001';
  end if;
  if body is not null and char_length(body) > 1000 then raise exception 'note is too long' using errcode = 'P0001'; end if;
  if p_kind = 'note' and body is null then raise exception 'write the note first' using errcode = 'P0001'; end if;

  -- An agent owns a lead the moment they work it, unless a colleague already does.
  if l.crm_owner is null and r <> 'supervisor' then
    update public.leads set crm_owner = auth.uid() where id = p_id; l.crm_owner := auth.uid();
  elsif l.crm_owner is distinct from auth.uid() and r <> 'supervisor' then
    raise exception 'this lead belongs to a colleague' using errcode = '42501';
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

  -- Rule 1: every open lead needs a dated next step. Closing as lost needs none.
  if new_status in ('new','contacted','quoted','payment_sent') and (p_kind <> 'note' or new_status is distinct from l.status) then
    if p_next_action is null then raise exception 'set the next follow-up before saving' using errcode = 'P0001'; end if;
    if p_next_action < now() - interval '5 minutes' then raise exception 'the follow-up must be in the future' using errcode = 'P0001'; end if;
    if p_next_action > now() + interval '60 days' then raise exception 'pick a follow-up within 60 days' using errcode = 'P0001'; end if;
  end if;

  update public.leads set
    status = new_status,
    crm_next_action_at = case when new_status = 'lost' then null when p_next_action is not null then p_next_action else crm_next_action_at end,
    crm_lost_reason = case when new_status = 'lost' then p_lost_reason when new_status is distinct from l.status then null else crm_lost_reason end,
    crm_first_contact_at = case when touched and crm_first_contact_at is null then now() else crm_first_contact_at end
  where id = p_id;

  insert into public.crm_activities (lead_id, actor, kind, body, status_to)
    values (p_id, auth.uid(), case when new_status is distinct from l.status and p_kind = 'note' then 'status' else p_kind end,
      concat_ws(' · ', case when new_status = 'lost' then 'Lost: ' || p_lost_reason end, body,
        case when p_next_action is not null then 'Next: ' || to_char(p_next_action at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') end),
      case when new_status is distinct from l.status then new_status end);
end; $$;

create or replace function public.crm_add_lead(p_name text, p_phone text, p_area text default null, p_source text default 'phone', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role(); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); dup uuid; nid uuid; note text := nullif(trim(p_note), '');
begin
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'enter a valid 10 digit mobile number' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 then raise exception 'enter the customer name' using errcode = 'P0001'; end if;
  if p_source not in ('phone','walk_in','justdial','instagram','whatsapp') then raise exception 'unknown source' using errcode = 'P0001'; end if;
  if public.crm_has_pii(note) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note.' using errcode = 'P0001'; end if;
  select id into dup from public.leads where phone = ph and deleted_at is null and status in ('new','contacted','quoted','payment_sent') and created_at > now() - interval '30 days'
    order by created_at desc limit 1;
  if dup is not null then return jsonb_build_object('id', dup, 'duplicate', true); end if;
  insert into public.leads (name, phone, area, source, notes, status, crm_owner, consent_whatsapp)
    values (trim(p_name), ph, nullif(trim(p_area), ''), p_source, note, 'new', case when r = 'supervisor' then null else auth.uid() end, false)
    returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Added by hand (' || p_source || ')');
  return jsonb_build_object('id', nid, 'duplicate', false);
end; $$;

-- ───────────────────────── Supervisor ─────────────────────────
create or replace function public.crm_team_stats(p_from date default current_date, p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); sla int; f timestamptz; t timestamptz;
begin
  if r <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  f := (p_from::timestamp at time zone 'Asia/Kolkata'); t := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  return jsonb_build_object(
    'sla_minutes', sla,
    'unassigned_new', (select count(*) from public.leads where deleted_at is null and crm_owner is null and status = 'new'),
    'unassigned_late', (select count(*) from public.leads where deleted_at is null and crm_owner is null and status = 'new' and created_at < now() - make_interval(mins => sla)),
    'agents', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', u.user_id, 'name', u.name, 'role', u.role, 'daily_target', u.daily_target, 'active', u.active,
        'open', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent')),
        'late', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.status = 'new' and l.crm_first_contact_at is null and l.created_at < now() - make_interval(mins => sla)),
        'overdue', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent') and l.crm_next_action_at < now()),
        'contacts', (select count(*) from public.crm_activities a where a.actor = u.user_id and a.kind in ('call','whatsapp') and a.created_at >= f and a.created_at < t),
        'booked', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.crm_won_at >= f and l.crm_won_at < t),
        'advance_pending', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.status = 'payment_sent'),
        'lost', (select count(*) from public.leads l where l.crm_owner = u.user_id and l.deleted_at is null and l.status = 'lost' and l.updated_at >= f and l.updated_at < t),
        'avg_first_contact_min', (select round(avg(extract(epoch from (l.crm_first_contact_at - l.created_at)) / 60)::numeric, 1) from public.leads l
            where l.crm_owner = u.user_id and l.crm_first_contact_at is not null and l.created_at >= f and l.created_at < t)
      ) order by u.role, u.name) from public.crm_users u), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'leads', x.n, 'booked', x.b) order by x.n desc)
      from (select coalesce(nullif(l.utm ->> 'utm_source', ''), l.source) as source, count(*) n, count(*) filter (where l.crm_won_at is not null) b
            from public.leads l where l.deleted_at is null and l.created_at >= f and l.created_at < t group by 1) x), '[]'::jsonb),
    'lost_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', x.crm_lost_reason, 'n', x.n) order by x.n desc)
      from (select crm_lost_reason, count(*) n from public.leads where deleted_at is null and status = 'lost' and crm_lost_reason is not null and updated_at >= f and updated_at < t group by 1) x), '[]'::jsonb));
end; $$;

create or replace function public.crm_list_users() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.crm_need_role() <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name, 'role', role, 'active', active, 'daily_target', daily_target) order by active desc, role, name)
    from public.crm_users), '[]'::jsonb);
end; $$;

create or replace function public.crm_set_target(p_user uuid, p_target int) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.crm_need_role() <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  update public.crm_users set daily_target = greatest(0, least(100, p_target)) where user_id = p_user;
end; $$;

create or replace function public.crm_set_user_active(p_user uuid, p_active boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.crm_need_role() <> 'supervisor' then raise exception 'supervisors only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot switch yourself off' using errcode = 'P0001'; end if;
  update public.crm_users set active = p_active where user_id = p_user;
  if not p_active then update public.leads set crm_owner = null where crm_owner = p_user and status in ('new','contacted','quoted','payment_sent'); end if;
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_me()','crm_queue(text,text)','crm_lead(uuid)','crm_claim(uuid)','crm_assign(uuid,uuid)',
    'crm_log(uuid,text,text,timestamptz,text,text)','crm_add_lead(text,text,text,text,text)','crm_team_stats(date,date)','crm_list_users()',
    'crm_set_target(uuid,int)','crm_set_user_active(uuid,boolean)']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
