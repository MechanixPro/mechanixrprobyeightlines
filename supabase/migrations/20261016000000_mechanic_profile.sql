-- Mechanic profiles (city, specialties, experience, Mechanix Pro certification) and the time a booking was confirmed to the customer.
alter table public.mechanics
  add column if not exists city text not null default 'Bengaluru' check (char_length(city) <= 40),
  add column if not exists specialties text check (char_length(specialties) <= 120),
  add column if not exists experience_years integer not null default 0 check (experience_years between 0 and 60),
  add column if not exists certified boolean not null default true,
  add column if not exists notes text check (char_length(notes) <= 500);
alter table public.leads add column if not exists confirmed_at timestamptz;
