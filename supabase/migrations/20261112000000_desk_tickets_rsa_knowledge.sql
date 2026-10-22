-- Care Buddy desk, part 3: tickets, RSA (roadside) cases, playbooks, fitments and SOPs.
-- Agents have no table access; everything is a security definer function that checks crm_can(...) or crm_need_page(...).

-- ───────────────────────── Tickets ─────────────────────────
create table if not exists public.crm_tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  category text not null check (category in ('escalation','booking_issue','roadside','legal_accident','garage_issue','garage_inspection')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved')),
  title text not null check (char_length(title) between 3 and 120),
  body text check (char_length(body) <= 1500),
  legal boolean not null default false,
  lead_id uuid references public.leads(id) on delete set null,
  garage_id uuid references public.garages(id) on delete set null,
  rsa_case_id uuid,
  owner uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz
);
create index if not exists crm_tickets_status_idx on public.crm_tickets (status, created_at desc);
create table if not exists public.crm_ticket_notes (
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.crm_tickets(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null, body text not null check (char_length(body) between 1 and 1000), created_at timestamptz not null default now()
);
alter table public.crm_tickets enable row level security; alter table public.crm_ticket_notes enable row level security;
drop policy if exists crm_tickets_owner on public.crm_tickets; create policy crm_tickets_owner on public.crm_tickets for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists crm_ticket_notes_owner on public.crm_ticket_notes; create policy crm_ticket_notes_owner on public.crm_ticket_notes for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop trigger if exists crm_tickets_touch on public.crm_tickets; create trigger crm_tickets_touch before update on public.crm_tickets for each row execute function public.crm_touch();

-- Can the signed-in person see this ticket? Legal or accident tickets need view_legal_tickets; others need view_all_leads or to be the owner or creator.
create or replace function public.crm_ticket_visible(t public.crm_tickets) returns boolean language sql stable security definer set search_path = public as $$
  select case when t.legal then public.crm_can('view_legal_tickets')
    else public.crm_can('view_all_leads') or t.owner = auth.uid() or t.created_by = auth.uid() end;
$$;

create or replace function public.crm_ticket_create(p_category text, p_title text, p_body text default null, p_priority text default 'normal', p_lead uuid default null, p_garage uuid default null, p_rsa uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nid uuid; ncode text; is_legal boolean := (p_category = 'legal_accident'); pri text := coalesce(p_priority, 'normal'); vwhen timestamptz;
begin
  perform public.crm_need_role(); perform public.crm_need_page('tickets'); perform public.crm_require('create_tickets');
  if p_category not in ('escalation','booking_issue','roadside','legal_accident','garage_issue','garage_inspection') then raise exception 'choose a ticket category' using errcode = 'P0001'; end if;
  if pri not in ('low','normal','high','critical') then raise exception 'unknown priority' using errcode = 'P0001'; end if;
  if char_length(coalesce(trim(p_title), '')) < 3 then raise exception 'give the ticket a short title' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p_title) or public.crm_has_pii(p_body) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the ticket.' using errcode = 'P0001'; end if;
  if p_category in ('garage_issue','garage_inspection') and p_garage is null then raise exception 'pick the garage this ticket is about' using errcode = 'P0001'; end if;
  if is_legal then pri := 'critical'; end if;
  insert into public.crm_tickets (category, priority, title, body, legal, lead_id, garage_id, rsa_case_id, owner, created_by)
  values (p_category, pri, public.crm_clean_text(p_title, 120), public.crm_clean_text(p_body, 1500), is_legal, p_lead, p_garage, p_rsa, case when is_legal then null else auth.uid() end, auth.uid()) returning id, code into nid, ncode;
  if p_category = 'garage_inspection' and public.crm_can('schedule_visits') then
    vwhen := date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours';
    insert into public.garage_visits (garage_id, kind, scheduled_at, address, ticket_id, created_by)
    select p_garage, 'inspection', vwhen at time zone 'Asia/Kolkata', address, nid, auth.uid() from public.garages where id = p_garage and deleted_at is null;
  end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), case when is_legal then 'legal_ticket_created' else 'ticket_created' end, jsonb_build_object('ticket', nid, 'category', p_category));
  return jsonb_build_object('id', nid, 'code', ncode, 'legal', is_legal);
end; $$;

