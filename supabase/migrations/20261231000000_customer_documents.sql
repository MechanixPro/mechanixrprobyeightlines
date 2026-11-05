-- Customer journey, part 3: "Your documents" and "Your other bookings" on the private tracking page.
-- Design: docs/superpowers/specs/2026-11-06-customer-journey-and-mechanic-link-design.md (section 6, with the privacy trade-off).
-- Idempotent and safe to dry-run. Read-only functions for the service role (the track-booking function); nothing is exposed to anon or signed-in users directly.
-- Roll back: drop function if exists public.booking_documents(text), public.booking_history(text); delete from public.settings where key = 'track_show_history';

-- One switch for "Your other bookings": set the value to false to hide the list for everyone, with no deploy (admin: Settings, or update public.settings).
insert into public.settings (key, value) values ('track_show_history', to_jsonb(true)) on conflict (key) do nothing;

-- The fee receipt (advance) and the final invoice for THIS booking. The receipt number exists once the receipt email was made; the invoice exists once it was emailed or saved from the admin (never a voided one).
create or replace function public.booking_documents(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); inv public.invoices; num text;
begin
  if l.id is null then return jsonb_build_object('ok', false); end if;
  select number into num from public.invoice_numbers where lead_id = l.id;
  select * into inv from public.invoices where lead_id = l.id and voided_at is null and coalesce(doc_key, 'A') = 'A' order by revision desc limit 1;
  return jsonb_build_object('ok', true,
    'receipt', case when l.confirm_fee is not null and l.confirm_paid_at is not null then jsonb_build_object('number', num, 'amount', l.confirm_fee, 'paid_at', l.confirm_paid_at) end,
    'invoice', case when inv.id is not null then jsonb_build_object('number', inv.number, 'issued_at', inv.issued_at, 'customer_name', inv.customer_name, 'customer_company', inv.customer_company, 'customer_gstin', inv.customer_gstin,
      'has_gst', inv.has_gst, 'gst_rate', inv.gst_rate, 'taxable', inv.taxable, 'cgst', inv.cgst, 'sgst', inv.sgst, 'discount', inv.discount, 'total', inv.total, 'paid', inv.paid, 'balance', inv.balance, 'lines', inv.lines) end);
end; $$;
revoke all on function public.booking_documents(text) from public, anon, authenticated;
grant execute on function public.booking_documents(text) to service_role;

-- Up to 10 earlier bookings of the same customer (same customer record, so same phone): date, vehicle, service, status, invoice number, and the booking's own private link ONLY if one already exists.
-- No address, no phone, no mechanic. Off when settings.track_show_history is false.
create or replace function public.booking_history(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); on_flag boolean := coalesce((select (value #>> '{}')::boolean from public.settings where key = 'track_show_history'), true);
begin
  if l.id is null then return jsonb_build_object('ok', false); end if;
  if not on_flag or l.customer_id is null then return jsonb_build_object('ok', true, 'enabled', on_flag, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'enabled', true, 'rows', coalesce((select jsonb_agg(x order by (x ->> 'sort') desc) from (
    select jsonb_build_object('sort', coalesce(o.preferred_date::text, o.created_at::date::text) || o.created_at::text, 'date', coalesce(o.preferred_date, o.created_at::date), 'vehicle', coalesce(o.vehicle, 'bike'),
      'brand', case when b.brand is not null and b.brand <> 'Other' then b.brand end, 'model', b.model, 'service', s.name, 'status', o.status, 'invoice_no', n.number, 'token', sec.track_token) as x
    from public.leads o left join public.bikes b on b.id = o.bike_id left join public.services s on s.id = o.service_id left join public.invoice_numbers n on n.lead_id = o.id left join public.booking_secrets sec on sec.lead_id = o.id
    where o.customer_id = l.customer_id and o.id <> l.id and o.deleted_at is null and o.status in ('paid','scheduled','completed') order by o.created_at desc limit 10) q), '[]'::jsonb));
end; $$;
revoke all on function public.booking_history(text) from public, anon, authenticated;
grant execute on function public.booking_history(text) to service_role;
