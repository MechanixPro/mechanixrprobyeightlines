-- New service: puncture sorted at the customer's doorstep or anywhere. Price is before GST (GST is added on the final invoice).
insert into public.services (id, kind, name, description, price, sort, active) values
  ('puncture','service','Puncture sorted at your doorstep or anywhere','A mechanic comes to you and sorts the puncture, at your doorstep or anywhere',599,6,true)
on conflict (id) do update set name = excluded.name, description = excluded.description, price = excluded.price, active = true;
update public.services set includes = '["At your doorstep or anywhere in our service area", "• Puncture found and sorted on the spot", "• Tyre and tube or tubeless check", "• Air pressure set", "• Clear price before work, excluding GST", "• Customer approval before any extra work"]'::jsonb where id = 'puncture';
