-- How a mechanic's percentage is worked out: on the amount collected (GST included) or on the amount before GST. The owner chooses in Settings.
insert into public.settings (key, value) values ('payout_basis', '"collected"'::jsonb) on conflict (key) do nothing;
