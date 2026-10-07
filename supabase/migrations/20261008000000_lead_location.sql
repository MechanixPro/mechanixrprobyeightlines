-- Where the work happens: free-text address plus the pin the customer shared from their phone.
alter table public.leads
  add column if not exists address text check (char_length(address) <= 200),
  add column if not exists lat numeric(8,5) check (lat between 6 and 38),
  add column if not exists lng numeric(8,5) check (lng between 68 and 98);
