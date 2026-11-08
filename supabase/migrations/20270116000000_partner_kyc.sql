-- Partner (garage and mechanic) onboarding: KYC documents, review and approval. Additive and idempotent.
-- Documents are IMAGES or PDFs in a private storage bucket. No identity number is stored in any column, note or log.
-- The existing status pipeline is kept: applied -> visited -> kyc_done -> trained -> pilot -> live (garages.status, mechanics.onboarding_status).
-- KYC approval sets 'kyc_done'; going 'live' is a separate explicit action by an admin.
-- Rollback: drop function public.kyc_review_list(), public.kyc_review_detail(text, uuid), public.kyc_doc_set_status(uuid, text, text),
--   public.kyc_decide(text, uuid, text, text), public.kyc_onboard(text, uuid), public.kyc_delete_docs(text, uuid),
--   public.kyc_link_create(text, uuid), public.kyc_link_check(text), public.kyc_submit(text, uuid), public.kyc_need_admin();
--   drop table public.partner_onboarding_log, public.partner_docs, public.partner_kyc, public.partner_onboarding_links;
--   delete from storage.buckets where id = 'kyc' (after emptying it).

-- 1. Private bucket: no policy is created for it, so only the service role (Edge Functions) can read or write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc', 'kyc', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- 2. Tables. Row level security is on and there are no policies: only the functions below and the service role touch them.
create table if not exists public.partner_onboarding_links (
  token_hash text primary key,
  partner_kind text not null check (partner_kind in ('garage', 'mechanic')),
  partner_id uuid not null,
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.partner_docs (
  id uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('garage', 'mechanic')),
  partner_id uuid not null,
  doc_type text not null check (char_length(doc_type) between 3 and 40),
  path text not null check (char_length(path) between 5 and 300),
  uploaded_at timestamptz not null default now(),
  status text not null default 'uploaded' check (status in ('uploaded', 'accepted', 'rejected')),
  reject_reason text check (char_length(reject_reason) <= 300),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create index if not exists partner_docs_partner_idx on public.partner_docs (partner_kind, partner_id);
create table if not exists public.partner_kyc (
  partner_kind text not null check (partner_kind in ('garage', 'mechanic')),
  partner_id uuid not null,
  submitted_at timestamptz,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decision_reason text check (char_length(decision_reason) <= 300),
  decided_by uuid,
  decided_at timestamptz,
  primary key (partner_kind, partner_id)
);
create table if not exists public.partner_onboarding_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  who uuid,
  action text not null,
  partner_kind text,
  partner_id uuid,
  doc_id uuid
);
alter table public.partner_onboarding_links enable row level security;
alter table public.partner_docs enable row level security;
alter table public.partner_kyc enable row level security;
alter table public.partner_onboarding_log enable row level security;

-- 3. Admin check used by every review function: owner or admin only (Crew has no access to documents).
create or replace function public.kyc_need_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- 4. Review list: who has applied, how many documents, whether they have submitted. Counts only.
create or replace function public.kyc_review_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  return coalesce((
    select jsonb_agg(x order by x.submitted desc, x.name) from (
      select 'garage'::text as kind, g.id, g.name, g.mobile as phone, g.status as status,
             coalesce(k.decision, 'pending') as decision, (k.submitted_at is not null) as submitted, k.submitted_at,
             (select count(*) from public.partner_docs d where d.partner_kind = 'garage' and d.partner_id = g.id) as docs
        from public.garages g left join public.partner_kyc k on k.partner_kind = 'garage' and k.partner_id = g.id
       where g.deleted_at is null and g.status in ('applied', 'visited', 'kyc_done', 'trained')
      union all
      select 'mechanic', m.id, m.name, m.phone, m.onboarding_status,
             coalesce(k.decision, 'pending'), (k.submitted_at is not null), k.submitted_at,
             (select count(*) from public.partner_docs d where d.partner_kind = 'mechanic' and d.partner_id = m.id)
        from public.mechanics m left join public.partner_kyc k on k.partner_kind = 'mechanic' and k.partner_id = m.id
       where m.onboarding_status in ('applied', 'visited', 'kyc_done', 'trained')
    ) x), '[]'::jsonb);
end $$;

-- 5. Detail: applicant fields and document list (type, status, time, reason). Never file content or numbers.
create or replace function public.kyc_review_detail(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb; k public.partner_kyc;
begin
  perform public.kyc_need_admin();
  if p_kind = 'garage' then
    select jsonb_build_object('kind', 'garage', 'id', g.id, 'name', g.name, 'owner_name', g.owner_name, 'phone', g.mobile, 'address', g.address, 'pincode', g.pincode, 'status', g.status) into a from public.garages g where g.id = p_id and g.deleted_at is null;
  elsif p_kind = 'mechanic' then
    select jsonb_build_object('kind', 'mechanic', 'id', m.id, 'name', m.name, 'phone', m.phone, 'status', m.onboarding_status) into a from public.mechanics m where m.id = p_id;
  else raise exception 'unknown partner type' using errcode = 'P0001'; end if;
  if a is null then raise exception 'applicant not found' using errcode = 'P0002'; end if;
  select * into k from public.partner_kyc where partner_kind = p_kind and partner_id = p_id;
  return a || jsonb_build_object('decision', coalesce(k.decision, 'pending'), 'decision_reason', k.decision_reason, 'submitted_at', k.submitted_at,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'status', d.status, 'uploaded_at', d.uploaded_at, 'reject_reason', d.reject_reason) order by d.doc_type, d.uploaded_at)
                        from public.partner_docs d where d.partner_kind = p_kind and d.partner_id = p_id), '[]'::jsonb));
