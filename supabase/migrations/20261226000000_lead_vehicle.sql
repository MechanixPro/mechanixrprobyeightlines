-- Vehicle tag on leads: BIKE, CAR or PARTS, so the desk can tell the three apart (bike ads, a car service ad and the Axlio parts ads share one WhatsApp number).
-- Today every lead is a "quote" and nothing says car or bike (bike_type is only an S/M size).
--
-- What this does:
--   * leads.vehicle  text not null default 'bike'  (check: bike, car, parts)
--   * leads.vehicle_source text null               ('auto' = set by automation, 'desk' = a person set it; automation never overrides 'desk')
--   * detect_vehicle(text): whole-word, case-insensitive, conservative (same word lists as supabase/functions/_shared/vehicle.ts)
--   * backfill: 'car' or 'parts' only where the lead's own text clearly says so; everything else stays 'bike'. Status, junk and booking IDs are not touched.
--   * set_lead_vehicle(lead, vehicle): the desk's control. Writes vehicle_source = 'desk', a history line and an audit row.
--   * the desk functions that return leads now return vehicle, and the list functions take an optional vehicle filter.
-- Rollback: drop the new functions, restore the previous bodies from 20261225000000, then
--   alter table public.leads drop column vehicle_source, drop column vehicle;   (drop the view crm_desk_leads first and recreate it)
-- Idempotent: safe to run twice.

alter table public.leads add column if not exists vehicle text not null default 'bike' check (vehicle in ('bike','car','parts'));
alter table public.leads add column if not exists vehicle_source text check (vehicle_source in ('auto','desk'));
create index if not exists leads_vehicle_idx on public.leads (vehicle);

-- ───────────────────────── Detector (mirror of detectVehicle in _shared/vehicle.ts) ─────────────────────────
-- Returns 'parts', 'car', 'bike' or null. "-", "_", "." and "/" count as spaces. \m and \M are whole-word edges.
create or replace function public.detect_vehicle(p text) returns text language plpgsql immutable set search_path = public as $$
declare t text; car boolean; bike boolean;
begin
  if p is null or btrim(p) = '' then return null; end if;
  t := regexp_replace(regexp_replace(lower(left(p, 6000)), '[_./-]+', ' ', 'g'), '\s+', ' ', 'g');
  if t ~ '\m(spare parts?|auto parts?|car parts?|bike parts?|axlio)\M' then return 'parts'; end if;
  car := t ~ '\m(cars?|four wheelers?|4 wheelers?|4wheelers?|hatchback|sedan|swift|i20|i10|creta|baleno|brezza|wagon r|wagonr|alto|nexon|innova)\M';
  bike := t ~ '\m(bikes?|scooter|scooty|motorcycle|motorbike|two wheeler|2 wheeler|activa|splendor|pulsar)\M';
  if car and bike then return null; end if;
  return case when car then 'car' when bike then 'bike' else null end;
end; $$;