create or replace function public.crm_tickets_list(p_status text default null, p_category text default null, p_mine boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('tickets');
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'category', t.category, 'priority', t.priority, 'status', t.status, 'title', t.title, 'legal', t.legal,
      'owner_id', t.owner, 'owner', public.crm_name(t.owner), 'created_by', public.crm_name(t.created_by), 'created_at', t.created_at, 'updated_at', t.updated_at,
      'lead', (select l.name from public.leads l where l.id = t.lead_id), 'garage', (select g.name from public.garages g where g.id = t.garage_id))
      order by (t.status = 'resolved'), case t.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at desc)
    from public.crm_tickets t
    where public.crm_ticket_visible(t) and (p_status is null or t.status = p_status) and (p_category is null or t.category = p_category) and (not p_mine or t.owner = auth.uid() or t.created_by = auth.uid())), '[]'::jsonb);
end; $$;

create or replace function public.crm_ticket_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.crm_tickets;
begin
  perform public.crm_need_role(); perform public.crm_need_page('tickets');
  select * into t from public.crm_tickets where id = p_id;
  if not found or not public.crm_ticket_visible(t) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ticket', to_jsonb(t) || jsonb_build_object('owner_name', public.crm_name(t.owner), 'created_by_name', public.crm_name(t.created_by)),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'actor', public.crm_name(n.actor), 'created_at', n.created_at) order by n.created_at) from public.crm_ticket_notes n where n.ticket_id = p_id), '[]'::jsonb));
end; $$;

create or replace function public.crm_ticket_note(p_id uuid, p_body text) returns void language plpgsql security definer set search_path = public as $$
declare t public.crm_tickets;
begin
  perform public.crm_need_role(); perform public.crm_need_page('tickets');
  select * into t from public.crm_tickets where id = p_id;
  if not found or not public.crm_ticket_visible(t) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  if char_length(coalesce(trim(p_body), '')) < 1 then raise exception 'write a note' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p_body) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the note.' using errcode = 'P0001'; end if;
  insert into public.crm_ticket_notes (ticket_id, actor, body) values (p_id, auth.uid(), left(trim(p_body), 1000));
  update public.crm_tickets set updated_at = now(), status = case when status = 'waiting' then 'in_progress' else status end where id = p_id;
end; $$;

