-- Duplicate detection and safe merging of customers and leads/bookings (database side only; screens come later).
-- NOT applied anywhere by the build. Idempotent: every statement is create-if-missing, create-or-replace, or guarded.
--
-- ROLLBACK NOTES (run only if NO merge has been made; otherwise unmerge each one first with crm_unmerge_customers / crm_unmerge_leads):
--   drop trigger if exists leads_customer_follow_merge_tr on public.leads;
--   drop trigger if exists bikes_customer_follow_merge_tr on public.bikes;
--   drop trigger if exists invoices_customer_follow_merge_tr on public.invoices;
--   drop view if exists public.customers_active;
--   drop function if exists public.crm_duplicate_customers(), public.crm_duplicate_leads(), public.crm_merge_customers(uuid, uuid, text),
--     public.crm_merge_leads(uuid, uuid, text), public.crm_unmerge_customers(uuid), public.crm_unmerge_leads(uuid),
--     public.crm_customer_summary(uuid), public.crm_merge_list(integer), public.customer_follow_merge(), public.merge_gate(boolean),
--     public.merge_move_rows(text, uuid, regclass, uuid, uuid), public.merge_restore_rows(text, uuid, uuid, uuid),
--     public.merge_diff(jsonb, jsonb), public.merge_changed_mismatch(regclass, uuid, jsonb), public.merge_apply_fields(regclass, uuid, jsonb),
--     public.norm_phone10(text);
--   drop table if exists public.merge_moved_rows, public.customer_merges, public.lead_merges;
--   alter table public.customers drop column if exists merged_into, drop column if exists merged_at;
--
-- DESIGN
--  * norm_phone10(text): digits only, last 10. "+91 98xxx", "098xxx", "98 xxx xxx" all give the same key.
--  * Detection RPCs only READ. They return flat rows (group_key = the normalised phone) so a screen can group them.
--    Two leads that both carry a booking ID, or are both paid, are real separate bookings and are never grouped together.
--  * Merging never deletes. The dropped customer/lead stays as a retired row, every child row that was moved is recorded in
--    merge_moved_rows (full pre-move row), and a snapshot of what changed on both rows is stored, so the merge can be reversed.
--  * Phone uniqueness: customers.phone keeps its plain UNIQUE constraint. The retired customer KEEPS its phone. We deliberately do not
--    turn that into a partial index: book-start and crm_update_booking use "on conflict (phone)", and Postgres only infers a partial
--    index when the same WHERE is repeated, so a partial index would break those upserts. Instead, a BEFORE trigger on leads, bikes and
--    invoices follows customers.merged_into, so an upsert that lands on the retired row still links the new lead/bike/invoice to the
--    surviving customer. One customer per phone, no split history, no change to any existing writer.
--  * Child tables are discovered from pg_constraint, so a table added later with a foreign key to leads/customers is moved too.
--    A row that would break a unique key on the keeper (for example a second booking_secrets row) stays on the retired record and is
--    reported as skipped, nothing is lost.
--  * Money: ledger rows are MOVED, never copied, and leads.paid_amount is carried as keep + drop (drop becomes 0), so the sum over all
--    leads and over the ledger is the same before and after. Invoices are never copied; if both leads already have an invoice the merge is refused.
--  * Permissions: admins, or an explicit crm_users action 'merge_records' (flow_can). Unmerge is admin only. The audit_log row carries ids and refs, no phone numbers.

-- ───────────────────────────── 1. phone key
create or replace function public.norm_phone10(p text) returns text language sql immutable parallel safe as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

-- ───────────────────────────── 2. columns and closed tables
alter table public.customers add column if not exists merged_into uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists merged_at timestamptz;
create index if not exists customers_merged_into_idx on public.customers (merged_into) where merged_into is not null;