end $$;

-- 6. Accept or reject one document (a rejection needs a reason the applicant can act on).
create or replace function public.kyc_doc_set_status(p_doc uuid, p_status text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.partner_docs;
begin
  perform public.kyc_need_admin();
  if p_status not in ('accepted', 'rejected') then raise exception 'choose accepted or rejected' using errcode = 'P0001'; end if;
  if p_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason the applicant can act on' using errcode = 'P0001'; end if;
  update public.partner_docs set status = p_status, reject_reason = case when p_status = 'rejected' then left(btrim(p_reason), 300) else null end, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_doc returning * into d;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id, doc_id) values (auth.uid(), 'doc_' || p_status, d.partner_kind, d.partner_id, d.id);
  return jsonb_build_object('ok', true);
end $$;

-- 7. Decide on the KYC. Approve sets 'kyc_done'. Reject keeps the status and needs a reason. Going live is a separate step.
create or replace function public.kyc_decide(p_kind text, p_id uuid, p_decision text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  if p_decision not in ('approve', 'reject') then raise exception 'choose approve or reject' using errcode = 'P0001'; end if;
  if p_decision = 'reject' and coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason' using errcode = 'P0001'; end if;
  insert into public.partner_kyc (partner_kind, partner_id, decision, decision_reason, decided_by, decided_at)
  values (p_kind, p_id, case when p_decision = 'approve' then 'approved' else 'rejected' end, left(btrim(coalesce(p_reason, '')), 300), auth.uid(), now())
  on conflict (partner_kind, partner_id) do update set decision = excluded.decision, decision_reason = excluded.decision_reason, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  if p_decision = 'approve' then
    if p_kind = 'garage' then update public.garages set status = 'kyc_done' where id = p_id and status in ('applied', 'visited'); else update public.mechanics set onboarding_status = 'kyc_done' where id = p_id and onboarding_status in ('applied', 'visited'); end if;
  end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'kyc_' || p_decision, p_kind, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- 8. Go live: only after the KYC was approved. A separate, explicit action.
create or replace function public.kyc_onboard(p_kind text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.partner_kyc;
begin
  perform public.kyc_need_admin();
  select * into k from public.partner_kyc where partner_kind = p_kind and partner_id = p_id;
  if not found or k.decision <> 'approved' then raise exception 'approve the KYC first' using errcode = 'P0001'; end if;
  if p_kind = 'garage' then update public.garages set status = 'live' where id = p_id and deleted_at is null; else update public.mechanics set onboarding_status = 'live' where id = p_id; end if;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'onboarded', p_kind, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- 9. Delete an applicant's documents (for example after a rejection). Returns the storage paths so the Edge Function removes the files.
create or replace function public.kyc_delete_docs(p_kind text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare paths jsonb;
begin
  perform public.kyc_need_admin();
  select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from public.partner_docs where partner_kind = p_kind and partner_id = p_id;
  delete from public.partner_docs where partner_kind = p_kind and partner_id = p_id;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'docs_deleted', p_kind, p_id);
  return jsonb_build_object('ok', true, 'paths', paths);
end $$;

-- 10. Service-role helpers for the Edge Functions: create a link (token returned once, only its hash stored), check a link, mark submitted.
create or replace function public.kyc_link_create(p_kind text, p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update public.partner_onboarding_links set revoked_at = now() where partner_kind = p_kind and partner_id = p_id and revoked_at is null;
  insert into public.partner_onboarding_links (token_hash, partner_kind, partner_id) values (encode(sha256(convert_to(tok, 'utf8')), 'hex'), p_kind, p_id);
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (auth.uid(), 'link_created', p_kind, p_id);
  return tok;
end $$;
create or replace function public.kyc_link_check(p_hash text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('kind', partner_kind, 'id', partner_id) from public.partner_onboarding_links where token_hash = p_hash and revoked_at is null and expires_at > now()), jsonb_build_object('error', 'link'));
$$;
create or replace function public.kyc_submit(p_kind text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.partner_kyc (partner_kind, partner_id, submitted_at) values (p_kind, p_id, now())
  on conflict (partner_kind, partner_id) do update set submitted_at = now(), decision = 'pending', decision_reason = null;
  insert into public.partner_onboarding_log (who, action, partner_kind, partner_id) values (null, 'submitted', p_kind, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- 11. Who may call what. The admin functions check the role themselves; the helpers are for the service role only.
revoke all on function public.kyc_need_admin() from public, anon;
revoke all on function public.kyc_review_list() from public, anon;
revoke all on function public.kyc_review_detail(text, uuid) from public, anon;
revoke all on function public.kyc_doc_set_status(uuid, text, text) from public, anon;
revoke all on function public.kyc_decide(text, uuid, text, text) from public, anon;
revoke all on function public.kyc_onboard(text, uuid) from public, anon;
revoke all on function public.kyc_delete_docs(text, uuid) from public, anon;
grant execute on function public.kyc_review_list(), public.kyc_review_detail(text, uuid), public.kyc_doc_set_status(uuid, text, text), public.kyc_decide(text, uuid, text, text), public.kyc_onboard(text, uuid), public.kyc_delete_docs(text, uuid) to authenticated;
revoke all on function public.kyc_link_create(text, uuid), public.kyc_link_check(text), public.kyc_submit(text, uuid) from public, anon, authenticated;
grant execute on function public.kyc_link_create(text, uuid), public.kyc_link_check(text), public.kyc_submit(text, uuid) to service_role;
