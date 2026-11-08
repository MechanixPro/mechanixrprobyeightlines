-- Mechanic offer: the mechanic accepts or declines a newly assigned job in the app. Additive only.
-- Rollback: drop trigger if exists leads_mech_assigned on public.leads; drop function if exists public.leads_mech_assigned_fn(), public.mechanic_offer_accept(uuid, uuid), public.mechanic_offer_decline(uuid, uuid, text);
--           alter table public.leads drop column if exists mechanic_accepted_at, drop column if exists mechanic_assigned_at;
alter table public.leads add column if not exists mechanic_assigned_at timestamptz;
alter table public.leads add column if not exists mechanic_accepted_at timestamptz;

-- When a booking is (re)assigned to a mechanic, stamp the time and clear any earlier acceptance so the new mechanic gets an offer.
create or replace function public.leads_mech_assigned_fn() returns trigger language plpgsql as $$
begin
  if new.mechanic_id is not null and new.mechanic_id is distinct from old.mechanic_id then
    new.mechanic_assigned_at := now(); new.mechanic_accepted_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists leads_mech_assigned on public.leads;
create trigger leads_mech_assigned before update of mechanic_id on public.leads for each row execute function public.leads_mech_assigned_fn();

-- Accept: only the assigned mechanic, only an open job, idempotent (the first time stays).
create or replace function public.mechanic_offer_accept(p_mechanic uuid, p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead and deleted_at is null for update;
  if not found or l.mechanic_id is distinct from p_mechanic or l.status not in ('paid','scheduled') then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if l.mechanic_accepted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.leads set mechanic_accepted_at = now() where id = l.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Mechanic accepted');
  insert into public.audit_log (action, details) values ('mechanic_accepted', jsonb_build_object('lead', l.ref, 'mechanic', p_mechanic));
  return jsonb_build_object('ok', true, 'already', false);
end; $$;

-- Decline: records it for Crew only. Never unassigns; Crew decides.
create or replace function public.mechanic_offer_decline(p_mechanic uuid, p_lead uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; r text := left(btrim(coalesce(p_reason, '')), 200);
begin
  select * into l from public.leads where id = p_lead and deleted_at is null;
  if not found or l.mechanic_id is distinct from p_mechanic or l.status not in ('paid','scheduled') then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  insert into public.crm_activities (lead_id, actor, kind, body) values (l.id, null, 'note', 'Mechanic cannot take this job' || case when r <> '' then ': ' || r else '' end);
  insert into public.audit_log (action, details) values ('mechanic_declined', jsonb_build_object('lead', l.ref, 'mechanic', p_mechanic, 'reason', r));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.mechanic_offer_accept(uuid, uuid), public.mechanic_offer_decline(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mechanic_offer_accept(uuid, uuid), public.mechanic_offer_decline(uuid, uuid, text) to service_role;
