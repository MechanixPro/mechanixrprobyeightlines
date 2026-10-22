-- Care Buddy desk, part 10: know when a customer has written and nobody has answered yet, without AiSensy webhooks.
-- A scheduled job asks AiSensy about each open lead's WhatsApp contact (included in the plan) and stores the two timestamps below.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.leads add column if not exists wa_last_message_at timestamptz;
create index if not exists leads_wa_wait_idx on public.leads (last_customer_msg_at) where deleted_at is null;

-- Leads where the customer wrote last and nobody has replied yet (in the desk or in AiSensy Live Chat).
-- A reply within 90 seconds of the customer's message is treated as AiSensy's automatic welcome message, not a person.
create or replace function public.crm_replies_waiting() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean;
begin
  perform public.crm_need_role(); boss := public.crm_can('assign_leads');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'name', l.name, 'phone', l.phone, 'wrote_at', l.last_customer_msg_at, 'owner', public.crm_name(l.crm_owner), 'unassigned', l.crm_owner is null)
      order by l.last_customer_msg_at)
    from public.leads l
    where l.deleted_at is null and l.status in ('new','contacted','quoted','payment_sent') and not coalesce(l.opted_out, false)
      and l.last_customer_msg_at > now() - interval '3 days'
      and (l.wa_last_message_at is null or l.last_customer_msg_at >= l.wa_last_message_at - interval '90 seconds')
      and not exists (select 1 from public.crm_activities a where a.lead_id = l.id and a.kind in ('call','whatsapp') and a.created_at > l.last_customer_msg_at)
      and (boss or coalesce(l.crm_owner = me, false) or (l.crm_owner is null and public.crm_can('take_leads')))), '[]'::jsonb);
end; $$;

revoke all on function public.crm_replies_waiting() from public;
grant execute on function public.crm_replies_waiting() to authenticated;
