-- The booking ID is given after confirmation, not when a lead arrives. A lead is not a booking.
--   leads.ref        stays as the private lookup key in links (track, rating, payment, technician job). New leads get 'L-' + 6 letters or digits. Never shown to a customer.
--   leads.booking_id the customer-visible serial MP-yy-yy-#### (also the invoice number). Empty until Crew or Admin confirms, or until the booking is paid, scheduled or completed.
--   leads.status     gains 'junk' (admin only): kept as data with a reason, out of follow-ups, reminders, pipeline totals and reports. 'Restore' goes back to the earlier status.
-- Existing data: a lead is "won" if its status is paid, scheduled or completed, or it has a payment, payment link, invoice or ledger entry.
--   Won leads keep their ID: booking_id = ref (an MP-yy-yy-#### ref). Every other lead keeps its old links working (old_ref and ref_aliases get the ID it had), then gets ref = 'L-xxxxxx' and booking_id = null.
--   order_counters is NOT reset: serial numbers stay unique and gaps are fine. Invoice numbers are never touched.
-- rollback (by hand, only if needed). Leads that were not won and have no booking_id yet go back to the ID they had:
--   update public.leads set ref = coalesce(ref_aliases[array_length(ref_aliases, 1)], old_ref) where ref ~ '^L-' and booking_id is null and (ref_aliases <> '{}' or old_ref is not null);
--   (ref_aliases ends with the ID the lead had just before this migration; old_ref is the oldest ID it ever had.)
--   Leads confirmed after this migration keep their L- ref and booking_id: they have no earlier ID to go back to.
--   Then drop trigger leads_private_ref_tr and recreate leads_serial_ref_tr from 20261210000000_order_ids.sql, restore every junk lead (restore_lead_junk) and drop 'junk' from leads_status_check.

-- ───────────────────────── Columns ─────────────────────────
alter table public.leads add column if not exists booking_id text;
create unique index if not exists leads_booking_id_uq on public.leads (booking_id) where booking_id is not null;
alter table public.leads add column if not exists ref_aliases text[] not null default '{}';
create index if not exists leads_ref_aliases_idx on public.leads using gin (ref_aliases);
alter table public.leads add column if not exists junk_reason text check (char_length(junk_reason) <= 200);
alter table public.leads add column if not exists junk_at timestamptz;
alter table public.leads add column if not exists junk_by uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists junk_prev_status text;

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in ('new','contacted','quoted','payment_sent','paid','scheduled','completed','lost','junk'));
alter table public.leads alter column ref drop default;

-- ───────────────────────── Private ref for new leads ─────────────────────────
-- 6 characters from 32 (no 0, O, 1, I): about a billion combinations, checked against every ref the lead table has ever held.
create or replace function public.lead_ref_new() returns text language plpgsql volatile set search_path = public as $$
declare a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; r text; b bytea; i int;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); r := 'L-';
    for i in 0..5 loop r := r || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.leads where ref = r or old_ref = r or ref_aliases @> array[r]);
  end loop;
  return r;
end $$;
revoke all on function public.lead_ref_new() from public, anon, authenticated;

create or replace function public.leads_private_ref() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ref is null or new.ref !~ '^L-[A-Z0-9]{6}$' then new.ref := public.lead_ref_new(); end if;
  return new;
end $$;
drop trigger if exists leads_serial_ref_tr on public.leads;
drop function if exists public.leads_serial_ref();
drop trigger if exists leads_private_ref_tr on public.leads;
create trigger leads_private_ref_tr before insert on public.leads for each row execute function public.leads_private_ref();

-- ───────────────────────── Existing data ─────────────────────────
-- Run before the booking ID triggers exist, so the history is not filled with one line per old lead. Safe to run again.
do $$
declare r record; won constant text := $w$
    l.status in ('paid','scheduled','completed') or coalesce(l.paid_amount, 0) > 0 or l.payment_link is not null
    or exists (select 1 from public.invoices i where i.lead_id = l.id)
    or exists (select 1 from public.invoice_numbers n where n.lead_id = l.id)
    or exists (select 1 from public.ledger_entries e where e.lead_id = l.id)$w$;