create or replace function public.crm_ticket_set(p_id uuid, p_status text default null, p_owner uuid default null, p_priority text default null, p_clear_owner boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare t public.crm_tickets;
begin
  perform public.crm_need_role(); perform public.crm_need_page('tickets');
  select * into t from public.crm_tickets where id = p_id for update;
  if not found or not public.crm_ticket_visible(t) then raise exception 'ticket not found' using errcode = 'P0002'; end if;
  if p_status is not null then
    if p_status not in ('open','in_progress','waiting','resolved') then raise exception 'unknown status' using errcode = 'P0001'; end if;
    if p_status = 'resolved' or t.status = 'resolved' then perform public.crm_require('resolve_tickets'); end if;
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high','critical') then raise exception 'unknown priority' using errcode = 'P0001'; end if;
  if p_owner is not null or p_clear_owner then
    perform public.crm_require('assign_leads');
    if p_owner is not null and not exists (select 1 from public.crm_users where user_id = p_owner and active) and not exists (select 1 from public.admins where user_id = p_owner) then raise exception 'that person cannot own tickets' using errcode = 'P0001'; end if;
  end if;
  update public.crm_tickets set status = coalesce(p_status, status), priority = coalesce(p_priority, priority),
    owner = case when p_clear_owner then null else coalesce(p_owner, owner) end,
    resolved_at = case when coalesce(p_status, status) = 'resolved' then coalesce(resolved_at, now()) else null end where id = p_id;
  insert into public.crm_ticket_notes (ticket_id, actor, body) values (p_id, auth.uid(), 'Updated: ' || concat_ws(', ', case when p_status is not null then 'status ' || p_status end, case when p_priority is not null then 'priority ' || p_priority end, case when p_owner is not null then 'owner changed' end));
end; $$;

-- ───────────────────────── RSA cases ─────────────────────────
create table if not exists public.rsa_cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  lead_id uuid references public.leads(id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 2 and 60),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  brand text check (char_length(brand) <= 40), model text check (char_length(model) <= 60), fuel text check (fuel in ('petrol','electric','other')),
  lat numeric check (lat between 12.4 and 13.7), lng numeric check (lng between 77.0 and 78.2), address text check (char_length(address) <= 300),
  problem text not null check (problem in ('puncture','battery','wont_start','chain_or_brake','fuel','overheating','accident','electric_fault','other')),
  details text check (char_length(details) <= 1000),
  rider_safe boolean not null default true, busy_road boolean not null default false, injured boolean not null default false,
  priority text not null default 'normal' check (priority in ('normal','high','critical')),
  eta_minutes integer check (eta_minutes between 5 and 480),
  mechanic_id uuid references public.mechanics(id) on delete set null, garage_id uuid references public.garages(id) on delete set null,
  status text not null default 'new' check (status in ('new','guiding','dispatched','on_the_way','working','resolved_phone','resolved_onsite','towed','cancelled')),
  outcome text check (char_length(outcome) <= 500), ticket_id uuid references public.crm_tickets(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create table if not exists public.rsa_case_events (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.rsa_cases(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null, kind text not null, body text check (char_length(body) <= 600), created_at timestamptz not null default now()
);
alter table public.rsa_cases enable row level security; alter table public.rsa_case_events enable row level security;
drop policy if exists rsa_cases_owner on public.rsa_cases; create policy rsa_cases_owner on public.rsa_cases for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists rsa_events_owner on public.rsa_case_events; create policy rsa_events_owner on public.rsa_case_events for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop trigger if exists rsa_cases_touch on public.rsa_cases; create trigger rsa_cases_touch before update on public.rsa_cases for each row execute function public.crm_touch();
alter table public.crm_tickets drop constraint if exists crm_tickets_rsa_fk;
alter table public.crm_tickets add constraint crm_tickets_rsa_fk foreign key (rsa_case_id) references public.rsa_cases(id) on delete set null;

create or replace function public.crm_rsa_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9]', '', 'g'); nm text := public.crm_clean_text(p ->> 'name', 60); prob text := p ->> 'problem';
  safe boolean := coalesce((p ->> 'rider_safe')::boolean, true); busy boolean := coalesce((p ->> 'busy_road')::boolean, false); hurt boolean := coalesce((p ->> 'injured')::boolean, false) or prob = 'accident';
  v_lat numeric; v_lng numeric; pri text := 'normal'; nid uuid; ncode text; tk jsonb; tid uuid; msgs text[] := '{}';
begin
  perform public.crm_need_role(); perform public.crm_need_page('rsa'); perform public.crm_require('manage_rsa');
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'enter a valid 10 digit mobile number' using errcode = 'P0001'; end if;
  if nm is null or char_length(nm) < 2 then raise exception 'enter the customer name' using errcode = 'P0001'; end if;
  if prob not in ('puncture','battery','wont_start','chain_or_brake','fuel','overheating','accident','electric_fault','other') then raise exception 'choose the problem' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN, bank or card numbers from the case.' using errcode = 'P0001'; end if;
  begin v_lat := nullif(p ->> 'lat', '')::numeric; v_lng := nullif(p ->> 'lng', '')::numeric; exception when others then v_lat := null; v_lng := null; end;
  if (v_lat is null) <> (v_lng is null) or (v_lat is not null and (v_lat not between 12.4 and 13.7 or v_lng not between 77.0 and 78.2)) then raise exception 'the location pin looks wrong' using errcode = 'P0001'; end if;
  if v_lat is null and public.crm_clean_text(p ->> 'address', 300) is null then raise exception 'share the live location or type the address' using errcode = 'P0001'; end if;
  if hurt then pri := 'critical'; elsif not safe or busy then pri := 'high'; end if;
  insert into public.rsa_cases (lead_id, customer_name, mobile, brand, model, fuel, lat, lng, address, problem, details, rider_safe, busy_road, injured, priority, created_by)
  values (nullif(p ->> 'lead_id', '')::uuid, nm, ph, public.crm_clean_text(p ->> 'brand', 40), public.crm_clean_text(p ->> 'model', 60), case when p ->> 'fuel' in ('petrol','electric','other') then p ->> 'fuel' end,
    v_lat, v_lng, public.crm_clean_text(p ->> 'address', 300), prob, public.crm_clean_text(p ->> 'details', 1000), safe, busy, hurt, pri, auth.uid()) returning id, code into nid, ncode;
  insert into public.rsa_case_events (case_id, actor, kind, body) values (nid, auth.uid(), 'created', 'Case opened, priority ' || pri);
  if hurt then
    insert into public.crm_tickets (category, priority, title, body, legal, rsa_case_id, created_by) values ('legal_accident', 'critical', 'Accident or injury on roadside case ' || ncode, public.crm_clean_text(p ->> 'details', 1500), true, nid, auth.uid()) returning id into tid;
    update public.rsa_cases set ticket_id = tid where id = nid;
    insert into public.audit_log (actor, action, details) values (auth.uid(), 'legal_ticket_created', jsonb_build_object('rsa_case', nid, 'ticket', tid));
    msgs := msgs || 'Ask if anyone needs an ambulance. Call 112 for injuries. Do not move an injured rider.'::text;
  end if;
  if not safe or busy then msgs := msgs || 'Ask the rider to move the bike and themselves to a safe place away from traffic first.'::text; end if;
  return jsonb_build_object('id', nid, 'code', ncode, 'priority', pri, 'safety_first', to_jsonb(msgs), 'ticket_id', tid);
end; $$;

create or replace function public.crm_rsa_list(p_status text default null, p_open_only boolean default false) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('rsa');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'customer_name', c.customer_name, 'mobile', c.mobile, 'brand', c.brand, 'model', c.model, 'problem', c.problem, 'priority', c.priority,
      'status', c.status, 'eta_minutes', c.eta_minutes, 'injured', c.injured, 'rider_safe', c.rider_safe, 'address', c.address, 'mechanic', (select m.name from public.mechanics m where m.id = c.mechanic_id), 'created_at', c.created_at)
      order by (c.status in ('resolved_phone','resolved_onsite','towed','cancelled')), case c.priority when 'critical' then 0 when 'high' then 1 else 2 end, c.created_at desc)
    from public.rsa_cases c where (p_status is null or c.status = p_status) and (not p_open_only or c.status not in ('resolved_phone','resolved_onsite','towed','cancelled'))), '[]'::jsonb);
