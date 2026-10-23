-- Desk: the booking catalog hides the engine-size rows (they are not separate services) and sends their prices, so the quote on screen matches the saved price.
create or replace function public.crm_booking_catalog() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not (public.crm_can('create_bookings') or public.crm_can('edit_leads')) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'description', description) order by sort, id) from public.services where kind = 'service' and active and id !~ '250$'), '[]'::jsonb),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort, id) from public.services where kind = 'addon' and active), '[]'::jsonb),
    'tiers', coalesce((select jsonb_object_agg(replace(id, '250', ''), price) from public.services where kind = 'service' and active and id in ('basic250', 'general250', 'full250')), '{}'::jsonb),
    'big_fee', coalesce((select price from public.services where id = 'bigbike' and kind = 'fee' and active), 300));
end; $$;