begin
  -- won leads keep the number they have: it is on their invoice, payment link or messages
  execute 'update public.leads l set booking_id = l.ref where l.booking_id is null and l.ref ~ ''^MP-[0-9]{2}-[0-9]{2}-[0-9]{4}$'' and (' || won || ')';
  -- a won lead that somehow has no serial ref gets the next serial; its old ref still finds it
  for r in execute 'select l.id, l.ref, l.created_at from public.leads l where l.booking_id is null and l.ref !~ ''^L-'' and (' || won || ') order by l.created_at, l.id' loop
    update public.leads set old_ref = coalesce(old_ref, ref), ref_aliases = array_append(ref_aliases, ref), booking_id = public.order_ref_next(r.created_at) where id = r.id;
  end loop;
  -- every other lead: the ID it had keeps resolving (old_ref, and ref_aliases for the one old_ref could not hold), then it gets a private ref and no booking ID
  for r in execute 'select l.id from public.leads l where l.booking_id is null and l.ref !~ ''^L-'' and not (' || won || ') order by l.created_at, l.id' loop
    update public.leads set old_ref = coalesce(old_ref, ref),
      ref_aliases = case when ref = any (ref_aliases) then ref_aliases else array_append(ref_aliases, ref) end,
      ref = public.lead_ref_new(), booking_id = null
    where id = r.id;
  end loop;
end $$;

