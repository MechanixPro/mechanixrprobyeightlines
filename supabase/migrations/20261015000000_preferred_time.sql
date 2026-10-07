-- The exact one-hour arrival window the customer picked on the clock, next to the broad slot the team already uses.
alter table public.leads add column if not exists preferred_time text check (char_length(preferred_time) <= 30);
