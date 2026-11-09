-- Live leads for partner garages: an available, live garage sees open paid bookings near it and the first to claim wins. Additive and idempotent.
-- Rollback: drop function public.garage_live_leads(uuid), public.garage_claim_lead(uuid, uuid), public.garage_haversine_km(numeric, numeric, numeric, numeric);
-- Both functions are for the service role only (the garage-app Edge Function checks the garage's session first). They never return a customer's name, phone, email or street address.

create or replace function public.garage_haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric language sql immutable as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else round((2 * 6371 * asin(sqrt(power(sin(radians((lat2 - lat1)::float8) / 2), 2) + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2))))::numeric, 1) end;
$$;

-- Open bookings this garage may claim. Radius and capacity come from the same setting the auto-assign step uses (auto_assign_garage), with the same defaults.
create or replace function public.garage_live_leads(p_garage uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages; s jsonb; radius numeric; maxjobs int; openjobs int;
begin
  select * into g from public.garages where id = p_garage and deleted_at is null and status in ('live', 'pilot') and ops_state = 'active' and is_open;
  if not found then return jsonb_build_object('available', false, 'leads', '[]'::jsonb); end if;
  select value into s from public.settings where key = 'auto_assign_garage';
  radius := coalesce((s ->> 'radius_km')::numeric, 15); maxjobs := coalesce((s ->> 'max_open_jobs')::int, 3);
  select count(*) into openjobs from public.garage_assignments where garage_id = p_garage and status in ('sent', 'received', 'in_work', 'ready');
  if openjobs >= maxjobs then return jsonb_build_object('available', true, 'full', true, 'leads', '[]'::jsonb); end if;
  return jsonb_build_object('available', true, 'full', false, 'leads', coalesce((
    select jsonb_agg(x order by x.sort_at) from (
      select l.id as id, l.booking_id as ref, coalesce(sv.name, 'Bike service') as service, case when l.vehicle = 'car' then 'car' else 'bike' end as vehicle_type,
             nullif(btrim(coalesce(b.brand, '') || ' ' || coalesce(b.model, '')), '') as model, l.area as area, l.pincode as pin,
             l.preferred_date as slot_date, l.preferred_slot as slot_part,
             public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) as distance_km,
             coalesce(l.preferred_date::timestamptz, l.created_at) as sort_at
        from public.leads l
        left join public.services sv on sv.id = l.service_id
        left join public.bikes b on b.id = l.bike_id
       where l.deleted_at is null and l.confirm_paid_at is not null and l.status in ('paid', 'scheduled') and l.mechanic_id is null
         and (l.preferred_date is null or l.preferred_date >= (now() at time zone 'Asia/Kolkata')::date)
         and not exists (select 1 from public.garage_assignments a where a.lead_id = l.id and a.status in ('sent', 'received', 'in_work', 'ready'))
         and (
           (public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) is not null and public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) <= radius)
           or (public.garage_haversine_km(g.shop_lat, g.shop_lng, l.lat, l.lng) is null and g.pincode is not null and l.pincode = g.pincode)
         )
       limit 20
    ) x), '[]'::jsonb));
end $$;

-- Claim: re-checks everything inside the transaction, so two garages tapping at once cannot both win.
create or replace function public.garage_claim_lead(p_garage uuid, p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; g public.garages; s jsonb; maxjobs int; openjobs int; nid uuid; mine public.garage_assignments;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'taken'); end if;
  select * into g from public.garages where id = p_garage and deleted_at is null and status in ('live', 'pilot') and ops_state = 'active' and is_open;
  if not found then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  -- Same garage tapping twice: still theirs.
  select * into mine from public.garage_assignments where lead_id = p_lead and garage_id = p_garage and status in ('sent', 'received', 'in_work', 'ready');
  if found then return jsonb_build_object('ok', true, 'already', true, 'assignment_id', mine.id); end if;
  if l.mechanic_id is not null or l.confirm_paid_at is null or l.status not in ('paid', 'scheduled')
     or exists (select 1 from public.garage_assignments a where a.lead_id = p_lead and a.status in ('sent', 'received', 'in_work', 'ready')) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  select value into s from public.settings where key = 'auto_assign_garage';
  maxjobs := coalesce((s ->> 'max_open_jobs')::int, 3);
  select count(*) into openjobs from public.garage_assignments where garage_id = p_garage and status in ('sent', 'received', 'in_work', 'ready');
  if openjobs >= maxjobs then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  -- The garage chose this job, so it starts as received (accepted).
  insert into public.garage_assignments (lead_id, garage_id, status, received_at, assigned_by) values (p_lead, p_garage, 'received', now(), null) returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'assign', 'Garage ' || g.name || ' claimed the job from Live leads');
  insert into public.audit_log (actor, action, details) values (null, 'garage_claimed', jsonb_build_object('lead', l.ref, 'garage', p_garage, 'assignment', nid));
  return jsonb_build_object('ok', true, 'assignment_id', nid);
end $$;

revoke all on function public.garage_haversine_km(numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.garage_live_leads(uuid), public.garage_claim_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.garage_live_leads(uuid), public.garage_claim_lead(uuid, uuid) to service_role;