-- ───────────────────────── Assigning the booking ID ─────────────────────────
-- (a) Crew or Admin confirms. Idempotent: a lead that has an ID gets the same one back.
create or replace function public.confirm_booking(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; r text; adm boolean := public.is_admin(); n text;
begin
  if auth.uid() is null then raise exception 'sign in again' using errcode = '42501'; end if;
  if not adm then r := public.crm_need_role(); perform public.crm_require('create_bookings'); end if;
  select * into l from public.leads where id = p_lead for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not adm and not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.booking_id is not null then return l.booking_id; end if;
  if l.status in ('lost','junk') then raise exception 'this lead is closed; reopen it first' using errcode = 'P0001'; end if;
  update public.leads set booking_id = public.order_ref_next() where id = p_lead returning booking_id into n;
  return n;   -- the history line and the audit entry are written by leads_booking_id_log_tr
end $$;
revoke all on function public.confirm_booking(uuid) from public, anon;
grant execute on function public.confirm_booking(uuid) to authenticated;

-- (b) Online payment, scheduling or completion gives the ID by itself (payment webhook, checkout verify, admin, desk).
create or replace function public.leads_booking_id_auto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is null and new.status <> 'junk' and (new.status in ('paid','scheduled','completed') or coalesce(new.paid_amount, 0) > 0) then
    new.booking_id := public.order_ref_next();
  end if;
  return new;
end $$;
drop trigger if exists leads_booking_id_auto_tr on public.leads;
create trigger leads_booking_id_auto_tr before insert or update on public.leads for each row execute function public.leads_booking_id_auto();

-- Who gave the ID and when, for every way it can be given.
create or replace function public.leads_booking_id_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is not null and (tg_op = 'INSERT' or old.booking_id is distinct from new.booking_id) then
    insert into public.crm_activities (lead_id, actor, kind, body)
      values (new.id, auth.uid(), 'edit', 'Booking ID ' || new.booking_id || ' given ' ||
        case when auth.uid() is null then 'automatically (' || new.status || ')' else 'by ' || coalesce(public.crm_name(auth.uid()), 'a team member') end);
    insert into public.audit_log (actor, action, details)
      values (auth.uid(), 'booking_id_assigned', jsonb_build_object('lead', new.ref, 'booking_id', new.booking_id, 'status', new.status, 'manual', auth.uid() is not null));
  end if;
  return null;
end $$;
drop trigger if exists leads_booking_id_log_tr on public.leads;
create trigger leads_booking_id_log_tr after insert or update on public.leads for each row execute function public.leads_booking_id_log();

-- (c) An invoice uses the booking ID as its number, and makes sure the booking has one.
create or replace function public.invoice_no_alloc(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select booking_id into n from public.leads where id = p_lead for update;
  if not found then raise exception 'Booking not found'; end if;
  if n is null then update public.leads set booking_id = public.order_ref_next() where id = p_lead returning booking_id into n; end if;
  insert into public.invoice_numbers (lead_id, fy, seq, number) values (p_lead, substr(n, 4, 5), nullif(right(n, 4), '')::integer, n)
    on conflict (lead_id) do update set number = excluded.number, fy = excluded.fy, seq = excluded.seq;
  return n;
end $$;
revoke all on function public.invoice_no_alloc(uuid) from public, anon, authenticated;
grant execute on function public.invoice_no_alloc(uuid) to service_role;

-- ───────────────────────── Junk leads (admin only) ─────────────────────────
-- Junk keeps the row and the reason, and drops out of follow-ups, reminders, pipeline totals and reports.
create or replace function public.stop_followups_when_closed() returns trigger language plpgsql as $$
begin
  if new.status in ('paid','scheduled','completed','lost','junk') or new.opted_out then
    new.next_followup_at := null;
  end if;
  return new;
end; $$;

create or replace function public.mark_lead_junk(p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare l public.leads; why text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then raise exception 'only an admin can mark a lead as junk' using errcode = '42501'; end if;
  select * into l from public.leads where id = p_lead for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.status = 'junk' then return; end if;
  if l.booking_id is not null or l.status in ('paid','scheduled','completed') or coalesce(l.paid_amount, 0) > 0 then
    raise exception 'a confirmed booking cannot be marked as junk' using errcode = 'P0001';
  end if;
  if why is not null and char_length(why) > 200 then raise exception 'the reason is too long' using errcode = 'P0001'; end if;
  if public.crm_has_pii(why) then raise exception 'Remove ID or card numbers from the reason.' using errcode = 'P0001'; end if;
  update public.leads set junk_prev_status = status, status = 'junk', junk_reason = why, junk_at = now(), junk_by = auth.uid() where id = p_lead;
  insert into public.crm_activities (lead_id, actor, kind, body, status_to)
    values (p_lead, auth.uid(), 'status', 'Marked as junk' || coalesce(': ' || why, ''), 'junk');
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'lead_marked_junk', jsonb_build_object('lead', l.ref, 'reason', why, 'from', l.status));
end $$;

create or replace function public.restore_lead_junk(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; back text;
begin
  if not public.is_admin() then raise exception 'only an admin can restore a junk lead' using errcode = '42501'; end if;
  select * into l from public.leads where id = p_lead for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.status <> 'junk' then raise exception 'this lead is not junk' using errcode = 'P0001'; end if;
  back := case when l.junk_prev_status in ('new','contacted','quoted','payment_sent') then l.junk_prev_status else 'new' end;
  update public.leads set status = back, junk_reason = null, junk_at = null, junk_by = null, junk_prev_status = null where id = p_lead;
  insert into public.crm_activities (lead_id, actor, kind, body, status_to)
    values (p_lead, auth.uid(), 'restore', 'Restored from junk to ' || back, back);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'lead_junk_restored', jsonb_build_object('lead', l.ref, 'to', back));
  return back;
end $$;
revoke all on function public.mark_lead_junk(uuid, text), public.restore_lead_junk(uuid) from public, anon;
grant execute on function public.mark_lead_junk(uuid, text), public.restore_lead_junk(uuid) to authenticated;

-- ───────────────────────── Desk screens: show the booking ID, leave junk out ─────────────────────────
-- The desk view is "select *", frozen when it was made. Remaking it adds the new columns (booking_id, junk_*).
create or replace view public.crm_desk_leads as select * from public.leads where source is distinct from 'website';
revoke all on public.crm_desk_leads from public, anon, authenticated;

drop function if exists public.crm_leads_list(text, text, uuid, date, date, integer);
create or replace function public.crm_leads_list(p_filter text default 'all', p_search text default null, p_owner uuid default null,
  p_from date default null, p_to date default null, p_limit integer default 500)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text)
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
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    and (p_filter = 'junk') = (l.status = 'junk')
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
      when 'junk' then l.status = 'junk'
      else false end
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end; $$;

drop function if exists public.crm_my_leads(text, text);
create or replace function public.crm_my_leads(p_filter text default 'mine', p_search text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text)
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
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null and (l.crm_owner = auth.uid() or l.crm_owner is null)
    and (p_filter = 'junk') = (l.status = 'junk')
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    and case p_filter
      when 'mine' then l.crm_owner = auth.uid() and l.status in ('new','contacted','quoted','payment_sent')
      when 'unassigned' then l.crm_owner is null
      when 'followups' then l.crm_owner = auth.uid() and l.crm_next_action_at is not null and l.crm_next_action_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' and l.status in ('new','contacted','quoted','payment_sent')
      when 'converted' then l.crm_owner = auth.uid() and l.status in ('paid','scheduled','completed')
      when 'won' then l.crm_owner = auth.uid() and l.status = 'completed'
      when 'lost' then l.crm_owner = auth.uid() and l.status = 'lost'
      when 'junk' then l.crm_owner = auth.uid() and l.status = 'junk'
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
  from public.crm_desk_leads l
  where deleted_at is null and status <> 'junk' and (allv or crm_owner = me or crm_owner is null) and (p_owner is null or crm_owner = p_owner)
    and (p_from is null or created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')) and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'));
  return jsonb_build_object('all', t, 'converted', c, 'won', w, 'followups', f, 'lost', lo,
    'junk', (select count(*) from public.crm_desk_leads where deleted_at is null and status = 'junk' and (allv or crm_owner = me or crm_owner is null)),
    'pct', jsonb_build_object('converted', case when t > 0 then round(c * 100.0 / t) else 0 end, 'won', case when t > 0 then round(w * 100.0 / t) else 0 end,
      'lost', case when t > 0 then round(lo * 100.0 / t) else 0 end, 'followups', case when t > 0 then round(f * 100.0 / t) else 0 end));
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
    from public.crm_desk_leads where deleted_at is null and status <> 'junk' and created_at >= f and created_at < t and (allv or crm_owner = me or crm_owner is null);
  -- chats: a conversation is a phone number with messages in the last 30 days; unreplied = the last message is from the customer
  with last_msg as (
    select distinct on (phone) phone, direction from public.messages where created_at > now() - interval '30 days' order by phone, created_at desc)
  select count(*), count(*) filter (where direction = 'in') into chats_total, chats_unreplied from last_msg;
  res := jsonb_build_object(
    'range', jsonb_build_object('from', f, 'to', t),
    'chats', jsonb_build_object('total', chats_total, 'unreplied', chats_unreplied),
    'leads', jsonb_build_object('total', tot, 'won', won, 'lost', lost,
      'won_pct', case when tot > 0 then round(won * 100.0 / tot) else 0 end, 'lost_pct', case when tot > 0 then round(lost * 100.0 / tot) else 0 end),
    'unassigned', (select count(*) from public.crm_desk_leads where deleted_at is null and crm_owner is null and status in ('new','contacted','quoted','payment_sent')),
    'targets', jsonb_build_object(
      'team', jsonb_build_object('daily_target', td, 'monthly_target', tm,
        'daily_done', (select count(*) from public.crm_desk_leads where deleted_at is null and crm_won_at >= day0 and crm_owner in (select user_id from public.crm_users)),
        'monthly_done', (select count(*) from public.crm_desk_leads where deleted_at is null and crm_won_at >= mon0 and crm_owner in (select user_id from public.crm_users))),
      'me', jsonb_build_object('daily_target', coalesce((select daily_target from public.crm_users where user_id = me), 0), 'monthly_target', coalesce((select monthly_target from public.crm_users where user_id = me), 0),
        'daily_done', (select count(*) from public.crm_desk_leads where deleted_at is null and crm_won_at >= day0 and crm_owner = me),
        'monthly_done', (select count(*) from public.crm_desk_leads where deleted_at is null and crm_won_at >= mon0 and crm_owner = me))));
  if public.crm_can('view_team_performance') then
    res := res || jsonb_build_object('agents', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id, 'name', u.name, 'designation', u.designation, 'daily_target', u.daily_target, 'monthly_target', u.monthly_target,
      'assigned', x.assigned, 'won', x.won, 'lost', x.lost,
      'won_pct', case when x.assigned > 0 then round(x.won * 100.0 / x.assigned) else 0 end, 'lost_pct', case when x.assigned > 0 then round(x.lost * 100.0 / x.assigned) else 0 end,
      'daily_done', (select count(*) from public.crm_desk_leads l where l.deleted_at is null and l.crm_owner = u.user_id and l.crm_won_at >= day0),
      'monthly_done', (select count(*) from public.crm_desk_leads l where l.deleted_at is null and l.crm_owner = u.user_id and l.crm_won_at >= mon0)) order by u.name)
      from public.crm_users u cross join lateral (
        select count(*) assigned, count(*) filter (where l.status = 'completed') won, count(*) filter (where l.status = 'lost') lost
        from public.crm_desk_leads l where l.deleted_at is null and l.status <> 'junk' and l.crm_owner = u.user_id and l.created_at >= f and l.created_at < t) x
      where u.active), '[]'::jsonb));
  end if;
  if public.crm_can('view_attribution') then
    res := res || jsonb_build_object('attribution', coalesce((select jsonb_agg(jsonb_build_object('platform', p, 'leads', n, 'booked', b, 'share', case when s > 0 then round(n * 100.0 / s) else 0 end) order by n desc)
      from (select coalesce(nullif(utm ->> 'utm_source', ''), source) p, count(*) n, count(*) filter (where status in ('paid','scheduled','completed')) b, sum(count(*)) over () s
            from public.crm_desk_leads where deleted_at is null and status <> 'junk' and created_at >= f and created_at < t group by 1) q), '[]'::jsonb));
  end if;
  return res;
