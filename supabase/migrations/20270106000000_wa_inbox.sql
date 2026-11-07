-- WhatsApp Cloud API inbox (number +91 83106 21498): conversations, internal notes, per-user reads, and the Crew / Admin RPCs.
-- The AiSensy desk number keeps its own path; every old messages row stays channel 'aisensy'. Design notes in docs/GO-LIVE-WA-CLOUD.md.
-- Idempotent and safe to dry-run (add column if not exists, create table if not exists, create or replace, on conflict).
-- Roll back (as the database owner):
--   drop function if exists public.crm_wa_inbox(text, text, int), public.crm_wa_thread(text, int), public.crm_wa_claim(text), public.crm_wa_close(text, text), public.crm_wa_reopen(text), public.crm_wa_note(text, text),
--     public.crm_wa_mark_read(text), public.crm_wa_ai(text, boolean), public.crm_wa_send_context(text), public.crm_wa_media_ok(text), public.admin_wa_overview(timestamptz, timestamptz, int), public.admin_wa_list(uuid, int, timestamptz, timestamptz, int),
--     public.wa_record_inbound(text, uuid, text, text, jsonb, text, text, timestamptz), public.wa_record_outbound(text, uuid, text, text, text, jsonb, text, uuid, text), public.wa_apply_status(text, text, text), public.wa_need(), public.wa_rank(text);
--   drop table if exists public.wa_reads, public.wa_notes, public.wa_conversations;
--   (the new messages columns can stay: they are empty or defaulted for old rows. alter table public.messages drop column ... if you want them gone.)

-- ───────────────────────── messages: new columns, old rows untouched ─────────────────────────
alter table public.messages add column if not exists channel text not null default 'aisensy';
alter table public.messages add column if not exists wa_number text;          -- the business number the message went through (digits, with 91)
alter table public.messages add column if not exists status text;             -- outbound delivery: sent, delivered, read, failed, unknown
alter table public.messages add column if not exists status_detail text;
alter table public.messages add column if not exists media jsonb;             -- {type, id, mime, filename, caption, latitude, longitude}: the Meta media id and mime only, never the bytes
alter table public.messages add column if not exists assigned_to uuid;        -- the staff user who sent it (outbound) or owned the conversation when it arrived
alter table public.messages add column if not exists read_at timestamptz;     -- when a Crew user opened the conversation after this inbound message
alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages add constraint messages_channel_check check (channel in ('aisensy', 'cloud'));
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check check (status is null or status in ('sent', 'delivered', 'read', 'failed', 'unknown'));
create index if not exists messages_phone_created_idx on public.messages (phone, created_at);

-- ───────────────────────── conversations, notes, reads (RLS-closed: only the functions below touch them) ─────────────────────────
create table if not exists public.wa_conversations (
  phone            text primary key,                     -- last 10 digits
  lead_id          uuid references public.leads(id) on delete set null,
  wa_number        text,
  profile_name     text,
  last_preview     text,
  last_message_at  timestamptz,
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  unread           integer not null default 0,
  assigned_to      uuid,
  claimed_at       timestamptz,
  status           text not null default 'open' check (status in ('open', 'closed')),
  closed_reason    text,
  closed_at        timestamptz,
  ai_auto          boolean,                              -- null = follow the global setting wa_ai_auto
  created_at       timestamptz not null default now()
);
create index if not exists wa_conv_last_idx on public.wa_conversations (last_message_at desc);
create index if not exists wa_conv_assigned_idx on public.wa_conversations (assigned_to);
create table if not exists public.wa_notes (
  id bigserial primary key, phone text not null, author uuid, body text not null check (length(body) between 1 and 2000), created_at timestamptz not null default now()
);
create index if not exists wa_notes_phone_idx on public.wa_notes (phone, created_at);
create table if not exists public.wa_reads (
  phone text not null, user_id uuid not null, last_read_at timestamptz not null default now(), primary key (phone, user_id)
);
alter table public.wa_conversations enable row level security;
alter table public.wa_notes enable row level security;
alter table public.wa_reads enable row level security;
revoke all on public.wa_conversations, public.wa_notes, public.wa_reads from anon, authenticated;
revoke all on sequence public.wa_notes_id_seq from anon, authenticated;
insert into public.settings (key, value) values ('wa_ai_auto', 'true'::jsonb) on conflict (key) do nothing;   -- global switch for the AI auto reply on the Cloud number (default: current behaviour)

