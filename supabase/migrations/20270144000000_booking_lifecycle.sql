-- Booking lifecycle backend: ONE booking screen for the whole life of a booking, in step with the Garage app and the customer's tracking page.
-- Delivery stages (ready, delivered, closed), approve-on-behalf-of-customer, approval status and estimate history, a refunds table that follows the ledger and Cashfree,
-- one assignment (garage or outside partner), one merged timeline, and the display state used by the status dropdown. Docs: docs/BOOKING-LIFECYCLE.md
-- Additive and safe to run twice: create-if-not-exists, create-or-replace, on-conflict, drop-then-create for constraints and triggers. leads.status keeps its values
-- ('completed' still means won: revenue, invoices, ratings and warranty are untouched); the new delivery_stage sits beside it.
-- Apply (one command, as the project owner): npx supabase db query --linked -f supabase/migrations/20270144000000_booking_lifecycle.sql
-- Roll back (by hand, only if needed, as the database owner):
--   drop function if exists public.booking_state(public.leads), public.booking_state_label(text), public.crm_booking_state(uuid), public.crm_delivery_set(uuid, text, text), public.crm_quote_admin_approve(uuid, text, text, int),
--     public.crm_booking_estimates(uuid), public.crm_booking_refunds(uuid), public.crm_assignment_info(uuid), public.crm_assign_booking(uuid, uuid, text, text, timestamptz), public.crm_booking_timeline(uuid, int),
--     public.notification_label(text), public.quote_decide(text, int, text, text, text);
--   drop trigger if exists ledger_zz_booking_refunds on public.ledger_entries; drop trigger if exists job_quotes_decided_fill_tr on public.job_quotes; drop function if exists public.ledger_booking_refund_fn(), public.job_quotes_decided_fill_fn();
--   drop table if exists public.booking_refunds;
--   then re-run 20261228000000_paid_confirmation.sql / 20270105000000_funnel_quote.sql (quote_decide, crm_quote_phone_approve), 20270101000000_garage_app.sql (notification_finish, crm_garage_estimate_review) and 20270143000000_cancellations.sql (crm_cancellations_list)
--   to restore the earlier versions. The new columns can stay: they are empty for old bookings.

-- ───────────────────────── 1. Columns ─────────────────────────
alter table public.leads add column if not exists delivery_stage text check (delivery_stage in ('ready','delivered','closed'));
alter table public.leads add column if not exists ready_at     timestamptz;
alter table public.leads add column if not exists delivered_at timestamptz;
alter table public.leads add column if not exists closed_at    timestamptz;
alter table public.leads add column if not exists delivery_note text check (char_length(delivery_note) <= 300);
alter table public.leads add column if not exists delivery_by  uuid;

alter table public.job_quotes add column if not exists decided_method  text check (decided_method in ('phone','whatsapp','customer_link','customer_app'));
alter table public.job_quotes add column if not exists decided_by_name text check (char_length(decided_by_name) <= 80);
alter table public.job_quotes add column if not exists decided_remarks text check (char_length(decided_remarks) <= 300);
-- Older decisions get the method they imply (phone stays phone, a tap on the link stays a customer link).
update public.job_quotes set decided_method = case decided_via when 'phone' then 'phone' else 'customer_link' end
  where status in ('approved','declined') and decided_method is null and decided_via is not null;
-- Whatever path decides a quote (old function versions included) ends with a method filled in.
create or replace function public.job_quotes_decided_fill_fn() returns trigger language plpgsql as $$
begin
  if new.status in ('approved','declined') and new.decided_method is null and new.decided_via is not null then
    new.decided_method := case new.decided_via when 'phone' then 'phone' else 'customer_link' end;
  end if;
  if new.status in ('approved','declined') and new.decided_by_name is null and new.decided_method in ('customer_link','customer_app') then new.decided_by_name := 'Customer'; end if;
  return new;
end $$;
drop trigger if exists job_quotes_decided_fill_tr on public.job_quotes;
create trigger job_quotes_decided_fill_tr before insert or update on public.job_quotes for each row execute function public.job_quotes_decided_fill_fn();

create index if not exists garage_assignments_lead_idx on public.garage_assignments (lead_id, assigned_at desc);

-- ───────────────────────── 2. Notification kinds and labels ─────────────────────────
-- The regex is the one from 20270101000000_garage_app.sql plus the new kinds (same optional :N suffix).
alter table public.booking_notifications drop constraint if exists booking_notifications_kind_check;
alter table public.booking_notifications add constraint booking_notifications_kind_check
  check (kind ~ '^(confirm_email|receipt_email|confirm_whatsapp|team_paid|team_link_unpaid|team_unassigned|quote_email|quote_whatsapp|team_quote_decision|eta_email|eta_whatsapp|ontheway_email|team_issue|team_garage_estimate|team_garage_ready|delivery_ready_email|delivery_ready_whatsapp|delivery_done_email|delivery_done_whatsapp|approval_email|approval_whatsapp|garage_approved|garage_estimate_rejected|refund_email|refund_whatsapp)(:[0-9]{1,3})?$');