end; $$;

create or replace function public.crm_lead(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads; sla int;
begin
  select * into l from public.leads where id = p_id and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return jsonb_build_object(
    'lead', (select jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'junk_reason', l.junk_reason, 'junk_at', l.junk_at, 'name', l.name, 'phone', l.phone, 'area', l.area, 'pincode', l.pincode, 'address', l.address,
        'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'brand', b.brand, 'model', b.model, 'service_id', l.service_id, 'addons', to_jsonb(l.addons), 'service_name', s.name, 'source', l.source,
        'campaign', l.utm ->> 'utm_campaign', 'utm_source', l.utm ->> 'utm_source', 'status', l.status, 'crm_owner', l.crm_owner,
        'owner_name', public.crm_name(l.crm_owner), 'est_total', l.est_total, 'coupon_code', l.coupon_code, 'coupon_discount', l.coupon_discount, 'notes', l.notes, 'preferred_date', l.preferred_date,
        'preferred_slot', l.preferred_slot, 'job_place', l.job_place, 'disposition', l.disposition, 'sub_disposition', l.sub_disposition, 'created_at', l.created_at, 'updated_at', l.updated_at, 'crm_next_action_at', l.crm_next_action_at,
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

create or replace function public.crm_replies_waiting() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean;
begin
  perform public.crm_need_role(); boss := public.crm_can('assign_leads');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'phone', l.phone, 'wrote_at', l.last_customer_msg_at, 'owner', public.crm_name(l.crm_owner), 'unassigned', l.crm_owner is null)
      order by l.last_customer_msg_at)
    from public.crm_desk_leads l
    where l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent') and not coalesce(l.opted_out, false)
      and l.last_customer_msg_at > now() - interval '3 days'
      and (l.wa_last_message_at is null or l.last_customer_msg_at >= l.wa_last_message_at - interval '90 seconds')
      and not exists (select 1 from public.crm_activities a where a.lead_id = l.id and a.kind in ('call','whatsapp') and a.created_at > l.last_customer_msg_at)
      and (boss or coalesce(l.crm_owner = me, false) or (l.crm_owner is null and public.crm_can('take_leads')))), '[]'::jsonb);
