-- Everything goes to a garage. This adds:
--   admin_mechanic_convert(mechanic, garage name, plan, rate): makes a garage from a mechanic and links the two. Nothing is rewritten: past jobs, ledger and payouts stay on the mechanic row, which is switched off for new jobs.
--   admin_garage_history(garage): the garage's own jobs plus the earlier jobs of the mechanic it was converted from (job list only, no amounts).
--   a guard so no signed-in person can give a job to an individual mechanic any more (jobs already with a mechanic keep working);
--   the Crew mechanic list now comes back empty.
-- Additive. Rollback: drop trigger leads_no_new_mechanic on public.leads; drop function public.leads_no_new_mechanic_fn(), public.admin_mechanic_convert(uuid, text, text, numeric), public.admin_garage_history(uuid);
--   alter table public.garages drop column converted_from_mechanic; alter table public.mechanics drop column converted_to_garage; and restore crm_mechanic_picker from 20261114000000.
alter table public.mechanics add column if not exists converted_to_garage uuid references public.garages(id) on delete set null;
alter table public.garages add column if not exists converted_from_mechanic uuid references public.mechanics(id) on delete set null;
create unique index if not exists garages_converted_from_uq on public.garages (converted_from_mechanic) where converted_from_mechanic is not null;

create or replace function public.admin_mechanic_convert(p_mechanic uuid, p_name text default null, p_plan text default 'bronze', p_rate numeric default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.mechanics; g public.garages; nm text; open_n integer;
begin
  perform public.kyc_need_admin();
  select * into m from public.mechanics where id = p_mechanic for update;
  if not found then raise exception 'mechanic not found' using errcode = 'P0001'; end if;
  if m.converted_to_garage is not null then raise exception 'this mechanic is already a garage' using errcode = 'P0001'; end if;
  if p_plan not in ('bronze', 'silver', 'gold') then raise exception 'choose Bronze, Silver or Gold' using errcode = 'P0001'; end if;
  if p_plan = 'bronze' and (p_rate is null or p_rate <= 0 or p_rate > 100) then raise exception 'Bronze needs the agreed rate (1 to 100)' using errcode = 'P0001'; end if;
  select count(*) into open_n from public.leads where mechanic_id = m.id and deleted_at is null and status not in ('completed', 'lost', 'junk');
  if open_n > 0 then raise exception 'this mechanic still has % open job(s). Finish or move them first', open_n using errcode = 'P0001'; end if;
  if exists (select 1 from public.garages where mobile = m.phone and deleted_at is null) then raise exception 'a garage with this mobile number already exists' using errcode = 'P0001'; end if;
  nm := left(btrim(coalesce(nullif(p_name, ''), m.name)), 80);
  if char_length(nm) < 2 then raise exception 'enter the garage name' using errcode = 'P0001'; end if;
  insert into public.garages (name, owner_name, mobile, address, city, plan, agreed_rate, converted_from_mechanic, notes)
  values (nm, left(m.name, 80), m.phone, m.area, coalesce(nullif(m.city, ''), 'Bengaluru'), p_plan, case when p_plan = 'bronze' then p_rate end, m.id, 'Converted from mechanic ' || m.name)
  returning * into g;
  update public.mechanics set active = false, converted_to_garage = g.id where id = m.id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'mechanic_converted', jsonb_build_object('mechanic', m.id, 'garage', g.id, 'code', g.code, 'plan', p_plan));
  return jsonb_build_object('garage_id', g.id, 'code', g.code, 'name', g.name);
end $$;

create or replace function public.admin_garage_history(p_garage uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.garages; m public.mechanics;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_garage; if not found then raise exception 'garage not found' using errcode = 'P0001'; end if;
  select * into m from public.mechanics where id = g.converted_from_mechanic;
  return jsonb_build_object(
    'garage', jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code, 'created_at', g.created_at),
    'mechanic', case when m.id is null then null else jsonb_build_object('id', m.id, 'name', m.name, 'since', m.created_at, 'converted_at', (select max(created_at) from public.audit_log where action = 'mechanic_converted' and details ->> 'mechanic' = m.id::text)) end,
    'mechanic_jobs', coalesce((select jsonb_agg(x order by x ->> 'date' desc) from (select jsonb_build_object('ref', coalesce(l.booking_id, l.ref), 'status', l.status, 'date', coalesce(l.preferred_date::text, l.created_at::date::text), 'area', l.area) x from public.leads l where l.mechanic_id = m.id and l.deleted_at is null order by l.created_at desc limit 100) q), '[]'::jsonb),
    'garage_jobs', coalesce((select jsonb_agg(x order by x ->> 'date' desc) from (select jsonb_build_object('ref', coalesce(l.booking_id, l.ref), 'status', ga.status, 'date', coalesce(l.preferred_date::text, ga.assigned_at::date::text), 'area', l.area) x from public.garage_assignments ga join public.leads l on l.id = ga.lead_id where ga.garage_id = g.id order by ga.assigned_at desc limit 100) q), '[]'::jsonb));
end $$;

-- No individual assignment: a signed-in person cannot hand a job to a mechanic. Jobs already with a mechanic, and the service role, are not affected.
create or replace function public.leads_no_new_mechanic_fn() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.mechanic_id is not null and new.mechanic_id is distinct from old.mechanic_id then
    raise exception 'Jobs go to a partner garage. Pick a garage instead of a mechanic.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists leads_no_new_mechanic on public.leads;
create trigger leads_no_new_mechanic before update of mechanic_id on public.leads for each row execute function public.leads_no_new_mechanic_fn();

create or replace function public.crm_mechanic_picker() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  return '[]'::jsonb;
end; $$;

revoke all on function public.admin_mechanic_convert(uuid, text, text, numeric), public.admin_garage_history(uuid) from public, anon;
grant execute on function public.admin_mechanic_convert(uuid, text, text, numeric), public.admin_garage_history(uuid) to authenticated;
