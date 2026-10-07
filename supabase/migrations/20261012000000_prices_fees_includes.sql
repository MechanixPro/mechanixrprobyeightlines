-- One place for prices: fees (booking advance, big-bike surcharge) become rows next to the services, so the website, the admin
-- and the server all read the same numbers. Each service also carries the list of what is included.
alter table public.services drop constraint if exists services_kind_check;
alter table public.services add constraint services_kind_check check (kind in ('service','addon','fee'));
alter table public.services add column if not exists includes jsonb not null default '[]'::jsonb;

insert into public.services (id, kind, name, description, price, sort) values
  ('advance','fee','Booking advance',null,199,20),
  ('bigbike','fee','Above-180cc surcharge',null,300,21)
on conflict (id) do nothing;
-- keep the old settings in step so nothing changes for existing bookings
update public.services set price = (select (value #>> '{}')::int from public.settings where key = 'booking_advance') where id = 'advance' and exists (select 1 from public.settings where key = 'booking_advance');
update public.services set price = (select (value #>> '{}')::int from public.settings where key = 'big_bike_surcharge') where id = 'bigbike' and exists (select 1 from public.settings where key = 'big_bike_surcharge');

update public.services set includes = '["Engine oil level check", "Chain clean and lube", "Brake adjustment", "Wash and wipe"]'::jsonb where id = 'basic';
update public.services set includes = '["Engine oil change (brand of your choice)", "Air filter clean and spark plug check", "Chain clean, lube and adjust", "Brake inspection and adjustment", "Battery, lights and horn check", "Tyre pressure and 20-point safety check", "Wash and wipe"]'::jsonb where id = 'general';
update public.services set includes = '["Everything in the General service", "Throttle body clean", "Brake pads check", "Polish"]'::jsonb where id = 'full';
update public.services set includes = '["Inspection visit at your location", "Diagnosis of the problem", "Itemised quote before any work starts"]'::jsonb where id = 'repair';
update public.services set includes = '["Mechanic dispatched to your location now", "Puncture repair or battery help", "Breakdown check and advice"]'::jsonb where id = 'sos';

update public.settings set value = jsonb_set(value, '{warranty}', '"30 days on our service work"') where key = 'business_info';
