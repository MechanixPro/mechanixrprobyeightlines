-- Fix for the handover photo read rule. Desk users cannot read public.leads directly (row security), so the rule in 20261224000000_handover.sql, which looked the lead up in its own
-- subquery, always said no and "See photos" in Crew showed nothing. The lookup now runs inside a security definer helper, with the same visibility rule the desk uses (crm_can_see).
create or replace function public.crm_handover_photo_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_role() is not null and exists (
    select 1 from public.leads l where l.id::text = split_part(p_name, '/', 1) and public.crm_can_see(l, public.crm_role())
  );
$$;
revoke all on function public.crm_handover_photo_ok(text) from public, anon;
grant execute on function public.crm_handover_photo_ok(text) to authenticated;

-- The folder is the lead id. No insert, update or delete policy: only the function (service role) writes.
drop policy if exists handover_bucket_desk_read on storage.objects;
create policy handover_bucket_desk_read on storage.objects for select to authenticated using (bucket_id = 'handover' and public.crm_handover_photo_ok(name));