create or replace function public.notification_label(p_kind text) returns text language sql immutable as $$
  select case split_part(p_kind, ':', 1)
    when 'confirm_email' then 'Confirmation email' when 'receipt_email' then 'Fee receipt email' when 'confirm_whatsapp' then 'WhatsApp confirmation'
    when 'team_paid' then 'Team alert: paid booking' when 'quote_email' then 'Quote email' when 'quote_whatsapp' then 'Quote WhatsApp' when 'team_quote_decision' then 'Team alert: quote decision'
    when 'eta_email' then 'Delivery update email' when 'eta_whatsapp' then 'Delivery update WhatsApp'
    when 'team_link_unpaid' then 'Team alert: link unpaid' when 'team_unassigned' then 'Team alert: no mechanic' when 'ontheway_email' then 'On-the-way email' when 'team_issue' then 'Team alert: customer issue'
    when 'team_garage_estimate' then 'Team alert: garage estimate' when 'team_garage_ready' then 'Team alert: garage says ready'
    when 'delivery_ready_email' then 'Vehicle ready email' when 'delivery_ready_whatsapp' then 'Vehicle ready WhatsApp'
    when 'delivery_done_email' then 'Vehicle delivered email' when 'delivery_done_whatsapp' then 'Vehicle delivered WhatsApp'
    when 'approval_email' then 'Approval email' when 'approval_whatsapp' then 'Approval WhatsApp' when 'garage_approved' then 'Garage notice: quote approved'
    when 'garage_estimate_rejected' then 'Garage notice: estimate rejected' when 'refund_email' then 'Refund email' when 'refund_whatsapp' then 'Refund WhatsApp'
    else p_kind end;
$$;

create or replace function public.notification_finish(p_lead uuid, p_kind text, p_status text, p_error text default null) returns void language plpgsql security definer set search_path = public as $$
declare label text := public.notification_label(p_kind);
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'bad status'; end if;
  update public.booking_notifications set status = p_status, error = left(p_error, 200), sent_at = case when p_status = 'sent' then now() else sent_at end where lead_id = p_lead and kind = p_kind;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, null, 'note', label || ' ' || p_status || coalesce(': ' || left(p_error, 120), ''));
end; $$;
revoke all on function public.notification_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_finish(uuid, text, text, text) to service_role;

-- ───────────────────────── 3. The display state (status dropdown) ─────────────────────────
-- One key per row of the dropdown. 'completed' is shown as Done until a delivery stage is set; cancelled splits by who cancelled.
create or replace function public.booking_state(l public.leads) returns text language sql stable as $$
  select case l.status
    when 'cancelled' then case when l.cancel_kind = 'customer' then 'cancelled_customer' else 'cancelled_company' end
    when 'completed' then case l.delivery_stage when 'ready' then 'ready_for_delivery' when 'delivered' then 'delivered' when 'closed' then 'closed' else 'completed' end
    else l.status end;
$$;
create or replace function public.booking_state_label(p_state text) returns text language sql immutable as $$
  select case p_state
    when 'new' then 'New' when 'contacted' then 'Contacted' when 'quoted' then 'Quote sent' when 'payment_sent' then 'Advance link sent'
    when 'paid' then 'Booked' when 'scheduled' then 'Booked (visit scheduled)' when 'cancelled_customer' then 'Customer cancelled' when 'cancelled_company' then 'Cancelled by us'
    when 'lost' then 'Lost' when 'completed' then 'Done' when 'ready_for_delivery' then 'Vehicle ready for delivery' when 'delivered' then 'Vehicle delivered' when 'closed' then 'Booking closed'
    when 'junk' then 'Junk' else p_state end;
$$;
revoke all on function public.booking_state(public.leads), public.booking_state_label(text) from public, anon;
grant execute on function public.booking_state(public.leads), public.booking_state_label(text) to authenticated;

