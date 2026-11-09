-- Mechanix Shield monthly cap: total approved claims in a month cannot pass the setting shield_cap (default Rs 50,000; the admin changes it). Additive.
-- Rollback: re-run crm_shield_decide from 20270125000000_shield_claims.sql; drop function public.crm_shield_month(), public.crm_shield_cap_set(numeric); delete from public.settings where key = 'shield_cap';
insert into public.settings (key, value) values ('shield_cap', '{"monthly": 50000}'::jsonb) on conflict (key) do nothing;

-- Admin only: the cap and what has been approved this month.
create or replace function public.crm_shield_month() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cap numeric; used numeric;
begin
  perform public.crm_need_role();
  if not public.is_admin() then return null; end if;
  select coalesce((value ->> 'monthly')::numeric, 50000) into cap from public.settings where key = 'shield_cap';
  select coalesce(sum(amount), 0) into used from public.shield_claims where status in ('approved', 'paid')
     and date_trunc('month', decided_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata');
  return jsonb_build_object('cap', coalesce(cap, 50000), 'used', used);
end $$;

create or replace function public.crm_shield_cap_set(p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role();
  if not public.is_admin() then raise exception 'only the admin changes the cap' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 5000 or p_amount > 1000000 then raise exception 'the cap must be from 5,000 to 10,00,000' using errcode = '22023'; end if;
  insert into public.settings (key, value, updated_at) values ('shield_cap', jsonb_build_object('monthly', round(p_amount, 0)), now()) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'shield_cap_set', jsonb_build_object('monthly', round(p_amount, 0)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.crm_shield_decide(p_id uuid, p_decision text, p_amount numeric default null, p_note text default null, p_recover text default 'none') returns jsonb language plpgsql security definer set search_path = public as $$
declare role_ text := public.crm_need_role(); q public.shield_claims; l public.leads; n text := nullif(btrim(coalesce(p_note, '')), ''); rec text := coalesce(nullif(p_recover, ''), 'none'); cap numeric; used numeric;
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
    -- Monthly cap on what the company pays out in Shield claims (setting shield_cap, rupees; India time month).
    select coalesce((value ->> 'monthly')::numeric, 50000) into cap from public.settings where key = 'shield_cap';
    cap := coalesce(cap, 50000);
    select coalesce(sum(amount), 0) into used from public.shield_claims where status in ('approved', 'paid') and id <> p_id
       and date_trunc('month', decided_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata');
    if used + round(p_amount, 2) > cap then raise exception 'this would pass the monthly Shield cap of % (already approved this month: %)', cap, used using errcode = '22023'; end if;
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

revoke all on function public.crm_shield_month(), public.crm_shield_cap_set(numeric) from public, anon;
grant execute on function public.crm_shield_month(), public.crm_shield_cap_set(numeric) to authenticated;
