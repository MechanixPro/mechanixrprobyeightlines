-- Care Buddy desk, part 9: what a chat reply needs to know, checked as the signed-in person.

create or replace function public.crm_chat_context(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_leads');
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (coalesce(l.crm_owner = auth.uid(), false) or public.crm_can('assign_leads')) then raise exception 'take the lead first' using errcode = '42501'; end if;
  return jsonb_build_object('lead_id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'opted_out', coalesce(l.opted_out, false), 'last_customer_msg_at', l.last_customer_msg_at,
    'window_open', coalesce(l.last_customer_msg_at > now() - interval '24 hours', false));
end; $$;

-- The chat for one lead, newest last, for the live view in the lead sheet
create or replace function public.crm_chat(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads;
begin
  perform public.crm_need_role();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, public.crm_need_role()) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('window_open', coalesce(l.last_customer_msg_at > now() - interval '24 hours', false), 'opted_out', coalesce(l.opted_out, false), 'last_customer_msg_at', l.last_customer_msg_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
      from (select * from public.messages where lead_id = l.id order by created_at desc limit 60) m), '[]'::jsonb));
end; $$;

revoke all on function public.crm_chat_context(uuid), public.crm_chat(uuid) from public;
grant execute on function public.crm_chat_context(uuid), public.crm_chat(uuid) to authenticated;
