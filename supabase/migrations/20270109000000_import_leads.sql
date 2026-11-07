-- CSV lead import (up to 500 rows). Named crm_import_leads_csv: crm_import_leads(jsonb, text) from the AiSensy paste already exists and a 1-arg overload would be ambiguous.
-- Skips a phone that already belongs to a lead or an active customer. leads.source is constrained, so an unknown or empty source is stored as 'phone' and the lead is tagged page = 'import'.
create or replace function public.crm_import_leads_csv(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; ph text; nm text; src text; nt text; added int := 0; skipped int := 0; nid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('add_leads');
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'send a list of customers' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'import at most 500 customers at a time' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    ph := public.norm_phone10(r ->> 'phone');
    if ph is null or ph !~ '^[6-9][0-9]{9}$' then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.leads where phone = ph) or exists (select 1 from public.customers_active where phone = ph) then skipped := skipped + 1; continue; end if;
    nm := left(trim(regexp_replace(coalesce(r ->> 'name', ''), '[\u0000-\u001f]', ' ', 'g')), 60);
    nt := nullif(left(trim(coalesce(r ->> 'note', '')), 500), '');
    if char_length(nm) < 2 or public.crm_has_pii(nm) or public.crm_has_pii(nt) then skipped := skipped + 1; continue; end if;
    src := coalesce(nullif(r ->> 'source', ''), 'phone');
    if src not in ('website','whatsapp','phone','walk_in','app','instagram') then src := 'phone'; end if;
    insert into public.leads (name, phone, source, notes, status, crm_owner, consent_whatsapp, page)
      values (nm, ph, src, nt, 'new', null, false, 'import') returning id into nid;
    insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Imported');
    added := added + 1;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end; $$;
revoke all on function public.crm_import_leads_csv(jsonb) from public;
grant execute on function public.crm_import_leads_csv(jsonb) to authenticated;
