-- The admin Prices rows `repair`, `sos` and `newfee` were renamed on 16 Oct to hold an engine-size price sheet (150-250cc tiers).
-- The site, the desk payment link and checkout use those ids for the repair check, the roadside visit and the new-customer slot fee,
-- so the slot fee read Rs 1,799. Put the three core rows back (prices kept, new-customer slot fee back to the decided Rs 99)
-- and keep the engine-size tiers as their own rows, inactive until the booking flow is rebuilt around them.
insert into public.services (id, kind, name, description, price, sort, active, includes)
select 'basic250', 'service', name, description, price, 11, false, '[]'::jsonb from public.services where id = 'repair' and name <> 'Repair or problem check'
on conflict (id) do nothing;
insert into public.services (id, kind, name, description, price, sort, active, includes)
select 'general250', 'service', name, description, price, 12, false, '[]'::jsonb from public.services where id = 'sos' and name <> 'Roadside emergency'
on conflict (id) do nothing;
insert into public.services (id, kind, name, description, price, sort, active, includes)
select 'full250', 'service', name, 'Full service for bikes of 150 to 250cc', price, 13, false, '[]'::jsonb from public.services where id = 'newfee' and name <> 'New customer slot fee'
on conflict (id) do nothing;

update public.services set name = 'Repair or problem check', description = 'Inspection visit; repair quoted before work starts' where id = 'repair' and name <> 'Repair or problem check';
update public.services set name = 'Roadside emergency', description = 'Puncture, battery or breakdown; mechanic dispatched now' where id = 'sos' and name <> 'Roadside emergency';
update public.services set name = 'New customer slot fee', description = 'Locks the slot for a first-time customer; adjusted in the final bill', price = 99 where id = 'newfee' and (name <> 'New customer slot fee' or price <> 99);