end; $$;

create or replace function public.crm_rsa_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.rsa_cases;
begin
  perform public.crm_need_role(); perform public.crm_need_page('rsa');
  select * into c from public.rsa_cases where id = p_id;
  if not found then raise exception 'case not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('case', to_jsonb(c) || jsonb_build_object('mechanic', (select m.name from public.mechanics m where m.id = c.mechanic_id), 'garage', (select g.name from public.garages g where g.id = c.garage_id)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'actor', public.crm_name(e.actor), 'created_at', e.created_at) order by e.created_at) from public.rsa_case_events e where e.case_id = p_id), '[]'::jsonb),
    'playbooks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title)) from public.crm_playbooks b where b.status = 'published' and c.problem = any (b.problems)), '[]'::jsonb));
end; $$;

create or replace function public.crm_rsa_update(p_id uuid, p_status text default null, p_eta integer default null, p_mechanic uuid default null, p_garage uuid default null, p_outcome text default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.rsa_cases; done boolean; txt text;
begin
  perform public.crm_need_role(); perform public.crm_need_page('rsa'); perform public.crm_require('manage_rsa');
  select * into c from public.rsa_cases where id = p_id for update;
  if not found then raise exception 'case not found' using errcode = 'P0002'; end if;
  if c.closed_at is not null then raise exception 'this case is closed' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('new','guiding','dispatched','on_the_way','working','resolved_phone','resolved_onsite','towed','cancelled') then raise exception 'unknown status' using errcode = 'P0001'; end if;
  if p_eta is not null and (p_eta < 5 or p_eta > 480) then raise exception 'ETA must be between 5 and 480 minutes' using errcode = 'P0001'; end if;
  if (p_mechanic is not null or p_garage is not null) then perform public.crm_require('assign_leads'); end if;
  if p_mechanic is not null and not exists (select 1 from public.mechanics where id = p_mechanic and onboarding_status in ('live','pilot') and active) then raise exception 'that mechanic is not live' using errcode = 'P0001'; end if;
  if p_status in ('dispatched','on_the_way') and coalesce(p_mechanic, c.mechanic_id) is null and coalesce(p_garage, c.garage_id) is null then raise exception 'assign a mechanic or garage before dispatching' using errcode = 'P0001'; end if;
  if p_status in ('dispatched','on_the_way') and coalesce(p_eta, c.eta_minutes) is null then raise exception 'give the customer an ETA first' using errcode = 'P0001'; end if;
  done := p_status in ('resolved_phone','resolved_onsite','towed','cancelled');
  if done and char_length(coalesce(trim(coalesce(p_outcome, c.outcome)), '')) < 3 then raise exception 'write the outcome before closing the case' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p_outcome) or public.crm_has_pii(p_note) then raise exception 'Remove ID or card numbers.' using errcode = 'P0001'; end if;
  update public.rsa_cases set status = coalesce(p_status, status), eta_minutes = coalesce(p_eta, eta_minutes), mechanic_id = coalesce(p_mechanic, mechanic_id), garage_id = coalesce(p_garage, garage_id),
    outcome = coalesce(public.crm_clean_text(p_outcome, 500), outcome), closed_at = case when done then now() else null end where id = p_id;
  txt := concat_ws('; ', case when p_status is not null then 'status ' || p_status end, case when p_eta is not null then 'ETA ' || p_eta || ' min' end, case when p_mechanic is not null then 'mechanic assigned' end, public.crm_clean_text(p_note, 300));
  insert into public.rsa_case_events (case_id, actor, kind, body) values (p_id, auth.uid(), coalesce(p_status, 'update'), nullif(txt, ''));
  return (select status from public.rsa_cases where id = p_id);
