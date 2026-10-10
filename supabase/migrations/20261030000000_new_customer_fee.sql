-- New customers pay only Rs 99 to lock a slot (so we serve genuine customers); returning customers pay the Rs 349 checkup and quote fee.
insert into public.services (id, kind, name, description, price, sort)
values ('newfee', 'fee', 'New customer slot fee', 'Locks the slot for a first-time customer; adjusted in the final bill', 99, 7)
on conflict (id) do update set name = excluded.name, price = excluded.price, description = excluded.description, active = true;