-- ───────────────────────── helpers ─────────────────────────
-- Status only moves forward. unknown < sent < delivered < read. failed is only accepted before delivery.
create or replace function public.wa_rank(p text) returns int language sql immutable as $$
  select case p when 'unknown' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 when 'failed' then 9 else 0 end;
$$;
-- Who may use the inbox: any admin, or a Crew user whose pages include inbox.
create or replace function public.wa_need() returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.flow_role();
begin
  if r is null or not (public.is_admin() or public.crm_page_ok('inbox')) then raise exception 'you do not have access to this page' using errcode = '42501'; end if;
  return r;
end; $$;

-- ───────────────────────── webhook-side functions (service role only) ─────────────────────────
create or replace function public.wa_record_inbound(p_phone text, p_lead uuid, p_wa_id text, p_body text, p_media jsonb, p_wa_number text, p_profile text, p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.wa_conversations; n int;
begin
  insert into public.messages (lead_id, phone, direction, sender, body, wa_message_id, channel, wa_number, media, assigned_to, created_at)
    values (p_lead, p_phone, 'in', 'customer', left(p_body, 4000), p_wa_id, 'cloud', p_wa_number, p_media, (select assigned_to from public.wa_conversations where phone = p_phone), coalesce(p_at, now()))
    on conflict (wa_message_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('duplicate', true); end if;
  insert into public.wa_conversations (phone, lead_id, wa_number, profile_name, last_preview, last_message_at, last_inbound_at, unread)
    values (p_phone, p_lead, p_wa_number, nullif(p_profile, ''), left(p_body, 120), coalesce(p_at, now()), coalesce(p_at, now()), 1)
    on conflict (phone) do update set lead_id = coalesce(public.wa_conversations.lead_id, excluded.lead_id), wa_number = coalesce(excluded.wa_number, public.wa_conversations.wa_number),
      profile_name = coalesce(excluded.profile_name, public.wa_conversations.profile_name), last_preview = excluded.last_preview, last_message_at = excluded.last_message_at,
      last_inbound_at = excluded.last_inbound_at, unread = public.wa_conversations.unread + 1,
      status = 'open', closed_reason = null, closed_at = null;     -- a new customer message reopens a closed conversation
  select * into c from public.wa_conversations where phone = p_phone;
  return jsonb_build_object('duplicate', false, 'assigned_to', c.assigned_to, 'ai_auto', c.ai_auto,
    'global_ai', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'wa_ai_auto'), true));
end; $$;