end; $$;

-- ───────────────────────── Playbooks, fitments, SOPs ─────────────────────────
create table if not exists public.crm_playbooks (
  id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 3 and 120), problems text[] not null default '{}',
  symptom text check (char_length(symptom) <= 400), safety_note text check (char_length(safety_note) <= 600), ask_first text[] not null default '{}', steps text[] not null default '{}',
  stop_and_dispatch text check (char_length(stop_and_dispatch) <= 600), parts_notes text check (char_length(parts_notes) <= 600), cost_note text check (char_length(cost_note) <= 300),
  safety_critical boolean not null default false, status text not null default 'draft' check (status in ('draft','published','archived')), version integer not null default 1,
  owner uuid references auth.users(id) on delete set null, reviewed_by text check (char_length(reviewed_by) <= 80), review_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.crm_playbook_flags (
  id uuid primary key default gen_random_uuid(), playbook_id uuid not null references public.crm_playbooks(id) on delete cascade, actor uuid references auth.users(id) on delete set null,
  note text check (char_length(note) <= 400), created_at timestamptz not null default now(), resolved boolean not null default false
);
create table if not exists public.fitments (
  id uuid primary key default gen_random_uuid(), brand text not null check (char_length(brand) between 2 and 40), model text not null check (char_length(model) between 1 and 60), part text not null check (char_length(part) between 2 and 60),
  spec text check (char_length(spec) <= 200), alternatives text check (char_length(alternatives) <= 300), oem_notes text check (char_length(oem_notes) <= 300), source text check (char_length(source) <= 200),
  last_checked date, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.crm_sops (
  id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 3 and 120), category text check (char_length(category) <= 40), body text not null check (char_length(body) <= 6000),
  version integer not null default 1, status text not null default 'draft' check (status in ('draft','published','archived')), owner uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
alter table public.crm_playbooks enable row level security; alter table public.crm_playbook_flags enable row level security; alter table public.fitments enable row level security; alter table public.crm_sops enable row level security;
drop policy if exists crm_playbooks_owner on public.crm_playbooks; create policy crm_playbooks_owner on public.crm_playbooks for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists crm_flags_owner on public.crm_playbook_flags; create policy crm_flags_owner on public.crm_playbook_flags for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists fitments_owner on public.fitments; create policy fitments_owner on public.fitments for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists crm_sops_owner on public.crm_sops; create policy crm_sops_owner on public.crm_sops for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop trigger if exists crm_playbooks_touch on public.crm_playbooks; create trigger crm_playbooks_touch before update on public.crm_playbooks for each row execute function public.crm_touch();
drop trigger if exists crm_sops_touch on public.crm_sops; create trigger crm_sops_touch before update on public.crm_sops for each row execute function public.crm_touch();

create or replace function public.crm_playbooks_list(p_search text default null, p_problem text default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), ''); editor boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('knowledge'); editor := public.crm_can('edit_knowledge');
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'problems', b.problems, 'symptom', b.symptom, 'safety_critical', b.safety_critical, 'status', b.status, 'version', b.version,
      'reviewed_by', b.reviewed_by, 'review_date', b.review_date, 'open_flags', (select count(*) from public.crm_playbook_flags f where f.playbook_id = b.id and not f.resolved)) order by b.title)
    from public.crm_playbooks b where (b.status = 'published' or (editor and b.status <> 'archived')) and (p_problem is null or p_problem = any (b.problems))
      and (q is null or b.title ilike '%' || q || '%' or b.symptom ilike '%' || q || '%')), '[]'::jsonb);
end; $$;

create or replace function public.crm_playbook_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.crm_playbooks; editor boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('knowledge'); editor := public.crm_can('edit_knowledge');
  select * into b from public.crm_playbooks where id = p_id;
  if not found or (b.status <> 'published' and not editor) then raise exception 'playbook not found' using errcode = 'P0002'; end if;
  return to_jsonb(b) - 'owner';