end; $$;

create or replace function public.crm_tech_board(p_date date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  return jsonb_build_object('date', d,
    'techs', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'area', m.area, 'pincodes', to_jsonb(m.pincodes), 'shift', m.shift,
        'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'area', l.area, 'pincode', l.pincode, 'slot', l.preferred_slot, 'status', l.status) order by l.preferred_slot)
          from public.leads l where l.mechanic_id = m.id and l.deleted_at is null and l.preferred_date = d and l.status in ('paid','scheduled','completed')), '[]'::jsonb)) order by m.name)
      from public.mechanics m where m.active and m.onboarding_status in ('live','pilot')), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'area', l.area, 'slot', l.preferred_slot) order by l.preferred_slot)
      from public.leads l where l.mechanic_id is null and l.deleted_at is null and l.preferred_date = d and l.status in ('paid','scheduled')), '[]'::jsonb));
end; $$;

create or replace function public.crm_unstaffed_jobs() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not public.crm_can('assign_leads') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'area', l.area, 'preferred_date', l.preferred_date, 'preferred_slot', l.preferred_slot) order by l.preferred_date, l.preferred_slot)
    from public.leads l
    where l.deleted_at is null and l.mechanic_id is null and l.status in ('paid','scheduled')
      and l.preferred_date between (now() at time zone 'Asia/Kolkata')::date - 7 and (now() at time zone 'Asia/Kolkata')::date), '[]'::jsonb);
