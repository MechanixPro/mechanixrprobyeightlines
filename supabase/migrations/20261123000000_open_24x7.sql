-- The business is open 24/7. The AI assistant and the desk read the hours from here.
update public.settings set value = jsonb_set(value, '{hours}', '"Open 24/7"') where key = 'business_info';