end; $$;

create or replace function public.crm_playbook_save(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid := nullif(p ->> 'id', '')::uuid; probs text[]; x text; nid uuid; asks text[]; stp text[];
begin
  perform public.crm_need_role(); perform public.crm_require('edit_knowledge');
  if char_length(coalesce(trim(p ->> 'title'), '')) < 3 then raise exception 'give the playbook a title' using errcode = 'P0001'; end if;
  probs := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'problems') = 'array' then p -> 'problems' else '[]'::jsonb end)), '{}');
  foreach x in array probs loop if x not in ('puncture','battery','wont_start','chain_or_brake','fuel','overheating','accident','electric_fault','other') then raise exception 'unknown problem type: %', left(x, 20) using errcode = 'P0001'; end if; end loop;
  asks := coalesce(array(select left(jsonb_array_elements_text(case when jsonb_typeof(p -> 'ask_first') = 'array' then p -> 'ask_first' else '[]'::jsonb end), 200)), '{}');
  stp := coalesce(array(select left(jsonb_array_elements_text(case when jsonb_typeof(p -> 'steps') = 'array' then p -> 'steps' else '[]'::jsonb end), 300)), '{}');
  if cardinality(stp) > 20 then raise exception 'keep a playbook to 20 steps' using errcode = 'P0001'; end if;
  if pid is null then
    insert into public.crm_playbooks (title, problems, symptom, safety_note, ask_first, steps, stop_and_dispatch, parts_notes, cost_note, safety_critical, owner)
    values (public.crm_clean_text(p ->> 'title', 120), probs, public.crm_clean_text(p ->> 'symptom', 400), public.crm_clean_text(p ->> 'safety_note', 600), asks, stp, public.crm_clean_text(p ->> 'stop_and_dispatch', 600),
      public.crm_clean_text(p ->> 'parts_notes', 600), public.crm_clean_text(p ->> 'cost_note', 300), coalesce((p ->> 'safety_critical')::boolean, false), auth.uid()) returning crm_playbooks.id into nid;
  else
    -- Any edit sends a published playbook back to draft: it must be reviewed again before agents see it
    update public.crm_playbooks set title = public.crm_clean_text(p ->> 'title', 120), problems = probs, symptom = public.crm_clean_text(p ->> 'symptom', 400), safety_note = public.crm_clean_text(p ->> 'safety_note', 600),
      ask_first = asks, steps = stp, stop_and_dispatch = public.crm_clean_text(p ->> 'stop_and_dispatch', 600), parts_notes = public.crm_clean_text(p ->> 'parts_notes', 600), cost_note = public.crm_clean_text(p ->> 'cost_note', 300),
      safety_critical = coalesce((p ->> 'safety_critical')::boolean, safety_critical), status = 'draft', version = version + 1, reviewed_by = null, review_date = null
    where crm_playbooks.id = pid returning crm_playbooks.id into nid;
    if nid is null then raise exception 'playbook not found' using errcode = 'P0002'; end if;
  end if;
  return nid;
end; $$;

create or replace function public.crm_playbook_publish(p_id uuid, p_reviewed_by text default null, p_review_months integer default 6) returns void language plpgsql security definer set search_path = public as $$
declare b public.crm_playbooks; rv text := public.crm_clean_text(p_reviewed_by, 80);
begin
  perform public.crm_need_role(); perform public.crm_require('review_knowledge');
  select * into b from public.crm_playbooks where id = p_id for update;
  if not found then raise exception 'playbook not found' using errcode = 'P0002'; end if;
  if cardinality(b.steps) = 0 then raise exception 'add the steps before publishing' using errcode = 'P0001'; end if;
  if b.safety_critical and (rv is null or b.safety_note is null) then raise exception 'a safety-critical playbook needs a safety note and the name of the technical head who reviewed it' using errcode = 'P0001'; end if;
  update public.crm_playbooks set status = 'published', reviewed_by = coalesce(rv, reviewed_by, public.crm_name(auth.uid())), review_date = current_date + (greatest(1, least(coalesce(p_review_months, 6), 24)) * 30) where id = p_id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'playbook_published', jsonb_build_object('playbook', p_id));
end; $$;