-- {state, label} for one booking (Admin and Crew, only bookings they may see). Used by the screen; crm_lead is not changed.
create or replace function public.crm_booking_state(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; s text;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  s := public.booking_state(l);
  return jsonb_build_object('state', s, 'label', public.booking_state_label(s), 'status', l.status, 'delivery_stage', l.delivery_stage, 'cancel_kind', l.cancel_kind);
end; $$;
revoke all on function public.crm_booking_state(uuid) from public, anon;
grant execute on function public.crm_booking_state(uuid) to authenticated;

-- ───────────────────────── 4. Delivery lifecycle ─────────────────────────
-- done -> ready -> delivered -> closed. 'done' is the existing Mark done (status completed; completed_at and the won time are stamped by the existing triggers; the invoice is still
-- created by the Admin screen exactly as before). Any desk user may use it for a booking they can see. A repeat of the same step returns ok with already:true.
create or replace function public.crm_delivery_set(p_lead uuid, p_stage text, p_remarks text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; who text; st text := lower(btrim(coalesce(p_stage, ''))); rm text := public.crm_clean_text(p_remarks, 300); now_at timestamptz := now(); title text; s text; ga int;
begin
  if st not in ('done', 'ready', 'delivered', 'closed') then raise exception 'choose done, ready, delivered or closed' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if rm is not null and public.crm_has_pii(rm) then raise exception 'remove ID, bank or card numbers from the remarks' using errcode = 'P0001'; end if;
  if st = 'delivered' and (rm is null or char_length(rm) < 3) then raise exception 'write a short remark about the handover (at least 3 characters)' using errcode = 'P0001'; end if;
  who := coalesce(public.crm_name(auth.uid()), 'a team member');
  if st = 'done' then
    if l.status = 'completed' then return jsonb_build_object('ok', true, 'already', true, 'state', public.booking_state(l), 'stage', 'done', 'at', l.completed_at, 'by_name', who); end if;
    if l.status not in ('paid', 'scheduled') then raise exception 'only a booked job (paid or scheduled) can be marked done' using errcode = 'P0001'; end if;
    update public.leads set status = 'completed' where id = p_lead;
    insert into public.crm_activities (lead_id, actor, kind, body, status_to) values (p_lead, auth.uid(), 'status', 'Marked done by ' || who || coalesce('. Remarks: ' || rm, ''), 'completed');
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'delivery_done', jsonb_build_object('lead', l.ref, 'by', auth.uid(), 'remarks', rm));
    select * into l from public.leads where id = p_lead;
    return jsonb_build_object('ok', true, 'state', public.booking_state(l), 'stage', 'done', 'at', coalesce(l.completed_at, now_at), 'by_name', who);
  end if;
  if l.status <> 'completed' then raise exception 'mark the service done first' using errcode = 'P0001'; end if;
  if st = 'ready' then
    if l.delivery_stage = 'ready' then return jsonb_build_object('ok', true, 'already', true, 'state', public.booking_state(l), 'stage', 'ready', 'at', l.ready_at, 'by_name', coalesce(public.crm_name(l.delivery_by), who)); end if;
    if l.delivery_stage is not null then raise exception 'this vehicle is already %', l.delivery_stage using errcode = 'P0001'; end if;
  elsif st = 'delivered' then
    if l.delivery_stage = 'delivered' then return jsonb_build_object('ok', true, 'already', true, 'state', public.booking_state(l), 'stage', 'delivered', 'at', l.delivered_at, 'by_name', coalesce(public.crm_name(l.delivery_by), who)); end if;
    if l.delivery_stage = 'closed' then raise exception 'this booking is already closed' using errcode = 'P0001'; end if;
  else
    if l.delivery_stage = 'closed' then return jsonb_build_object('ok', true, 'already', true, 'state', public.booking_state(l), 'stage', 'closed', 'at', l.closed_at, 'by_name', coalesce(public.crm_name(l.delivery_by), who)); end if;
    if l.delivery_stage is distinct from 'delivered' then raise exception 'deliver the vehicle first' using errcode = 'P0001'; end if;
  end if;
  update public.leads set delivery_stage = st,
    ready_at = case when st in ('ready', 'delivered') then coalesce(ready_at, now_at) else ready_at end,
    delivered_at = case when st = 'delivered' then now_at else delivered_at end,
    closed_at = case when st = 'closed' then now_at else closed_at end,
    delivery_note = coalesce(rm, delivery_note), delivery_by = auth.uid()
  where id = p_lead;
  if st in ('delivered', 'closed') then
    update public.garage_assignments set status = 'returned', returned_at = coalesce(returned_at, now_at), updated_at = now_at where lead_id = p_lead and status = 'ready';
  end if;
  title := case st when 'ready' then 'Vehicle ready for delivery' when 'delivered' then 'Vehicle delivered' else 'Booking closed' end;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', title || ' (by ' || who || ')' || coalesce('. Remarks: ' || rm, ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'delivery_' || st, jsonb_build_object('lead', l.ref, 'by', auth.uid(), 'remarks', rm));
  select * into l from public.leads where id = p_lead;
  s := public.booking_state(l);
  return jsonb_build_object('ok', true, 'state', s, 'stage', st, 'at', now_at, 'by_name', who);
end; $$;
revoke all on function public.crm_delivery_set(uuid, text, text) from public, anon;
grant execute on function public.crm_delivery_set(uuid, text, text) to authenticated;

-- ───────────────────────── 5. Approve on behalf of the customer ─────────────────────────
-- Same guards as crm_quote_phone_approve (quote_guard: a desk user who may send quotes; closed leads refused). Remarks are required. Approves the latest SENT quote (or the version given).
-- decided_via stays 'phone' (the old column only knows link or phone); decided_method says phone or whatsapp.
create or replace function public.crm_quote_admin_approve(p_lead uuid, p_method text, p_remarks text, p_version int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; q public.job_quotes; who text; rm text := public.crm_clean_text(p_remarks, 300); m text := lower(btrim(coalesce(p_method, '')));
begin
  l := public.quote_guard(p_lead);
  if m not in ('phone', 'whatsapp') then raise exception 'choose phone or whatsapp' using errcode = 'P0001'; end if;
  if rm is null or char_length(rm) < 5 then raise exception 'write the remarks: what the customer said (at least 5 characters)' using errcode = 'P0001'; end if;
  if public.crm_has_pii(rm) then raise exception 'remove ID, bank or card numbers from the remarks' using errcode = 'P0001'; end if;
  if p_version is not null then
    select * into q from public.job_quotes where lead_id = p_lead and version = p_version and status <> 'draft';
  else
    select * into q from public.job_quotes where lead_id = p_lead and status in ('sent', 'changes_requested', 'approved', 'declined') order by version desc limit 1;
  end if;
  if not found then raise exception 'there is no sent quote to approve' using errcode = 'P0001'; end if;
  if q.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true, 'version', q.version, 'approved_at', q.decided_at, 'by_name', coalesce(q.decided_by_name, public.crm_name(q.decided_by), 'Customer'), 'method', coalesce(q.decided_method, q.decided_via));
  end if;
  if q.status not in ('sent', 'changes_requested') then raise exception 'this quote was % and cannot be approved: send a new quote', q.status using errcode = 'P0001'; end if;
  who := coalesce(public.crm_name(auth.uid()), 'a team member');
  update public.job_quotes set status = 'approved', decided_at = now(), decided_by = auth.uid(), decided_via = 'phone', decided_method = m, decided_by_name = left(who, 80), decided_remarks = rm where id = q.id and status in ('sent', 'changes_requested');
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'note', 'Quote v' || q.version || ' approved by ' || case m when 'whatsapp' then 'WhatsApp' else 'phone' end || ', recorded by ' || who || ' on behalf of the customer. Remarks: ' || rm);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'quote_approved_' || m, jsonb_build_object('lead', l.ref, 'version', q.version, 'recorded_by', auth.uid(), 'method', m, 'remarks', rm));
  return jsonb_build_object('ok', true, 'version', q.version, 'approved_at', now(), 'by_name', who, 'method', m);