create or replace function public.wa_record_outbound(p_phone text, p_lead uuid, p_wa_id text, p_body text, p_sender text, p_media jsonb, p_status text, p_user uuid, p_wa_number text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
  insert into public.messages (lead_id, phone, direction, sender, body, wa_message_id, channel, wa_number, media, status, assigned_to)
    values (p_lead, p_phone, 'out', p_sender, left(p_body, 4000), p_wa_id, 'cloud', p_wa_number, p_media, p_status, p_user) returning id into mid;
  insert into public.wa_conversations (phone, lead_id, wa_number, last_preview, last_message_at, last_outbound_at, unread, assigned_to, claimed_at)
    values (p_phone, p_lead, p_wa_number, left(p_body, 120), now(), now(), 0, case when p_sender = 'staff' then p_user end, case when p_sender = 'staff' and p_user is not null then now() end)
    on conflict (phone) do update set last_preview = excluded.last_preview, last_message_at = now(), last_outbound_at = now(),
      assigned_to = case when p_sender = 'staff' and p_user is not null then coalesce(public.wa_conversations.assigned_to, p_user) else public.wa_conversations.assigned_to end,
      claimed_at = case when p_sender = 'staff' and p_user is not null and public.wa_conversations.assigned_to is null then now() else public.wa_conversations.claimed_at end,
      unread = case when p_sender = 'staff' then 0 else public.wa_conversations.unread end;
  return mid;
end; $$;

create or replace function public.wa_apply_status(p_wa_id text, p_status text, p_error text default null) returns boolean language plpgsql security definer set search_path = public as $$
declare cur text; n int;
begin
  if p_wa_id is null or p_status not in ('sent', 'delivered', 'read', 'failed') then return false; end if;
  select status into cur from public.messages where wa_message_id = p_wa_id and direction = 'out';
  if not found then return false; end if;
  if p_status = 'failed' then
    if coalesce(cur, '') in ('delivered', 'read', 'failed') then return false; end if;
  elsif cur = 'failed' or public.wa_rank(p_status) <= public.wa_rank(cur) then return false; end if;
  update public.messages set status = p_status, status_detail = case when p_status = 'failed' then left(p_error, 300) else null end where wa_message_id = p_wa_id and direction = 'out';
  get diagnostics n = row_count; return n > 0;
end; $$;
revoke all on function public.wa_record_inbound(text, uuid, text, text, jsonb, text, text, timestamptz), public.wa_record_outbound(text, uuid, text, text, text, jsonb, text, uuid, text), public.wa_apply_status(text, text, text), public.wa_rank(text) from public, anon, authenticated;
revoke all on function public.wa_need() from public, anon;
grant execute on function public.wa_need() to authenticated;

-- ───────────────────────── Crew RPCs (signed-in staff; agents read and reply, admins see everything, no money data) ─────────────────────────
-- p_filter: unread (mine), mine, unassigned, waiting (customer wrote last), closed, all. Counts for every tab come back with the rows.
create or replace function public.crm_wa_inbox(p_filter text default 'unread', p_q text default null, p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := nullif(btrim(coalesce(p_q, '')), ''); rows jsonb; cnt jsonb;
begin
  perform public.wa_need();
  return (
    with x as (
      select c.*, l.name as lead_name, l.booking_id, l.ref, (l.confirm_paid_at is not null) as paid,
        (select count(*) from public.messages m where m.phone = c.phone and m.direction = 'in' and m.channel = 'cloud' and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))::int as my_unread,
        (c.status = 'open' and c.last_inbound_at is not null and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at)) as waiting
      from public.wa_conversations c left join public.leads l on l.id = c.lead_id left join public.wa_reads r on r.phone = c.phone and r.user_id = me
    ), f as (
      select * from x where
        case coalesce(p_filter, 'unread')
          when 'unread' then status = 'open' and my_unread > 0
          when 'mine' then status = 'open' and assigned_to = me
          when 'unassigned' then status = 'open' and assigned_to is null
          when 'waiting' then waiting
          when 'closed' then status = 'closed'
          else true end
        and (q is null or phone like '%' || regexp_replace(q, '\D', '', 'g') || '%' and regexp_replace(q, '\D', '', 'g') <> '' or coalesce(lead_name, profile_name, '') ilike '%' || q || '%' or coalesce(booking_id, '') ilike '%' || q || '%' or coalesce(last_preview, '') ilike '%' || q || '%')
    )
    select jsonb_build_object(
      'counts', jsonb_build_object('unread', (select count(*) from x where status = 'open' and my_unread > 0), 'mine', (select count(*) from x where status = 'open' and assigned_to = me),
        'unassigned', (select count(*) from x where status = 'open' and assigned_to is null), 'waiting', (select count(*) from x where waiting), 'closed', (select count(*) from x where status = 'closed')),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('phone', phone, 'name', coalesce(lead_name, profile_name), 'lead_id', lead_id, 'booking_id', booking_id, 'paid', coalesce(paid, false), 'last_preview', last_preview,
        'last_message_at', last_message_at, 'last_inbound_at', last_inbound_at, 'unread', my_unread, 'assigned_to', assigned_to, 'assigned_name', public.crm_name(assigned_to), 'status', status,
        'waiting', waiting, 'window_open', coalesce(last_inbound_at > now() - interval '24 hours', false), 'ai_auto', ai_auto) order by last_message_at desc nulls last)
        from (select * from f order by last_message_at desc nulls last limit greatest(1, least(coalesce(p_limit, 100), 300))) f2), '[]'::jsonb))
  );
