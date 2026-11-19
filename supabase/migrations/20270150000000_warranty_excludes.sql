-- Warranty card: what is NOT covered, shown next to what is covered. Additive. Rollback: alter table public.warranty_cards drop column excludes;
alter table public.warranty_cards add column if not exists excludes text;