end; $$;
revoke all on function public.crm_quote_admin_approve(uuid, text, text, int) from public, anon;
grant execute on function public.crm_quote_admin_approve(uuid, text, text, int) to authenticated;

-- The old phone button keeps working: it is now the new function with method 'phone' and a default remark.
create or replace function public.crm_quote_phone_approve(p_lead uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := public.crm_clean_text(p_note, 200); rm text; res jsonb;
begin
  rm := case when n is null then 'Customer approved by phone' when char_length(n) >= 5 then n else 'Customer approved by phone (' || n || ')' end;
  res := public.crm_quote_admin_approve(p_lead, 'phone', rm, null);
  return case when (res ->> 'already') = 'true' then jsonb_build_object('ok', true, 'already', true, 'version', (res ->> 'version')::int) else jsonb_build_object('ok', true, 'version', (res ->> 'version')::int) end;
end; $$;
revoke all on function public.crm_quote_phone_approve(uuid, text) from public, anon;
grant execute on function public.crm_quote_phone_approve(uuid, text) to authenticated;

-- The customer's own answer. Same as before (20270105000000_funnel_quote.sql) plus p_source: 'link' (the private link in the email) or 'track' (the tracking page) is stored as decided_method.
-- The old 4-argument version is dropped so a 4-argument call resolves to this one (source defaults to 'link').
drop function if exists public.quote_decide(text, int, text, text);
create or replace function public.quote_decide(p_token text, p_version int, p_decision text, p_reason text default null, p_source text default 'link') returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.booking_secrets; l public.leads; q public.job_quotes; why text := nullif(left(btrim(coalesce(p_reason, '')), case when p_decision = 'changes' then 500 else 200 end), ''); newst text; meth text := case when p_source = 'track' then 'customer_app' else 'customer_link' end;
begin
  if p_decision not in ('approve','decline','changes') then raise exception 'bad decision'; end if;
  select * into s from public.booking_secrets where track_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = s.lead_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if l.status in ('cancelled', 'lost', 'junk') then return jsonb_build_object('ok', false, 'error', 'This booking is closed. Message us on WhatsApp.'); end if;
  select * into q from public.job_quotes where lead_id = l.id and version = p_version;
  if not found or q.status = 'draft' then return jsonb_build_object('ok', false, 'error', 'This quote is not available.'); end if;
  if q.status = 'superseded' then return jsonb_build_object('ok', false, 'error', 'This quote was replaced by a newer one. Reload the page.', 'superseded', true); end if;
  newst := case p_decision when 'approve' then 'approved' when 'decline' then 'declined' else 'changes_requested' end;
  if q.status = newst and p_decision <> 'changes' then return jsonb_build_object('ok', true, 'already', true, 'status', q.status, 'version', q.version); end if;
  if q.status in ('approved','declined') then return jsonb_build_object('ok', false, 'error', 'This quote was already ' || q.status || '. Call us to change it.', 'status', q.status); end if;
  if p_decision = 'changes' and why is null then return jsonb_build_object('ok', false, 'error', 'Tell us what you would like changed.'); end if;
  if p_decision = 'approve' and q.valid_until is not null and q.valid_until < now() then return jsonb_build_object('ok', false, 'error', 'This quote has expired. Please ask us for a fresh one.', 'expired', true); end if;
  if p_decision = 'changes' then
    update public.job_quotes set status = 'changes_requested', change_request = why, changes_at = now() where id = q.id and status in ('sent','changes_requested');
  else
    update public.job_quotes set status = newst, decided_at = now(), decided_via = 'link', decided_method = meth, decided_by_name = 'Customer', decline_reason = case when p_decision = 'decline' then why end where id = q.id and status in ('sent','changes_requested');
  end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note',
    'Customer ' || case p_decision when 'approve' then 'approved' when 'decline' then 'declined' else 'asked for changes to' end || ' quote v' || q.version || case when p_source = 'track' then ' on the tracking page' else ' on the tracking link' end || coalesce('. ' || case when p_decision = 'changes' then 'Message: ' else 'Reason: ' end || why, ''));
  insert into public.audit_log (action, details) values ('quote_' || newst, jsonb_build_object('lead', l.ref, 'version', q.version, 'method', case when p_decision = 'changes' then null else meth end));
  return jsonb_build_object('ok', true, 'status', newst, 'version', q.version, 'lead_id', l.id);
end; $$;
revoke all on function public.quote_decide(text, int, text, text, text) from public, anon, authenticated;
grant execute on function public.quote_decide(text, int, text, text, text) to service_role;

