-- Mechanix Pro gets leads only from Google Ads and Meta (plus the website, WhatsApp, phone and walk-ins). No JustDial.
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('website','whatsapp','phone','walk_in','app','instagram'));

create or replace function public.crm_add_lead(p_name text, p_phone text, p_area text default null, p_source text default 'phone', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.crm_need_role(); ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); dup uuid; nid uuid; note text := nullif(trim(p_note), '');
begin
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'enter a valid 10 digit mobile number' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 then raise exception 'enter the customer name' using errcode = 'P0001'; end if;
  if p_source not in ('phone','walk_in','instagram','whatsapp') then raise exception 'unknown source' using errcode = 'P0001'; end if;
  if public.crm_has_pii(note) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note.' using errcode = 'P0001'; end if;
  select id into dup from public.leads where phone = ph and deleted_at is null and status in ('new','contacted','quoted','payment_sent') and created_at > now() - interval '30 days'
    order by created_at desc limit 1;
  if dup is not null then return jsonb_build_object('id', dup, 'duplicate', true); end if;
  insert into public.leads (name, phone, area, source, notes, status, crm_owner, consent_whatsapp)
    values (trim(p_name), ph, nullif(trim(p_area), ''), p_source, note, 'new', case when r = 'supervisor' then null else auth.uid() end, false)
    returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (nid, auth.uid(), 'create', 'Added by hand (' || p_source || ')');
  return jsonb_build_object('id', nid, 'duplicate', false);
end; $$;
revoke all on function public.crm_add_lead(text,text,text,text,text) from public;
grant execute on function public.crm_add_lead(text,text,text,text,text) to authenticated;
