-- Booking cancellation and refund handling. Additive and safe to run twice: nothing is dropped except old CHECK constraints that are replaced by wider ones.
-- Policy (refund-policy page): customer cancels > 2 h before the slot = fee refunded in full; under 2 h or after the mechanic has left = not refunded;
-- SOS visits free until a mechanic is assigned; we cancel or cannot reach the customer = full refund. Slot start is estimated from the slot name (morning 09:00, afternoon 12:00, evening 16:00, asap 09:00 IST).
-- Who: Admin and Crew cancel; only Admin can change the refund decision and only Admin can record a refund (ledger insert is Admin-only by row security).
-- A customer asks from the tracking page ("Report a problem" > cancel); it lands in Issues as a request. Nothing is refunded or promised until staff cancel.
-- rollback (by hand, only if needed): update public.leads set status = 'lost' where status = 'cancelled'; then re-add the narrower constraints.

alter table public.leads add column if not exists cancelled_at timestamptz;
alter table public.leads add column if not exists cancel_reason text;
alter table public.leads add column if not exists cancel_kind text check (cancel_kind in ('customer','company','unreachable'));
alter table public.leads add column if not exists cancelled_by uuid;
alter table public.leads add column if not exists refund_due integer check (refund_due is null or refund_due >= 0);
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in ('new','contacted','quoted','payment_sent','paid','scheduled','completed','lost','junk','cancelled'));

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.booking_issues'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%safety%' loop
    execute format('alter table public.booking_issues drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.booking_issues drop constraint if exists booking_issues_category_check;
alter table public.booking_issues add constraint booking_issues_category_check check (category in ('late','mechanic','payment','safety','other','cancel'));

-- Customer request to cancel: same function as before, now accepting the category 'cancel' and refusing cancelled bookings.
create or replace function public.booking_issue_report(p_token text, p_category text, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads := public.booking_lead_by_token(p_token); b text := nullif(left(btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x1f\x7f<>]', ' ', 'g')), 500), ''); i public.booking_issues; n int;
begin
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if l.status in ('lost','junk','cancelled') then return jsonb_build_object('ok', false, 'error', 'This booking is closed. Message us on WhatsApp.'); end if;
  if p_category not in ('late','mechanic','payment','safety','other','cancel') then return jsonb_build_object('ok', false, 'field', 'category', 'error', 'Choose what the problem is about.'); end if;
  if b is null or char_length(b) < 3 then return jsonb_build_object('ok', false, 'field', 'body', 'error', 'Tell us briefly what went wrong.'); end if;
  perform 1 from public.leads where id = l.id for update;   -- two taps at once wait for each other
  select * into i from public.booking_issues where lead_id = l.id and category = p_category and body = b and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
  if found then select count(*) into n from public.booking_issues where lead_id = l.id and created_at <= i.created_at; return jsonb_build_object('ok', true, 'already', true, 'id', i.id, 'n', n); end if;
  if (select count(*) from public.booking_issues where lead_id = l.id and status = 'open') >= 5 then return jsonb_build_object('ok', false, 'error', 'We already have several open problems on this booking. Our team will contact you.'); end if;
  insert into public.booking_issues (lead_id, category, body) values (l.id, p_category, b) returning * into i;
  select count(*) into n from public.booking_issues where lead_id = l.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', case when p_category = 'cancel' then 'Customer asked to cancel this booking. Check the slot time, then cancel it from the booking (the refund rule suggests the outcome). It is in Issues until resolved.' else 'Customer reported a problem (' || p_category || '). It is in Issues until someone resolves it.' end);
  insert into public.audit_log (action, details) values ('customer_issue_reported', jsonb_build_object('lead', l.ref, 'category', p_category));
  return jsonb_build_object('ok', true, 'id', i.id, 'n', least(n, 999), 'lead_id', l.id);
end; $$;
revoke all on function public.booking_issue_report(text, text, text) from public, anon, authenticated;
grant execute on function public.booking_issue_report(text, text, text) to service_role;

-- What the policy says for this booking right now. A suggestion for staff: nothing is changed.
create or replace function public.cancel_outcome(p_lead uuid, p_kind text default 'customer') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads; slot_at timestamptz; hrs numeric; paid integer; ok boolean; why text; sos boolean;
begin
  perform public.flow_need();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  paid := coalesce(l.paid_amount, 0);
  slot_at := case when l.preferred_date is null then null else (l.preferred_date::timestamp + case l.preferred_slot when 'afternoon' then time '12:00' when 'evening' then time '16:00' else time '09:00' end) at time zone 'Asia/Kolkata' end;
  hrs := case when slot_at is null then null else round(extract(epoch from (slot_at - now())) / 3600.0, 1) end;
  sos := coalesce(l.service_id, '') ~* '(sos|roadside|rsa|breakdown)';
  if p_kind in ('company', 'unreachable') then ok := true; why := 'We cancelled or could not reach the customer: full refund, or another slot if the customer prefers.';
  elsif l.visit_stage is not null then ok := false; why := 'The mechanic has already left for the visit: the confirmation fee covers it and is not refunded.';
  elsif sos then ok := (l.mechanic_id is null); why := case when ok then 'Roadside visit and no mechanic assigned yet: free cancellation, fee refunded.' else 'Roadside visit and a mechanic is already assigned: not refunded.' end;
  elsif hrs is null or hrs > 2 then ok := true; why := 'More than 2 hours before the slot: free cancellation, confirmation fee refunded in full.';
  else ok := false; why := 'Less than 2 hours before the slot: the confirmation fee is not refunded.'; end if;
  return jsonb_build_object('refundable', ok, 'amount', case when ok then paid else 0 end, 'paid', paid, 'reason', why, 'hours_to_slot', hrs, 'slot_estimated', true);
end; $$;

-- Cancel a booking (Admin and Crew). Admin alone may overrule the suggested refund (p_refund true/false).
create or replace function public.crm_cancel_booking(p_lead uuid, p_kind text, p_reason text, p_refund boolean default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; o jsonb; why text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '[\x01-\x1f\x7f<>]', ' ', 'g')), 200), ''); due integer;
begin
  if p_kind not in ('customer', 'company', 'unreachable') then raise exception 'choose who cancelled' using errcode = 'P0001'; end if;
  if why is null or char_length(why) < 3 then raise exception 'write a short reason' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true, 'refund_due', coalesce(l.refund_due, 0)); end if;
  if l.status in ('completed', 'lost', 'junk') then raise exception 'this booking is already closed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.garage_assignments a where a.lead_id = p_lead and a.status in ('in_work', 'ready')) then raise exception 'the garage has already started this job: speak to the garage first' using errcode = 'P0001'; end if;
  o := public.cancel_outcome(p_lead, p_kind);
  due := (o ->> 'amount')::integer;
  if p_refund is not null then
    if not public.is_admin() then raise exception 'only an admin can change the refund decision' using errcode = '42501'; end if;
    due := case when p_refund then coalesce(l.paid_amount, 0) else 0 end;
  end if;
  update public.leads set status = 'cancelled', cancelled_at = now(), cancel_reason = why, cancel_kind = p_kind, cancelled_by = auth.uid(), refund_due = due, updated_at = now() where id = p_lead;
  update public.garage_assignments set status = 'cancelled', updated_at = now() where lead_id = p_lead and status in ('sent', 'received');
  update public.booking_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolve_note = 'Booking cancelled' where lead_id = p_lead and category = 'cancel' and status = 'open';
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Booking cancelled (' || p_kind || '): ' || why || '. ' || case when due > 0 then 'Refund due Rs ' || due || ': Admin records it.' else 'No refund due.' end);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'booking_cancelled', jsonb_build_object('lead', l.ref, 'kind', p_kind, 'refund_due', due, 'rule', o ->> 'reason'));
  return jsonb_build_object('ok', true, 'refund_due', due, 'rule', o ->> 'reason');
