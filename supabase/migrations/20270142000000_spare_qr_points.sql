-- Spare-part QR points. Each spare part from Axlio carries a one-time QR code (a link). A garage scans it with the phone camera, signed in to its app, and earns points (1 point = Rs 1)
-- that are paid with its normal payout. Points are 0 until Admin sets them, so nothing is earned by accident.
--   spare_qr: one row per code (the code is random, one scan only). garage_points: the points ledger (scans add, payouts subtract).
--   admin_spare_qr_make(count, points, part): makes codes. admin_garage_points(garage): balance and recent scans. admin_garage_points_pay(garage, points, note): records a payout.
--   garage_qr_scan(garage, code): service role only, called by the garage-app function. At most 20 scans a day per garage.
-- Additive. Rollback: drop function public.admin_spare_qr_make(integer, integer, text), public.admin_garage_points(uuid), public.admin_garage_points_pay(uuid, integer, text), public.garage_qr_scan(uuid, text); drop table public.garage_points, public.spare_qr;
create table if not exists public.spare_qr (
  code text primary key check (code ~ '^[A-Z0-9]{10}$'),
  part text check (char_length(part) <= 80),
  points integer not null default 0 check (points between 0 and 5000),
  created_at timestamptz not null default now(),
  scanned_by uuid references public.garages(id), scanned_at timestamptz
);
create table if not exists public.garage_points (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references public.garages(id),
  kind text not null check (kind in ('scan', 'payout')),
  points integer not null,
  code text references public.spare_qr(code),
  note text check (char_length(note) <= 200),
  created_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists garage_points_code_uq on public.garage_points (code) where kind = 'scan';
create index if not exists garage_points_garage_idx on public.garage_points (garage_id, created_at desc);
alter table public.spare_qr enable row level security;
alter table public.garage_points enable row level security;

create or replace function public.admin_spare_qr_make(p_count integer, p_points integer, p_part text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare codes text[] := '{}'; c text; n integer := 0;
begin
  perform public.kyc_need_admin();
  if p_count is null or p_count < 1 or p_count > 500 then raise exception 'make 1 to 500 codes at a time' using errcode = 'P0001'; end if;
  if p_points is null or p_points < 0 or p_points > 5000 then raise exception 'points must be 0 to 5000' using errcode = 'P0001'; end if;
  while n < p_count loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    if c ~ '^[A-Z0-9]{10}$' and not exists (select 1 from public.spare_qr where code = c) then
      insert into public.spare_qr (code, part, points) values (c, nullif(left(btrim(coalesce(p_part, '')), 80), ''), p_points); codes := codes || c; n := n + 1;
    end if;
  end loop;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'spare_qr_made', jsonb_build_object('count', p_count, 'points', p_points, 'part', p_part));
  return jsonb_build_object('codes', to_jsonb(codes));
end $$;

create or replace function public.admin_garage_points(p_garage uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return jsonb_build_object('balance', coalesce((select sum(points) from public.garage_points where garage_id = p_garage), 0),
    'earned', coalesce((select sum(points) from public.garage_points where garage_id = p_garage and kind = 'scan'), 0),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'points', points, 'note', note, 'at', created_at) order by created_at desc) from (select * from public.garage_points where garage_id = p_garage order by created_at desc limit 30) q), '[]'::jsonb));
end $$;

create or replace function public.admin_garage_points_pay(p_garage uuid, p_points integer, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare bal integer;
begin
  perform public.kyc_need_admin();
  select coalesce(sum(points), 0) into bal from public.garage_points where garage_id = p_garage;
  if p_points is null or p_points < 1 or p_points > bal then raise exception 'enter points from 1 to the balance (%)', bal using errcode = 'P0001'; end if;
  insert into public.garage_points (garage_id, kind, points, note, created_by) values (p_garage, 'payout', -p_points, left(btrim(coalesce(p_note, '')), 200), auth.uid());
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'garage_points_paid', jsonb_build_object('garage', p_garage, 'points', p_points));
  return jsonb_build_object('balance', bal - p_points);
end $$;

create or replace function public.garage_qr_scan(p_garage uuid, p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.spare_qr; today_n integer; bal integer;
begin
  select count(*) into today_n from public.garage_points where garage_id = p_garage and kind = 'scan' and created_at > now() - interval '1 day';
  if today_n >= 20 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  select * into q from public.spare_qr where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  if q.scanned_at is not null then return jsonb_build_object('ok', false, 'error', 'used'); end if;
  update public.spare_qr set scanned_by = p_garage, scanned_at = now() where code = q.code;
  insert into public.garage_points (garage_id, kind, points, code, note) values (p_garage, 'scan', q.points, q.code, q.part);
  select coalesce(sum(points), 0) into bal from public.garage_points where garage_id = p_garage;
  return jsonb_build_object('ok', true, 'points', q.points, 'part', q.part, 'balance', bal);
end $$;
create or replace function public.garage_points_balance(p_garage uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('balance', coalesce(sum(points), 0), 'scans', count(*) filter (where kind = 'scan')) from public.garage_points where garage_id = p_garage;
$$;

revoke all on function public.admin_spare_qr_make(integer, integer, text), public.admin_garage_points(uuid), public.admin_garage_points_pay(uuid, integer, text) from public, anon;
grant execute on function public.admin_spare_qr_make(integer, integer, text), public.admin_garage_points(uuid), public.admin_garage_points_pay(uuid, integer, text) to authenticated;
revoke all on function public.garage_qr_scan(uuid, text), public.garage_points_balance(uuid) from public, anon, authenticated;
grant execute on function public.garage_qr_scan(uuid, text), public.garage_points_balance(uuid) to service_role;
