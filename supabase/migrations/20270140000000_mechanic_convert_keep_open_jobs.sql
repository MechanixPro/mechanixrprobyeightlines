-- Converting a mechanic no longer waits for their open jobs, and Bronze may be converted before its rate is known.
--   A mechanic with open jobs stays switched on until those jobs finish (the guard already stops any new job going to them); one with none is switched off at once.
--   Bronze with no rate leaves agreed_rate empty; the garage cannot sign until Admin saves the rate (Garages, Agreement).
-- Rollback: restore admin_mechanic_convert from 20270139000000_mechanic_to_garage.sql.
create or replace function public.admin_mechanic_convert(p_mechanic uuid, p_name text default null, p_plan text default 'bronze', p_rate numeric default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.mechanics; g public.garages; nm text; open_n integer;
begin
  perform public.kyc_need_admin();
  select * into m from public.mechanics where id = p_mechanic for update;
  if not found then raise exception 'mechanic not found' using errcode = 'P0001'; end if;
  if m.converted_to_garage is not null then raise exception 'this mechanic is already a garage' using errcode = 'P0001'; end if;
  if p_plan not in ('bronze', 'silver', 'gold') then raise exception 'choose Bronze, Silver or Gold' using errcode = 'P0001'; end if;
  if p_rate is not null and (p_rate <= 0 or p_rate > 100) then raise exception 'the rate must be between 1 and 100' using errcode = 'P0001'; end if;
  select count(*) into open_n from public.leads where mechanic_id = m.id and deleted_at is null and status not in ('completed', 'lost', 'junk');
  if exists (select 1 from public.garages where mobile = m.phone and deleted_at is null) then raise exception 'a garage with this mobile number already exists' using errcode = 'P0001'; end if;
  nm := left(btrim(coalesce(nullif(p_name, ''), m.name)), 80);
  if char_length(nm) < 2 then raise exception 'enter the garage name' using errcode = 'P0001'; end if;
  insert into public.garages (name, owner_name, mobile, address, city, plan, agreed_rate, converted_from_mechanic, notes)
  values (nm, left(m.name, 80), m.phone, m.area, coalesce(nullif(m.city, ''), 'Bengaluru'), p_plan, case when p_plan = 'bronze' then p_rate end, m.id, 'Converted from mechanic ' || m.name)
  returning * into g;
  update public.mechanics set active = (open_n > 0), converted_to_garage = g.id where id = m.id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_converted', jsonb_build_object('mechanic', m.id, 'garage', g.id, 'code', g.code, 'plan', p_plan, 'open_jobs', open_n));
  return jsonb_build_object('garage_id', g.id, 'code', g.code, 'name', g.name, 'open_jobs', open_n);
end $$;