-- ───────────────────────── 6. Approval status and estimate history ─────────────────────────
create or replace function public.crm_booking_estimates(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; q public.job_quotes; st text := 'none'; meth text; appr jsonb;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into q from public.job_quotes where lead_id = p_lead and status in ('sent', 'approved', 'declined', 'changes_requested') order by version desc limit 1;
  if found then
    meth := coalesce(q.decided_method, case q.decided_via when 'phone' then 'phone' when 'link' then 'customer_link' end);
    st := case q.status when 'sent' then 'pending' when 'declined' then 'rejected' when 'changes_requested' then 'changes_requested'
      else case when meth in ('phone', 'whatsapp') then 'approved_admin' else 'approved_self' end end;
    appr := jsonb_build_object('status', st, 'version', q.version, 'decided_at', q.decided_at,
      'decided_by_name', case when q.status in ('approved', 'declined') then coalesce(q.decided_by_name, public.crm_name(q.decided_by), case when meth in ('customer_link', 'customer_app') then 'Customer' end) end,
      'method', meth, 'remarks', q.decided_remarks);
  else
    appr := jsonb_build_object('status', 'none', 'version', null, 'decided_at', null, 'decided_by_name', null, 'method', null, 'remarks', null);
  end if;
  return jsonb_build_object('approval', appr,
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('version', x.version, 'status', x.status, 'quote_no', x.quote_no, 'total', x.total, 'balance', x.balance, 'lines', x.lines, 'eta_text', x.eta_text, 'sent_at', x.sent_at,
        'decided_at', x.decided_at, 'decided_via', x.decided_via, 'decided_method', coalesce(x.decided_method, case x.decided_via when 'phone' then 'phone' when 'link' then 'customer_link' end),
        'decided_by_name', case when x.status in ('approved', 'declined') then coalesce(x.decided_by_name, public.crm_name(x.decided_by)) end, 'decided_remarks', x.decided_remarks, 'change_request', x.change_request) order by x.version desc)
      from public.job_quotes x where x.lead_id = p_lead), '[]'::jsonb),
    'garage_estimates', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'garage', g.name, 'status', e.status, 'lines', e.lines, 'notes', e.notes, 'hours', e.hours, 'return_day', e.return_day, 'submitted_at', e.submitted_at,
        'reviewed_at', e.reviewed_at, 'review_note', e.review_note, 'reviewed_by_name', public.crm_name(e.reviewed_by), 'converted_quote_id', e.converted_quote_id) order by coalesce(e.submitted_at, e.created_at) desc)
      from public.garage_estimates e join public.garage_assignments a on a.id = e.assignment_id join public.garages g on g.id = a.garage_id where a.lead_id = p_lead), '[]'::jsonb));
end; $$;
revoke all on function public.crm_booking_estimates(uuid) from public, anon;
grant execute on function public.crm_booking_estimates(uuid) to authenticated;

-- Garage estimate review. Same as 20270101000000_garage_app.sql, with one change: a rejection needs a remark (min 3 characters) that the garage reads in its app.
-- Approve makes a DRAFT customer quote (crm_quote_save). To EDIT it, the screen opens the quote builder on that draft and saves again with crm_quote_save (it updates the one draft in place), then sends it.
create or replace function public.crm_garage_estimate_review(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.garage_estimates; a public.garage_assignments; l public.leads; nt text := public.crm_clean_text(p_note, 300); eta jsonb; qid uuid; q jsonb;
begin
  perform public.garage_staff_need();
  select * into e from public.garage_estimates where id = p_id for update;
  if not found then raise exception 'estimate not found' using errcode = 'P0002'; end if;
  if e.status <> 'submitted' then raise exception 'this estimate was already reviewed' using errcode = 'P0001'; end if;
  select * into a from public.garage_assignments where id = e.assignment_id;
  select * into l from public.leads where id = a.lead_id;
  if nt is not null and public.crm_has_pii(nt) then raise exception 'remove ID, bank or card numbers from the note' using errcode = 'P0001'; end if;
  if not coalesce(p_approve, false) and (nt is null or char_length(nt) < 3) then raise exception 'write why the estimate is rejected (at least 3 characters): the garage reads it' using errcode = 'P0001'; end if;
  if coalesce(p_approve, false) then
    if exists (select 1 from public.job_quotes where lead_id = l.id and status = 'draft') then raise exception 'there is already a draft quote for this booking: send or edit it first' using errcode = 'P0001'; end if;
    eta := case when e.hours is not null then jsonb_build_object('kind', 'hours', 'hours', e.hours) else jsonb_build_object('kind', 'date', 'date', e.return_day) end;
    q := public.crm_quote_save(l.id, e.lines, eta);
    select id into qid from public.job_quotes where lead_id = l.id and status = 'draft';
    update public.garage_estimates set status = 'converted', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nt, converted_quote_id = qid where id = e.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Garage estimate approved: draft quote v' || (q ->> 'version') || ' created. Review it and send it to the customer');
  else
    update public.garage_estimates set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nt where id = e.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Garage estimate rejected: ' || nt);
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), case when coalesce(p_approve, false) then 'garage_estimate_approved' else 'garage_estimate_rejected' end, jsonb_build_object('lead', l.ref, 'estimate', e.id));
  return jsonb_build_object('ok', true, 'status', case when coalesce(p_approve, false) then 'converted' else 'rejected' end, 'quote', q, 'lead_id', l.id);
end; $$;
revoke all on function public.crm_garage_estimate_review(uuid, boolean, text) from public, anon;
grant execute on function public.crm_garage_estimate_review(uuid, boolean, text) to authenticated;