create table if not exists public.customer_merges (
  id uuid primary key default gen_random_uuid(),
  kept uuid not null references public.customers(id) on delete restrict,
  dropped uuid not null references public.customers(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 300),
  merged_by uuid,
  merged_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  unmerged_at timestamptz,
  unmerged_by uuid,
  check (kept <> dropped)
);
create table if not exists public.lead_merges (
  id uuid primary key default gen_random_uuid(),
  kept uuid not null references public.leads(id) on delete restrict,
  dropped uuid not null references public.leads(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 300),
  merged_by uuid,
  merged_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  unmerged_at timestamptz,
  unmerged_by uuid,
  check (kept <> dropped)
);
create table if not exists public.merge_moved_rows (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('customer', 'lead')),
  merge_id uuid not null,
  tbl text not null,
  col text not null,
  row jsonb not null
);
create index if not exists merge_moved_rows_merge_idx on public.merge_moved_rows (kind, merge_id);
create index if not exists customer_merges_kept_idx on public.customer_merges (kept);
create index if not exists lead_merges_kept_idx on public.lead_merges (kept);
alter table public.customer_merges enable row level security;
alter table public.lead_merges enable row level security;
alter table public.merge_moved_rows enable row level security;
-- No policy on purpose: nobody reads or writes these directly; only the security definer RPCs below (as the table owner) do.
revoke all on public.customer_merges, public.lead_merges, public.merge_moved_rows from public, anon, authenticated;

-- Active customers only (retired duplicates hidden). Runs with the caller's own rights, so the customers policies still apply.
create or replace view public.customers_active with (security_invoker = true) as select * from public.customers where merged_into is null;
revoke all on public.customers_active from public, anon;
grant select on public.customers_active to authenticated;

-- ───────────────────────────── 3. a lead, bike or invoice never points at a retired customer
create or replace function public.customer_follow_merge() returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid := new.customer_id; n uuid; hops integer := 0;
begin
  if t is null then return new; end if;
  loop
    select c.merged_into into n from public.customers c where c.id = t;
    exit when n is null or hops >= 5;
    t := n; hops := hops + 1;
  end loop;
  new.customer_id := t;
  return new;
end $$;
revoke all on function public.customer_follow_merge() from public, anon, authenticated;
drop trigger if exists leads_customer_follow_merge_tr on public.leads;
create trigger leads_customer_follow_merge_tr before insert or update of customer_id on public.leads for each row execute function public.customer_follow_merge();
drop trigger if exists bikes_customer_follow_merge_tr on public.bikes;
create trigger bikes_customer_follow_merge_tr before insert or update of customer_id on public.bikes for each row execute function public.customer_follow_merge();
drop trigger if exists invoices_customer_follow_merge_tr on public.invoices;
create trigger invoices_customer_follow_merge_tr before insert or update of customer_id on public.invoices for each row execute function public.customer_follow_merge();

-- ───────────────────────────── 4. internal helpers (callable only by the RPCs below)
create or replace function public.merge_gate(p_admin_only boolean default false) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_admin_only then
    if not public.is_admin() then raise exception 'you do not have permission: only an admin can undo a merge' using errcode = '42501'; end if;
  elsif not public.flow_can('merge_records') then
    raise exception 'you do not have permission to merge records' using errcode = '42501';
  end if;
end $$;

-- What changed between two row snapshots: {column: {before, after}}.
create or replace function public.merge_diff(p_old jsonb, p_new jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(o.key, jsonb_build_object('before', o.value, 'after', n.value)), '{}'::jsonb)
    from jsonb_each(p_old) o join jsonb_each(p_new) n using (key)
   where o.value is distinct from n.value and o.key <> 'updated_at'
$$;

-- First column whose current value is no longer the value the merge wrote (null when nothing changed since).
create or replace function public.merge_changed_mismatch(p_tbl regclass, p_id uuid, p_changed jsonb) returns text language plpgsql stable security definer set search_path = public as $$
declare cur jsonb; k text;
begin
  execute format('select to_jsonb(t) from %s t where t.id = $1', p_tbl) into cur using p_id;
  if cur is null then return 'the row no longer exists'; end if;
  for k in select jsonb_object_keys(coalesce(p_changed, '{}'::jsonb)) loop
    if cur -> k is distinct from p_changed -> k -> 'after' then return k; end if;
  end loop;
  return null;
end $$;

create or replace function public.merge_apply_fields(p_tbl regclass, p_id uuid, p_changed jsonb) returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  for k in select jsonb_object_keys(coalesce(p_changed, '{}'::jsonb)) loop
    execute format('update %s t set %I = (jsonb_populate_record(null::%s, $1)).%I where t.id = $2', p_tbl, k, p_tbl, k)
      using jsonb_build_object(k, p_changed -> k -> 'before'), p_id;
  end loop;
end $$;

