-- Invoices carry the vehicle registration number and the customer's email (optional) as saved at the time.
alter table public.invoices add column if not exists vehicle_reg text, add column if not exists customer_email text;