end; $$;

create or replace function public.crm_web_leads(p_filter text default 'open', p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role();
  if not (public.crm_can('take_leads') or public.crm_can('view_all_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at') desc) from (
    select jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'phone', l.phone, 'area', l.area, 'service', s.name, 'status', l.status,
      'est_total', l.est_total, 'created_at', l.created_at, 'owner', public.crm_name(l.crm_owner), 'owner_id', l.crm_owner,
      'when', nullif(concat_ws(' ', l.preferred_date::text, l.preferred_slot), '')) as x
    from public.leads l left join public.services s on s.id = l.service_id
    where l.source = 'website' and l.deleted_at is null
      and (case when coalesce(p_filter, 'open') = 'open' then l.status in ('new','contacted','quoted','payment_sent') when p_filter = 'junk' then l.status = 'junk' else l.status <> 'junk' end)
      and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
      and (q is null or l.name ilike '%' || q || '%' or l.phone ilike '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    order by l.created_at desc limit 300) t), '[]'::jsonb);
end; $$;

create or replace function public.crm_payment_context(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.crm_need_role(); perform public.crm_require('send_payment_link');
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (coalesce(l.crm_owner = auth.uid(), false) or public.crm_can('assign_leads')) then raise exception 'take the lead first' using errcode = '42501'; end if;
  if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already confirmed' using errcode = 'P0001'; end if;
  if l.status in ('lost','junk') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  return jsonb_build_object('lead_id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'phone', l.phone, 'status', l.status, 'est_total', l.est_total, 'can_override', public.crm_can('assign_leads'),
    'existing_link', l.payment_link is not null, 'existing_amount', l.amount_due);
end; $$;

create or replace function public.crm_me() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); u record; sla int;
begin
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes';
  select coalesce(cu.name, a.name) as name, coalesce(cu.daily_target, 3) as target, coalesce(cu.monthly_target, 60) as mtarget, cu.designation as designation into u
    from (select 1) x left join public.crm_users cu on cu.user_id = auth.uid() left join public.admins a on a.user_id = auth.uid();
  return jsonb_build_object(
    'user_id', auth.uid(), 'name', u.name, 'role', r, 'designation', u.designation, 'daily_target', u.target, 'monthly_target', u.mtarget, 'sla_minutes', coalesce(sla, 15),
    'permissions', public.crm_perms(), 'is_admin', public.is_admin(),
    'booked_today', (select count(*) from public.leads where crm_owner = auth.uid() and crm_won_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' and deleted_at is null),
    'pending_advance', (select count(*) from public.leads where crm_owner = auth.uid() and status = 'payment_sent' and deleted_at is null),
    'contacts_today', (select count(*) from public.crm_activities where actor = auth.uid() and kind in ('call','whatsapp') and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_leads_list(text,text,uuid,date,date,integer)','crm_my_leads(text,text)','crm_leads_summary(date,date,uuid)','crm_dashboard(date,date)',
    'crm_lead(uuid)','crm_me()','crm_replies_waiting()','crm_tech_board(date)','crm_unstaffed_jobs()','crm_payment_context(uuid)']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
revoke all on function public.crm_web_leads(text, text) from public, anon;
grant execute on function public.crm_web_leads(text, text) to authenticated;