create or replace function public.crm_playbook_flag(p_id uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_need_role(); perform public.crm_need_page('knowledge');
  if not exists (select 1 from public.crm_playbooks where id = p_id and status = 'published') then raise exception 'playbook not found' using errcode = 'P0002'; end if;
  insert into public.crm_playbook_flags (playbook_id, actor, note) values (p_id, auth.uid(), public.crm_clean_text(p_note, 400));
end; $$;

create or replace function public.crm_fitments_list(p_search text default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(p_search), '');
begin
  perform public.crm_need_role(); perform public.crm_need_page('knowledge');
  return coalesce((select jsonb_agg(to_jsonb(f) - 'created_by' order by f.brand, f.model, f.part) from public.fitments f
    where q is null or f.brand ilike '%' || q || '%' or f.model ilike '%' || q || '%' or f.part ilike '%' || q || '%'), '[]'::jsonb);
end; $$;

create or replace function public.crm_fitment_save(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid := nullif(p ->> 'id', '')::uuid; nid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_knowledge');
  if char_length(coalesce(trim(p ->> 'brand'), '')) < 2 or char_length(coalesce(trim(p ->> 'model'), '')) < 1 or char_length(coalesce(trim(p ->> 'part'), '')) < 2 then raise exception 'brand, model and part are required' using errcode = 'P0001'; end if;
  if fid is null then
    insert into public.fitments (brand, model, part, spec, alternatives, oem_notes, source, last_checked, created_by) values (public.crm_clean_text(p ->> 'brand', 40), public.crm_clean_text(p ->> 'model', 60), public.crm_clean_text(p ->> 'part', 60),
      public.crm_clean_text(p ->> 'spec', 200), public.crm_clean_text(p ->> 'alternatives', 300), public.crm_clean_text(p ->> 'oem_notes', 300), public.crm_clean_text(p ->> 'source', 200), nullif(p ->> 'last_checked', '')::date, auth.uid()) returning fitments.id into nid;
  else
    update public.fitments set brand = public.crm_clean_text(p ->> 'brand', 40), model = public.crm_clean_text(p ->> 'model', 60), part = public.crm_clean_text(p ->> 'part', 60), spec = public.crm_clean_text(p ->> 'spec', 200),
      alternatives = public.crm_clean_text(p ->> 'alternatives', 300), oem_notes = public.crm_clean_text(p ->> 'oem_notes', 300), source = public.crm_clean_text(p ->> 'source', 200), last_checked = nullif(p ->> 'last_checked', '')::date
    where fitments.id = fid returning fitments.id into nid;
    if nid is null then raise exception 'fitment not found' using errcode = 'P0002'; end if;
  end if;
  return nid;
end; $$;

create or replace function public.crm_sops_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare editor boolean;
begin
  perform public.crm_need_role(); perform public.crm_need_page('knowledge'); editor := public.crm_can('edit_knowledge');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'category', s.category, 'body', s.body, 'version', s.version, 'status', s.status, 'updated_at', s.updated_at) order by s.category, s.title)
    from public.crm_sops s where s.status = 'published' or (editor and s.status = 'draft')), '[]'::jsonb);
end; $$;

create or replace function public.crm_sop_save(p_id uuid, p_title text, p_category text, p_body text, p_publish boolean default false) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public.crm_need_role(); perform public.crm_require('edit_knowledge');
  if p_publish then perform public.crm_require('review_knowledge'); end if;
  if char_length(coalesce(trim(p_title), '')) < 3 or char_length(coalesce(trim(p_body), '')) < 10 then raise exception 'a SOP needs a title and some text' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p_body) then raise exception 'Remove ID or card numbers.' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.crm_sops (title, category, body, status, owner) values (public.crm_clean_text(p_title, 120), public.crm_clean_text(p_category, 40), left(trim(p_body), 6000), case when p_publish then 'published' else 'draft' end, auth.uid()) returning crm_sops.id into nid;
  else
    update public.crm_sops set title = public.crm_clean_text(p_title, 120), category = public.crm_clean_text(p_category, 40), body = left(trim(p_body), 6000), version = version + 1, status = case when p_publish then 'published' else 'draft' end
    where crm_sops.id = p_id returning crm_sops.id into nid;
    if nid is null then raise exception 'SOP not found' using errcode = 'P0002'; end if;
  end if;
  return nid;
end; $$;