end; $$;

create or replace function public.crm_wa_thread(p_phone text, p_limit int default 300) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); c public.wa_conversations; l public.leads;
begin
  perform public.wa_need();
  select * into c from public.wa_conversations where phone = ph;
  if not found and not exists (select 1 from public.messages where phone = ph) then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  select * into l from public.leads where id = coalesce(c.lead_id, (select m.lead_id from public.messages m where m.phone = ph and m.lead_id is not null order by m.created_at desc limit 1)) and deleted_at is null;
  return jsonb_build_object(
    'conversation', jsonb_build_object('phone', ph, 'name', coalesce(l.name, c.profile_name), 'status', coalesce(c.status, 'open'), 'closed_reason', c.closed_reason, 'assigned_to', c.assigned_to, 'assigned_name', public.crm_name(c.assigned_to),
      'last_inbound_at', c.last_inbound_at, 'window_open', coalesce(c.last_inbound_at > now() - interval '24 hours', false),
      'window_closes_at', c.last_inbound_at + interval '24 hours', 'ai_auto', c.ai_auto, 'ai_global', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'wa_ai_auto'), true), 'opted_out', coalesce(l.opted_out, false), 'me', auth.uid()),
    'lead', case when l.id is null then null else jsonb_build_object('id', l.id, 'ref', l.ref, 'booking_id', l.booking_id, 'name', l.name, 'status', l.status, 'paid', l.confirm_paid_at is not null) end,
    'items', coalesce((select jsonb_agg(t order by (t->>'at')) from (
      select jsonb_build_object('kind', 'msg', 'id', m.id, 'direction', m.direction, 'sender', m.sender, 'body', m.body, 'status', m.status, 'status_detail', m.status_detail, 'media', m.media, 'channel', m.channel,
        'by', public.crm_name(m.assigned_to), 'at', m.created_at) as t from public.messages m where m.phone = ph order by m.created_at desc limit greatest(1, least(coalesce(p_limit, 300), 500))) s), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('kind', 'note', 'id', n.id, 'body', n.body, 'by', public.crm_name(n.author), 'at', n.created_at) order by n.created_at) from public.wa_notes n where n.phone = ph), '[]'::jsonb));
end; $$;

create or replace function public.crm_wa_claim(p_phone text) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); c public.wa_conversations; boss boolean;
begin
  perform public.wa_need(); boss := public.is_admin() or public.crm_can('assign_leads');
  select * into c from public.wa_conversations where phone = ph for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if c.assigned_to is not null and c.assigned_to <> auth.uid() and not boss then raise exception 'already taken by %', coalesce(public.crm_name(c.assigned_to), 'a colleague') using errcode = '42501'; end if;
  update public.wa_conversations set assigned_to = auth.uid(), claimed_at = now() where phone = ph;
  return jsonb_build_object('ok', true, 'assigned_to', auth.uid());
end; $$;

create or replace function public.crm_wa_close(p_phone text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  perform public.wa_need();
  update public.wa_conversations set status = 'closed', closed_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200), closed_at = now(), unread = 0 where phone = ph;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  insert into public.wa_reads (phone, user_id, last_read_at) values (ph, auth.uid(), now()) on conflict (phone, user_id) do update set last_read_at = now();
  return jsonb_build_object('ok', true);
end; $$;
create or replace function public.crm_wa_reopen(p_phone text) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  perform public.wa_need();
  update public.wa_conversations set status = 'open', closed_reason = null, closed_at = null where phone = ph;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end; $$;