-- ───────────────────────── Backfill (conservative) ─────────────────────────
-- Text read per lead: its notes, note, campaign, page, the ad campaign / keyword / content in utm, the bike brand and model, and what the customer wrote
-- on WhatsApp (inbound messages). Staff notes and activity lines are not read. A lead that mentions both bike and car words stays bike.
-- Only leads still on the default with no source are looked at, so a desk edit is never overwritten and a second run changes nothing.
do $$
declare n_car int; n_parts int; n_total int;
begin
  alter table public.leads disable trigger leads_touch;   -- a tag is not an edit: keep updated_at (and the desk's "last activity" order)
  with t as (
    select l.id, public.detect_vehicle(concat_ws(' ', l.notes, l.note, l.campaign, l.page, l.utm ->> 'utm_campaign', l.utm ->> 'utm_term', l.utm ->> 'utm_content',
        b.brand, b.model,
        (select string_agg(m.body, ' ') from public.messages m where m.lead_id = l.id and m.direction = 'in' and m.sender = 'customer'))) as v
    from public.leads l left join public.bikes b on b.id = l.bike_id
    where l.vehicle = 'bike' and l.vehicle_source is null)
  update public.leads l set vehicle = t.v, vehicle_source = 'auto' from t where t.id = l.id and t.v in ('car', 'parts');
  alter table public.leads enable trigger leads_touch;
  select count(*) filter (where vehicle = 'car'), count(*) filter (where vehicle = 'parts'), count(*) into n_car, n_parts, n_total from public.leads;
  raise notice 'lead vehicle backfill: % car, % parts, % bike (of % leads)', n_car, n_parts, n_total - n_car - n_parts, n_total;
end $$;

-- ───────────────────────── Desk control ─────────────────────────
-- Desk people who may edit leads and can see this lead; admins too. A desk edit locks the tag against automation.
create or replace function public.set_lead_vehicle(p_lead uuid, p_vehicle text) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; r text; v text := lower(btrim(coalesce(p_vehicle, '')));
begin
  if v not in ('bike','car','parts') then raise exception 'choose bike, car or parts' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not public.is_admin() then
    r := public.crm_need_role();
    perform public.crm_require('edit_leads');
    if not coalesce(public.crm_can_see(l, r), false) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  end if;
  update public.leads set vehicle = v, vehicle_source = 'desk' where id = p_lead;
  if l.vehicle is distinct from v then
    insert into public.crm_activities (lead_id, actor, kind, body)
      values (p_lead, auth.uid(), 'edit', 'Vehicle changed from ' || upper(l.vehicle) || ' to ' || upper(v));
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'lead_vehicle_set', jsonb_build_object('lead', l.ref, 'from', l.vehicle, 'to', v));
  return v;
end $$;
revoke all on function public.set_lead_vehicle(uuid, text) from public, anon;
grant execute on function public.set_lead_vehicle(uuid, text) to authenticated;
revoke all on function public.detect_vehicle(text) from public, anon, authenticated;

-- ───────────────────────── Desk screens: return the vehicle ─────────────────────────
-- Bodies are copied from 20261225000000_booking_id_after_confirmation.sql with only the vehicle added. The desk view is "select *", frozen when made: remake it to add the new columns.
create or replace view public.crm_desk_leads as select * from public.leads where source is distinct from 'website';
revoke all on public.crm_desk_leads from public, anon, authenticated;

