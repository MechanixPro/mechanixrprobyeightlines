-- 1. The client's signed-off partner agreements set the volume bands at Silver 30 to 80 orders a month and Gold 50 to 100 (the plan table had 50 to 80 and 60 to 100 from the handwritten note).
-- 2. admin_garage_get also returns what the printable agreement autofills from: legal name, trade licence, code, city, plan, deposit status and date. No Aadhaar, PAN or bank data is ever returned.
-- Additive: two row updates and one function replaced with the same signature. Rollback: set the bands back to 50/80 and 60/100; re-run admin_garage_get from 20270134000000_admin_garages_code_issue.sql.
update public.partner_plans set orders_min = 30, orders_max = 80 where plan = 'silver';
update public.partner_plans set orders_min = 50, orders_max = 100 where plan = 'gold';

create or replace function public.admin_garage_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_id and deleted_at is null;
  if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('garage', jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'legal_name', g.legal_name, 'trade_id', g.trade_id, 'owner_name', g.owner_name, 'mobile', g.mobile, 'address', g.address, 'landmark', g.landmark,
    'pincode', g.pincode, 'city', g.city, 'lat', g.lat, 'lng', g.lng, 'categories', g.categories, 'open_days', g.open_days, 'open_time', g.open_time, 'close_time', g.close_time, 'bays', g.bays, 'notes', g.notes,
    'plan', g.plan, 'deposit_status', g.deposit_status, 'deposit_received_at', g.deposit_received_at));
end $$;
revoke all on function public.admin_garage_get(uuid) from public, anon;
grant execute on function public.admin_garage_get(uuid) to authenticated;
