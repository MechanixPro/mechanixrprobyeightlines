-- Redo Promise: if the same repair work fails within 30 days of the service, the customer asks for a free redo from the tracking page; Crew decides.
-- Additive and idempotent.
-- Rollback: drop function public.redo_request_create(text, text), public.redo_status_get(uuid), public.crm_redo_list(), public.crm_redo_decide(uuid, text, text); drop table public.redo_requests;
create table if not exists public.redo_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'approved', 'declined', 'done')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists redo_one_open_per_lead on public.redo_requests (lead_id) where status in ('open', 'approved');
create index if not exists redo_status_idx on public.redo_requests (status, created_at);
alter table public.redo_requests enable row level security;

-- Customer side (service role only; the track-booking Edge Function holds the secret link). Window is 30 days from the completed date.
create or replace function public.redo_request_create(p_token text, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare sec public.booking_secrets; l public.leads; r text := btrim(coalesce(p_reason, '')); nid uuid;
begin
  select * into sec from public.booking_secrets where track_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = sec.lead_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if l.status <> 'completed' or l.completed_at is null then return jsonb_build_object('ok', false, 'error', 'A redo can be asked for after the service is completed.'); end if;
  if l.completed_at < now() - interval '30 days' then return jsonb_build_object('ok', false, 'error', 'The 30 day Redo Promise window for this service has ended. Message us and we will still look at it.'); end if;
  if char_length(r) < 5 or char_length(r) > 500 then return jsonb_build_object('ok', false, 'error', 'Tell us what is not right, in 5 to 500 characters.'); end if;
  if exists (select 1 from public.redo_requests where lead_id = l.id and status in ('open', 'approved')) then return jsonb_build_object('ok', false, 'error', 'You already have a redo request open. We will get back to you.'); end if;
  insert into public.redo_requests (lead_id, reason) values (l.id, r) returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Redo Promise: customer asked for a redo. ' || left(r, 200));
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- What the tracking page shows: whether a redo can be asked for, until when, and the latest request.
create or replace function public.redo_status_get(p_lead uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', l.status = 'completed' and l.completed_at is not null and l.completed_at >= now() - interval '30 days'
                and not exists (select 1 from public.redo_requests q where q.lead_id = l.id and q.status in ('open', 'approved')),
    'until', case when l.completed_at is not null then l.completed_at + interval '30 days' end,
    'request', (select jsonb_build_object('status', q.status, 'created_at', q.created_at, 'note', case when q.status in ('declined', 'approved', 'done') then q.decision_note end)
                  from public.redo_requests q where q.lead_id = l.id order by q.created_at desc limit 1))
  from public.leads l where l.id = p_lead and l.deleted_at is null;
$$;

-- Crew and Admin queue: open and approved requests first, then recent decisions. Only leads the person may see.
create or replace function public.crm_redo_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare role_ text := public.crm_need_role();
begin
  return coalesce((select jsonb_agg(x order by x.sort_key, x.created_at desc) from (
    select q.id, q.status, q.reason, q.created_at, q.decided_at, q.decision_note, l.id as lead_id, l.booking_id as ref, l.name, l.phone, l.area, l.completed_at,
           case when q.status = 'open' then 0 when q.status = 'approved' then 1 else 2 end as sort_key
      from public.redo_requests q join public.leads l on l.id = q.lead_id
     where public.crm_can_see(l, role_) and (q.status in ('open', 'approved') or q.decided_at >= now() - interval '30 days')
     limit 100) x), '[]'::jsonb);
end $$;

create or replace function public.crm_redo_decide(p_id uuid, p_decision text, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare role_ text := public.crm_need_role(); q public.redo_requests; l public.leads; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approved', 'declined', 'done') then raise exception 'bad decision' using errcode = '22023'; end if;
  select * into q from public.redo_requests where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into l from public.leads where id = q.lead_id;
  if not public.crm_can_see(l, role_) then raise exception 'not allowed' using errcode = '42501'; end if;
  if n is not null and char_length(n) > 300 then raise exception 'note too long' using errcode = '22023'; end if;
  if p_decision = 'declined' and n is null then raise exception 'say why' using errcode = '22023'; end if;
  if q.status = 'open' and p_decision = 'done' then raise exception 'approve first' using errcode = '22023'; end if;
  if q.status in ('declined', 'done') then raise exception 'already closed' using errcode = '22023'; end if;
  update public.redo_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(n, decision_note) where id = p_id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Redo Promise ' || p_decision || coalesce(': ' || n, ''));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.redo_request_create(text, text), public.redo_status_get(uuid) from public, anon, authenticated;
grant execute on function public.redo_request_create(text, text), public.redo_status_get(uuid) to service_role;
revoke all on function public.crm_redo_list(), public.crm_redo_decide(uuid, text, text) from public, anon;
grant execute on function public.crm_redo_list(), public.crm_redo_decide(uuid, text, text) to authenticated;
