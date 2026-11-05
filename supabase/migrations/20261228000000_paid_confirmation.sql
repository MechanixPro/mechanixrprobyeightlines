-- Paid confirmation booking: a small confirmation fee (Rs 49 to Rs 99 by engine size) confirms a doorstep slot; the booking is tracked, dispatched in Crew,
-- and the customer's one-time door code starts the job. Design: docs/superpowers/specs/2026-11-05-paid-confirmation-booking-design.md
-- Idempotent and safe to dry-run (every statement is create-if-not-exists, create-or-replace or on-conflict). Nothing here changes an old lead: all new columns are null for them.
-- Roll back (in this order, as the database owner):
--   drop trigger if exists leads_a_confirm_paid_tr on public.leads; drop trigger if exists leads_b_confirm_guard_tr on public.leads; drop trigger if exists leads_c_secrets_clear_tr on public.leads;
--   drop function if exists public.flow_role(), public.flow_need(), public.flow_can(text), public.crm_resend_guard(uuid), public.crm_quote_save(uuid, jsonb, jsonb), public.crm_quote_send(uuid), public.crm_quote_phone_approve(uuid, text), public.crm_quote_eta(uuid, jsonb), public.crm_quote_get(uuid), public.quote_decide(text, int, text, text), public.quote_guard(uuid), public.crm_quote_counts(date, date), public.crm_notifications(uuid), public.notification_claim(uuid, text, boolean), public.notification_finish(uuid, text, text, text);
--   drop table if exists public.job_quotes, public.booking_notifications; drop trigger if exists leads_d_quote_gate_tr on public.leads;
--   drop function if exists public.crm_dispatch_list(int), public.crm_paid_badges(uuid[]), public.crm_confirmation(uuid), public.crm_door_code(uuid), public.booking_open_secrets(uuid), public.booking_door_code_new(uuid, uuid);
--   drop table if exists public.booking_secrets; alter table public.services drop constraint if exists services_confirm_fee_range; delete from public.services where id like 'confirm\_%';
--   (the new leads columns can stay: they are empty for old leads. crm_handover_code from 20261224000000 can be restored by re-running that file's create function.)

-- ───────────────────────── Admin passes everywhere in this flow ─────────────────────────
-- Owners already act as supervisors in Crew (crm_role). These three make EVERY admin (owner or staff) pass the checks of this flow, while agents and technicians keep their own limits.
-- Used by the new functions below and by crm_move_guard, crm_tech_link, crm_payment_context, crm_handover_code (re-created here with the same rules plus admin).
create or replace function public.flow_role() returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_role(), case when public.is_admin() then 'supervisor' end);
$$;
create or replace function public.flow_need() returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_role();
begin if r is null then raise exception 'not allowed' using errcode = '42501'; end if; return r; end; $$;
create or replace function public.flow_can(p_action text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.crm_can(p_action);
$$;
revoke all on function public.flow_role(), public.flow_need(), public.flow_can(text) from public, anon;
grant execute on function public.flow_role(), public.flow_need(), public.flow_can(text) to authenticated;

-- ───────────────────────── Fee table (edit in the admin Prices tab) ─────────────────────────
insert into public.services (id, kind, name, description, price, sort) values
  ('confirm_std', 'fee', 'Confirmation fee: bike up to 149cc',     'Confirms the slot; adjusted in the final bill', 49, 8),
  ('confirm_mid', 'fee', 'Confirmation fee: bike 150 to 250cc',    'Confirms the slot; adjusted in the final bill', 69, 9),
  ('confirm_big', 'fee', 'Confirmation fee: bike 251cc and above', 'Confirms the slot; adjusted in the final bill', 99, 10),
  ('confirm_car', 'fee', 'Confirmation fee: car',                  'Confirms the slot; adjusted in the final bill', 99, 11)
on conflict (id) do nothing;   -- never overwrite a price the owner has edited
-- No confirmation fee can ever be below Rs 49 or above Rs 99, whoever edits the row.
alter table public.services drop constraint if exists services_confirm_fee_range;
alter table public.services add constraint services_confirm_fee_range check (id !~ '^confirm_' or price between 49 and 99);
insert into public.settings (key, value) values ('confirm_nudge_minutes', to_jsonb(30)) on conflict (key) do nothing;   -- nudge a lead whose payment link is unpaid after N minutes

-- ───────────────────────── Lead columns ─────────────────────────
alter table public.leads add column if not exists confirm_fee          integer check (confirm_fee between 49 and 99);   -- the fee charged for this lead; null = an old-style lead
alter table public.leads add column if not exists confirm_fee_review   boolean not null default false;                  -- engine size unknown or disagreeing: Crew checks the fee
alter table public.leads add column if not exists confirm_paid_at      timestamptz;
alter table public.leads add column if not exists client_key           text check (char_length(client_key) between 16 and 64);   -- from the browser: one lead per form, however many taps
alter table public.leads add column if not exists rzp_order_id         text;
alter table public.leads add column if not exists payment_link_sent_at timestamptz;
alter table public.leads add column if not exists visit_stage          text check (visit_stage in ('on_the_way','arrived','started','repair_doorstep','picked_up','ready','returned'));
alter table public.leads add column if not exists visit_stage_at       timestamptz;
create unique index if not exists leads_client_key_uidx on public.leads (client_key) where client_key is not null;

-- The handover table gets a third kind: 'start' is the door code for every job (bike and car).
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.handovers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.handovers drop constraint %I', c);
  end loop;
  alter table public.handovers add constraint handovers_kind_check check (kind in ('pickup','return','start'));
end $$;

-- ───────────────────────── Secrets: tracking link token and the door code ─────────────────────────
-- No grants: only security definer functions and the service role (Edge Functions) read this. The code is a 4-digit one-time code, cleared when the job is completed.
create table if not exists public.booking_secrets (
  lead_id     uuid primary key references public.leads(id) on delete cascade,
  track_token text not null unique check (track_token ~ '^[0-9a-f]{32}$'),
  door_code   text check (door_code ~ '^[0-9]{4}$'),
  created_at  timestamptz not null default now()
);
alter table public.booking_secrets enable row level security;
revoke all on public.booking_secrets from public, anon, authenticated;

-- Makes a new door code for a lead: the old open one is cancelled, a new handovers row (kind 'start') keeps only the salted hash, and the code is kept in booking_secrets for the email, the tracking page and Crew.
-- Internal (no grants). The code lasts until three days after the slot day.
create or replace function public.booking_door_code_new(p_lead uuid, p_by uuid) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; hid uuid := gen_random_uuid(); rnd bytea; code text; exp timestamptz;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  exp := greatest(now() + interval '24 hours', coalesce((l.preferred_date::timestamp at time zone 'Asia/Kolkata') + interval '3 days', now() + interval '7 days'));
  update public.handovers set code_expires_at = now() where lead_id = p_lead and kind = 'start' and verified_at is null and code_expires_at > now();
  rnd := extensions.gen_random_bytes(3);
  code := lpad(((get_byte(rnd, 0) * 65536 + get_byte(rnd, 1) * 256 + get_byte(rnd, 2)) % 10000)::text, 4, '0');
  insert into public.handovers (id, lead_id, kind, code_hash, code_expires_at, created_by, mechanic_id)
    values (hid, p_lead, 'start', encode(extensions.digest(hid::text || ':' || code, 'sha256'), 'hex'), exp, p_by, l.mechanic_id);
  update public.booking_secrets set door_code = code where lead_id = p_lead;
  return code;
end; $$;
revoke all on function public.booking_door_code_new(uuid, uuid) from public, anon, authenticated;

-- Service role only (the payment functions). Gives a paid booking its private tracking token and an open door code. Safe to call again: it returns what exists.
create or replace function public.booking_open_secrets(p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; s public.booking_secrets; open_row boolean;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into s from public.booking_secrets where lead_id = p_lead;
  if not found then
    insert into public.booking_secrets (lead_id, track_token) values (p_lead, encode(extensions.gen_random_bytes(16), 'hex')) returning * into s;
  end if;
  if exists (select 1 from public.handovers where lead_id = p_lead and kind = 'start' and verified_at is not null) then
    return jsonb_build_object('track_token', s.track_token, 'door_code', null, 'door_state', 'verified');
  end if;
  select exists (select 1 from public.handovers where lead_id = p_lead and kind = 'start' and verified_at is null and locked_at is null and attempts < 5 and code_expires_at > now()) into open_row;
  if not open_row or s.door_code is null then perform public.booking_door_code_new(p_lead, null); select * into s from public.booking_secrets where lead_id = p_lead; end if;
  return jsonb_build_object('track_token', s.track_token, 'door_code', s.door_code, 'door_state', 'open');
end; $$;
revoke all on function public.booking_open_secrets(uuid) from public, anon, authenticated;
grant execute on function public.booking_open_secrets(uuid) to service_role;

-- ───────────────────────── Triggers: paid means confirmed ─────────────────────────
-- (a) The confirmation fee counts as paid when the lead becomes paid or the money received reaches the fee (payment, or an admin recording the payment).
create or replace function public.leads_confirm_paid() returns trigger language plpgsql as $$
begin
  if new.confirm_fee is not null and new.confirm_paid_at is null
     and (new.status in ('paid','scheduled','completed') and coalesce(new.paid_amount, 0) >= 0 and (new.status = 'paid' or coalesce(new.paid_amount, 0) >= new.confirm_fee)
          or coalesce(new.paid_amount, 0) >= new.confirm_fee) then
    new.confirm_paid_at := now();
  end if;
  return new;
end $$;
drop trigger if exists leads_a_confirm_paid_tr on public.leads;
create trigger leads_a_confirm_paid_tr before insert or update on public.leads for each row execute function public.leads_confirm_paid();

-- (b) A lead with a confirmation fee cannot become scheduled or completed, or be given a booking ID by hand, until the fee is paid. Old leads (no fee) are untouched.
create or replace function public.leads_confirm_guard() returns trigger language plpgsql as $$
begin
  if new.confirm_fee is not null and new.confirm_paid_at is null and new.status <> 'junk' and new.status <> 'lost' then
    if new.status in ('scheduled','completed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      raise exception 'waiting for the confirmation fee: this booking is confirmed only after it is paid' using errcode = 'P0001';
    end if;
    if new.booking_id is not null and (tg_op = 'INSERT' or old.booking_id is null) then
      raise exception 'waiting for the confirmation fee: the booking ID is given after payment' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_b_confirm_guard_tr on public.leads;
create trigger leads_b_confirm_guard_tr before insert or update on public.leads for each row execute function public.leads_confirm_guard();

-- (c) History line when the fee is paid, and the door code is wiped when the job is completed.
create or replace function public.leads_confirm_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.confirm_fee is not null and new.confirm_paid_at is not null and (tg_op = 'INSERT' or old.confirm_paid_at is null) then
    insert into public.crm_activities (lead_id, actor, kind, body) values (new.id, auth.uid(), 'note', 'Confirmation fee of Rs ' || new.confirm_fee || ' paid. Booking confirmed.');
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'confirmation_paid', jsonb_build_object('lead', new.ref, 'fee', new.confirm_fee));
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then update public.booking_secrets set door_code = null where lead_id = new.id; end if;
  return null;
end $$;
drop trigger if exists leads_c_secrets_clear_tr on public.leads;
create trigger leads_c_secrets_clear_tr after insert or update on public.leads for each row execute function public.leads_confirm_after();

-- ───────────────────────── Crew: door code from the desk (extends the handover code RPC) ─────────────────────────
-- Same function as 20261224000000, plus kind 'start': a new door code for ANY job (not only pickups), shown once to the desk and kept for the customer's tracking page.
create or replace function public.crm_handover_code(p_lead uuid, p_kind text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; hid uuid := gen_random_uuid(); rnd bytea; code text; exp timestamptz := now() + interval '24 hours';
begin
  perform public.flow_need();
  if p_kind not in ('pickup','return','start') then raise exception 'choose pickup, return or start' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians') or (public.flow_can('edit_leads') and coalesce(l.crm_owner = auth.uid(), false))) then
    raise exception 'you do not have permission to do this' using errcode = '42501';
  end if;
  if l.status = 'lost' then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.handovers where lead_id = p_lead and kind = p_kind and verified_at is not null) then raise exception 'this handover is already verified' using errcode = 'P0001'; end if;
  if p_kind = 'start' then
    if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'waiting for the confirmation fee' using errcode = 'P0001'; end if;
    perform public.booking_open_secrets(p_lead);                       -- makes sure the secrets row exists
    code := public.booking_door_code_new(p_lead, auth.uid());
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'handover_code_created', jsonb_build_object('lead', l.ref, 'kind', p_kind));
    return jsonb_build_object('code', code, 'kind', p_kind);
  end if;
  if not (l.job_place = 'garage' or l.place = 'pickup') then raise exception 'this is not a pickup job' using errcode = 'P0001'; end if;
  if l.mechanic_id is null then raise exception 'assign a technician first' using errcode = 'P0001'; end if;
  if p_kind = 'return' and not exists (select 1 from public.handovers where lead_id = p_lead and kind = 'pickup' and verified_at is not null) then raise exception 'verify the pickup first' using errcode = 'P0001'; end if;
  update public.handovers set code_expires_at = now() where lead_id = p_lead and kind = p_kind and verified_at is null and code_expires_at > now();
  rnd := extensions.gen_random_bytes(3);
  code := lpad(((get_byte(rnd, 0) * 65536 + get_byte(rnd, 1) * 256 + get_byte(rnd, 2)) % 10000)::text, 4, '0');
  insert into public.handovers (id, lead_id, kind, code_hash, code_expires_at, created_by, mechanic_id)
    values (hid, p_lead, p_kind, encode(extensions.digest(hid::text || ':' || code, 'sha256'), 'hex'), exp, auth.uid(), l.mechanic_id);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'handover_code_created', jsonb_build_object('lead', l.ref, 'kind', p_kind));
  return jsonb_build_object('code', code, 'kind', p_kind, 'expires_at', exp);