-- ───────────────────────── 7. Refunds ─────────────────────────
create table if not exists public.booking_refunds (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads(id) on delete cascade,
  kind              text not null check (kind in ('full', 'partial')),
  amount            numeric(12,2) not null check (amount > 0),
  method            text not null check (method in ('cashfree', 'manual')),
  reference         text,
  gateway_refund_id text,
  status            text not null default 'pending' check (status in ('pending', 'processing', 'refunded', 'failed')),
  reason            text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  ledger_entry_id   uuid references public.ledger_entries(id) on delete set null
);
create index if not exists booking_refunds_lead_idx on public.booking_refunds (lead_id, created_at desc);
create unique index if not exists booking_refunds_ledger_uq on public.booking_refunds (ledger_entry_id) where ledger_entry_id is not null;
alter table public.booking_refunds enable row level security;
revoke all on public.booking_refunds from public, anon, authenticated;
grant select on public.booking_refunds to authenticated;
drop policy if exists booking_refunds_admin_read on public.booking_refunds;
create policy booking_refunds_admin_read on public.booking_refunds for select to authenticated using (public.is_admin());

-- Keeps the table in step with the ledger. Manual refund (source not gateway): one 'refunded' row. Gateway refund: one row that starts from what the ledger note says and is then updated by admin-refund and the webhook.
-- A reversal of a refund (the money did not go back) turns its row 'failed'. Never raises: a problem here must not stop a ledger entry.
create or replace function public.ledger_booking_refund_fn() returns trigger language plpgsql security definer set search_path = public as $$
declare paid numeric; k text; n text := lower(coalesce(new.note, ''));
begin
  begin
    if new.entry_type = 'refund' and new.lead_id is not null then
      select coalesce(sum(e.amount), 0) into paid from public.ledger_entries e
        where e.lead_id = new.lead_id and e.entry_type = 'customer_payment' and not exists (select 1 from public.ledger_entries r where r.reverses_id = e.id);
      k := case when new.amount >= paid then 'full' else 'partial' end;
      insert into public.booking_refunds (lead_id, kind, amount, method, reference, status, reason, created_by, created_at, ledger_entry_id)
        values (new.lead_id, k, new.amount, case when new.source = 'gateway' then 'cashfree' else 'manual' end, new.reference,
          case when new.source <> 'gateway' then 'refunded' when n like '%refund success%' then 'refunded' when n like '%onhold%' then 'processing' else 'pending' end,
          coalesce(new.reason, new.note), new.created_by, new.created_at, new.id)
        on conflict (ledger_entry_id) where ledger_entry_id is not null do nothing;
    elsif new.entry_type = 'reversal' and new.reverses_id is not null then
      update public.booking_refunds set status = 'failed', updated_at = now() where ledger_entry_id = new.reverses_id and status <> 'failed';
    end if;
  exception when others then
    raise warning 'booking_refunds sync skipped: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists ledger_zz_booking_refunds on public.ledger_entries;
create trigger ledger_zz_booking_refunds after insert on public.ledger_entries for each row execute function public.ledger_booking_refund_fn();

-- Refunds already in the ledger before this migration become rows too (once; the unique index on ledger_entry_id keeps it that way).
insert into public.booking_refunds (lead_id, kind, amount, method, reference, status, reason, created_by, created_at, ledger_entry_id)
select e.lead_id,
  case when e.amount >= (select coalesce(sum(p.amount), 0) from public.ledger_entries p where p.lead_id = e.lead_id and p.entry_type = 'customer_payment' and not exists (select 1 from public.ledger_entries r where r.reverses_id = p.id)) then 'full' else 'partial' end,
  e.amount, case when e.source = 'gateway' then 'cashfree' else 'manual' end, e.reference,
  case when exists (select 1 from public.ledger_entries r where r.reverses_id = e.id) then 'failed' when e.source <> 'gateway' then 'refunded' when lower(coalesce(e.note, '')) like '%refund success%' then 'refunded' else 'pending' end,
  coalesce(e.reason, e.note), e.created_by, e.created_at, e.id
from public.ledger_entries e
where e.entry_type = 'refund' and e.lead_id is not null
  and not exists (select 1 from public.booking_refunds b where b.ledger_entry_id = e.id);

-- Money, refunds and what is still due for one booking. Admin and Crew may read; Crew sees amounts and status but no gateway ids or references.
create or replace function public.crm_booking_refunds(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; adm boolean := public.is_admin(); paid numeric; refd numeric;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select coalesce(sum(case e.entry_type when 'customer_payment' then e.amount else 0 end), 0), coalesce(sum(case e.entry_type when 'refund' then e.amount else 0 end), 0) into paid, refd
    from public.ledger_entries e where e.lead_id = p_lead and e.entry_type in ('customer_payment', 'refund') and not exists (select 1 from public.ledger_entries x where x.reverses_id = e.id);
  return jsonb_build_object('paid', paid, 'refunded', refd, 'refundable', greatest(0, paid - refd),
    'refund_due', case when l.status = 'cancelled' then coalesce(l.refund_due, 0) else 0 end,
    'refund_outstanding', case when l.status = 'cancelled' then greatest(0, least(coalesce(l.refund_due, 0), paid - refd)) else 0 end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'amount', b.amount, 'method', b.method, 'status', b.status, 'reason', b.reason, 'created_at', b.created_at, 'updated_at', b.updated_at,
        'created_by_name', coalesce(public.crm_name(b.created_by), 'System'),
        'reference', case when adm or b.method = 'manual' then b.reference end, 'gateway_refund_id', case when adm then b.gateway_refund_id end) order by b.created_at desc)
      from public.booking_refunds b where b.lead_id = p_lead), '[]'::jsonb));
end; $$;
revoke all on function public.crm_booking_refunds(uuid) from public, anon;
grant execute on function public.crm_booking_refunds(uuid) to authenticated;

