-- A last-minute discount the owner gives on the invoice at the customer's request, with a short reason. It is on top of any coupon.
alter table public.leads
  add column if not exists extra_discount integer not null default 0 check (extra_discount >= 0 and extra_discount <= 100000),
  add column if not exists extra_discount_note text check (extra_discount_note is null or char_length(extra_discount_note) <= 80);
