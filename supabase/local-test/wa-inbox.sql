-- WhatsApp Cloud inbox checks (20270106000000_wa_inbox.sql). Runs in the LOCAL scratch database after the other tests; one transaction, rolled back. All numbers and names are placeholders.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','admin@example.invalid'),('00000000-0000-0000-0000-0000000000b2','nobody@example.invalid'),('00000000-0000-0000-0000-0000000000c3','sales@example.invalid'),('00000000-0000-0000-0000-0000000000c4','agent2@example.invalid') on conflict do nothing;
insert into public.admins (user_id, name, role) values ('00000000-0000-0000-0000-0000000000a1','Staff Admin','staff') on conflict do nothing;
insert into public.crm_users (user_id, name, role, active) values ('00000000-0000-0000-0000-0000000000c3','Sales Agent','sales',true),('00000000-0000-0000-0000-0000000000c4','Second Agent','sales',true) on conflict do nothing;
insert into public.leads (id, name, phone, status, source, confirm_paid_at, est_total) values ('d1000000-0000-0000-0000-000000000001', 'Test Customer', '9800000001', 'paid', 'whatsapp', now(), 1234);

-- old rows keep channel aisensy; new columns are empty
insert into public.messages (lead_id, phone, direction, sender, body, wa_message_id) values ('d1000000-0000-0000-0000-000000000001', '9800000001', 'out', 'staff', 'old desk message', 'as:old1');
select pg_temp.ok((select channel from public.messages where wa_message_id = 'as:old1') = 'aisensy' and (select status from public.messages where wa_message_id = 'as:old1') is null, 'old rows stay channel aisensy');

