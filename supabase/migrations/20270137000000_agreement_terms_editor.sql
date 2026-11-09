-- The client edits the partner agreement terms himself in Admin > Garages > Agreement terms: the clause text (Part A and the Bronze, Silver and Gold Part B), the penalty amounts, and each plan's commission, deposit and order band.
-- One override document; with none saved, the built-in text (the client's signed-off wording) is used. Every save keeps the earlier version in agreement_terms_log, and every printed agreement is logged with the version it used.
-- Owner and admin only (kyc_need_admin). Additive; nothing here changes a garage, a job or a payout. Rollback: drop function public.agreement_terms_get(), public.agreement_terms_save(jsonb, text), public.agreement_terms_reset(), public.partner_plan_values_set(text, numeric, numeric, integer, integer, integer), public.agreement_issued(uuid, text, numeric, integer); drop table public.agreement_terms_log, public.agreement_terms.
create table if not exists public.agreement_terms (
  id integer primary key check (id = 1),
  doc jsonb not null,
  version integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.agreement_terms_log (
  id bigserial primary key,
  version integer not null,
  doc jsonb not null,
  note text,
  saved_by uuid default auth.uid(),
  saved_at timestamptz not null default now()
);
alter table public.agreement_terms enable row level security;
alter table public.agreement_terms_log enable row level security;

create or replace function public.agreement_terms_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.agreement_terms;
begin
  perform public.kyc_need_admin();
  select * into t from public.agreement_terms where id = 1;
  return jsonb_build_object('doc', case when found then t.doc else null end, 'version', coalesce(t.version, 0), 'updated_at', t.updated_at,
    'log', coalesce((select jsonb_agg(jsonb_build_object('version', l.version, 'note', l.note, 'saved_at', l.saved_at) order by l.id desc) from (select * from public.agreement_terms_log order by id desc limit 10) l), '[]'::jsonb));
end $$;

create or replace function public.agreement_terms_save(p_doc jsonb, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare lim integer; k text; sec jsonb; c jsonb; txt text; tok text; v integer; n int; vars jsonb := coalesce(p_doc -> 'vars', '{}'::jsonb); allowed text[] := array['rate','deposit','min','max','accept','pen_noshow','pen_cancel','pen_date','pen_cap'];
begin
  perform public.kyc_need_admin();
  if jsonb_typeof(coalesce(p_doc, 'null'::jsonb)) <> 'object' or length(p_doc::text) > 150000 then raise exception 'the agreement terms are not in the expected form' using errcode = 'P0001'; end if;
  for k in select unnest(array['part_a','bronze','silver','gold']) loop
    sec := case when k = 'part_a' then p_doc -> 'part_a' else p_doc -> 'part_b' -> k end;
    if jsonb_typeof(coalesce(sec, 'null'::jsonb)) <> 'array' or jsonb_array_length(sec) < 1 or jsonb_array_length(sec) > 40 then raise exception 'each section needs between 1 and 40 clauses (%)', k using errcode = 'P0001'; end if;
    for c in select * from jsonb_array_elements(sec) loop
      if jsonb_typeof(c) <> 'object' or char_length(btrim(coalesce(c ->> 'title', ''))) not between 2 and 120 or char_length(btrim(coalesce(c ->> 'text', ''))) not between 2 and 3000 then raise exception 'every clause needs a title (2 to 120 characters) and text (2 to 3000 characters)' using errcode = 'P0001'; end if;
      txt := (c ->> 'title') || ' ' || (c ->> 'text');
      if public.crm_has_pii(txt) then raise exception 'remove ID, bank or card numbers from the clauses' using errcode = 'P0001'; end if;
      for tok in select m[1] from regexp_matches(txt, '\{\{([a-z_]+)\}\}', 'g') as m loop
        if not (tok = any(allowed)) then raise exception 'unknown placeholder {{%}}. Allowed: rate, deposit, min, max, accept, pen_noshow, pen_cancel, pen_date, pen_cap', tok using errcode = 'P0001'; end if;
      end loop;
    end loop;
  end loop;
  for k in select unnest(array['pen_noshow','pen_cancel','pen_date','accept_silver','accept_gold','pen_cap']) loop
    begin v := (vars ->> k)::integer; exception when others then v := null; end;
    lim := case when k in ('pen_cap','accept_silver','accept_gold') then 100 else 100000 end;
    if v is null or v < 0 or v > lim then raise exception 'the number for % is missing or out of range', k using errcode = 'P0001'; end if;
  end loop;
  insert into public.agreement_terms (id, doc, version, updated_by, updated_at) values (1, p_doc, 1, auth.uid(), now())
    on conflict (id) do update set doc = excluded.doc, version = public.agreement_terms.version + 1, updated_by = auth.uid(), updated_at = now() returning version into n;
  insert into public.agreement_terms_log (version, doc, note) values (n, p_doc, public.crm_clean_text(p_note, 200));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'agreement_terms_saved', jsonb_build_object('version', n));
  return jsonb_build_object('ok', true, 'version', n);
end $$;

create or replace function public.agreement_terms_reset() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  delete from public.agreement_terms where id = 1;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'agreement_terms_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- A plan's numbers. Garages already on the plan keep it; a held deposit is never touched. Bronze stays deposit-free.
create or replace function public.partner_plan_values_set(p_plan text, p_commission numeric, p_deposit numeric, p_months integer, p_min integer, p_max integer) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.kyc_need_admin();
  if p_plan not in ('bronze','silver','gold') then raise exception 'unknown plan' using errcode = 'P0001'; end if;
  if p_commission is null or p_commission < 0 or p_commission > 100 then raise exception 'commission must be from 0 to 100' using errcode = 'P0001'; end if;
  if p_plan = 'bronze' then p_deposit := 0; p_months := 0; p_min := null; p_max := null; end if;
  if p_deposit is null or p_deposit < 0 or p_deposit > 1000000 then raise exception 'deposit must be from 0 to 10,00,000' using errcode = 'P0001'; end if;
  if p_months is null or p_months < 0 or p_months > 24 then raise exception 'deposit months must be from 0 to 24' using errcode = 'P0001'; end if;
  if p_plan <> 'bronze' and (p_min is null or p_max is null or p_min < 0 or p_max < p_min or p_max > 100000) then raise exception 'the order band needs a minimum and a larger maximum' using errcode = 'P0001'; end if;
  update public.partner_plans set commission_pct = p_commission, deposit_amount = p_deposit, deposit_months = p_months, orders_min = p_min, orders_max = p_max where plan = p_plan;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'partner_plan_values_set', jsonb_build_object('plan', p_plan, 'commission', p_commission, 'deposit', p_deposit, 'months', p_months, 'min', p_min, 'max', p_max));
  return jsonb_build_object('ok', true);
end $$;

-- Logged each time an agreement is printed, with the terms version it used.
create or replace function public.agreement_issued(p_garage uuid, p_tier text, p_rate numeric, p_version integer) returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.garages;
begin
  perform public.kyc_need_admin();
  select * into g from public.garages where id = p_garage; if not found then raise exception 'garage not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'agreement_issued', jsonb_build_object('garage', g.code, 'tier', p_tier, 'rate', p_rate, 'terms_version', coalesce(p_version, 0)));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.agreement_terms_get(), public.agreement_terms_save(jsonb, text), public.agreement_terms_reset(), public.partner_plan_values_set(text, numeric, numeric, integer, integer, integer), public.agreement_issued(uuid, text, numeric, integer) from public, anon;
grant execute on function public.agreement_terms_get(), public.agreement_terms_save(jsonb, text), public.agreement_terms_reset(), public.partner_plan_values_set(text, numeric, numeric, integer, integer, integer), public.agreement_issued(uuid, text, numeric, integer) to authenticated;