-- ───────────────────────── Starter playbooks: DRAFTS only, hidden from agents until a technical head reviews and publishes them ─────────────────────────
insert into public.crm_playbooks (title, problems, symptom, safety_note, ask_first, steps, stop_and_dispatch, parts_notes, cost_note, safety_critical, status)
select * from (values
 ('Puncture on the road', array['puncture'], 'Tyre is flat or the bike wobbles and pulls to one side.', 'Do not ride on a flat tyre. Move the bike off the road before anything else.',
   array['Are you and the bike away from traffic?','Is it the front or rear tyre?','Tubeless or tube tyre?'], array['Ask the rider to stop and park on level ground away from traffic.','Ask if there is a nail or sharp object visible in the tyre.','If tubeless and the object is still in, tell them not to pull it out.','Share the nearest puncture shop if within 1 km, otherwise dispatch a mechanic.'], 'Dispatch if the tyre is off the rim, the sidewall is cut or the rider is on a highway.', 'Tube, tubeless plug kit, valve.', 'Use the Mechanix price list for puncture repair.', true, 'draft'),
 ('Bike will not start', array['wont_start'], 'Starter does nothing, clicks or cranks without firing.', 'Never kick-start or crank for long with fuel smell. Keep away from open flame.',
   array['Is the fuel indicator above reserve?','Do the lights and horn work?','Is the kill switch off and the side stand up?','Did it start yesterday?'], array['Check the kill switch is on RUN and the stand is up.','Press the brake or clutch fully while pressing the starter.','If lights and horn are weak, the battery is the likely cause, offer a jump-start visit.','If lights are fine but it will not fire, stop cranking after 5 seconds and wait a minute.'], 'Dispatch if there is a fuel smell, smoke, or two retries have failed.', 'Battery, spark plug, fuel filter.', 'Diagnosis is covered by the visit fee.', true, 'draft'),
 ('Battery dead, jump-start needed', array['battery'], 'Dim lights, weak horn, clicking sound.', 'Only a trained mechanic should jump-start. Do not let the customer connect cables.',
   array['Is it a petrol or electric bike?','How old is the battery?','Any recent long parking?'], array['Confirm it is not an electric bike. Electric bikes are never jump-started.','Offer a doorstep visit with a jump-starter.','Advise the rider not to keep pressing the starter.'], 'Always dispatch. Do not guide a jump-start over the phone.', 'Battery replacement, charging system check.', 'Use the Mechanix price list.', true, 'draft'),
 ('Ran out of fuel', array['fuel'], 'Engine sputters and dies, fuel needle at empty.', 'Do not carry petrol in a bottle on a bike. Keep away from open flame.',
   array['Is the bike safe and off the road?','Is a petrol pump within walking distance?'], array['Ask the rider to move the bike to a safe spot.','If a pump is within 1 km, suggest they walk with an approved can, or offer a fuel-delivery visit.','Remind them to switch to reserve next time.'], 'Dispatch if there is no pump nearby or the rider is on a highway.', 'Fuel only.', 'Fuel cost plus visit fee.', false, 'draft'),
 ('Engine overheating or smoke', array['overheating'], 'Temperature warning, burning smell, or smoke from the engine.', 'Switch the engine off at once. Do not open any cap while hot. Keep the rider away from the bike if there is smoke.',
   array['Is there smoke or a burning smell?','When did it start?','Is oil or coolant leaking?'], array['Tell the rider to switch off the engine and stand away from the bike.','Wait at least 20 minutes before touching anything.','Do not ride on.'], 'Always dispatch or arrange a tow. Do not guide a restart.', 'Coolant, oil, radiator, fan.', 'Diagnosis at the visit.', true, 'draft')
) as v(title, problems, symptom, safety_note, ask_first, steps, stop_and_dispatch, parts_notes, cost_note, safety_critical, status)
where not exists (select 1 from public.crm_playbooks);

do $$ declare f text; begin
  for f in select unnest(array['crm_ticket_visible(public.crm_tickets)','crm_ticket_create(text,text,text,text,uuid,uuid,uuid)','crm_tickets_list(text,text,boolean)','crm_ticket_get(uuid)','crm_ticket_note(uuid,text)',
    'crm_ticket_set(uuid,text,uuid,text,boolean)','crm_rsa_create(jsonb)','crm_rsa_list(text,boolean)','crm_rsa_get(uuid)','crm_rsa_update(uuid,text,integer,uuid,uuid,text,text)','crm_playbooks_list(text,text)',
    'crm_playbook_get(uuid)','crm_playbook_save(jsonb)','crm_playbook_publish(uuid,text,integer)','crm_playbook_flag(uuid,text)','crm_fitments_list(text)','crm_fitment_save(jsonb)','crm_sops_list()','crm_sop_save(uuid,text,text,text,boolean)']) loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