-- inbound: stored once, duplicate ignored, conversation counts
select pg_temp.ok((public.wa_record_inbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.IN1', 'hello', null, '918310621498', 'Test Customer') ->> 'duplicate')::boolean = false, 'first inbound stored');
select pg_temp.ok((public.wa_record_inbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.IN1', 'hello', null, '918310621498', 'Test Customer') ->> 'duplicate')::boolean = true, 'same wa_message_id is a duplicate');
select pg_temp.ok((select count(*) from public.messages where wa_message_id = 'wamid.IN1') = 1 and (select unread from public.wa_conversations where phone = '9800000001') = 1, 'one row, unread 1');
select public.wa_record_inbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.IN2', '[image]', '{"type":"image","id":"MEDIA1","mime":"image/jpeg"}'::jsonb, '918310621498', null);
select pg_temp.ok((select unread from public.wa_conversations where phone = '9800000001') = 2 and (select media ->> 'id' from public.messages where wa_message_id = 'wamid.IN2') = 'MEDIA1', 'media id stored, unread 2');

-- outbound and status ordering
select public.wa_record_outbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.OUT1', 'reply', 'staff', null, 'sent', '00000000-0000-0000-0000-0000000000c3', '918310621498');
select pg_temp.ok((select assigned_to from public.wa_conversations where phone = '9800000001') = '00000000-0000-0000-0000-0000000000c3' and (select unread from public.wa_conversations where phone = '9800000001') = 0, 'staff reply claims an unassigned conversation and clears unread');
select pg_temp.ok(public.wa_apply_status('wamid.OUT1', 'read'), 'sent moves to read (call)');
select pg_temp.ok((select status from public.messages where wa_message_id = 'wamid.OUT1') = 'read', 'sent moves to read');
select pg_temp.ok(not public.wa_apply_status('wamid.OUT1', 'delivered'), 'read never moves back to delivered (call)');
select pg_temp.ok((select status from public.messages where wa_message_id = 'wamid.OUT1') = 'read', 'read never moves back to delivered');
select pg_temp.ok(not public.wa_apply_status('wamid.OUT1', 'failed', 'x'), 'failed after read is ignored (call)');
select pg_temp.ok((select status from public.messages where wa_message_id = 'wamid.OUT1') = 'read', 'failed after read is ignored');
select public.wa_record_outbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.OUT2', 'second', 'staff', null, 'sent', '00000000-0000-0000-0000-0000000000c3', '918310621498');
select pg_temp.ok(public.wa_apply_status('wamid.OUT2', 'failed', 'Re-engagement message'), 'failed accepted before delivery (call)');
select pg_temp.ok((select status_detail from public.messages where wa_message_id = 'wamid.OUT2') = 'Re-engagement message', 'failed accepted before delivery');
select pg_temp.ok(not public.wa_apply_status('wamid.OUT2', 'delivered'), 'nothing moves out of failed');
select public.wa_record_outbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.OUT3', 'third', 'staff', null, 'unknown', '00000000-0000-0000-0000-0000000000c3', '918310621498');
select pg_temp.ok(public.wa_apply_status('wamid.OUT3', 'sent'), 'unknown can advance; an unknown id is ignored (call)');
select pg_temp.ok(not public.wa_apply_status('wamid.NOPE', 'sent'), 'unknown can advance; an unknown id is ignored');

-- the webhook functions are not callable by signed-in users
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select public.wa_record_inbound('9800000002', null, 'x', 'x', null, null, null)$$, 'permission', 'authenticated cannot record inbound');
select pg_temp.fails($$select * from public.wa_conversations$$, 'permission', 'conversations table is closed');
select pg_temp.fails($$select * from public.wa_notes$$, 'permission', 'notes table is closed');
reset role;

-- Crew: an agent reads, claims and notes; a person with no role is refused; no money data
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.crm_wa_inbox('all')$$, 'access', 'no role, no inbox');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select pg_temp.ok((public.crm_wa_inbox('all') -> 'rows' -> 0 ->> 'paid')::boolean = true and (public.crm_wa_inbox('mine') -> 'rows') = '[]'::jsonb, 'agent sees the conversation with a paid flag; not mine');
select pg_temp.ok((public.crm_wa_inbox('all', '980000') -> 'rows' -> 0 ->> 'phone') = '9800000001' and public.crm_wa_inbox('all', 'zzz-no-match') -> 'rows' = '[]'::jsonb, 'search by phone digits and text');
select pg_temp.ok((public.crm_wa_inbox('unread') -> 'counts' ->> 'unread')::int = 1, 'unread counts for a user who has not read it');
select pg_temp.ok(not ((public.crm_wa_thread('+91 98000 00001') -> 'lead')::jsonb ? 'est_total') and (public.crm_wa_thread('9800000001') -> 'lead' ->> 'paid')::boolean, 'thread carries a paid flag and no money fields');
select pg_temp.ok(jsonb_array_length(public.crm_wa_thread('9800000001') -> 'items') = 6, 'thread holds old AiSensy and Cloud rows');
select pg_temp.fails($$select public.crm_wa_claim('9800000001')$$, 'already taken', 'a colleague cannot steal a claimed conversation');
select pg_temp.fails($$select public.crm_wa_send_context('9800000001')$$, 'claimed by', 'a colleague cannot reply on a claimed conversation');
select public.crm_wa_mark_read('9800000001');
select pg_temp.ok((public.crm_wa_inbox('unread') -> 'counts' ->> 'unread')::int = 0, 'mark read clears my unread');
select public.crm_wa_note('9800000001', 'internal note');
select pg_temp.ok(jsonb_array_length(public.crm_wa_thread('9800000001') -> 'notes') = 1, 'note stored and returned apart from messages');
select pg_temp.fails($$select public.crm_wa_note('9800000001', '   ')$$, 'write the note', 'empty note refused');
select pg_temp.fails($$select public.admin_wa_overview()$$, 'admins only', 'agent cannot open supervision');
select pg_temp.fails($$select public.admin_wa_list()$$, 'admins only', 'agent cannot list supervision');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok((public.crm_wa_inbox('mine') -> 'counts' ->> 'mine')::int = 1, 'owner sees it in Mine');
select pg_temp.ok((public.crm_wa_send_context('9800000001') ->> 'window_open')::boolean = true, 'window open after an inbound message');
select public.crm_wa_close('9800000001', 'done');
select pg_temp.ok((public.crm_wa_inbox('closed') -> 'rows' -> 0 ->> 'status') = 'closed', 'closed tab lists it');
reset role;
select public.wa_record_inbound('9800000001', 'd1000000-0000-0000-0000-000000000001', 'wamid.IN3', 'again', null, '918310621498', null);
select pg_temp.ok((select status from public.wa_conversations where phone = '9800000001') = 'open', 'a new customer message reopens a closed conversation');

-- 24 hour window from the database side
update public.wa_conversations set last_inbound_at = now() - interval '25 hours' where phone = '9800000001';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok((public.crm_wa_send_context('9800000001') ->> 'window_open')::boolean = false, 'window closed after 24 hours');
select public.crm_wa_ai('9800000001', false);
select pg_temp.ok((public.crm_wa_thread('9800000001') -> 'conversation' ->> 'ai_auto')::boolean = false, 'per-conversation AI switch');
reset role;

-- Admin supervision: counts, median first response, per agent
delete from public.messages where phone = '9800000009';
insert into public.messages (phone, direction, sender, body, wa_message_id, channel, created_at, assigned_to) values
  ('9800000009', 'in', 'customer', 'q1', 'wamid.S1', 'cloud', now() - interval '3 hours', null),
  ('9800000009', 'out', 'staff', 'a1', 'wamid.S2', 'cloud', now() - interval '3 hours' + interval '120 seconds', '00000000-0000-0000-0000-0000000000c3'),
  ('9800000009', 'in', 'customer', 'q2', 'wamid.S3', 'cloud', now() - interval '2 hours', null),
  ('9800000009', 'in', 'customer', 'q2b', 'wamid.S3b', 'cloud', now() - interval '110 minutes', null),
  ('9800000009', 'out', 'staff', 'a2', 'wamid.S4', 'cloud', now() - interval '2 hours' + interval '600 seconds', '00000000-0000-0000-0000-0000000000c3');
insert into public.wa_conversations (phone, last_message_at, last_inbound_at, last_outbound_at, status) values ('9800000009', now() - interval '40 minutes', now() - interval '40 minutes', now() - interval '3 hours', 'open') on conflict (phone) do update set last_inbound_at = excluded.last_inbound_at, last_outbound_at = excluded.last_outbound_at, status = 'open';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.admin_wa_overview(now() - interval '1 day', now(), 30) ->> 'median_first_response_secs')::int = 360, 'median of 120 and 600 seconds is 360 (a burst counts once)');
select pg_temp.ok((public.admin_wa_overview(now() - interval '1 day', now(), 30) ->> 'unanswered_over')::int >= 1 and (public.admin_wa_overview(now() - interval '1 day', now(), 90) ->> 'unanswered_over')::int < (public.admin_wa_overview(now() - interval '1 day', now(), 30) ->> 'unanswered_over')::int, 'unanswered over N minutes shrinks as N grows');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.admin_wa_overview(now() - interval '1 day', now(), 30) -> 'agents') a where a ->> 'name' = 'Sales Agent' and (a ->> 'replies')::int >= 2), 'per-agent replies');
select pg_temp.ok(jsonb_array_length(public.admin_wa_list(null, 30)) >= 1 and jsonb_array_length(public.admin_wa_list('00000000-0000-0000-0000-0000000000c4')) = 0, 'admin list filters by agent and by minutes');
select pg_temp.ok((public.crm_wa_thread('9800000009') -> 'conversation' ->> 'status') = 'open', 'admin opens any thread');
select public.crm_wa_claim('9800000009');
reset role;

rollback;
select 'ALL WA INBOX SQL CHECKS PASSED' as result;