end; $$;

-- Cancelled bookings (last 120 days), refunds still to pay, and customers asking to cancel.
create or replace function public.crm_cancellations_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need();
begin
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('issue_id', i.id, 'lead_id', l.id, 'booking_id', coalesce(l.booking_id, l.ref), 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'date', l.preferred_date, 'slot', l.preferred_slot, 'paid', coalesce(l.paid_amount, 0), 'body', i.body, 'asked_at', i.created_at, 'outcome', null) order by i.created_at)
      from public.booking_issues i join public.leads l on l.id = i.lead_id where i.category = 'cancel' and i.status = 'open' and l.deleted_at is null and public.crm_can_see(l, r) and l.status <> 'cancelled'), '[]'::jsonb),
    'cancelled', coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'booking_id', coalesce(l.booking_id, l.ref), 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'kind', l.cancel_kind, 'reason', l.cancel_reason, 'cancelled_at', l.cancelled_at,
        'refund_due', coalesce(l.refund_due, 0), 'refund_outstanding', least(coalesce(l.refund_due, 0), coalesce(l.paid_amount, 0))) order by l.cancelled_at desc)
      from public.leads l where l.status = 'cancelled' and l.deleted_at is null and l.cancelled_at > now() - interval '120 days' and public.crm_can_see(l, r)), '[]'::jsonb));
end; $$;

revoke all on function public.cancel_outcome(uuid, text), public.crm_cancel_booking(uuid, text, text, boolean), public.crm_cancellations_list() from public, anon;
grant execute on function public.cancel_outcome(uuid, text), public.crm_cancel_booking(uuid, text, text, boolean), public.crm_cancellations_list() to authenticated;

-- One booking's cancellation details, for the booking card (Crew and Admin).
create or replace function public.crm_cancel_info(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('cancelled', l.status = 'cancelled', 'kind', l.cancel_kind, 'reason', l.cancel_reason, 'at', l.cancelled_at, 'refund_due', coalesce(l.refund_due, 0),
    'refund_outstanding', case when l.status = 'cancelled' then least(coalesce(l.refund_due, 0), coalesce(l.paid_amount, 0)) else 0 end);
end; $$;
revoke all on function public.crm_cancel_info(uuid) from public, anon;
grant execute on function public.crm_cancel_info(uuid) to authenticated;
