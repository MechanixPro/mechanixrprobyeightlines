-- An edited invoice: the admin can change the items and amounts, and say whether they are before or including GST.
-- Shape: { "basis": "excl" | "incl", "lines": [ { "name": "Clutch plate set", "amount": 1000 } ] }. Empty means "use the package prices".
alter table public.leads
  add column if not exists invoice_override jsonb check (invoice_override is null or (jsonb_typeof(invoice_override) = 'object' and pg_column_size(invoice_override) <= 8000));
