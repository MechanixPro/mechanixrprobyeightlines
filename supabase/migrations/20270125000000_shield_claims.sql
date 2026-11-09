-- Mechanix Shield: up to Rs 5,000 paid by the company if a vehicle is damaged in our care. The customer reports it from the tracking page within 48 hours of delivery; the team reviews it with the pickup and delivery photos.
-- Money decisions (approve with an amount, mark paid) are for the admin only; any desk role can read the claim and decline it with a reason. Additive and idempotent.
-- Rollback: drop function public.shield_claim_create(text, text), public.shield_status_get(uuid), public.crm_shield_list(), public.crm_shield_decide(uuid, text, numeric, text, text); drop table public.shield_claims;
create table if not exists public.shield_claims (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  description text not null check (char_length(description) between 10 and 800),
  status text not null default 'open' check (status in ('open', 'approved', 'declined', 'paid')),
  amount numeric(10, 2) check (amount is null or (amount >= 0 and amount <= 5000)),
  recover_from text not null default 'none' check (recover_from in ('none', 'garage', 'mechanic')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  decided_by uuid,
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists shield_one_open_per_lead on public.shield_claims (lead_id) where status in ('open', 'approved');
create index if not exists shield_status_idx on public.shield_claims (status, created_at);
alter table public.shield_claims enable row level security;

-- Customer side (service role only; the Edge Function holds the secret link). The window is 48 hours from the completed date.
create or replace function public.shield_claim_create(p_token text, p_description text) returns jsonb language plpgsql security definer set search_path = public as $$
declare sec public.booking_secrets; l public.leads; d text := btrim(coalesce(p_description, '')); nid uuid;
begin
  select * into sec from public.booking_secrets where track_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into l from public.leads where id = sec.lead_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if l.status <> 'completed' or l.completed_at is null then return jsonb_build_object('ok', false, 'error', 'A Mechanix Shield claim can be made after your vehicle is delivered.'); end if;
  if l.completed_at < now() - interval '48 hours' then return jsonb_build_object('ok', false, 'error', 'The 48 hour window for a Mechanix Shield claim has ended. Message us and we will still look at it.'); end if;
  if char_length(d) < 10 or char_length(d) > 800 then return jsonb_build_object('ok', false, 'error', 'Tell us what was damaged and how, in 10 to 800 characters.'); end if;
  if public.crm_has_pii(d) then return jsonb_build_object('ok', false, 'error', 'Please remove ID, bank or card numbers from your message.'); end if;
  if exists (select 1 from public.shield_claims where lead_id = l.id and status in ('open', 'approved')) then return jsonb_build_object('ok', false, 'error', 'You already have a claim open. We will get back to you.'); end if;
  insert into public.shield_claims (lead_id, description) values (l.id, d) returning id into nid;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Mechanix Shield: customer reported damage. ' || left(d, 200));
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- What the tracking page shows: whether a claim can be made, until when, and the latest claim.
create or replace function public.shield_status_get(p_lead uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', l.status = 'completed' and l.completed_at is not null and l.completed_at >= now() - interval '48 hours'
                and not exists (select 1 from public.shield_claims q where q.lead_id = l.id and q.status in ('open', 'approved')),
    'until', case when l.completed_at is not null then l.completed_at + interval '48 hours' end,
    'claim', (select jsonb_build_object('status', q.status, 'created_at', q.created_at, 'note', q.decision_note, 'amount', case when q.status in ('approved', 'paid') then q.amount end)
                from public.shield_claims q where q.lead_id = l.id order by q.created_at desc limit 1))
  from public.leads l where l.id = p_lead and l.deleted_at is null;
$$;

-- Crew and Admin queue. The amount and the recovery choice show to the admin only.
create or replace function public.crm_shield_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare role_ text := public.crm_need_role(); adm boolean := public.is_admin();
begin
  return coalesce((select jsonb_agg(x order by x.sort_key, x.created_at desc) from (
    select q.id, q.status, q.description, q.created_at, q.decided_at, q.decision_note, l.id as lead_id, l.booking_id as ref, l.name, l.phone, l.area, l.completed_at,
           case when adm then q.amount end as amount, case when adm then q.recover_from end as recover_from,
           case when q.status = 'open' then 0 when q.status = 'approved' then 1 else 2 end as sort_key
      from public.shield_claims q join public.leads l on l.id = q.lead_id
     where public.crm_can_see(l, role_) and (q.status in ('open', 'approved') or q.decided_at >= now() - interval '60 days')
     limit 100) x), '[]'::jsonb);
end $$;

-- Decide: declined (any desk role, reason required), approved with an amount up to 5,000 and who to recover from (admin), paid (admin, after approval).
create or replace function public.crm_shield_decide(p_id uuid, p_decision text, p_amount numeric default null, p_note text default null, p_recover text default 'none') returns jsonb language plpgsql security definer set search_path = public as $$
declare role_ text := public.crm_need_role(); q public.shield_claims; l public.leads; n text := nullif(btrim(coalesce(p_note, '')), ''); rec text := coalesce(nullif(p_recover, ''), 'none');
begin
  if p_decision not in ('approved', 'declined', 'paid') then raise exception 'bad decision' using errcode = '22023'; end if;
  if p_decision <> 'declined' and not public.is_admin() then raise exception 'only the admin approves or pays a claim' using errcode = '42501'; end if;
  select * into q from public.shield_claims where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into l from public.leads where id = q.lead_id;
  if not public.crm_can_see(l, role_) then raise exception 'not allowed' using errcode = '42501'; end if;
  if n is not null and char_length(n) > 300 then raise exception 'note too long' using errcode = '22023'; end if;
  if q.status in ('declined', 'paid') then raise exception 'already closed' using errcode = '22023'; end if;
  if p_decision = 'declined' and n is null then raise exception 'say why' using errcode = '22023'; end if;
  if p_decision = 'approved' then
    if q.status <> 'open' then raise exception 'already approved' using errcode = '22023'; end if;
    if p_amount is null or p_amount <= 0 or p_amount > 5000 then raise exception 'the amount must be from 1 to 5,000' using errcode = '22023'; end if;
    if rec not in ('none', 'garage', 'mechanic') then raise exception 'bad recovery choice' using errcode = '22023'; end if;
    update public.shield_claims set status = 'approved', amount = round(p_amount, 2), recover_from = rec, decision_note = coalesce(n, decision_note), decided_by = auth.uid(), decided_at = now() where id = p_id;
  elsif p_decision = 'paid' then
    if q.status <> 'approved' then raise exception 'approve first' using errcode = '22023'; end if;
    update public.shield_claims set status = 'paid', paid_at = now(), decision_note = coalesce(n, decision_note) where id = p_id;
  else
    update public.shield_claims set status = 'declined', decision_note = n, decided_by = auth.uid(), decided_at = now() where id = p_id;
  end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, auth.uid(), 'note', 'Mechanix Shield claim ' || p_decision || coalesce(': ' || n, ''));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'shield_' || p_decision, jsonb_build_object('lead', l.booking_id, 'claim', p_id, 'amount', p_amount, 'recover_from', rec));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.shield_claim_create(text, text), public.shield_status_get(uuid) from public, anon, authenticated;
grant execute on function public.shield_claim_create(text, text), public.shield_status_get(uuid) to service_role;
revoke all on function public.crm_shield_list(), public.crm_shield_decide(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.crm_shield_list(), public.crm_shield_decide(uuid, text, numeric, text, text) to authenticated;