-- Re-points every row that references p_parent(p_from) to p_to, in every table (found from pg_constraint). Records each moved row.
-- A row that would break a unique key on the target is left where it is and counted as skipped.
create or replace function public.merge_move_rows(p_kind text, p_merge uuid, p_parent regclass, p_from uuid, p_to uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; r record; moved integer; skipped integer; out jsonb := jsonb_build_object('moved', '{}'::jsonb, 'skipped', '{}'::jsonb);
begin
  for f in
    select format('%I.%I', n.nspname, cl.relname) as tbl, a.attname::text as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = p_parent and cardinality(c.conkey) = 1
       and c.conrelid not in ('public.customer_merges'::regclass, 'public.lead_merges'::regclass)
     order by 1
  loop
    moved := 0; skipped := 0;
    for r in execute format('select t.ctid as cid, to_jsonb(t) as j from %s t where t.%I = $1', f.tbl, f.col) using p_from loop
      begin
        execute format('update %s t set %I = $1 where t.ctid = $2', f.tbl, f.col) using p_to, r.cid;
        insert into public.merge_moved_rows (kind, merge_id, tbl, col, row) values (p_kind, p_merge, f.tbl, f.col, r.j);
        moved := moved + 1;
      exception when unique_violation then skipped := skipped + 1;
      end;
    end loop;
    if moved > 0 then out := jsonb_set(out, array['moved', f.tbl], to_jsonb(moved)); end if;
    if skipped > 0 then out := jsonb_set(out, array['skipped', f.tbl], to_jsonb(skipped)); end if;
  end loop;
  return out;
end $$;

-- Puts every recorded row back on p_to (the original owner). A row that was deleted since is ignored; one that now sits elsewhere stops the undo.
create or replace function public.merge_restore_rows(p_kind text, p_merge uuid, p_from uuid, p_to uuid) returns integer language plpgsql security definer set search_path = public as $$
declare r record; pk text[]; w text; n integer; total integer := 0; holder integer; anywhere integer;
begin
  for r in select * from public.merge_moved_rows where kind = p_kind and merge_id = p_merge order by id loop
    select array_agg(a.attname::text) into pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = r.tbl::regclass and i.indisprimary;
    if pk is not null then
      select string_agg(format('t.%I is not distinct from (jsonb_populate_record(null::%s, $3)).%I', x, r.tbl, x), ' and ') into w from unnest(pk) x;
    else
      w := format('to_jsonb(t) - %L = $3 - %L', r.col, r.col);
    end if;
    execute format('select count(*) from %s t where %s', r.tbl, w) into anywhere using null::uuid, null::uuid, r.row;
    execute format('select count(*) from %s t where %s and t.%I = $1', r.tbl, w, r.col) into holder using p_from, null::uuid, r.row;
    if anywhere > 0 and holder = 0 then raise exception 'cannot undo: a moved row in % was changed or moved again since the merge', r.tbl using errcode = 'P0001'; end if;
    if holder > 0 then
      execute format('update %s t set %I = $1 where %s and t.%I = $2', r.tbl, r.col, w, r.col) using p_to, p_from, r.row;
      get diagnostics n = row_count; total := total + n;
    end if;
  end loop;
  return total;
end $$;
revoke all on function public.merge_gate(boolean), public.merge_diff(jsonb, jsonb), public.merge_changed_mismatch(regclass, uuid, jsonb),
  public.merge_apply_fields(regclass, uuid, jsonb), public.merge_move_rows(text, uuid, regclass, uuid, uuid), public.merge_restore_rows(text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ───────────────────────────── 5. detection (read only)
create or replace function public.crm_duplicate_customers()
returns table (group_key text, customer_id uuid, name text, phone text, email text, bookings integer, paid_total numeric, created_at timestamptz, has_booking_id boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.merge_gate();
  return query
  with c as (select cu.id, cu.name, cu.phone, cu.email, cu.created_at, public.norm_phone10(cu.phone) as p10 from public.customers cu where cu.merged_into is null),
  g as (select c.p10 from c where length(c.p10) = 10 group by c.p10 having count(*) > 1),
  s as (
    select c.id, count(l.id)::integer as n, coalesce(sum(l.paid_amount), 0)::numeric as paid, coalesce(bool_or(l.booking_id is not null), false) as hb
      from c join g on g.p10 = c.p10 left join public.leads l on l.customer_id = c.id and l.deleted_at is null
     group by c.id)
  select c.p10, c.id, c.name, c.phone, c.email, s.n, s.paid, c.created_at, s.hb
    from c join g on g.p10 = c.p10 join s on s.id = c.id
   order by c.p10, c.created_at, c.id;
end $$;

create or replace function public.crm_duplicate_leads()
returns table (group_key text, reason text, lead_id uuid, ref text, booking_id text, name text, phone text, reg_no text, preferred_date date, status text, created_at timestamptz, paid_amount integer, confirm_paid_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.merge_gate();
  return query
  with l as (
    select x.id, x.ref, x.booking_id, x.name, x.phone, x.reg_no, x.preferred_date, x.status, x.created_at, x.paid_amount, x.confirm_paid_at, public.norm_phone10(x.phone) as p10,
           (x.confirm_paid_at is not null or coalesce(x.paid_amount, 0) > 0) as is_paid
      from public.leads x where x.deleted_at is null and x.status <> 'junk'),
  pr as (
    select a.id as a_id, b.id as b_id, a.p10,
           case when a.reg_no is not null and a.reg_no = b.reg_no then 'same_vehicle'
                when a.preferred_date is not null and b.preferred_date is not null and abs(a.preferred_date - b.preferred_date) <= 3 then 'close_dates'
                when a.booking_id is null and b.booking_id is null and abs(extract(epoch from a.created_at - b.created_at)) <= 172800 then 'new_within_48h' end as why
      from l a join l b on b.p10 = a.p10 and a.id < b.id
     where length(a.p10) = 10
       and not (a.booking_id is not null and b.booking_id is not null)
       and not (a.is_paid and b.is_paid)),
  ok as (select * from pr where why is not null),
  m as (select a_id as id, p10 from ok union select b_id, p10 from ok),
  gr as (select p10, string_agg(distinct why, ',' order by why) as why from ok group by p10)
  select m.p10, gr.why, l.id, l.ref, l.booking_id, l.name, l.phone, l.reg_no, l.preferred_date, l.status, l.created_at, l.paid_amount, l.confirm_paid_at
    from m join l on l.id = m.id join gr on gr.p10 = m.p10
   order by m.p10, l.created_at, l.id;
end $$;

-- The one set of numbers every desk screen should show for a customer: leads linked by customer_id (including any duplicate merged into it)
-- OR sharing the same normalised phone. Junk and deleted leads are not counted. Each lead is counted once.
create or replace function public.crm_customer_summary(p_customer uuid)
returns table (customer_id uuid, name text, phone text, bookings integer, confirmed_bookings integer, paid_total numeric, last_booking_date date, duplicate_customers integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare t public.customers; hops integer := 0;
begin
  if auth.uid() is null or not (public.is_admin() or public.crm_role() is not null) then raise exception 'you do not have permission to do this' using errcode = '42501'; end if;
  select * into t from public.customers where id = p_customer;
  if not found then raise exception 'customer not found' using errcode = 'P0001'; end if;
  while t.merged_into is not null and hops < 5 loop select * into t from public.customers where id = t.merged_into; hops := hops + 1; end loop;
  return query
  select t.id, t.name, t.phone,
         count(l.id)::integer,
         (count(l.id) filter (where l.booking_id is not null))::integer,
         coalesce(sum(l.paid_amount), 0)::numeric,
         max((coalesce(l.confirmed_at, l.created_at) at time zone 'Asia/Kolkata')::date),
         (select count(*)::integer - 1 from public.customers o where o.merged_into is null and public.norm_phone10(o.phone) = public.norm_phone10(t.phone))
    from (select 1) one
    left join public.leads l on l.deleted_at is null and l.status <> 'junk'
      and (l.customer_id = t.id or l.customer_id in (select m.id from public.customers m where m.merged_into = t.id)
           or (length(public.norm_phone10(t.phone)) = 10 and public.norm_phone10(l.phone) = public.norm_phone10(t.phone)));
end $$;

-- Merge history for the desk (no snapshots). Admins and merge_records only.
create or replace function public.crm_merge_list(p_limit integer default 50)
returns table (kind text, merge_id uuid, kept uuid, dropped uuid, kept_label text, dropped_label text, reason text, merged_at timestamptz, merged_by uuid, unmerged_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.merge_gate();
  return query
  select * from (
    select 'customer'::text, m.id, m.kept, m.dropped, ck.name, cd.name, m.reason, m.merged_at, m.merged_by, m.unmerged_at
      from public.customer_merges m left join public.customers ck on ck.id = m.kept left join public.customers cd on cd.id = m.dropped
    union all
    select 'lead'::text, m.id, m.kept, m.dropped, lk.ref, ld.ref, m.reason, m.merged_at, m.merged_by, m.unmerged_at
      from public.lead_merges m left join public.leads lk on lk.id = m.kept left join public.leads ld on ld.id = m.dropped
  ) u order by 8 desc limit greatest(1, least(coalesce(p_limit, 50), 500));
end $$;

-- ───────────────────────────── 6. merge customers
create or replace function public.crm_merge_customers(p_keep uuid, p_drop uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.customers; d public.customers; k2 public.customers; d2 public.customers; ex public.customer_merges; mid uuid := gen_random_uuid();
  reason text := btrim(coalesce(p_reason, '')); mv jsonb; kd jsonb; dd jsonb; unsub timestamptz; cons boolean; moved_auth uuid;
begin
  perform public.merge_gate();
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'choose two different customers to merge' using errcode = 'P0001'; end if;
  if length(regexp_replace(reason, '[^A-Za-z]', '', 'g')) < 3 then raise exception 'give a reason of at least 3 letters' using errcode = 'P0001'; end if;
  perform 1 from public.customers where id in (p_keep, p_drop) order by id for update;
  select * into k from public.customers where id = p_keep;
  select * into d from public.customers where id = p_drop;
  if k.id is null or d.id is null then raise exception 'customer not found' using errcode = 'P0001'; end if;
  select * into ex from public.customer_merges m where m.unmerged_at is null and m.kept in (k.id, d.id) and m.dropped in (k.id, d.id) limit 1;
  if found then return jsonb_build_object('merge_id', ex.id, 'kept', ex.kept, 'dropped', ex.dropped, 'already_merged', true); end if;
  if k.merged_into is not null or d.merged_into is not null then raise exception 'one of these customers was already merged into another; merge into the surviving customer instead' using errcode = 'P0001'; end if;
  if public.norm_phone10(k.phone) is distinct from public.norm_phone10(d.phone) then raise exception 'these customers have different phone numbers; only the same phone number can be merged' using errcode = 'P0001'; end if;
  if d.blocked and not k.blocked then raise exception 'the customer being merged away is blocked and the one kept is not: keep the blocked record, or unblock first' using errcode = 'P0001'; end if;
  if k.auth_user is not null and d.auth_user is not null and k.auth_user <> d.auth_user then raise exception 'both customers have their own login; they cannot be merged automatically' using errcode = 'P0001'; end if;

  -- children first (bikes, leads, invoices and anything added later), then the fields
  mv := public.merge_move_rows('customer', mid, 'public.customers'::regclass, d.id, k.id);
  moved_auth := case when k.auth_user is null then d.auth_user end;
  if moved_auth is not null then update public.customers set auth_user = null where id = d.id; end if;
  unsub := coalesce(k.email_unsubscribed_at, d.email_unsubscribed_at);
  cons := case when unsub is not null then false else (k.email_marketing_consent or d.email_marketing_consent) end;
  update public.customers set
    name = coalesce(nullif(btrim(k.name), ''), d.name),
    email = coalesce(nullif(btrim(k.email), ''), d.email),
    address = coalesce(nullif(btrim(k.address), ''), d.address),
    area = coalesce(nullif(btrim(k.area), ''), d.area),
    company_name = coalesce(nullif(btrim(k.company_name), ''), d.company_name),
    gstin = coalesce(nullif(btrim(k.gstin), ''), d.gstin),
    notes = coalesce(nullif(btrim(k.notes), ''), d.notes),
    auth_user = coalesce(k.auth_user, moved_auth),
    blocked = k.blocked or d.blocked,
    blocked_reason = case when k.blocked or d.blocked then coalesce(nullif(btrim(k.blocked_reason), ''), d.blocked_reason) else k.blocked_reason end,
    email_unsubscribed_at = unsub,
    email_marketing_consent = cons
   where id = k.id;
  update public.customers set merged_into = k.id, merged_at = now() where id = d.id;
  select * into k2 from public.customers where id = k.id; select * into d2 from public.customers where id = d.id;
  kd := public.merge_diff(to_jsonb(k), to_jsonb(k2)); dd := public.merge_diff(to_jsonb(d), to_jsonb(d2));
  insert into public.customer_merges (id, kept, dropped, reason, merged_by, snapshot)
    values (mid, k.id, d.id, reason, auth.uid(), jsonb_build_object('dropped_row', to_jsonb(d), 'kept_row', to_jsonb(k), 'kept_changed', kd, 'dropped_changed', dd, 'children', mv));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'customers_merged', jsonb_build_object('merge', mid, 'kept', k.id, 'dropped', d.id, 'reason', reason, 'children', mv));
  return jsonb_build_object('merge_id', mid, 'kept', k.id, 'dropped', d.id, 'already_merged', false, 'children', mv);
end $$;

-- ───────────────────────────── 7. merge leads
create or replace function public.crm_merge_leads(p_keep uuid, p_drop uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.leads; b public.leads; k public.leads; d public.leads; k2 public.leads; d2 public.leads; ex public.lead_merges; mid uuid := gen_random_uuid();
  reason text := btrim(coalesce(p_reason, '')); mv jsonb; kd jsonb; dd jsonb; a_paid boolean; b_paid boolean; keep_a boolean; newnote text; aliases text[];
begin
  perform public.merge_gate();
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'choose two different leads to merge' using errcode = 'P0001'; end if;
  if length(regexp_replace(reason, '[^A-Za-z]', '', 'g')) < 3 then raise exception 'give a reason of at least 3 letters' using errcode = 'P0001'; end if;
  perform 1 from public.leads where id in (p_keep, p_drop) order by id for update;
  select * into a from public.leads where id = p_keep;
  select * into b from public.leads where id = p_drop;
  if a.id is null or b.id is null then raise exception 'lead not found' using errcode = 'P0001'; end if;
  select * into ex from public.lead_merges m where m.unmerged_at is null and m.kept in (a.id, b.id) and m.dropped in (a.id, b.id) limit 1;
  if found then return jsonb_build_object('merge_id', ex.id, 'kept', ex.kept, 'dropped', ex.dropped, 'already_merged', true); end if;
  if a.deleted_at is not null or b.deleted_at is not null then raise exception 'a deleted or already merged lead cannot be merged' using errcode = 'P0001'; end if;
  if public.norm_phone10(a.phone) is distinct from public.norm_phone10(b.phone) then raise exception 'these leads have different phone numbers; only the same phone number can be merged' using errcode = 'P0001'; end if;
  if a.booking_id is not null and b.booking_id is not null then raise exception 'both leads have a booking ID: these are separate bookings and cannot be merged' using errcode = 'P0001'; end if;
  a_paid := a.confirm_paid_at is not null or coalesce(a.paid_amount, 0) > 0;
  b_paid := b.confirm_paid_at is not null or coalesce(b.paid_amount, 0) > 0;
  if a_paid and b_paid then raise exception 'both leads are paid: these are separate paid bookings and cannot be merged' using errcode = 'P0001'; end if;
  if exists (select 1 from public.invoices where lead_id = a.id) and exists (select 1 from public.invoices where lead_id = b.id)
     or exists (select 1 from public.invoice_numbers where lead_id = a.id) and exists (select 1 from public.invoice_numbers where lead_id = b.id) then
    raise exception 'both leads already have an invoice; invoices are never merged, so this needs a manual decision' using errcode = 'P0001';
  end if;
  -- the lead with a booking ID or a payment survives; when equal, the older one
  keep_a := case
    when (a.booking_id is not null or a_paid) <> (b.booking_id is not null or b_paid) then (a.booking_id is not null or a_paid)
    when a.created_at <> b.created_at then a.created_at < b.created_at
    else a.id < b.id end;
  if keep_a then k := a; d := b; else k := b; d := a; end if;

  mv := public.merge_move_rows('lead', mid, 'public.leads'::regclass, d.id, k.id);

  newnote := k.note;
  if nullif(btrim(d.note), '') is not null then
    newnote := left(coalesce(nullif(k.note, '') || E'\n', '') || 'Merged from ' || d.ref || ': ' || btrim(d.note), 300);
  end if;
  select coalesce(array_agg(distinct x), '{}') into aliases from unnest(k.ref_aliases || d.ref_aliases || array[d.ref, d.old_ref]) x where x is not null and x <> k.ref;
  update public.leads set
    customer_id = coalesce(k.customer_id, d.customer_id),
    area = coalesce(nullif(btrim(k.area), ''), d.area),
    service_id = coalesce(nullif(btrim(k.service_id), ''), d.service_id),
    addons = case when coalesce(cardinality(k.addons), 0) = 0 then d.addons else k.addons end,
    preferred_date = coalesce(k.preferred_date, d.preferred_date),
    preferred_slot = coalesce(nullif(btrim(k.preferred_slot), ''), d.preferred_slot),
    preferred_time = coalesce(nullif(btrim(k.preferred_time), ''), d.preferred_time),
    notes = coalesce(nullif(btrim(k.notes), ''), d.notes),
    km_band = coalesce(k.km_band, d.km_band),
    issues = case when k.issues is null or k.issues in ('[]'::jsonb, '{}'::jsonb) then d.issues else k.issues end,
    place = coalesce(k.place, d.place),
    bike_type = coalesce(k.bike_type, d.bike_type),
    address = coalesce(nullif(btrim(k.address), ''), d.address),
    lat = coalesce(k.lat, d.lat), lng = coalesce(k.lng, d.lng),
    email = coalesce(nullif(btrim(k.email), ''), d.email),
    reg_no = coalesce(nullif(btrim(k.reg_no), ''), d.reg_no),
    vehicle = coalesce(nullif(btrim(k.vehicle), ''), d.vehicle),
    vehicle_source = case when nullif(btrim(k.vehicle), '') is null then coalesce(k.vehicle_source, d.vehicle_source) else k.vehicle_source end,
    pincode = coalesce(k.pincode, d.pincode),
    job_place = coalesce(k.job_place, d.job_place),
    bike_id = coalesce(k.bike_id, d.bike_id),
    campaign = coalesce(nullif(btrim(k.campaign), ''), d.campaign),
    opted_out = k.opted_out or d.opted_out,
    note = newnote,
    ref_aliases = aliases,
    paid_amount = coalesce(k.paid_amount, 0) + coalesce(d.paid_amount, 0),
    paid_at = coalesce(k.paid_at, d.paid_at)
   where id = k.id;
  -- the dropped lead is retired; its money now lives on the kept lead (ledger rows were moved, not copied)
  update public.leads set deleted_at = now(), deleted_reason = left('merged into ' || k.ref, 200),
    paid_amount = case when coalesce(d.paid_amount, 0) > 0 then 0 else d.paid_amount end,
    paid_at = case when coalesce(d.paid_amount, 0) > 0 then null else d.paid_at end,
    next_followup_at = null, crm_next_action_at = null
   where id = d.id;
  insert into public.crm_activities (lead_id, actor, kind, body) values (k.id, auth.uid(), 'note', left('Merged duplicate ' || d.ref || ' into this lead. Reason: ' || reason, 1000));

  select * into k2 from public.leads where id = k.id; select * into d2 from public.leads where id = d.id;
  kd := public.merge_diff(to_jsonb(k), to_jsonb(k2)); dd := public.merge_diff(to_jsonb(d), to_jsonb(d2));
  insert into public.lead_merges (id, kept, dropped, reason, merged_by, snapshot)
    values (mid, k.id, d.id, reason, auth.uid(), jsonb_build_object('dropped_row', to_jsonb(d), 'kept_row', to_jsonb(k), 'kept_changed', kd, 'dropped_changed', dd, 'children', mv));
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'leads_merged', jsonb_build_object('merge', mid, 'kept_ref', k.ref, 'dropped_ref', d.ref, 'reason', reason, 'children', mv));
  return jsonb_build_object('merge_id', mid, 'kept', k.id, 'dropped', d.id, 'kept_ref', k.ref, 'dropped_ref', d.ref, 'already_merged', false, 'children', mv);
end $$;

-- ───────────────────────────── 8. undo (admin only; refuses when anything it touched has changed since)
create or replace function public.crm_unmerge_customers(p_merge uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.customer_merges; bad text; n integer;
begin
  perform public.merge_gate(true);
  select * into m from public.customer_merges where id = p_merge for update;
  if not found then raise exception 'merge not found' using errcode = 'P0001'; end if;
  if m.unmerged_at is not null then raise exception 'this merge was already undone' using errcode = 'P0001'; end if;
  perform 1 from public.customers where id in (m.kept, m.dropped) order by id for update;
  bad := public.merge_changed_mismatch('public.customers'::regclass, m.kept, m.snapshot -> 'kept_changed');
  if bad is not null then raise exception 'cannot undo: the kept customer was changed since the merge (%)', bad using errcode = 'P0001'; end if;
  bad := public.merge_changed_mismatch('public.customers'::regclass, m.dropped, m.snapshot -> 'dropped_changed');
  if bad is not null then raise exception 'cannot undo: the retired customer was changed since the merge (%)', bad using errcode = 'P0001'; end if;
  perform public.merge_apply_fields('public.customers'::regclass, m.kept, m.snapshot -> 'kept_changed');
  perform public.merge_apply_fields('public.customers'::regclass, m.dropped, m.snapshot -> 'dropped_changed');   -- clears merged_into first, so the follow-merge trigger lets rows go back
  n := public.merge_restore_rows('customer', m.id, m.kept, m.dropped);
  delete from public.merge_moved_rows where kind = 'customer' and merge_id = m.id;
  update public.customer_merges set unmerged_at = now(), unmerged_by = auth.uid() where id = m.id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'customers_unmerged', jsonb_build_object('merge', m.id, 'kept', m.kept, 'dropped', m.dropped, 'rows_restored', n));
  return jsonb_build_object('merge_id', m.id, 'kept', m.kept, 'dropped', m.dropped, 'rows_restored', n);
end $$;

create or replace function public.crm_unmerge_leads(p_merge uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.lead_merges; bad text; n integer;
begin
  perform public.merge_gate(true);
  select * into m from public.lead_merges where id = p_merge for update;
  if not found then raise exception 'merge not found' using errcode = 'P0001'; end if;
  if m.unmerged_at is not null then raise exception 'this merge was already undone' using errcode = 'P0001'; end if;
  perform 1 from public.leads where id in (m.kept, m.dropped) order by id for update;
  bad := public.merge_changed_mismatch('public.leads'::regclass, m.kept, m.snapshot -> 'kept_changed');
  if bad is not null then raise exception 'cannot undo: the kept lead was changed since the merge (%)', bad using errcode = 'P0001'; end if;
  bad := public.merge_changed_mismatch('public.leads'::regclass, m.dropped, m.snapshot -> 'dropped_changed');
  if bad is not null then raise exception 'cannot undo: the retired lead was changed since the merge (%)', bad using errcode = 'P0001'; end if;
  perform public.merge_apply_fields('public.leads'::regclass, m.kept, m.snapshot -> 'kept_changed');
  perform public.merge_apply_fields('public.leads'::regclass, m.dropped, m.snapshot -> 'dropped_changed');
  n := public.merge_restore_rows('lead', m.id, m.kept, m.dropped);
  delete from public.merge_moved_rows where kind = 'lead' and merge_id = m.id;
  update public.lead_merges set unmerged_at = now(), unmerged_by = auth.uid() where id = m.id;
  insert into public.audit_log (actor, action, details) values (auth.uid(), 'leads_unmerged', jsonb_build_object('merge', m.id, 'kept', m.kept, 'dropped', m.dropped, 'rows_restored', n));
  return jsonb_build_object('merge_id', m.id, 'kept', m.kept, 'dropped', m.dropped, 'rows_restored', n);
end $$;

-- ───────────────────────────── 9. grants: signed-in users only (each function checks the permission itself)
revoke all on function public.crm_duplicate_customers(), public.crm_duplicate_leads(), public.crm_customer_summary(uuid), public.crm_merge_list(integer),
  public.crm_merge_customers(uuid, uuid, text), public.crm_merge_leads(uuid, uuid, text), public.crm_unmerge_customers(uuid), public.crm_unmerge_leads(uuid)
  from public, anon;
grant execute on function public.crm_duplicate_customers(), public.crm_duplicate_leads(), public.crm_customer_summary(uuid), public.crm_merge_list(integer),
  public.crm_merge_customers(uuid, uuid, text), public.crm_merge_leads(uuid, uuid, text), public.crm_unmerge_customers(uuid), public.crm_unmerge_leads(uuid)
  to authenticated;