drop function if exists public.crm_leads_list(text, text, uuid, date, date, integer);
drop function if exists public.crm_leads_list(text, text, uuid, date, date, integer, text);
create or replace function public.crm_leads_list(p_filter text default 'all', p_search text default null, p_owner uuid default null,
  p_from date default null, p_to date default null, p_limit integer default 500, p_vehicle text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text, vehicle text)
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
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id, l.vehicle
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null
    and (q is null or l.name ilike '%' || q || '%' or l.phone like '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    and (p_filter = 'junk') = (l.status = 'junk')
    and (p_owner is null or l.crm_owner = p_owner)
    and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
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
drop function if exists public.crm_my_leads(text, text, text);
create or replace function public.crm_my_leads(p_filter text default 'mine', p_search text default null, p_vehicle text default null)
returns table (id uuid, ref text, lead text, mobile text, source text, platform text, stage text, owner_id uuid, owner_name text, disposition text, sub_disposition text,
  follow_up timestamptz, created_at timestamptz, last_activity timestamptz, area text, bike text, service_name text, est_total integer, is_late boolean, overdue boolean, lost_reason text, updated_at timestamptz, booking_id text, vehicle text)
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
    (l.crm_next_action_at is not null and l.crm_next_action_at < now() and l.status in ('new','contacted','quoted','payment_sent')), case when l.status = 'junk' then l.junk_reason else l.crm_lost_reason end, l.updated_at, l.booking_id, l.vehicle
  from public.crm_desk_leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id
  where l.deleted_at is null and (l.crm_owner = auth.uid() or l.crm_owner is null)
    and (p_filter = 'junk') = (l.status = 'junk')
    and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
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

drop function if exists public.crm_leads_summary(date, date, uuid);
drop function if exists public.crm_leads_summary(date, date, uuid, text);
create or replace function public.crm_leads_summary(p_from date default null, p_to date default null, p_owner uuid default null, p_vehicle text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t int; c int; w int; f int; lo int; allv boolean; me uuid := auth.uid(); bv jsonb;
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
    and (nullif(p_vehicle, '') is null or vehicle = p_vehicle)
    and (p_from is null or created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')) and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'));
  -- bike / car / parts split for the same people and dates (the vehicle filter itself is not applied, so the three always show)
  select coalesce(jsonb_object_agg(v.k, jsonb_build_object('leads', coalesce(x.n, 0), 'converted', coalesce(x.b, 0), 'won', coalesce(x.w, 0))), '{}'::jsonb) into bv
  from (values ('bike'), ('car'), ('parts')) v(k)
  left join (select vehicle, count(*) n, count(*) filter (where status in ('paid','scheduled','completed')) b, count(*) filter (where status = 'completed') w
    from public.crm_desk_leads where deleted_at is null and status <> 'junk' and (allv or crm_owner = me or crm_owner is null) and (p_owner is null or crm_owner = p_owner)
      and (p_from is null or created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')) and (p_to is null or created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
    group by vehicle) x on x.vehicle = v.k;
  return jsonb_build_object('all', t, 'converted', c, 'won', w, 'followups', f, 'lost', lo, 'by_vehicle', bv,
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
  res := res || jsonb_build_object('by_vehicle', (select coalesce(jsonb_object_agg(v.k, jsonb_build_object('leads', coalesce(x.n, 0), 'booked', coalesce(x.b, 0), 'won', coalesce(x.w, 0))), '{}'::jsonb)
    from (values ('bike'), ('car'), ('parts')) v(k)
    left join (select vehicle, count(*) n, count(*) filter (where status in ('paid','scheduled','completed')) b, count(*) filter (where status = 'completed') w
      from public.crm_desk_leads where deleted_at is null and status <> 'junk' and created_at >= f and created_at < t and (allv or crm_owner = me or crm_owner is null) group by vehicle) x on x.vehicle = v.k));
  return res;
end; $$;

create or replace function public.crm_lead(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads; sla int;
begin
  select * into l from public.leads where id = p_id and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select coalesce((value #>> '{}')::int, 15) into sla from public.settings where key = 'crm_sla_minutes'; sla := coalesce(sla, 15);
  return jsonb_build_object(
    'lead', (select jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'vehicle', l.vehicle, 'vehicle_source', l.vehicle_source, 'junk_reason', l.junk_reason, 'junk_at', l.junk_at, 'name', l.name, 'phone', l.phone, 'area', l.area, 'pincode', l.pincode, 'address', l.address,
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

drop function if exists public.crm_web_leads(text, text);
drop function if exists public.crm_web_leads(text, text, text);
create or replace function public.crm_web_leads(p_filter text default 'open', p_search text default null, p_vehicle text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role();
  if not (public.crm_can('take_leads') or public.crm_can('view_all_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at') desc) from (
    select jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'vehicle', l.vehicle, 'name', l.name, 'phone', l.phone, 'area', l.area, 'service', s.name, 'status', l.status,
      'est_total', l.est_total, 'created_at', l.created_at, 'owner', public.crm_name(l.crm_owner), 'owner_id', l.crm_owner,
      'when', nullif(concat_ws(' ', l.preferred_date::text, l.preferred_slot), '')) as x
    from public.leads l left join public.services s on s.id = l.service_id
    where l.source = 'website' and l.deleted_at is null
      and (case when coalesce(p_filter, 'open') = 'open' then l.status in ('new','contacted','quoted','payment_sent') when p_filter = 'junk' then l.status = 'junk' else l.status <> 'junk' end)
      and (nullif(p_vehicle, '') is null or l.vehicle = p_vehicle)
      and (public.crm_can('view_all_leads') or l.crm_owner is null or l.crm_owner = auth.uid())
      and (q is null or l.name ilike '%' || q || '%' or l.phone ilike '%' || q || '%' or l.ref ilike '%' || q || '%' or l.booking_id ilike '%' || q || '%')
    order by l.created_at desc limit 300) t), '[]'::jsonb);
end; $$;

do $$ declare f text; begin
  for f in select unnest(array['crm_leads_list(text,text,uuid,date,date,integer,text)','crm_my_leads(text,text,text)','crm_leads_summary(date,date,uuid,text)','crm_dashboard(date,date)',
    'crm_lead(uuid)','crm_web_leads(text,text,text)']) loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
