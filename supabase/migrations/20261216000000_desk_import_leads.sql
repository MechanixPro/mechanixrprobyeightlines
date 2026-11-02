-- Desk: "Import from AiSensy". A Care Buddy pastes the new WhatsApp contacts from an AiSensy export and the desk makes one lead for each.
-- Mobile numbers only; a number that already has an open lead from the last 30 days is skipped, so pasting the same list twice is safe.
create or replace function public.crm_import_leads(p_rows jsonb, p_source text default 'whatsapp') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; ph text; nm text; made int := 0; dups int := 0; bad int := 0; nid uuid; cid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('add_leads');
  if p_source not in ('whatsapp','instagram','phone','walk_in') then raise exception 'unknown source' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'send a list of customers' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'import at most 300 customers at a time' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    ph := regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9]', '', 'g');
    if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
    if ph !~ '^[6-9][0-9]{9}$' then bad := bad + 1; continue; end if;
    if exists (select 1 from public.leads where phone = ph and deleted_at is null and status in ('new','contacted','quoted','payment_sent') and created_at > now() - interval '30 days') then dups := dups + 1; continue; end if;
    nm := nullif(left(trim(regexp_replace(coalesce(r ->> 'name', ''), '[\u0000-\u001f]', ' ', 'g')), 60), '');
    if nm is null or char_length(nm) < 2 or public.crm_has_pii(nm) then nm := 'WhatsApp customer'; end if;
    insert into public.customers (phone, name) values (ph, case when nm = 'WhatsApp customer' then null else nm end) on conflict (phone) do nothing;
    select id into cid from public.customers where phone = ph;
    insert into public.leads (customer_id, name, phone, source, status, crm_owner, consent_whatsapp, page, notes)
      values (cid, nm, ph, p_source, 'new', null, false, 'import', 'Imported from the AiSensy export.') returning id into nid;
    insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Imported from AiSensy (' || p_source || ')');
    made := made + 1;
  end loop;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'desk_import_leads', jsonb_build_object('created', made, 'duplicates', dups, 'invalid', bad));
  return jsonb_build_object('ok', true, 'created', made, 'duplicates', dups, 'invalid', bad);
end; $$;
revoke all on function public.crm_import_leads(jsonb, text) from public;
grant execute on function public.crm_import_leads(jsonb, text) to authenticated;
