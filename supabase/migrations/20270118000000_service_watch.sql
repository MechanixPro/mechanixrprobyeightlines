-- Service Watch: every paid job that is stuck or at risk, one list. Read-only; no table or column changes. Rollback: drop function public.crm_service_watch();
-- Scope like the Follow-ups lists: supervisors, admins and the Technician lead see all; an agent sees only leads they own. Phones of technician and garage and the amount: supervisors/technician lead/admin; amount admin only.
-- Rules (minutes = how long it has been stuck, from the stage time that exists): not_accepted (garage_assignments 'sent' 5/15 min), late_for_slot (slot start passed, no arrival; 60 min = red),
-- code_pending (arrived, start code not verified, 15 min), quote_not_sent (work stage, no sent quote, 30 min), quote_waiting (sent, undecided, 2 h / 24 h), no_eta (at garage or picked up, no ETA anywhere),
-- ready_not_requested (ready, no final link, no payment, 30 min), payment_pending (final link made, unpaid, 24 h / 48 h after ready), delivered_no_proof (returned, no payment mark or no verified return photos).
-- Known gaps: a mechanic's acceptance and the time the final link was made are not stored, so mechanic not_accepted is skipped and payment_pending counts from the ready time.
create or replace function public.crm_service_watch() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean; adm boolean; techlead boolean; now_ist timestamp := now() at time zone 'Asia/Kolkata';
begin
  perform public.crm_need_role(); perform public.crm_need_page('leads');
  adm := coalesce(public.is_admin(), false); techlead := coalesce(public.crm_can('assign_leads'), false) or coalesce(public.crm_can('manage_technicians'), false);
  boss := coalesce(public.crm_can('view_all_leads'), false) or adm or techlead;
  return coalesce((select jsonb_agg(x.j order by (x.j ->> 'severity') = 'amber', (x.j ->> 'minutes')::int desc) from (
    with b as (
      select l.id, l.ref, l.name, l.phone, l.area, l.vehicle, s.name as svc, l.preferred_date, l.preferred_slot, l.status, l.visit_stage, l.visit_stage_at, l.final_link_id, l.final_paid_at, l.final_link_amount, l.est_total, l.job_place, l.place, l.confirm_fee,
        m.name as mech_name, m.phone as mech_phone, g.name as garage_name, g.mobile as garage_phone, g.id as garage_id, ga.status as ga_status, ga.assigned_at, ga.received_at, ga.ready_at, ga.returned_at, ga.eta as ga_eta,
        q.status as q_status, q.sent_at as q_sent_at, (q.eta_hours is not null or q.eta_date is not null) as q_eta,
        exists (select 1 from public.garage_estimates e where e.assignment_id = ga.id and e.return_day is not null and e.status <> 'rejected') as est_eta,
        exists (select 1 from public.job_quotes jq where jq.lead_id = l.id and jq.sent_at is not null) as quote_ever_sent,
        exists (select 1 from public.handovers h where h.lead_id = l.id and h.kind = 'start' and h.verified_at is not null) as code_ok,
        exists (select 1 from public.handovers h where h.lead_id = l.id and h.kind = 'return' and h.verified_at is not null and coalesce(array_length(h.photo_paths, 1), 0) > 0) as proof_ok,
        case l.preferred_slot when 'morning' then 9 when 'afternoon' then 12 when 'evening' then 16 end as slot_hour
      from public.leads l
      left join public.services s on s.id = l.service_id left join public.mechanics m on m.id = l.mechanic_id
      left join public.garage_assignments ga on ga.lead_id = l.id and ga.status in ('sent','received','in_work','ready','returned') and (ga.status <> 'returned' or ga.returned_at >= now() - interval '7 days')
      left join public.garages g on g.id = ga.garage_id
      left join lateral (select * from public.job_quotes jq where jq.lead_id = l.id and jq.status <> 'draft' order by jq.version desc limit 1) q on true
      where l.deleted_at is null and l.status in ('paid','scheduled','completed') and l.created_at >= now() - interval '30 days'
        and (boss or coalesce(l.crm_owner = me, false))
    ), r as (
      select 'not_accepted' as rule, case when extract(epoch from now() - assigned_at) >= 900 then 'red' else 'amber' end as sev, round(extract(epoch from now() - assigned_at) / 60)::int as mins, 'Sent to the garage, not opened yet' as detail, b.* from b
        where ga_status = 'sent' and assigned_at <= now() - interval '5 minutes'
      union all select 'late_for_slot', case when (now_ist - (preferred_date + make_interval(hours => slot_hour))) >= interval '60 minutes' then 'red' else 'amber' end,
        round(extract(epoch from now_ist - (preferred_date + make_interval(hours => slot_hour))) / 60)::int, 'Slot started and the technician has not marked arrived', b.* from b
        where mech_name is not null and ga_status is null and coalesce(visit_stage, '') in ('', 'on_the_way') and slot_hour is not null and now_ist > preferred_date + make_interval(hours => slot_hour) and now_ist < preferred_date + interval '1 day'
      union all select 'code_pending', 'red', round(extract(epoch from now() - visit_stage_at) / 60)::int, 'Technician arrived, customer code not verified', b.* from b
        where visit_stage = 'arrived' and not code_ok and visit_stage_at <= now() - interval '15 minutes'
      union all select 'quote_not_sent', 'amber', round(extract(epoch from now() - visit_stage_at) / 60)::int, 'Work stage reached, no quote sent', b.* from b
        where visit_stage in ('started','repair_doorstep','picked_up','ready') and confirm_fee is not null and not quote_ever_sent and visit_stage_at <= now() - interval '30 minutes'
      union all select 'quote_waiting', case when q_sent_at <= now() - interval '24 hours' then 'red' else 'amber' end, round(extract(epoch from now() - q_sent_at) / 60)::int, 'Quote sent, customer has not decided', b.* from b
        where q_status = 'sent' and q_sent_at <= now() - interval '2 hours'
      union all select 'no_eta', 'red', round(extract(epoch from now() - coalesce(received_at, visit_stage_at)) / 60)::int, 'Vehicle at the garage, no estimated completion date', b.* from b
        where (ga_status in ('received','in_work') or visit_stage = 'picked_up') and ga_eta is null and not q_eta and not est_eta
      union all select 'ready_not_requested', 'amber', round(extract(epoch from now() - coalesce(ready_at, visit_stage_at)) / 60)::int, 'Ready, no payment link or payment', b.* from b
        where (ga_status = 'ready' or visit_stage = 'ready') and final_link_id is null and final_paid_at is null and coalesce(ready_at, visit_stage_at) <= now() - interval '30 minutes'
      union all select 'payment_pending', case when coalesce(ready_at, visit_stage_at) <= now() - interval '48 hours' then 'red' else 'amber' end, round(extract(epoch from now() - coalesce(ready_at, visit_stage_at)) / 60)::int, 'Payment link made, not paid', b.* from b
        where final_link_id is not null and final_paid_at is null and coalesce(ready_at, visit_stage_at) <= now() - interval '24 hours'
      union all select 'delivered_no_proof', 'red', round(extract(epoch from now() - coalesce(returned_at, visit_stage_at)) / 60)::int, case when final_paid_at is null then 'Delivered, no payment mark' else 'Delivered, no verified delivery photo' end, b.* from b
        where (visit_stage = 'returned' or ga_status = 'returned') and coalesce(returned_at, visit_stage_at) >= now() - interval '7 days'
          and (final_paid_at is null or ((job_place = 'garage' or place = 'pickup' or ga_status = 'returned') and not proof_ok))
    )
    select jsonb_build_object('rule', r.rule, 'severity', r.sev, 'lead_id', r.id, 'ref', r.ref, 'name', r.name, 'phone', r.phone, 'area', r.area,
      'vehicle_service', trim(coalesce(r.vehicle, '') || ' ' || coalesce(r.svc, '')), 'slot', nullif(trim(coalesce(r.preferred_date::text, '') || ' ' || coalesce(r.preferred_slot, '')), ''),
      'minutes', greatest(0, r.mins), 'detail', r.detail, 'mechanic_name', r.mech_name, 'garage_name', r.garage_name, 'garage_id', case when boss then r.garage_id end,
      'technician_phone', case when boss then r.mech_phone end, 'garage_phone', case when boss then r.garage_phone end,
      'amount', case when adm then coalesce(r.final_link_amount, r.est_total) end,
      'paid', r.final_paid_at is not null, 'payment_requested', r.final_link_id is not null) as j from r
  ) x), '[]'::jsonb);
end; $$;
revoke all on function public.crm_service_watch() from public, anon;
grant execute on function public.crm_service_watch() to authenticated;
