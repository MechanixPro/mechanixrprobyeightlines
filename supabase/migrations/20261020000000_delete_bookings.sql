-- The owner can delete bookings (for example test bookings). Messages go with the booking; email log and issue records stay, unlinked.
drop policy if exists leads_owner_delete on public.leads;
create policy leads_owner_delete on public.leads for delete to authenticated using (public.is_owner());
