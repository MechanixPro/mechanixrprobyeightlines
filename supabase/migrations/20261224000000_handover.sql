-- OTP handover and bike photos for pickup jobs (the bike goes to a garage: leads.job_place = 'garage' or leads.place = 'pickup').
-- Two handovers per job: 'pickup' and 'return'. The desk makes a 4-digit code and sends it to the customer on WhatsApp (crm_handover_code); the technician takes 4 or more photos
-- on the /job/ page and types the code the customer tells them; the tech-job function checks it and records who and when. Design: docs/superpowers/specs/2026-11-04-otp-handover-design.md
-- Only a SHA-256 hash of "<handover id>:<code>" is stored. A code lasts 24 hours, a new code for the same step cancels the old one, 5 wrong tries lock it.
-- Photos are private (bucket 'handover', no public URLs), kept 12 months (settings key handover_keep_months), then handover_purge_photos() removes them. Nothing schedules that function yet.

create table if not exists public.handovers (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  kind            text not null check (kind in ('pickup','return')),
  code_hash       text not null,
  code_expires_at timestamptz not null,
  attempts        int not null default 0,
  locked_at       timestamptz,
  verified_at     timestamptz,
  mechanic_id     uuid references public.mechanics(id) on delete set null,
  photo_paths     text[] not null default '{}',
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists handovers_lead_idx on public.handovers (lead_id, created_at desc);
-- One verified pickup and one verified return per booking: two taps at the same moment cannot both verify.
create unique index if not exists handovers_one_verified on public.handovers (lead_id, kind) where verified_at is not null;
alter table public.handovers enable row level security;
revoke all on public.handovers from public, anon, authenticated;

-- Private bucket: images only, 1 MB each (the phone compresses to about 150 KB). Uploads go through one-time signed URLs from the tech-job function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handover', 'handover', false, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Desk users read photos through signed URLs, only for a lead they may see (the folder is the lead id). No insert, update or delete policy: only the function (service role) writes.
drop policy if exists handover_bucket_desk_read on storage.objects;
create policy handover_bucket_desk_read on storage.objects for select to authenticated using (
  bucket_id = 'handover' and public.crm_role() is not null
  and exists (select 1 from public.leads l where l.id::text = (storage.foldername(name))[1] and public.crm_can_see(l, public.crm_role()))
);

-- Desk: make a code for one step and return it once. The same people who may send the technician link may do this.
create or replace function public.crm_handover_code(p_lead uuid, p_kind text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; hid uuid := gen_random_uuid(); rnd bytea; code text; exp timestamptz := now() + interval '24 hours';
begin
  perform public.crm_need_role();
  if p_kind not in ('pickup','return') then raise exception 'choose pickup or return' using errcode = 'P0001'; end if;
  select * into l from public.leads where id = p_lead and deleted_at is null for update;  -- two taps at once wait for each other, so only one code stays open
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('assign_leads') or public.crm_can('manage_technicians') or (public.crm_can('edit_leads') and l.crm_owner = auth.uid())) then
    raise exception 'you do not have permission to do this' using errcode = '42501';
  end if;
  if not (l.job_place = 'garage' or l.place = 'pickup') then raise exception 'this is not a pickup job' using errcode = 'P0001'; end if;
  if l.mechanic_id is null then raise exception 'assign a technician first' using errcode = 'P0001'; end if;
  if l.status = 'lost' then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  if exists (select 1 from public.handovers where lead_id = p_lead and kind = p_kind and verified_at is not null) then raise exception 'this handover is already verified' using errcode = 'P0001'; end if;
  if p_kind = 'return' and not exists (select 1 from public.handovers where lead_id = p_lead and kind = 'pickup' and verified_at is not null) then raise exception 'verify the pickup first' using errcode = 'P0001'; end if;
  update public.handovers set code_expires_at = now() where lead_id = p_lead and kind = p_kind and verified_at is null and code_expires_at > now();
  rnd := extensions.gen_random_bytes(3);
  code := lpad(((get_byte(rnd, 0) * 65536 + get_byte(rnd, 1) * 256 + get_byte(rnd, 2)) % 10000)::text, 4, '0');
  insert into public.handovers (id, lead_id, kind, code_hash, code_expires_at, created_by, mechanic_id)
    values (hid, p_lead, p_kind, encode(extensions.digest(hid::text || ':' || code, 'sha256'), 'hex'), exp, auth.uid(), l.mechanic_id);
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'handover_code_created', jsonb_build_object('lead', l.ref, 'kind', p_kind));
  return jsonb_build_object('code', code, 'kind', p_kind, 'expires_at', exp);
end; $$;
revoke all on function public.crm_handover_code(uuid, text) from public;
grant execute on function public.crm_handover_code(uuid, text) to authenticated;

-- Desk: the lead's handovers (newest first) for the Handover card, with the photo paths so the desk can ask Storage for signed URLs. Never the code or its hash.
create or replace function public.crm_handovers(p_lead uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.crm_need_role(); l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or not public.crm_can_see(l, r) then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'is_pickup', (l.job_place = 'garage' or l.place = 'pickup'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'code_expires_at', h.code_expires_at, 'attempts', h.attempts, 'locked_at', h.locked_at,
        'verified_at', h.verified_at, 'mechanic_name', m.name, 'photo_paths', to_jsonb(h.photo_paths), 'note', h.note, 'created_at', h.created_at) order by h.created_at desc)
      from public.handovers h left join public.mechanics m on m.id = h.mechanic_id where h.lead_id = l.id), '[]'::jsonb));
end; $$;
revoke all on function public.crm_handovers(uuid) from public;
grant execute on function public.crm_handovers(uuid) to authenticated;

-- Photos older than the keep time (settings key handover_keep_months, default 12) are deleted and the paths cleared; the verified record stays. Returns how many photos were removed.
-- Not scheduled and not granted to anyone: run it by hand (or from a cron the owner sets up) as the database owner.
create or replace function public.handover_purge_photos(p_months int default null) returns int language plpgsql security definer set search_path = public as $$
declare months int := coalesce(p_months, (select (value #>> '{}')::int from public.settings where key = 'handover_keep_months'), 12); cutoff timestamptz; n int;
begin
  if months < 1 then raise exception 'keep at least 1 month' using errcode = 'P0001'; end if;
  cutoff := now() - make_interval(months => months);
  select coalesce(sum(cardinality(photo_paths)), 0) into n from public.handovers where created_at < cutoff and cardinality(photo_paths) > 0;
  delete from storage.objects where bucket_id = 'handover' and name in (select unnest(photo_paths) from public.handovers where created_at < cutoff and cardinality(photo_paths) > 0);
  update public.handovers set photo_paths = '{}' where created_at < cutoff and cardinality(photo_paths) > 0;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'handover_photos_purged', jsonb_build_object('photos', n, 'older_than', cutoff));
  return n;
end; $$;
revoke all on function public.handover_purge_photos(int) from public, anon, authenticated;
