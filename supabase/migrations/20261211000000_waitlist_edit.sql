-- Admins can correct a waitlist signup (name, phone, email, city, note). Deleting stays owner-only.
drop policy if exists waitlist_admin_update on public.waitlist;
create policy waitlist_admin_update on public.waitlist for update to authenticated using (public.is_admin()) with check (public.is_admin());