-- ───────────────────────── 8. One assignment ─────────────────────────
-- Who has this booking: the open partner-garage job, or an outside partner (leads.assigned_to as text), plus the history. The garage phone is for Admin only.
create or replace function public.crm_assignment_info(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; a public.garage_assignments; g public.garages; gj jsonb := null;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into a from public.garage_assignments where lead_id = p_lead and status in ('sent', 'received', 'in_work', 'ready');
  if found then
    select * into g from public.garages where id = a.garage_id;
    gj := jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code, 'status', a.status, 'seen_at', a.received_at, 'eta', a.eta, 'notes', a.notes, 'assigned_at', a.assigned_at,
      'assigned_by_name', coalesce(public.crm_name(a.assigned_by), 'System'), 'phone_for_admin', case when public.is_admin() then g.mobile end);
  end if;
  return jsonb_build_object('garage', gj, 'outside', case when gj is null then nullif(btrim(coalesce(l.assigned_to, '')), '') end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('garage', gg.name, 'status', x.status, 'at', coalesce(x.cancelled_at, x.returned_at, x.ready_at, x.started_at, x.received_at, x.assigned_at)) order by x.assigned_at desc)
      from (select * from public.garage_assignments where lead_id = p_lead order by assigned_at desc limit 30) x join public.garages gg on gg.id = x.garage_id), '[]'::jsonb));
end; $$;
revoke all on function public.crm_assignment_info(uuid) from public, anon;
grant execute on function public.crm_assignment_info(uuid) to authenticated;

-- Give the booking to a partner garage (the existing crm_garage_assign runs, with all its guards) or to an outside partner. Exactly one of the two.
-- The old doorstep-mechanic assignment stays retired (its block trigger is left alone): nothing here touches mechanic_id.
create or replace function public.crm_assign_booking(p_lead uuid, p_garage uuid default null, p_outside text default null, p_note text default null, p_eta timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; out_name text := public.crm_clean_text(p_outside, 80); res jsonb; who text;
begin
  perform public.garage_staff_need();
  if (p_garage is null) = (out_name is null) then raise exception 'choose a partner garage or write an outside partner, not both' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found or not public.crm_can_see(l, public.flow_need()) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if l.status in ('cancelled', 'lost', 'junk') then raise exception 'this booking is closed' using errcode = 'P0001'; end if;
  who := coalesce(public.crm_name(auth.uid()), 'a team member');
  if p_garage is not null then
    if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'The customer has not paid the confirmation fee yet' using errcode = 'P0001'; end if;
    res := public.crm_garage_assign(p_lead, p_garage, p_note, p_eta);
    if nullif(btrim(coalesce(l.assigned_to, '')), '') is not null then
      update public.leads set assigned_to = null where id = p_lead;
      insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'assign', 'Outside partner ' || l.assigned_to || ' replaced by a partner garage (by ' || who || ')');
    end if;
    return res || jsonb_build_object('ok', true, 'kind', 'garage');
  end if;
  if public.crm_has_pii(out_name) or (p_note is not null and public.crm_has_pii(p_note)) then raise exception 'remove ID, bank or card numbers' using errcode = 'P0001'; end if;
  if exists (select 1 from public.garage_assignments where lead_id = p_lead and status in ('sent', 'received', 'in_work', 'ready')) then raise exception 'cancel or move the garage job first' using errcode = 'P0001'; end if;
  if l.assigned_to is not distinct from out_name then return jsonb_build_object('ok', true, 'kind', 'outside', 'outside', out_name, 'already', true); end if;
  update public.leads set assigned_to = out_name where id = p_lead;
  insert into public.crm_activities (lead_id, actor, kind, body) values (p_lead, auth.uid(), 'assign', 'Given to outside partner ' || out_name || ' (by ' || who || ')' || coalesce('. Note: ' || public.crm_clean_text(p_note, 300), ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'outside_partner_assigned', jsonb_build_object('lead', l.ref, 'partner', out_name));
  return jsonb_build_object('ok', true, 'kind', 'outside', 'outside', out_name);
end; $$;
revoke all on function public.crm_assign_booking(uuid, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.crm_assign_booking(uuid, uuid, text, text, timestamptz) to authenticated;

-- ───────────────────────── 9. Timeline ─────────────────────────
-- Newest first. Sources: the booking history (crm_activities: status changes, calls, notes, quotes and who approved them, assignments, garage progress, delivery, cancellation, refunds), the message log
-- (booking_notifications; the history lines that only repeat a message result are left out), the ledger (payments, refunds, reversals, write-offs: amounts for Admin only), quote drafts,
-- gateway refund status and garage declines or timeouts. Every row has by_name: the person, 'Customer' or 'System'.
create or replace function public.crm_booking_timeline(p_lead uuid, p_limit int default 200) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need(); l public.leads; adm boolean := public.is_admin(); lim int := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', t.at, 'kind', t.kind, 'title', t.title, 'detail', t.detail, 'by_name', t.by_name) order by t.at desc, t.ord desc) from (
    select * from (
      select a.created_at as at, 1 as ord,
        case when a.body ~ '^Quote' then 'quote' when a.body ~ '^(Partner garage|Sent to partner garage|Garage)' then 'garage' when a.body ~ '^(Vehicle ready|Vehicle delivered|Booking closed|Marked done)' then 'delivery'
             when a.body ~ '^Booking cancelled' then 'cancellation' when a.body ~ '^Refund' then 'refund' when a.kind = 'status' then 'status' when a.kind = 'assign' then 'assignment' when a.kind in ('call', 'whatsapp') then a.kind else 'note' end as kind,
        left(split_part(coalesce(a.body, a.kind), '. ', 1), 110) as title, case when char_length(coalesce(a.body, '')) > 110 then a.body end as detail,
        coalesce(cu.name, ad.name, case when a.actor is null and a.body ~* '^customer' then 'Customer' else 'System' end) as by_name
      from public.crm_activities a left join public.crm_users cu on cu.user_id = a.actor left join public.admins ad on ad.user_id = a.actor
      where a.lead_id = p_lead
        and not (a.actor is null and a.kind = 'note' and a.body ~ '^(.* (email|WhatsApp|notice|confirmation)|Team alert: .+|WhatsApp confirmation) (sent|failed|skipped)(: .*)?$')
      union all
      select coalesce(n.sent_at, n.last_attempt_at), 2, 'message', public.notification_label(n.kind) || ' ' || n.status, n.error, 'System'
        from public.booking_notifications n where n.lead_id = p_lead
      union all
      select e.created_at, 3, case e.entry_type when 'customer_payment' then 'payment' when 'refund' then 'refund' when 'reversal' then 'reversal' else 'ledger' end,
        case e.entry_type when 'customer_payment' then 'Payment received' when 'refund' then 'Refund recorded' when 'reversal' then 'Money entry reversed' else 'Balance written off' end,
        trim(both ' ' from coalesce(case when adm then 'Rs ' || trim(trailing '.' from trim(trailing '0' from e.amount::text)) || case when e.method is not null then ' via ' || e.method else '' end else e.method end, '') || coalesce('. ' || e.reason, '')),
        coalesce(cu.name, ad.name, case when e.entry_type = 'customer_payment' and e.source = 'gateway' then 'Customer' else 'System' end)
        from public.ledger_entries e left join public.crm_users cu on cu.user_id = e.created_by left join public.admins ad on ad.user_id = e.created_by
        where e.lead_id = p_lead and e.entry_type in ('customer_payment', 'refund', 'reversal', 'write_off')
      union all
      select q.created_at, 4, 'quote', 'Quote v' || q.version || ' drafted', null, coalesce(public.crm_name(q.created_by), 'System') from public.job_quotes q where q.lead_id = p_lead
      union all
      select b.updated_at, 5, 'refund', 'Gateway refund ' || b.status, case when adm then 'Rs ' || trim(trailing '.' from trim(trailing '0' from b.amount::text)) end, coalesce(public.crm_name(b.created_by), 'System')
        from public.booking_refunds b where b.lead_id = p_lead and b.method = 'cashfree'
      union all
      select x.cancelled_at, 6, 'garage', case x.cancel_kind when 'declined' then 'Garage declined the job' when 'expired' then 'Garage did not accept in time' when 'garage_cancelled' then 'Garage cancelled the job' else 'Garage job cancelled' end || ' (' || gg.name || ')', x.cancel_reason,
        case when x.cancel_kind in ('declined', 'expired', 'garage_cancelled') then 'Garage' else 'System' end
        from public.garage_assignments x join public.garages gg on gg.id = x.garage_id where x.lead_id = p_lead and x.cancelled_at is not null and x.cancel_kind is not null
    ) u order by u.at desc, u.ord desc limit lim
  ) t), '[]'::jsonb);
