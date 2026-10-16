-- Deleting a booking that already has invoices or payments cannot erase them (they are accounting records), so the booking is moved to "Deleted bookings" instead:
-- hidden from every list, report and reminder, and the owner can restore it. Bookings with no invoice or payment are still erased for good.
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_reason text check (char_length(deleted_reason) <= 200);
create index if not exists leads_deleted_idx on public.leads (deleted_at) where deleted_at is not null;