create or replace function public.crm_wa_note(p_phone text, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  perform public.wa_need();
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'write the note first' using errcode = '22023'; end if;
  if not exists (select 1 from public.wa_conversations where phone = ph) then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  insert into public.wa_notes (phone, author, body) values (ph, auth.uid(), left(btrim(p_body), 2000));
  return jsonb_build_object('ok', true);
end; $$;
create or replace function public.crm_wa_mark_read(p_phone text) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  perform public.wa_need();
  insert into public.wa_reads (phone, user_id, last_read_at) values (ph, auth.uid(), now()) on conflict (phone, user_id) do update set last_read_at = now();
  update public.wa_conversations set unread = 0 where phone = ph;
  update public.messages set read_at = now() where phone = ph and direction = 'in' and channel = 'cloud' and read_at is null;
  return jsonb_build_object('ok', true);
end; $$;
-- Per-conversation AI auto reply: true = on, false = off, null = follow the global setting.
create or replace function public.crm_wa_ai(p_phone text, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  perform public.wa_need();
  update public.wa_conversations set ai_auto = p_on where phone = ph;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'ai_auto', p_on);
end; $$;
-- What wa-send needs, checked as the signed-in person: the window, the opt-out, and whether a colleague holds the conversation.
-- Media Load button: the media id must belong to a message in a conversation this person may open. Returns the mime and phone, nothing else.
create or replace function public.crm_wa_media_ok(p_media_id text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.messages;
begin
  perform public.wa_need();
  select * into m from public.messages where channel = 'cloud' and media ->> 'id' = p_media_id order by created_at desc limit 1;
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('phone', m.phone, 'mime', m.media ->> 'mime', 'type', m.media ->> 'type');
end; $$;

create or replace function public.crm_wa_send_context(p_phone text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); c public.wa_conversations; l public.leads; boss boolean;
begin
  perform public.wa_need(); boss := public.is_admin() or public.crm_can('assign_leads');
  select * into c from public.wa_conversations where phone = ph;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if c.assigned_to is not null and c.assigned_to <> auth.uid() and not boss then raise exception 'claimed by %. Ask a supervisor to hand it over.', coalesce(public.crm_name(c.assigned_to), 'a colleague') using errcode = '42501'; end if;
  select * into l from public.leads where id = c.lead_id;
  return jsonb_build_object('phone', ph, 'lead_id', c.lead_id, 'opted_out', coalesce(l.opted_out, false), 'last_inbound_at', c.last_inbound_at, 'window_open', coalesce(c.last_inbound_at > now() - interval '24 hours', false),
    'name', coalesce(l.name, c.profile_name), 'user', auth.uid());
end; $$;

-- ───────────────────────── Admin supervision (admins only, read only) ─────────────────────────
-- Median first response = per customer burst (a message after our last one), seconds until the first staff reply. AI replies do not count.
create or replace function public.admin_wa_overview(p_from timestamptz default now() - interval '7 days', p_to timestamptz default now(), p_over_minutes int default 15) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return (
    with bursts as (
      select m.phone, m.created_at as at from public.messages m
      where m.direction = 'in' and m.channel = 'cloud' and m.created_at between p_from and p_to
        and not exists (select 1 from public.messages p where p.phone = m.phone and p.channel = 'cloud' and p.created_at < m.created_at and p.created_at > coalesce((select max(o.created_at) from public.messages o where o.phone = m.phone and o.channel = 'cloud' and o.direction = 'out' and o.created_at < m.created_at), '-infinity') and p.direction = 'in')
    ), resp as (
      select b.phone, b.at, r.created_at as rat, r.assigned_to as agent, extract(epoch from (r.created_at - b.at)) as secs
      from bursts b join lateral (select o.created_at, o.assigned_to from public.messages o where o.phone = b.phone and o.channel = 'cloud' and o.direction = 'out' and o.sender = 'staff' and o.created_at > b.at order by o.created_at limit 1) r on true
    )
    select jsonb_build_object(
      'open', (select count(*) from public.wa_conversations where status = 'open'),
      'unassigned', (select count(*) from public.wa_conversations where status = 'open' and assigned_to is null),
      'unanswered_over', (select count(*) from public.wa_conversations c where c.status = 'open' and c.last_inbound_at is not null and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at) and c.last_inbound_at < now() - make_interval(mins => greatest(1, coalesce(p_over_minutes, 15)))),
      'over_minutes', greatest(1, coalesce(p_over_minutes, 15)),
      'inbound', (select count(*) from public.messages where direction = 'in' and channel = 'cloud' and created_at between p_from and p_to),
      'outbound', (select count(*) from public.messages where direction = 'out' and channel = 'cloud' and created_at between p_from and p_to),
      'median_first_response_secs', (select round((percentile_cont(0.5) within group (order by secs))::numeric) from resp),
      'agents', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.agent, 'name', coalesce(public.crm_name(a.agent), 'Unknown'), 'first_responses', a.n, 'median_secs', a.med,
          'replies', (select count(*) from public.messages o where o.channel = 'cloud' and o.direction = 'out' and o.sender = 'staff' and o.assigned_to = a.agent and o.created_at between p_from and p_to),
          'open_assigned', (select count(*) from public.wa_conversations c where c.status = 'open' and c.assigned_to = a.agent)) order by a.n desc)
        from (select agent, count(*) as n, round((percentile_cont(0.5) within group (order by secs))::numeric) as med from resp group by agent) a), '[]'::jsonb))
  );