end; $$;
revoke all on function public.crm_booking_timeline(uuid, int) from public, anon;
grant execute on function public.crm_booking_timeline(uuid, int) to authenticated;

-- ───────────────────────── 10. Cancellations list: refund semantics ─────────────────────────
-- Same as 20270143000000_cancellations.sql plus refund_kind ('full', 'partial', 'none') and refund_label ('Full', 'Partial'): full when the refund due covers everything the customer paid.
create or replace function public.crm_cancellations_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_need();
begin
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('issue_id', i.id, 'lead_id', l.id, 'booking_id', coalesce(l.booking_id, l.ref), 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'date', l.preferred_date, 'slot', l.preferred_slot, 'paid', coalesce(l.paid_amount, 0), 'body', i.body, 'asked_at', i.created_at, 'outcome', null) order by i.created_at)
      from public.booking_issues i join public.leads l on l.id = i.lead_id where i.category = 'cancel' and i.status = 'open' and l.deleted_at is null and public.crm_can_see(l, r) and l.status <> 'cancelled'), '[]'::jsonb),
    'cancelled', coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'booking_id', coalesce(l.booking_id, l.ref), 'first_name', split_part(l.name, ' ', 1), 'area', l.area, 'kind', l.cancel_kind, 'reason', l.cancel_reason, 'cancelled_at', l.cancelled_at,
        'refund_due', coalesce(l.refund_due, 0), 'refund_outstanding', least(coalesce(l.refund_due, 0), coalesce(l.paid_amount, 0)),
        'refund_kind', case when coalesce(l.refund_due, 0) = 0 then 'none' when l.refund_due >= p.total_paid then 'full' else 'partial' end,
        'refund_label', case when coalesce(l.refund_due, 0) = 0 then null when l.refund_due >= p.total_paid then 'Full' else 'Partial' end) order by l.cancelled_at desc)
      from public.leads l
      cross join lateral (select coalesce(sum(e.amount), 0) as total_paid from public.ledger_entries e where e.lead_id = l.id and e.entry_type = 'customer_payment' and not exists (select 1 from public.ledger_entries x where x.reverses_id = e.id)) p
      where l.status = 'cancelled' and l.deleted_at is null and l.cancelled_at > now() - interval '120 days' and public.crm_can_see(l, r)), '[]'::jsonb));
end; $$;
revoke all on function public.crm_cancellations_list() from public, anon;
grant execute on function public.crm_cancellations_list() to authenticated;
