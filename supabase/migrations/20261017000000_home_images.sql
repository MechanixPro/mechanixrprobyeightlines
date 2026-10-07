-- Home page picture shuffle: pictures the team uploads in the admin panel. Visitors can read active ones; only admins change them.
create table if not exists public.home_images (
  id         uuid primary key default gen_random_uuid(),
  url        text not null check (url ~ '^https://' and char_length(url) <= 500),
  caption    text check (char_length(caption) <= 80),
  position   integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.home_images enable row level security;
drop policy if exists home_images_public_read on public.home_images;
create policy home_images_public_read on public.home_images for select to anon, authenticated using (active);
drop policy if exists home_images_admin_all on public.home_images;
create policy home_images_admin_all on public.home_images for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('home', 'home', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists home_bucket_admin_write on storage.objects;
create policy home_bucket_admin_write on storage.objects for insert to authenticated with check (bucket_id = 'home' and public.is_admin());
drop policy if exists home_bucket_admin_update on storage.objects;
create policy home_bucket_admin_update on storage.objects for update to authenticated using (bucket_id = 'home' and public.is_admin());
drop policy if exists home_bucket_admin_delete on storage.objects;
create policy home_bucket_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'home' and public.is_admin());
