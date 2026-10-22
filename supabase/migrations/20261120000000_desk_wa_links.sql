-- Care Buddy desk, part 11: where the team reads what customers wrote (AiSensy Live Chat). The link is data, not code.
insert into public.settings (key, value) values ('aisensy_live_chat_url', to_jsonb('https://www.app.aisensy.com/projects/6ad3de6d802c3b145fdd4841/live'::text)) on conflict (key) do nothing;

create or replace function public.crm_wa_links() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  return jsonb_build_object('live_chat', (select value #>> '{}' from public.settings where key = 'aisensy_live_chat_url'));
end; $$;
revoke all on function public.crm_wa_links() from public;
grant execute on function public.crm_wa_links() to authenticated;
