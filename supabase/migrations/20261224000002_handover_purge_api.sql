-- Supabase refuses direct deletes from storage tables ("Use the Storage API"), so handover_purge_photos() from 20261224000000_handover.sql cannot work.
-- Cleanup is now two read-only lists; the handover-purge function deletes the files through the Storage API, then clears the paths on the rows.
drop function if exists public.handover_purge_photos(int);

-- Photos of handovers older than the keep period (settings key handover_keep_months, default 12 months).
create or replace function public.handover_expired_photos(p_months int default null) returns table (handover_id uuid, path text)
language plpgsql stable security definer set search_path = public as $$
declare months int := coalesce(p_months, (select (value #>> '{}')::int from public.settings where key = 'handover_keep_months'), 12);
begin
  if months < 1 then raise exception 'keep at least 1 month' using errcode = 'P0001'; end if;
  return query select h.id, p from public.handovers h, unnest(h.photo_paths) p where h.created_at < now() - make_interval(months => months);
end; $$;

-- Files uploaded but never part of a verified handover (a locked attempt, an abandoned upload), once they are older than p_min_age.
create or replace function public.handover_orphan_photos(p_min_age interval default interval '2 days') returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o where o.bucket_id = 'handover' and o.created_at < now() - p_min_age
    and not exists (select 1 from public.handovers h where o.name = any (h.photo_paths));
$$;

revoke all on function public.handover_expired_photos(int), public.handover_orphan_photos(interval) from public, anon, authenticated;
grant execute on function public.handover_expired_photos(int), public.handover_orphan_photos(interval) to service_role;
