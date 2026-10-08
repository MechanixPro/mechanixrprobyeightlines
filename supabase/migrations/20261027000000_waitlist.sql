-- People who want to hear when a coming-soon service starts: car service, e-challan, AI PDI reports, AI damage analysis, bike rental, OEM parts, insurance claims, franchise.
-- Private: staff can read it, only the owner can delete, and the website writes through a function (no direct public access).
create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  name       text check (char_length(name) <= 60),
  phone      text check (phone ~ '^[6-9][0-9]{9}$'),
  email      text check (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(email) <= 120),
  interests  text[] not null check (cardinality(interests) >= 1 and interests <@ array['car','echallan','pdi','damage','rental','oem','insurance','franchise']),
  city       text check (char_length(city) <= 40),
  note       text check (char_length(note) <= 200),
  source     text not null default 'website' check (char_length(source) <= 30),
  ip_hash    text,
  created_at timestamptz not null default now(),
  constraint waitlist_contact check (phone is not null or email is not null)
);
create index if not exists waitlist_created_idx on public.waitlist (created_at desc);
create index if not exists waitlist_ip_idx on public.waitlist (ip_hash, created_at desc);
alter table public.waitlist enable row level security;
drop policy if exists waitlist_admin_read on public.waitlist;
create policy waitlist_admin_read on public.waitlist for select to authenticated using (public.is_admin());
drop policy if exists waitlist_owner_delete on public.waitlist;
create policy waitlist_owner_delete on public.waitlist for delete to authenticated using (public.is_owner());
