-- Approving a garage estimate failed with "the quote comes after the mechanic has arrived and the code is verified".
-- Cause: that gate only looked at leads.visit_stage, which the doorstep mechanic's app sets. A job sent straight to a partner garage never gets a visit_stage.
-- Fix: the same gate also passes when the booking has a partner-garage job that is received, in work or ready. The garage app itself already refuses to reach
-- "received"-onward work without the customer code and the receiving checklist, so the safety check is unchanged.
-- Additive: crm_quote_save is replaced with the same signature, only the stage line changes. Rollback: re-run crm_quote_save from 20270124000000_part_type.sql.
create or replace function public.crm_quote_save(p_lead uuid, p_lines jsonb, p_eta jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; ln jsonb; sub numeric := 0; n int := 0; gstv numeric; tot numeric; credit numeric := 0; ver int; k text; nm text; am numeric; ek text; eh int; ed date; ew text; pt text; q public.job_quotes; clean jsonb := '[]'::jsonb;
begin
  l := public.quote_guard(p_lead);
  if l.confirm_fee is not null and l.confirm_paid_at is null then raise exception 'waiting for the confirmation fee' using errcode = 'P0001'; end if;
  if coalesce(l.visit_stage, '') not in ('started','repair_doorstep','picked_up','ready') and not exists (select 1 from public.garage_assignments ga where ga.lead_id = l.id and ga.status in ('received','in_work','ready')) then raise exception 'the quote comes after the mechanic has arrived and the code is verified' using errcode = 'P0001'; end if;
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
