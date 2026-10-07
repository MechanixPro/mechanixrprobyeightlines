-- Extra booking details captured by the website builder, plus referral and campaign tracking.
alter table public.leads
  add column if not exists km_band text check (km_band in ('new','lt3','mid','gt6','unsure')),
  add column if not exists issues jsonb not null default '[]'::jsonb,
  add column if not exists note text check (char_length(note) <= 300),
  add column if not exists place text not null default 'home' check (place in ('home','road','unsure')),
  add column if not exists contact_pref text not null default 'whatsapp' check (contact_pref in ('whatsapp','call')),
  add column if not exists bike_type text check (bike_type in ('m','s','e')),
  add column if not exists ref_code text check (char_length(ref_code) <= 20),
  add column if not exists campaign text check (char_length(campaign) <= 60);

create index if not exists leads_ref_code_idx on public.leads (ref_code) where ref_code is not null;
create index if not exists leads_campaign_idx on public.leads (campaign) where campaign is not null;
