-- Partner availability selfie, one-time terms, first-run tour record. Additive and idempotent.
-- Selfies are IMAGES in a private bucket 'selfies' (no policy: only the service role in Edge Functions touches it).
-- Rollback: drop function public.partner_selfie_record(text, uuid, text), public.partner_selfie_latest(text, uuid),
--   public.partner_terms_status(text, uuid, text), public.partner_terms_accept(text, uuid, text, boolean);
--   drop table public.partner_selfies, public.partner_terms; delete from storage.buckets where id = 'selfies' (after emptying it).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table if not exists public.partner_selfies (
  id uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('garage', 'mechanic')),
  partner_id uuid not null,
  path text not null check (char_length(path) between 5 and 300),
  taken_at timestamptz not null default now()
);
create index if not exists partner_selfies_partner_idx on public.partner_selfies (partner_kind, partner_id, taken_at desc);
alter table public.partner_selfies enable row level security;

create table if not exists public.partner_terms (
  partner_kind text not null check (partner_kind in ('garage', 'mechanic')),
  partner_id uuid not null,
  version text not null check (char_length(version) between 1 and 20),
  accepted_at timestamptz not null default now(),
  tour_done_at timestamptz,
  primary key (partner_kind, partner_id, version)
);
alter table public.partner_terms enable row level security;

create or replace function public.partner_selfie_record(p_kind text, p_id uuid, p_path text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  insert into public.partner_selfies (partner_kind, partner_id, path) values (p_kind, p_id, p_path) returning taken_at into t;
  return t;
end $$;

create or replace function public.partner_selfie_latest(p_kind text, p_id uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(taken_at) from public.partner_selfies where partner_kind = p_kind and partner_id = p_id
$$;

create or replace function public.partner_terms_status(p_kind text, p_id uuid, p_version text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('accepted', true, 'accepted_at', accepted_at, 'tour_done', tour_done_at is not null)
    from public.partner_terms where partner_kind = p_kind and partner_id = p_id and version = p_version),
    jsonb_build_object('accepted', false, 'tour_done', false))
$$;

create or replace function public.partner_terms_accept(p_kind text, p_id uuid, p_version text, p_tour boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into public.partner_terms (partner_kind, partner_id, version, tour_done_at) values (p_kind, p_id, p_version, case when p_tour then now() end)
  on conflict (partner_kind, partner_id, version) do update set tour_done_at = coalesce(public.partner_terms.tour_done_at, case when p_tour then now() end);
  return public.partner_terms_status(p_kind, p_id, p_version);
end $$;

revoke all on function public.partner_selfie_record(text, uuid, text), public.partner_selfie_latest(text, uuid), public.partner_terms_status(text, uuid, text), public.partner_terms_accept(text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.partner_selfie_record(text, uuid, text), public.partner_selfie_latest(text, uuid), public.partner_terms_status(text, uuid, text), public.partner_terms_accept(text, uuid, text, boolean) to service_role;
