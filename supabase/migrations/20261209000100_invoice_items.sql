-- The items most often put on invoices, taken from the invoices already made (typical price, before GST). The admin can add to it and it learns new items when an invoice is saved.
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  code text not null,
  price numeric(10,2) not null default 0 check (price >= 0 and price <= 1000000),
  uses integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists invoice_items_name_uq on public.invoice_items (lower(name));
alter table public.invoice_items enable row level security;
drop policy if exists invoice_items_admin on public.invoice_items;
create policy invoice_items_admin on public.invoice_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.invoice_items (name, code, price, uses) values
  ('Air filter', 'MXP-AIRFILTER', 320, 21),
  ('Clutch roller', 'MXP-CLUTCHROLLER', 320, 11),
  ('Clutch spring kit', 'MXP-CLUTCHSPRING', 320, 7),
  ('Oil filter', 'MXP-OILFILTER', 120, 7),
  ('Back brake shoe', 'MXP-BACKBRAKESHO', 290, 9),
  ('Small filter', 'MXP-SMALLFILTER', 40, 7),
  ('V-bush', 'MXP-VBUSH', 100, 7),
  ('Clutch belt', 'MXP-CLUTCHBELT', 580, 6),
  ('Front brake shoe', 'MXP-FRONTBRAKESH', 280, 5),
  ('Clutch roller body', 'MXP-CLUTCHROLLER', 650, 5),
  ('Clutch lining', 'MXP-CLUTCHLINING', 680, 5),
  ('Fork oil', 'MXP-FORKOIL', 300, 5),
  ('U-bush', 'MXP-UBUSH', 210, 5),
  ('Sprocket rubber', 'MXP-SPROCKETRUBB', 250, 5),
  ('Body polish', 'MXP-BODYPOLISH', 150, 4),
  ('Spark plug', 'MXP-SPARKPLUG', 120, 4),
  ('Engine oil', 'MXP-ENGINEOIL', 200, 4),
  ('Cone set', 'MXP-CONESET', 1200, 3),
  ('Front disc pad', 'MXP-FRONTDISCPAD', 250, 3),
  ('Clutch plate', 'MXP-CLUTCHPLATE', 1850, 3),
  ('Silencer shield', 'MXP-SILENCERSHIE', 320, 3),
  ('Shock absorber green bush', 'MXP-SHOCKABSORBE', 180, 3),
  ('Clutch cover packing', 'MXP-CLUTCHCOVERP', 120, 3),
  ('Gearbox oil', 'MXP-GEARBOXOIL', 90, 3),
  ('Inner shield', 'MXP-INNERSHIELD', 820, 3),
  ('Front shield', 'MXP-FRONTSHIELD', 1900, 3),
  ('Fork oil seal', 'MXP-FORKOILSEAL', 300, 3),
  ('Front mudguard', 'MXP-FRONTMUDGUAR', 880, 3),
  ('Fork spring', 'MXP-FORKSPRING', 320, 3),
  ('Link bush', 'MXP-LINKBUSH', 280, 3),
  ('Clutch shoe', 'MXP-CLUTCHSHOE', 890, 2),
  ('Carburettor', 'MXP-CARBURETTOR', 1500, 2),
  ('Clutch service', 'MXP-CLUTCHSERVIC', 399, 2),
  ('Brake rod', 'MXP-BRAKEROD', 200, 2),
  ('Brake oil', 'MXP-BRAKEOIL', 280, 2),
  ('Front green bush', 'MXP-FRONTGREENBU', 280, 2)
on conflict do nothing;
