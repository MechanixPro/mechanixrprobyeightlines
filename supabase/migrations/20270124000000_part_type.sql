-- Genuine Parts Promise: every part line on a quote or garage estimate is marked Genuine (maker's authorised channel) or Equivalent (equivalent quality), and the customer sees which.
-- Additive: crm_quote_save and garage_estimate_save are replaced with the same signatures. Lines already saved keep working (no part_type means nothing is shown).
-- Rollback: re-run crm_quote_save from 20261228000000_paid_confirmation.sql and garage_estimate_save from 20270101000000_garage_app.sql.
create or replace function public.crm_quote_save(p_lead uuid, p_lines jsonb, p_eta jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; ln jsonb; sub numeric := 0; n int := 0; gstv numeric; tot numeric; credit numeric := 0; ver int; k text; nm text; am numeric; ek text; eh int; ed date; ew text; pt text; q public.job_quotes; clean jsonb := '[]'::jsonb;
begin
  l := public.quote_guard(p_lead);
  if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'waiting for the confirmation fee' using errcode = 'P0001'; end if;
  if coalesce(l.visit_stage, '') not in ('started','repair_doorstep','picked_up','ready') then raise exception 'the quote comes after the mechanic has arrived and the code is verified' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_lines) > 20 then raise exception 'at most 20 lines' using errcode = 'P0001'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    k := ln ->> 'kind'; nm := btrim(coalesce(ln ->> 'name', '')); 
    if k not in ('parts','labour','other') then raise exception 'each line is parts, labour or other' using errcode = 'P0001'; end if;
    pt := case when k = 'parts' then lower(btrim(coalesce(ln ->> 'part_type', ''))) else null end;
    if k = 'parts' and pt not in ('genuine','equivalent') then raise exception 'mark each part as Genuine or Equivalent' using errcode = 'P0001'; end if;
    if char_length(nm) < 2 or char_length(nm) > 80 then raise exception 'each line needs a name (2 to 80 characters)' using errcode = 'P0001'; end if;
    if public.crm_has_pii(nm) then raise exception 'remove ID, bank or card numbers from the line names' using errcode = 'P0001'; end if;
    begin am := (ln ->> 'amount')::numeric; exception when others then raise exception 'each line needs an amount' using errcode = 'P0001'; end;
    if am is null or am < 0 or am > 100000 then raise exception 'each amount must be from 0 to 1,00,000' using errcode = 'P0001'; end if;
    sub := sub + round(am, 2); n := n + 1; clean := clean || case when pt is not null then jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2), 'part_type', pt) else jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2)) end;
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

create or replace function public.garage_estimate_save(p_access uuid, p_assignment uuid, p_lines jsonb, p_notes text, p_hours int, p_day date, p_submit boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.garage_assignments; ac public.garage_access; g public.garages; l public.leads; ln jsonb; k text; nm text; am numeric; sub numeric := 0; clean jsonb := '[]'::jsonb; nt text := public.crm_clean_text(p_notes, 500); eid uuid; cnt int; today date := (now() at time zone 'Asia/Kolkata')::date; st text; pt text;
begin
  select * into ac from public.garage_access where id = p_access and active and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'Your access is switched off.'); end if;
  select * into a from public.garage_assignments where id = p_assignment and garage_id = ac.garage_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if a.status not in ('received','in_work') then return jsonb_build_object('ok', false, 'error', case when a.status = 'sent' then 'Mark Vehicle received before you send an estimate.' else 'This job is closed.' end); end if;
  select * into g from public.garages where id = a.garage_id; select * into l from public.leads where id = a.lead_id;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then return jsonb_build_object('ok', false, 'error', 'Add at least one line.'); end if;
  if jsonb_array_length(p_lines) > 20 then return jsonb_build_object('ok', false, 'error', 'At most 20 lines.'); end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    k := ln ->> 'kind'; nm := btrim(coalesce(ln ->> 'name', ''));
    if k not in ('parts','labour','other') then return jsonb_build_object('ok', false, 'error', 'Each line is parts, labour or other.'); end if;
    pt := case when k = 'parts' then lower(btrim(coalesce(ln ->> 'part_type', ''))) else null end;
    if k = 'parts' and pt not in ('genuine','equivalent') then return jsonb_build_object('ok', false, 'error', 'Mark each part as Genuine or Equivalent.'); end if;
    if char_length(nm) < 2 or char_length(nm) > 80 then return jsonb_build_object('ok', false, 'error', 'Each line needs a name (2 to 80 characters).'); end if;
    if public.crm_has_pii(nm) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the line names.'); end if;
    begin am := (ln ->> 'amount')::numeric; exception when others then return jsonb_build_object('ok', false, 'error', 'Each line needs an amount.'); end;
    if am is null or am < 0 or am > 100000 then return jsonb_build_object('ok', false, 'error', 'Each amount must be from 0 to 1,00,000.'); end if;
    sub := sub + round(am, 2); clean := clean || case when pt is not null then jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2), 'part_type', pt) else jsonb_build_object('kind', k, 'name', nm, 'amount', round(am, 2)) end;
  end loop;
  if nt is not null and public.crm_has_pii(nt) then return jsonb_build_object('ok', false, 'error', 'Remove ID, bank or card numbers from the notes.'); end if;
  if p_hours is not null and p_day is not null then return jsonb_build_object('ok', false, 'error', 'Give the estimated hours or a return day, not both.'); end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 72) then return jsonb_build_object('ok', false, 'error', 'Estimated hours must be from 1 to 72.'); end if;
  if p_day is not null and (p_day < today or p_day > today + 60) then return jsonb_build_object('ok', false, 'error', 'Pick a return day within the next 60 days.'); end if;
  if p_submit and p_hours is null and p_day is null then return jsonb_build_object('ok', false, 'error', 'Give the estimated hours or a return day.'); end if;
  select id, status into eid, st from public.garage_estimates where assignment_id = a.id and status in ('draft','submitted');
  if st = 'submitted' then return jsonb_build_object('ok', false, 'error', 'Your estimate is with the Mechanix Pro team for review.'); end if;
  if eid is null then
    insert into public.garage_estimates (assignment_id, lines, notes, hours, return_day) values (a.id, clean, nt, p_hours, p_day) returning id into eid;
  else
    update public.garage_estimates set lines = clean, notes = nt, hours = p_hours, return_day = p_day where id = eid;
  end if;
  if p_submit then
    update public.garage_estimates set status = 'submitted', submitted_at = now() where id = eid;
    select count(*) into cnt from public.garage_estimates where assignment_id = a.id;
    insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Partner garage (' || g.name || ') sent a repair estimate: Rs ' || sub || ' before GST. Waiting for review');
    insert into public.audit_log (action, details) values ('garage_estimate_submitted', jsonb_build_object('lead', l.ref, 'garage', g.id, 'estimate', eid, 'subtotal', sub));
  end if;
  return jsonb_build_object('ok', true, 'id', eid, 'submitted', coalesce(p_submit, false), 'subtotal', sub, 'gst', round(sub * 0.18, 2), 'total', sub + round(sub * 0.18, 2), 'lead_id', l.id, 'n', cnt);
end; $$;
