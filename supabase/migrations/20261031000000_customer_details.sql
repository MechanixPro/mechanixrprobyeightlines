-- Customer details the admin can edit: address, area, company name and GSTIN (for a GST invoice in a company's name).
alter table public.customers
  add column if not exists address text,
  add column if not exists area text,
  add column if not exists company_name text,
  add column if not exists gstin text;