end; $$;

create or replace function public.admin_wa_list(p_agent uuid default null, p_over_minutes int default null, p_from timestamptz default null, p_to timestamptz default null, p_limit int default 200) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row order by (row->>'last_message_at') desc nulls last) from (
    select jsonb_build_object('phone', c.phone, 'name', coalesce(l.name, c.profile_name), 'lead_id', c.lead_id, 'booking_id', l.booking_id, 'paid', l.confirm_paid_at is not null, 'status', c.status,
      'assigned_to', c.assigned_to, 'assigned_name', public.crm_name(c.assigned_to), 'last_preview', c.last_preview, 'last_message_at', c.last_message_at, 'last_inbound_at', c.last_inbound_at, 'last_outbound_at', c.last_outbound_at,
      'waiting_minutes', case when c.status = 'open' and c.last_inbound_at is not null and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at) then floor(extract(epoch from (now() - c.last_inbound_at)) / 60) end,
      'in_count', (select count(*) from public.messages m where m.phone = c.phone and m.channel = 'cloud' and m.direction = 'in'), 'out_count', (select count(*) from public.messages m where m.phone = c.phone and m.channel = 'cloud' and m.direction = 'out'),
      'ai_auto', c.ai_auto) as row
    from public.wa_conversations c left join public.leads l on l.id = c.lead_id
    where (p_agent is null or c.assigned_to = p_agent)
      and (p_from is null or c.last_message_at >= p_from) and (p_to is null or c.last_message_at <= p_to)
      and (p_over_minutes is null or (c.status = 'open' and c.last_inbound_at is not null and (c.last_outbound_at is null or c.last_inbound_at > c.last_outbound_at) and c.last_inbound_at < now() - make_interval(mins => p_over_minutes)))
    order by c.last_message_at desc nulls last limit greatest(1, least(coalesce(p_limit, 200), 500))) z), '[]'::jsonb);
end; $$;

revoke all on function public.crm_wa_inbox(text, text, int), public.crm_wa_thread(text, int), public.crm_wa_claim(text), public.crm_wa_close(text, text), public.crm_wa_reopen(text), public.crm_wa_note(text, text), public.crm_wa_mark_read(text),
  public.crm_wa_ai(text, boolean), public.crm_wa_send_context(text), public.crm_wa_media_ok(text), public.admin_wa_overview(timestamptz, timestamptz, int), public.admin_wa_list(uuid, int, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.crm_wa_inbox(text, text, int), public.crm_wa_thread(text, int), public.crm_wa_claim(text), public.crm_wa_close(text, text), public.crm_wa_reopen(text), public.crm_wa_note(text, text), public.crm_wa_mark_read(text),
  public.crm_wa_ai(text, boolean), public.crm_wa_send_context(text), public.crm_wa_media_ok(text), public.admin_wa_overview(timestamptz, timestamptz, int), public.admin_wa_list(uuid, int, timestamptz, timestamptz, int) to authenticated;
