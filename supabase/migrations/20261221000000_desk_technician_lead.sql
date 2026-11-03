-- Desk: the Technician lead (Mubarak) runs the technician network.
-- New permission manage_technicians: set the technician on any booking, see the technician board and unstaffed jobs, without assign_leads (which also moves leads between Care Buddies).
-- New designation tech_lead with its own preset. The 6-digit PIN already written in each technician's name becomes their first service PIN.

alter table public.crm_users drop constraint if exists crm_users_designation_check;
alter table public.crm_users add constraint crm_users_designation_check check (designation in ('sales','support','tech_lead'));

create or replace function public.crm_actions() returns text[] language sql immutable as $$
  select array['view_all_leads','assign_leads','take_leads','add_leads','edit_leads','delete_leads','create_bookings','edit_targets','manage_users',
    'view_attribution','view_team_performance','send_payment_link','create_coupons','edit_price_list','view_reports','export','close_chats',
    'create_tickets','resolve_tickets','view_legal_tickets','manage_rsa','schedule_visits','manage_garages','view_garage_bank','manage_mechanics',
    'edit_knowledge','review_knowledge','manage_technicians'];
$$;

create or replace function public.crm_preset(p_role text, p_designation text default null) returns jsonb language plpgsql immutable as $$
declare pages text[]; acts text[]; r jsonb := jsonb_build_object('pages', '{}'::jsonb, 'actions', '{}'::jsonb); x text; role text := coalesce(p_role, 'sales');
begin
  if role = 'supervisor' then pages := public.crm_pages(); acts := public.crm_actions();
  elsif p_designation = 'tech_lead' then
    pages := array['dashboard','leads','mechanics','garages'];
    acts := array['view_all_leads','edit_leads','manage_mechanics','manage_technicians'];
  elsif coalesce(p_designation, role) = 'support' or role = 'support' then
    pages := array['dashboard','inbox','leads','rsa','tickets','knowledge','garage_visits'];
    acts := array['take_leads','add_leads','edit_leads','create_bookings','close_chats','create_tickets','resolve_tickets','manage_rsa'];
  else
    pages := array['dashboard','inbox','leads','tickets','knowledge'];
    acts := array['take_leads','add_leads','edit_leads','create_bookings','close_chats','create_tickets','send_payment_link'];
  end if;
  foreach x in array public.crm_pages() loop r := jsonb_set(r, array['pages', x], to_jsonb(x = any (pages))); end loop;
  foreach x in array public.crm_actions() loop r := jsonb_set(r, array['actions', x], to_jsonb(x = any (acts))); end loop;
  return r;
end; $$;

-- Setting the technician through Edit booking: assign_leads or manage_technicians.
do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_update_booking(uuid,jsonb,timestamptz)'::regprocedure) into d;
  if position('manage_technicians' in d) > 0 then return; end if;
  n := replace(d, 'if p ? ''mechanic_id'' then perform public.crm_require(''assign_leads'');',
    'if p ? ''mechanic_id'' then if not (public.crm_can(''assign_leads'') or public.crm_can(''manage_technicians'')) then raise exception ''you do not have permission to do this'' using errcode = ''42501''; end if;');
  if n = d then raise exception 'crm_update_booking was not patched'; end if;
  execute n;
end $$;

-- The board and the unstaffed list: either permission.
do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_tech_board(date)'::regprocedure) into d;
  n := replace(d, 'perform public.crm_require(''assign_leads'');', 'if not (public.crm_can(''assign_leads'') or public.crm_can(''manage_technicians'')) then raise exception ''you do not have permission to do this'' using errcode = ''42501''; end if;');
  if n = d then raise exception 'crm_tech_board was not patched'; end if;
  execute n;
  select pg_get_functiondef('public.crm_unstaffed_jobs()'::regprocedure) into d;
  n := replace(d, 'if not public.crm_can(''assign_leads'') then', 'if not (public.crm_can(''assign_leads'') or public.crm_can(''manage_technicians'')) then');
  if n = d then raise exception 'crm_unstaffed_jobs was not patched'; end if;
  execute n;
end $$;

-- One-time: the PIN in a technician's name ("MUBARAK-560068") becomes their first service PIN.
update public.mechanics set pincodes = array[(regexp_match(name, '(56[0-9]{4})'))[1]]
where pincodes = '{}' and name ~ '56[0-9]{4}';
