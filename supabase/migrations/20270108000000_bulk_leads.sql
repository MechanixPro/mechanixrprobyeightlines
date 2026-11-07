-- Bulk lead actions (max 100 ids). Same permission checks as the per-lead RPCs:
--   assign : crm_need_role() + crm_require('assign_leads')   (as crm_assign / crm_assign_many)
--   status/snooze : crm_need_role() + crm_require('edit_leads'); a caller without view_all_leads may only touch leads they own (as crm_log)
-- Each lead is handled on its own: a lead that cannot be changed is counted as skipped, never aborts the batch.
-- One crm_activities row per changed lead. Returns {done, skipped}.

create or replace function public.crm_bulk_assign(p_ids uuid[], p_owner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i uuid; done int := 0; skipped int := 0; n int;
begin
  perform public.crm_need_role(); perform public.crm_require('assign_leads');
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'select at least one lead' using errcode = 'P0001'; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'select at most 100 leads' using errcode = 'P0001'; end if;
  if p_owner is not null and not exists (select 1 from public.crm_users where user_id = p_owner and active) and not exists (select 1 from public.admins where user_id = p_owner) then
    raise exception 'that person is not an active team member' using errcode = 'P0001';
  end if;
  foreach i in array (select array(select distinct unnest(p_ids))) loop
    update public.leads set crm_owner = p_owner where id = i and deleted_at is null and crm_owner is distinct from p_owner;
    get diagnostics n = row_count;
    if n = 0 then skipped := skipped + 1; continue; end if;
    insert into public.crm_activities (lead_id, actor, kind, body)
      values (i, auth.uid(), 'assign', case when p_owner is null then 'Moved back to the unassigned queue (bulk)' else 'Assigned to ' || coalesce(public.crm_name(p_owner), 'a team member') || ' (bulk)' end);
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end; $$;

create or replace function public.crm_bulk_status(p_ids uuid[], p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i uuid; l public.leads; done int := 0; skipped int := 0; reason text := nullif(trim(p_reason), '');
  ranks constant text[] := array['new','contacted','quoted','payment_sent'];
  lost_reason text;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_leads');
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'select at least one lead' using errcode = 'P0001'; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'select at most 100 leads' using errcode = 'P0001'; end if;
  if not (p_status = 'lost' or p_status = any (ranks)) then raise exception 'agents cannot set that status; payment sets it' using errcode = 'P0001'; end if;
  if p_status = 'lost' and reason is null then raise exception 'a reason is required for Lost' using errcode = 'P0001'; end if;
  if reason is not null and (char_length(reason) > 300 or public.crm_has_pii(reason)) then
    raise exception 'reason is too long or contains sensitive numbers' using errcode = 'P0001';
  end if;
  lost_reason := case when reason = any (public.crm_lost_reasons()) then reason else 'Other' end;
  foreach i in array (select array(select distinct unnest(p_ids))) loop
    select * into l from public.leads where id = i and deleted_at is null for update;
    if not found
       or l.status = p_status
       or l.status in ('paid','scheduled','completed')
       or (not public.crm_can('view_all_leads') and l.crm_owner is distinct from auth.uid())
       or (l.status = 'lost' and p_status = any (ranks) and public.crm_need_role() <> 'supervisor')
       or (p_status = any (ranks) and l.status = any (ranks) and array_position(ranks, p_status) < array_position(ranks, l.status))
    then skipped := skipped + 1; continue; end if;
    update public.leads set
      status = p_status,
      crm_next_action_at = case when p_status = 'lost' then null else crm_next_action_at end,
      crm_lost_reason = case when p_status = 'lost' then lost_reason else null end,
      crm_first_contact_at = coalesce(crm_first_contact_at, now())
    where id = i;
    insert into public.crm_activities (lead_id, actor, kind, body, status_to)
      values (i, auth.uid(), 'status', concat_ws(' · ', case when p_status = 'lost' then 'Lost: ' || lost_reason end, case when p_status = 'lost' and lost_reason = 'Other' then reason end, 'Bulk update'), p_status);
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end; $$;

create or replace function public.crm_bulk_snooze(p_ids uuid[], p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i uuid; l public.leads; done int := 0; skipped int := 0; nxt timestamptz;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_leads');
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'select at least one lead' using errcode = 'P0001'; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'select at most 100 leads' using errcode = 'P0001'; end if;
  if p_days is null or p_days < 1 or p_days > 3 then raise exception 'snooze must be 1 to 3 days' using errcode = 'P0001'; end if;
  foreach i in array (select array(select distinct unnest(p_ids))) loop
    select * into l from public.leads where id = i and deleted_at is null for update;
    if not found
       or l.status not in ('new','contacted','quoted','payment_sent')
       or (not public.crm_can('view_all_leads') and l.crm_owner is distinct from auth.uid())
    then skipped := skipped + 1; continue; end if;
    nxt := greatest(coalesce(l.crm_next_action_at, now()), now()) + make_interval(days => p_days);
    update public.leads set crm_next_action_at = nxt where id = i;
    insert into public.crm_activities (lead_id, actor, kind, body)
      values (i, auth.uid(), 'note', 'Snoozed ' || p_days || ' day' || case when p_days = 1 then '' else 's' end || ' · Next: ' || to_char(nxt at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') || ' (bulk)');
    done := done + 1;
  end loop;
  return jsonb_build_object('done', done, 'skipped', skipped);
end; $$;

revoke all on function public.crm_bulk_assign(uuid[], uuid), public.crm_bulk_status(uuid[], text, text), public.crm_bulk_snooze(uuid[], int) from public, anon;
grant execute on function public.crm_bulk_assign(uuid[], uuid), public.crm_bulk_status(uuid[], text, text), public.crm_bulk_snooze(uuid[], int) to authenticated;
