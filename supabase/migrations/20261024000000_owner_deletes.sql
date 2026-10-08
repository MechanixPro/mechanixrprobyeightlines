-- Staff can still read, add and edit customers and issues; only the owner can delete them.
drop policy if exists customers_admin on public.customers;
drop policy if exists customers_admin_select on public.customers;
create policy customers_admin_select on public.customers for select to authenticated using (public.is_admin());
drop policy if exists customers_admin_insert on public.customers;
create policy customers_admin_insert on public.customers for insert to authenticated with check (public.is_admin());
drop policy if exists customers_admin_update on public.customers;
create policy customers_admin_update on public.customers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists customers_owner_delete on public.customers;
create policy customers_owner_delete on public.customers for delete to authenticated using (public.is_owner());

drop policy if exists issues_admin_all on public.issues;
drop policy if exists issues_admin_select on public.issues;
create policy issues_admin_select on public.issues for select to authenticated using (public.is_admin());
drop policy if exists issues_admin_insert on public.issues;
create policy issues_admin_insert on public.issues for insert to authenticated with check (public.is_admin());
drop policy if exists issues_admin_update on public.issues;
create policy issues_admin_update on public.issues for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists issues_owner_delete on public.issues;
create policy issues_owner_delete on public.issues for delete to authenticated using (public.is_owner());
