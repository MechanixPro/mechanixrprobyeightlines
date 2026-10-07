-- The booking advance becomes the checkup and quote fee: Rs 349 confirms a booking and is adjusted in the final bill if the customer goes ahead.
update public.services set name = 'Checkup and quote fee', price = 349 where id = 'advance';
update public.services set price = 349, description = 'Checkup and quote visit; repair quoted before work starts' where id = 'repair';
update public.services set includes = '["Inspection visit at your location","Diagnosis of the problem","Itemised quote before any work starts","The fee is adjusted in your final bill if you go ahead with the service"]'::jsonb where id = 'repair';
update public.settings set value = '"349"'::jsonb where key = 'booking_advance';
