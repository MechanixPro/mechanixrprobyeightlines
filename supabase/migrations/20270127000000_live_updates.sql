-- Mechanix Live: the mechanic or partner garage shares photos and short clips (up to 15 seconds) while the job is on, and the customer watches them on the private tracking page.
-- Files sit in a private bucket and reach the customer only as short-lived signed links. Additive and idempotent.
-- Rollback: drop function public.live_update_add(uuid, text, text, text, uuid), public.live_updates_for(uuid); drop table public.live_updates; delete from storage.objects where bucket_id = 'live-updates'; delete from storage.buckets where id = 'live-updates';
create table if not exists public.live_updates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('photo', 'clip')),
  path text not null unique,
  by_kind text not null check (by_kind in ('mechanic', 'garage')),
  by_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists live_updates_lead_idx on public.live_updates (lead_id, created_at desc);
alter table public.live_updates enable row level security;
revoke all on public.live_updates from public, anon, authenticated;

-- Private bucket: photos and short clips, 30 MB each. Uploads go through one-time signed URLs from the tech-job and garage-app functions. No policies: only the service role reads and writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-updates', 'live-updates', false, 31457280, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'];

-- Add one shared item. Allowed while the booking is on (paid or scheduled) and for 2 days after it is completed; at most 30 items per booking.
create or replace function public.live_update_add(p_lead uuid, p_kind text, p_path text, p_by text, p_by_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  if p_kind not in ('photo', 'clip') or p_by not in ('mechanic', 'garage') then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'This job is not available.'); end if;
  if not (l.status in ('paid', 'scheduled') or (l.status = 'completed' and l.completed_at >= now() - interval '2 days')) then return jsonb_build_object('ok', false, 'error', 'Updates can be shared while the job is on.'); end if;
  if p_path not like l.id::text || '/%' then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  if (select count(*) from public.live_updates where lead_id = l.id) >= 30 then return jsonb_build_object('ok', false, 'error', 'This job already has 30 updates.'); end if;
  insert into public.live_updates (lead_id, kind, path, by_kind, by_id) values (l.id, p_kind, p_path, p_by, p_by_id) on conflict (path) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- The customer's list: newest first, 12 at most. Paths only; the function signs them.
create or replace function public.live_updates_for(p_lead uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'path', x.path, 'at', x.created_at) order by x.created_at desc), '[]'::jsonb)
    from (select * from public.live_updates where lead_id = p_lead order by created_at desc limit 12) x;
$$;

revoke all on function public.live_update_add(uuid, text, text, text, uuid), public.live_updates_for(uuid) from public, anon, authenticated;
grant execute on function public.live_update_add(uuid, text, text, text, uuid), public.live_updates_for(uuid) to service_role;
