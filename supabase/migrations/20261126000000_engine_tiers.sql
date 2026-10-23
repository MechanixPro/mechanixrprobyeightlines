-- Engine-size pricing: Basic, General and Full have a second price for bikes of 150 to 250cc (rows basic250, general250, full250).
-- Above 250cc is the 150-250cc price plus the existing above-250cc surcharge (row bigbike). Repair, roadside and the slot fees are not split by engine size.
alter table public.bikes add column if not exists engine_class text check (engine_class in ('std', 'mid', 'big'));
comment on column public.bikes.engine_class is 'std = up to 149cc, mid = 150 to 250cc, big = above 250cc. Null on bookings made before engine-size pricing: those used big_bike with the old surcharge.';

update public.services t set active = true, sort = v.sort,
  description = (select s.description from public.services s where s.id = v.base),
  includes = (select s.includes from public.services s where s.id = v.base)
from (values ('basic250', 'basic', 11), ('general250', 'general', 12), ('full250', 'full', 13)) as v(id, base, sort) where t.id = v.id;

-- The price of a package for an engine class. A missing or inactive tier row falls back to the standard price, so a half-set price sheet never breaks a booking.
create or replace function public.crm_booking_price(p_service text, p_addons text[], p_engine text) returns integer language plpgsql stable security definer set search_path = public as $$
declare tot int; a text; tier int; fee int;
begin
  select price into tot from public.services where id = p_service and kind = 'service' and active;
  if tot is null then raise exception 'choose a valid service' using errcode = 'P0001'; end if;
  if p_service in ('basic', 'general', 'full') and p_engine in ('mid', 'big') then
    select price into tier from public.services where id = p_service || '250' and kind = 'service' and active;
    if tier is not null then tot := tier; end if;
    if p_engine = 'big' then select price into fee from public.services where id = 'bigbike' and kind = 'fee' and active; tot := tot + coalesce(fee, 300); end if;
  end if;
  foreach a in array coalesce(p_addons, '{}') loop
    if not exists (select 1 from public.services where id = a and kind = 'addon' and active) then raise exception 'unknown add-on: %', left(a, 20) using errcode = 'P0001'; end if;
    tot := tot + (select price from public.services where id = a);
  end loop;
  return tot;
end; $$;
revoke all on function public.crm_booking_price(text, text[], text) from public;

-- The two-argument price stays (the coupon check uses it) and means "standard engine".
create or replace function public.crm_booking_price(p_service text, p_addons text[]) returns integer language sql stable security definer set search_path = public as $$
  select public.crm_booking_price(p_service, p_addons, null::text);
$$;

-- Desk: bookings and edits now price by engine class and keep it on the bike.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.crm_create_booking(jsonb)'::regprocedure); n := d;
  n := replace(n, 'total := public.crm_booking_price(svc, adds);', 'total := public.crm_booking_price(svc, adds, nullif(p ->> ''engine_class'', ''''));');
  n := replace(n, 'insert into public.bikes (customer_id, brand, model, reg_no) values (cid, brand, model, regno) returning id into bid;', 'insert into public.bikes (customer_id, brand, model, reg_no, engine_class, big_bike) values (cid, brand, model, regno, case when p ->> ''engine_class'' in (''std'', ''mid'', ''big'') then p ->> ''engine_class'' end, coalesce(p ->> ''engine_class'', '''') = ''big'') returning id into bid;');
  if n = d or position('engine_class, big_bike' in n) = 0 or position('nullif(p ->> ''engine_class''' in n) = 0 then raise exception 'crm_create_booking was not patched'; end if;
  execute n;
  d := pg_get_functiondef('public.crm_update_booking(uuid,jsonb,timestamptz)'::regprocedure); n := d;
  n := replace(n, 'total := public.crm_booking_price(svc, adds);', 'total := public.crm_booking_price(svc, adds, coalesce(nullif(p ->> ''engine_class'', ''''), (select b.engine_class from public.bikes b where b.id = l.bike_id)));');
  if n = d then raise exception 'crm_update_booking was not patched'; end if;
  execute n;
end $$;