end; $$;
revoke all on function public.crm_handover_code(uuid, text) from public;
grant execute on function public.crm_handover_code(uuid, text) to authenticated;

-- ───────────────────────── Crew reads ─────────────────────────
-- The "Paid" badge for a page of leads. Returns {lead id: {fee, paid, review, stage}} for only the leads this person may see; nothing for old leads.
create or replace function public.crm_paid_badges(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need();
begin
  return coalesce((select jsonb_object_agg(l.id::text, jsonb_build_object('fee', l.confirm_fee, 'paid', l.confirm_paid_at is not null, 'review', l.confirm_fee_review, 'stage', l.visit_stage,
    'quote', (select q.status from public.job_quotes q where q.lead_id = l.id and q.status <> 'draft' and q.status <> 'superseded' order by q.version desc limit 1)))
    from public.leads l where l.id = any (coalesce(p_ids, '{}')) and l.confirm_fee is not null and l.deleted_at is null and public.crm_can_see(l, r)), '{}'::jsonb);
end; $$;
revoke all on function public.crm_paid_badges(uuid[]) from public, anon;
grant execute on function public.crm_paid_badges(uuid[]) to authenticated;

-- One lead's confirmation state for the lead sheet: fee, paid, review flag, when the link was sent, the nudge delay, the visit stage and the door code state (never the code).
create or replace function public.crm_confirmation(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; h public.handovers;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into h from public.handovers where lead_id = p_lead and kind = 'start' order by (verified_at is not null) desc, created_at desc limit 1;
  return jsonb_build_object('fee', l.confirm_fee, 'paid', l.confirm_paid_at is not null, 'paid_at', l.confirm_paid_at, 'review', l.confirm_fee_review, 'link_sent_at', l.payment_link_sent_at,
    'nudge_minutes', coalesce((select (value #>> '{}')::int from public.settings where key = 'confirm_nudge_minutes'), 30), 'vehicle', l.vehicle, 'stage', l.visit_stage, 'stage_at', l.visit_stage_at,
    'quote', (select jsonb_build_object('status', q.status, 'version', q.version, 'eta_text', q.eta_text, 'total', q.total) from public.job_quotes q where q.lead_id = l.id and q.status not in ('draft','superseded') order by q.version desc limit 1),
    'door', case when h.id is null then 'none' when h.verified_at is not null then 'verified' when h.locked_at is not null or h.attempts >= 5 then 'locked' when h.code_expires_at <= now() then 'expired' else 'open' end);
end; $$;
revoke all on function public.crm_confirmation(uuid) from public, anon;
grant execute on function public.crm_confirmation(uuid) to authenticated;

-- The open door code, for the desk to read out or send again. Same people who may send the technician link; never after the door is verified.
create or replace function public.crm_door_code(p_lead uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare l public.leads; c text;
begin
  perform public.flow_need();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians') or (public.flow_can('edit_leads') and coalesce(l.crm_owner = auth.uid(), false))) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  select door_code into c from public.booking_secrets where lead_id = p_lead;
  return c;
end; $$;
revoke all on function public.crm_door_code(uuid) from public, anon;
grant execute on function public.crm_door_code(uuid) to authenticated;

-- Dispatch list: paid bookings that are not completed, unassigned first, then by day and slot time. Area and PIN, never the phone or the street address.
create or replace function public.crm_dispatch_list(p_days int default 3) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.flow_need();
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians')) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'assigned') , row ->> 'preferred_date', (row ->> 'slot_rank')::int, row ->> 'created_at') from (
    select jsonb_build_object('id', l.id, 'booking_id', l.booking_id, 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'pincode', l.pincode, 'vehicle', l.vehicle,
      'bike', nullif(trim(coalesce(b.brand,'') || ' ' || coalesce(b.model,'')), ''), 'service_name', s.name, 'preferred_date', l.preferred_date, 'preferred_slot', l.preferred_slot,
      'slot_rank', case l.preferred_slot when 'asap' then 0 when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 4 end,
      'assigned', (l.mechanic_id is not null)::text, 'mechanic_id', l.mechanic_id, 'mechanic_name', m.name, 'visit_stage', l.visit_stage, 'confirm_fee', l.confirm_fee, 'review', l.confirm_fee_review, 'created_at', l.created_at) as row
    from public.leads l left join public.bikes b on b.id = l.bike_id left join public.services s on s.id = l.service_id left join public.mechanics m on m.id = l.mechanic_id
    where l.deleted_at is null and l.status in ('paid','scheduled') and l.preferred_date between today - 1 and today + greatest(1, least(coalesce(p_days, 3), 30))) q), '[]'::jsonb);
end; $$;
revoke all on function public.crm_dispatch_list(int) from public, anon;
grant execute on function public.crm_dispatch_list(int) to authenticated;

-- ───────────────────────── Notifications: one row per (booking, kind), claimed atomically so a retry or a duplicate webhook never sends twice ─────────────────────────
-- kinds: confirm_email, receipt_email, confirm_whatsapp (customer); team_paid, team_link_unpaid, team_unassigned (staff); quote_email:N, quote_whatsapp:N, team_quote_decision:N, eta_email:N, eta_whatsapp:N (N = quote version or ETA revision). Every attempt is also a line in the booking history (crm_activities).
insert into public.settings (key, value) values ('unassigned_alert_minutes', to_jsonb(15)) on conflict (key) do nothing;   -- tell the team when a paid booking has no mechanic after M minutes
create table if not exists public.booking_notifications (
  lead_id         uuid not null references public.leads(id) on delete cascade,
  kind            text not null check (kind ~ '^(confirm_email|receipt_email|confirm_whatsapp|team_paid|team_link_unpaid|team_unassigned|quote_email|quote_whatsapp|team_quote_decision|eta_email|eta_whatsapp)(:[0-9]{1,3})?$'),   -- quote kinds carry the quote version or ETA revision
  status          text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts        int not null default 0,
  error           text,
  last_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  primary key (lead_id, kind)
);
alter table public.booking_notifications enable row level security;
revoke all on public.booking_notifications from public, anon, authenticated;

-- Returns true to exactly one caller: the first time, a failed one (up to 6 tries), a pending one that has gone stale (5 minutes), or any state when p_force (Crew's Resend).
create or replace function public.notification_claim(p_lead uuid, p_kind text, p_force boolean default false) returns boolean language plpgsql security definer set search_path = public as $$
declare got boolean := false;
begin
  insert into public.booking_notifications (lead_id, kind, status, attempts, last_attempt_at) values (p_lead, p_kind, 'pending', 1, now())
    on conflict (lead_id, kind) do update set status = 'pending', attempts = case when p_force then 1 else public.booking_notifications.attempts + 1 end, last_attempt_at = now(), error = null
    where p_force
       or (public.booking_notifications.status = 'failed' and public.booking_notifications.attempts < 6)
       or (public.booking_notifications.status = 'pending' and public.booking_notifications.last_attempt_at < now() - interval '5 minutes')
    returning true into got;
  return coalesce(got, false);
end; $$;
revoke all on function public.notification_claim(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.notification_claim(uuid, text, boolean) to service_role;

-- Records the result and writes the booking-history line Crew sees.
create or replace function public.notification_finish(p_lead uuid, p_kind text, p_status text, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
declare label text := case split_part(p_kind, ':', 1) when 'confirm_email' then 'Confirmation email' when 'receipt_email' then 'Fee receipt email' when 'confirm_whatsapp' then 'WhatsApp confirmation'
  when 'team_paid' then 'Team alert: paid booking' when 'quote_email' then 'Quote email' when 'quote_whatsapp' then 'Quote WhatsApp' when 'team_quote_decision' then 'Team alert: quote decision' when 'eta_email' then 'Delivery update email' when 'eta_whatsapp' then 'Delivery update WhatsApp' when 'team_link_unpaid' then 'Team alert: link unpaid' when 'team_unassigned' then 'Team alert: no mechanic' else p_kind end;
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status'; end if;
  update public.booking_notifications set status = p_status, error = left(p_error, 200), sent_at = case when p_status = 'sent' then now() else sent_at end where lead_id = p_lead and kind = p_kind;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'note', label || ' ' || p_status || coalesce(': ' || left(p_error, 120), ''));
end; $$;
revoke all on function public.notification_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_finish(uuid, text, text, text) to service_role;

-- The lead's notification rows for the Crew sheet (status and error text, no addresses).
create or replace function public.crm_notifications(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', n.kind, 'status', n.status, 'attempts', n.attempts, 'error', n.error, 'at', n.last_attempt_at) order by n.last_attempt_at desc) from public.booking_notifications n where n.lead_id = p_lead), '[]'::jsonb);
end; $$;
revoke all on function public.crm_notifications(uuid) from public, anon;
grant execute on function public.crm_notifications(uuid) to authenticated;

-- ───────────────────────── Itemised quote with customer approval and a delivery estimate ─────────────────────────
-- Reuses what exists: the line items are the same shape as leads.invoice_override (name and amount before GST, GST added on top at 18%, as the final invoice does), the customer is told through the
-- existing 'Quote ready' WhatsApp template (mxp_quote_ready_v2, same 3 variables) and the same email layout, and the confirmation fee is credited the way invoice.ts credits paid_amount.
-- One row per version. A revised quote is a new version; sending it replaces the old one and needs a new approval.
create table if not exists public.job_quotes (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  version        int not null,
  status         text not null default 'draft' check (status in ('draft','sent','approved','declined','superseded')),
  lines          jsonb not null default '[]'::jsonb,                -- [{kind: parts|labour|other, name, amount}] amounts before GST
  subtotal       numeric(12,2) not null default 0,
  gst_rate       int not null default 18,
  gst            numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,                  -- subtotal + GST
  fee_credit     numeric(12,2) not null default 0,                  -- the confirmation fee already paid, adjusted here
  balance        numeric(12,2) not null default 0,
  eta_kind       text check (eta_kind in ('hours','date')),
  eta_hours      int check (eta_hours between 1 and 72),
  eta_date       date,
  eta_window     text check (char_length(eta_window) <= 40),
  eta_text       text,
  eta_rev        int not null default 0,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  decided_at     timestamptz,
  decided_by     uuid,
  decided_via    text check (decided_via in ('link','phone')),
  decline_reason text check (char_length(decline_reason) <= 200),
  unique (lead_id, version)
);
create unique index if not exists job_quotes_one_draft on public.job_quotes (lead_id) where status = 'draft';
alter table public.job_quotes enable row level security;
revoke all on public.job_quotes from public, anon, authenticated;

-- Shared: may this person build or send a quote for this lead (the same people who may assign the technician or send the job link).
create or replace function public.quote_guard(p_lead uuid) returns public.leads language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.flow_need();
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians') or (public.flow_can('edit_leads') and coalesce(l.crm_owner = auth.uid(), false))) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  if l.status in ('lost','junk') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  return l;
end; $$;
revoke all on function public.quote_guard(uuid) from public, anon, authenticated;

create or replace function public.quote_eta_text(p_kind text, p_hours int, p_date date, p_window text) returns text language sql immutable as $$
  select case when p_kind = 'hours' then 'about ' || p_hours || case when p_hours = 1 then ' hour' else ' hours' end || ' after the work starts'
              else to_char(p_date, 'FMDay, FMDD Mon') || coalesce(', ' || nullif(trim(p_window), ''), '') end;
$$;

-- Saves the draft quote (creates the next version if the last one was already sent). Lines are checked, GST and the balance are worked out here, and the delivery estimate is required.
create or replace function public.crm_quote_save(p_lead uuid, p_lines jsonb, p_eta jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; ln jsonb; sub numeric := 0; n int := 0; gstv numeric; tot numeric; credit numeric := 0; ver int; k text; nm text; am numeric; ek text; eh int; ed date; ew text; q public.job_quotes; clean jsonb := '[]'::jsonb;
begin
  l := public.quote_guard(p_lead);
  if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'waiting for the confirmation fee' using errcode = 'P0001'; end if;
  if coalesce(l.visit_stage, '') not in ('started','repair_doorstep','picked_up','ready') then raise exception 'the quote comes after the mechanic has arrived and the code is verified' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_lines) > 20 then raise exception 'at most 20 lines' using errcode = 'P0001'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    k := ln ->> 'kind'; nm := btrim(coalesce(ln ->> 'name', '')); 
    if k not in ('parts','labour','other') then raise exception 'each line is parts, labour or other' using errcode = 'P0001'; end if;
    if char_length(nm) < 2 or char_length(nm) > 80 then raise exception 'each line needs a name (2 to 80 characters)' using errcode = 'P0001'; end if;
    if public.crm_has_pii(nm) then raise exception 'remove ID, bank or card numbers from the line names' using errcode = 'P0001'; end if;
    begin am := (ln ->> 'amount')::numeric; exception when others then raise exception 'each line needs an amount' using errcode = 'P0001'; end;
    if am is null or am < 0 or am > 100000 then raise exception 'each amount must be from 0 to 1,00,000' using errcode = 'P0001'; end if;
    sub := sub + round(am, 2); n := n + 1; clean := clean || jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2));
  end loop;
  ek := p_eta ->> 'kind';
  if ek = 'hours' then
    begin eh := (p_eta ->> 'hours')::int; exception when others then eh := null; end;
    if eh is null or eh < 1 or eh > 72 then raise exception 'set the estimated delivery: hours from 1 to 72' using errcode = 'P0001'; end if;
  elsif ek = 'date' then
    begin ed := (p_eta ->> 'date')::date; exception when others then ed := null; end;
    if ed is null or ed < (now() at time zone 'Asia/Kolkata')::date or ed > (now() at time zone 'Asia/Kolkata')::date + 60 then raise exception 'set the estimated delivery: a day within the next 60 days' using errcode = 'P0001'; end if;
    ew := left(btrim(coalesce(p_eta ->> 'window', '')), 40);
  else raise exception 'set the estimated delivery before sending the quote' using errcode = 'P0001'; end if;
  gstv := round(sub * 0.18, 2); tot := sub + gstv;
  if l.confirm_fee is not null and l.confirm_paid_at is not null then credit := least(l.confirm_fee, tot); end if;
  select * into q from public.job_quotes where lead_id = p_lead and status = 'draft';
  if found then
    update public.job_quotes set lines = clean, subtotal = sub, gst = gstv, total = tot, fee_credit = credit, balance = tot - credit, eta_kind = ek, eta_hours = eh, eta_date = ed, eta_window = ew,
      eta_text = public.quote_eta_text(ek, eh, ed, ew), created_by = auth.uid() where id = q.id returning version into ver;
  else
    select coalesce(max(version), 0) + 1 into ver from public.job_quotes where lead_id = p_lead;
    insert into public.job_quotes (lead_id, version, lines, subtotal, gst, total, fee_credit, balance, eta_kind, eta_hours, eta_date, eta_window, eta_text, created_by)
      values (p_lead, ver, clean, sub, gstv, tot, credit, tot - credit, ek, eh, ed, ew, public.quote_eta_text(ek, eh, ed, ew), auth.uid());
  end if;
  return jsonb_build_object('version', ver, 'subtotal', sub, 'gst', gstv, 'total', tot, 'fee_credit', credit, 'balance', tot - credit, 'eta_text', public.quote_eta_text(ek, eh, ed, ew), 'lines', n);
end; $$;
revoke all on function public.crm_quote_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crm_quote_save(uuid, jsonb, jsonb) to authenticated;

-- Marks the draft as sent. An earlier sent or approved version becomes superseded, so a revised quote always needs a new approval. Returns what the sender needs (no phone or address).
create or replace function public.crm_quote_send(p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; q public.job_quotes;
begin
  l := public.quote_guard(p_lead);
  select * into q from public.job_quotes where lead_id = p_lead and status = 'draft';
  if not found then raise exception 'save the quote first' using errcode = 'P0001'; end if;
  if q.eta_text is null or q.eta_kind is null then raise exception 'set the estimated delivery before sending the quote' using errcode = 'P0001'; end if;
  update public.job_quotes set status = 'superseded' where lead_id = p_lead and status in ('sent','approved') and id <> q.id;
  update public.job_quotes set status = 'sent', sent_at = now() where id = q.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Quote v' || q.version || ' sent: total Rs ' || q.total || ' incl. GST, balance Rs ' || q.balance || ', delivery ' || q.eta_text);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'quote_sent', jsonb_build_object('lead', l.ref, 'version', q.version, 'total', q.total));
  return jsonb_build_object('version', q.version, 'total', q.total, 'balance', q.balance, 'eta_text', q.eta_text);
end; $$;
revoke all on function public.crm_quote_send(uuid) from public, anon;
grant execute on function public.crm_quote_send(uuid) to authenticated;

-- The customer said yes on the phone: Crew records it, with their name in the history line.
create or replace function public.crm_quote_phone_approve(p_lead uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; q public.job_quotes; who text;
begin
  l := public.quote_guard(p_lead);
  select * into q from public.job_quotes where lead_id = p_lead and status in ('sent','approved') order by version desc limit 1;
  if not found then raise exception 'there is no sent quote to approve' using errcode = 'P0001'; end if;
  if q.status = 'approved' then return jsonb_build_object('ok', true, 'already', true, 'version', q.version); end if;
  if public.crm_has_pii(p_note) then raise exception 'remove ID, bank or card numbers from the note' using errcode = 'P0001'; end if;
  who := coalesce(public.crm_name(auth.uid()), 'a team member');
  update public.job_quotes set status = 'approved', decided_at = now(), decided_by = auth.uid(), decided_via = 'phone' where id = q.id and status = 'sent';
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Quote v' || q.version || ' approved by phone, recorded by ' || who || coalesce('. Note: ' || left(btrim(p_note), 200), ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'quote_approved_phone', jsonb_build_object('lead', l.ref, 'version', q.version, 'recorded_by', auth.uid()));
  return jsonb_build_object('ok', true, 'version', q.version);
end; $$;
revoke all on function public.crm_quote_phone_approve(uuid, text) from public, anon;
grant execute on function public.crm_quote_phone_approve(uuid, text) to authenticated;

-- The delivery estimate slipped: Crew changes it on the live quote (no new approval: the price did not change). The revision number lets the customer be told once per change.
create or replace function public.crm_quote_eta(p_lead uuid, p_eta jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; q public.job_quotes; ek text := p_eta ->> 'kind'; eh int; ed date; ew text; txt text;
begin
  l := public.quote_guard(p_lead);
  select * into q from public.job_quotes where lead_id = p_lead and status in ('sent','approved') order by version desc limit 1;
  if not found then raise exception 'there is no sent quote' using errcode = 'P0001'; end if;
  if ek = 'hours' then begin eh := (p_eta ->> 'hours')::int; exception when others then eh := null; end; if eh is null or eh < 1 or eh > 72 then raise exception 'hours from 1 to 72' using errcode = 'P0001'; end if;
  elsif ek = 'date' then begin ed := (p_eta ->> 'date')::date; exception when others then ed := null; end; if ed is null or ed < (now() at time zone 'Asia/Kolkata')::date or ed > (now() at time zone 'Asia/Kolkata')::date + 60 then raise exception 'a day within the next 60 days' using errcode = 'P0001'; end if; ew := left(btrim(coalesce(p_eta ->> 'window', '')), 40);
  else raise exception 'set the estimated delivery' using errcode = 'P0001'; end if;
  txt := public.quote_eta_text(ek, eh, ed, ew);
  if txt is not distinct from q.eta_text then return jsonb_build_object('ok', true, 'changed', false, 'eta_rev', q.eta_rev, 'eta_text', txt, 'version', q.version); end if;
  update public.job_quotes set eta_kind = ek, eta_hours = eh, eta_date = ed, eta_window = ew, eta_text = txt, eta_rev = eta_rev + 1 where id = q.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Delivery estimate changed to ' || txt || ' (was ' || coalesce(q.eta_text, 'not set') || ')');
  return jsonb_build_object('ok', true, 'changed', true, 'eta_rev', q.eta_rev + 1, 'eta_text', txt, 'version', q.version);
end; $$;
revoke all on function public.crm_quote_eta(uuid, jsonb) from public, anon;
grant execute on function public.crm_quote_eta(uuid, jsonb) to authenticated;

-- The quote for the Crew sheet: every version (status, total, who and how it was decided) and the latest one with its lines.
create or replace function public.crm_quote_get(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', q.version, 'status', q.status, 'total', q.total, 'balance', q.balance, 'eta_text', q.eta_text, 'sent_at', q.sent_at, 'decided_at', q.decided_at,
        'decided_via', q.decided_via, 'decided_by', public.crm_name(q.decided_by), 'decline_reason', q.decline_reason) order by q.version desc) from public.job_quotes q where q.lead_id = p_lead), '[]'::jsonb),
    'latest', (select jsonb_build_object('version', q.version, 'status', q.status, 'lines', q.lines, 'subtotal', q.subtotal, 'gst', q.gst, 'total', q.total, 'fee_credit', q.fee_credit, 'balance', q.balance,
        'eta_kind', q.eta_kind, 'eta_hours', q.eta_hours, 'eta_date', q.eta_date, 'eta_window', q.eta_window, 'eta_text', q.eta_text) from public.job_quotes q where q.lead_id = p_lead order by q.version desc limit 1));
end; $$;
revoke all on function public.crm_quote_get(uuid) from public, anon;
grant execute on function public.crm_quote_get(uuid) to authenticated;

-- Service role (the quote-decision function): the customer taps Approve or Decline on the secret tracking link. Idempotent: the same decision again returns what happened the first time.
create or replace function public.quote_decide(p_token text, p_version int, p_decision text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.booking_secrets; l public.leads; q public.job_quotes; why text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
begin
  if p_decision not in ('approve','decline') then raise exception 'bad decision'; end if;
  select * into s from public.booking_secrets where track_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = s.lead_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into q from public.job_quotes where lead_id = l.id and version = p_version;
  if not found or q.status = 'draft' then return jsonb_build_object('ok', false, 'error', 'This quote is not available.'); end if;
  if q.status = 'superseded' then return jsonb_build_object('ok', false, 'error', 'This quote was replaced by a newer one. Reload the page.', 'superseded', true); end if;
  if (q.status = 'approved' and p_decision = 'approve') or (q.status = 'declined' and p_decision = 'decline') then return jsonb_build_object('ok', true, 'already', true, 'status', q.status, 'version', q.version); end if;
  if q.status in ('approved','declined') then return jsonb_build_object('ok', false, 'error', 'This quote was already ' || q.status || '. Call us to change it.', 'status', q.status); end if;
  update public.job_quotes set status = case p_decision when 'approve' then 'approved' else 'declined' end, decided_at = now(), decided_via = 'link', decline_reason = case when p_decision = 'decline' then why end where id = q.id and status = 'sent';
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Customer ' || case p_decision when 'approve' then 'approved' else 'declined' end || ' quote v' || q.version || ' on the tracking link' || coalesce('. Reason: ' || why, ''));
  insert into public.audit_log (action, details) values (case p_decision when 'approve' then 'quote_approved' else 'quote_declined' end, jsonb_build_object('lead', l.ref, 'version', q.version));
  return jsonb_build_object('ok', true, 'status', case p_decision when 'approve' then 'approved' else 'declined' end, 'version', q.version);
end; $$;
revoke all on function public.quote_decide(text, int, text, text) from public, anon, authenticated;
grant execute on function public.quote_decide(text, int, text, text) to service_role;

-- No work without approval, enforced in the database: the visit cannot move to "repair at the door" or "picked up" until the latest sent quote is approved.
create or replace function public.leads_quote_gate() returns trigger language plpgsql as $$
declare latest text;
begin
  if new.confirm_fee is not null and new.visit_stage in ('repair_doorstep','picked_up') and new.visit_stage is distinct from old.visit_stage then
    select q.status into latest from public.job_quotes q where q.lead_id = new.id and q.status in ('sent','approved') order by q.version desc limit 1;
    if latest is distinct from 'approved' then raise exception 'the customer has not approved the quote yet' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_d_quote_gate_tr on public.leads;
create trigger leads_d_quote_gate_tr before update of visit_stage on public.leads for each row execute function public.leads_quote_gate();

-- Funnel numbers for the Crew conversion page (counts only, no customer data). Quotes sent, approved, declined, work started, delivered in the date range (India time).
create or replace function public.crm_quote_counts(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := coalesce(p_from, (now() at time zone 'Asia/Kolkata')::date - 29)::timestamp at time zone 'Asia/Kolkata'; t timestamptz := (coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date) + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  perform public.flow_need();
  return jsonb_build_object(
    'quotes_sent', (select count(distinct lead_id) from public.job_quotes where sent_at >= f and sent_at < t),
    'approved', (select count(distinct lead_id) from public.job_quotes where status = 'approved' and sent_at >= f and sent_at < t),
    'declined', (select count(distinct lead_id) from public.job_quotes where status = 'declined' and sent_at >= f and sent_at < t),
    'work_started', (select count(*) from public.leads where visit_stage in ('repair_doorstep','picked_up','ready','returned') and visit_stage_at >= f and visit_stage_at < t and deleted_at is null),
    'delivered', (select count(*) from public.leads where visit_stage = 'returned' and visit_stage_at >= f and visit_stage_at < t and deleted_at is null));
end; $$;
revoke all on function public.crm_quote_counts(date, date) from public, anon;
grant execute on function public.crm_quote_counts(date, date) to authenticated;

-- ───────────────────────── Re-created with admin allowed (same rules otherwise) ─────────────────────────
create or replace function public.flow_require(p_action text) returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.flow_can(p_action) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if; end; $$;
revoke all on function public.flow_require(text) from public, anon;
grant execute on function public.flow_require(text) to authenticated;

create or replace function public.crm_move_guard(p_id uuid, p_mechanic uuid) returns public.leads language plpgsql security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  perform public.flow_require('edit_leads');
  select * into l from public.leads where id = p_id for update;
  if not found or l.deleted_at is not null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('view_all_leads') or l.crm_owner = auth.uid() or l.crm_owner is null) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.crm_owner is null and r <> 'supervisor' and not public.flow_can('manage_technicians') then raise exception 'take the lead first' using errcode = 'P0001';
  elsif l.crm_owner is distinct from auth.uid() and not public.flow_can('view_all_leads') then raise exception 'this lead belongs to a colleague' using errcode = '42501';
  end if;
  if l.status in ('lost','completed') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  if p_mechanic is null or not exists (select 1 from public.mechanics where id = p_mechanic and active and onboarding_status in ('live','pilot')) then
    raise exception 'choose a live technician' using errcode = 'P0001';
  end if;
  return l;
end; $$;
revoke all on function public.crm_move_guard(uuid, uuid) from public, anon, authenticated;

create or replace function public.crm_tech_link(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; tok text;
begin
  perform public.flow_need();
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians') or (public.flow_can('edit_leads') and coalesce(l.crm_owner = auth.uid(), false))) then
    raise exception 'you do not have permission to do this' using errcode = '42501';
  end if;
  if l.mechanic_id is null then raise exception 'assign a technician first' using errcode = 'P0001'; end if;
  if l.status = 'lost' then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  update public.tech_job_links set expires_at = now() where lead_id = p_lead and reported_at is null and expires_at > now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tech_job_links (lead_id, mechanic_id, token_hash, created_by, expires_at)
    values (p_lead, l.mechanic_id, encode(extensions.digest(tok, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days');
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'tech_link_created', jsonb_build_object('lead', l.ref));
  return 'https://mechanixpro.in/job/?t=' || tok;
end; $$;
revoke all on function public.crm_tech_link(uuid) from public;
grant execute on function public.crm_tech_link(uuid) to authenticated;

create or replace function public.crm_payment_context(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.flow_need(); perform public.flow_require('send_payment_link');
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (coalesce(l.crm_owner = auth.uid(), false) or public.flow_can('assign_leads')) then raise exception 'take the lead first' using errcode = '42501'; end if;
  if l.status in ('paid','scheduled','completed') then raise exception 'this booking is already confirmed' using errcode = 'P0001'; end if;
  if l.status in ('lost','junk') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  return jsonb_build_object('lead_id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'phone', l.phone, 'status', l.status, 'est_total', l.est_total, 'can_override', public.flow_can('assign_leads'),
    'existing_link', l.payment_link is not null, 'existing_amount', l.amount_due);
end; $$;
revoke all on function public.crm_payment_context(uuid) from public, anon;
grant execute on function public.crm_payment_context(uuid) to authenticated;

-- Who may press Resend on a notification (used by the booking-notify function): the same people who may assign the technician, and every admin.
create or replace function public.crm_resend_guard(p_lead uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.flow_need();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.flow_can('assign_leads') or public.flow_can('manage_technicians') or (public.flow_can('edit_leads') and coalesce(l.crm_owner = auth.uid(), false))) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  return true;
end; $$;
revoke all on function public.crm_resend_guard(uuid) from public, anon;
grant execute on function public.crm_resend_guard(uuid) to authenticated;
