-- Technician job link: the desk sends the technician https://mechanixpro.in/job/?t=<token> with the job.
-- The technician opens it without logging in, sees the job, and after the job reports the amount collected; the tech-job function works out the company's share and makes the Razorpay link.
-- Only a SHA-256 hash of the token is stored. A link is for one booking, expires after 7 days, takes one report, and a new link for the booking expires the old one.

create table if not exists public.tech_job_links (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  mechanic_id      uuid not null references public.mechanics(id) on delete cascade,
  token_hash text unique not null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  opened_at        timestamptz,
  reported_at      timestamptz,
  amount_collected numeric(12,2),
  company_share    numeric(12,2),
  pay_link_url     text
);
create index if not exists tech_job_links_lead_idx on public.tech_job_links (lead_id, created_at desc);
alter table public.tech_job_links enable row level security;
revoke all on public.tech_job_links from public, anon, authenticated;

-- Money the technician reports collecting is a ledger row from the new source 'technician'.
alter table public.ledger_entries drop constraint if exists ledger_entries_source_check;
alter table public.ledger_entries add constraint ledger_entries_source_check check (source in ('admin','gateway','opening','technician'));

create or replace function public.crm_tech_link(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; tok text;
begin
  perform public.crm_need_role();
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if not (public.crm_can('assign_leads') or public.crm_can('manage_technicians') or (public.crm_can('edit_leads') and l.crm_owner = auth.uid())) then
    raise exception 'you do not have permission to do this' using errcode = '42501';
  end if;
  if l.mechanic_id is null then raise exception 'assign a technician first' using errcode = 'P0001'; end if;
  if l.status in ('lost') then raise exception 'this lead is closed' using errcode = 'P0001'; end if;
  update public.tech_job_links set expires_at = now() where lead_id = p_lead and reported_at is null and expires_at > now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.tech_job_links (lead_id, mechanic_id, token_hash, created_by, expires_at)
    values (p_lead, l.mechanic_id, encode(extensions.digest(tok, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days');
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'tech_link_created', jsonb_build_object('lead', l.ref));
  return 'https://mechanixpro.in/job/?t=' || tok;
end; $$;
revoke all on function public.crm_tech_link(uuid) from public;
grant execute on function public.crm_tech_link(uuid) to authenticated;
