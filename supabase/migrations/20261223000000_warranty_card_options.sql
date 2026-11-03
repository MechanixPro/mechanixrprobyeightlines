-- Warranty cards: the admin sets the number of days and what the card covers when issuing it.
alter table public.warranty_cards add column if not exists covers text;
alter table public.warranty_cards drop constraint if exists warranty_cards_covers_len, drop constraint if exists warranty_cards_days_range;
alter table public.warranty_cards add constraint warranty_cards_covers_len check (covers is null or char_length(covers) <= 160),
  add constraint warranty_cards_days_range check (days between 1 and 1095);
