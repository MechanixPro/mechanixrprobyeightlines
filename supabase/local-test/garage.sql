-- Behaviour test for 20270101000000_garage_app.sql on a LOCAL scratch Postgres (never Supabase). Run after journey.sql by run.sh.
-- Permission matrix: garage with a valid PIN, wrong PIN, other garage, supervisor (owner), admin (staff), agent, Technician lead, stranger, anon. Placeholders only: no real names, numbers or emails.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
-- people (made by paid-confirmation.sql): a9 owner (supervisor), a1 staff admin, c3 sales agent, e5 Technician lead, b2 stranger
insert into public.garages (id, name, mobile, status) values ('99999999-0000-0000-0000-00000000a001','Test Garage A','9000000011','live'),('99999999-0000-0000-0000-00000000b001','Test Garage B','9000000012','live');
-- G1: bike with a pickup job at the "started" stage (door code verified) and no quote yet. G2: picked up with an approved quote.
insert into public.leads (id, name, phone, email, address, area, pincode, preferred_date, preferred_slot, status, confirm_fee, vehicle, job_place, source, notes) values
 ('77777777-0000-0000-0000-000000000001','Asha Rao','9876500101','asha.private@example.invalid','12, Private Lane, Test Nagar','HSR Layout','560102', current_date,'morning','payment_sent',49,'bike','garage','website','call 9876500101 about the noise'),
 ('77777777-0000-0000-0000-000000000002','Vikram Shah','9876500102','vikram.private@example.invalid','99, Secret Road','Indiranagar','560038', current_date,'morning','payment_sent',49,'bike','garage','website',null);
update public.leads set status = 'paid' where id in ('77777777-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002');
update public.leads set visit_stage = 'started', visit_stage_at = now() where id in ('77777777-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002');
select public.booking_open_secrets('77777777-0000-0000-0000-000000000001'); select public.booking_open_secrets('77777777-0000-0000-0000-000000000002');
create temp table gk (tok text, ver int); grant all on gk to public;

-- ───────────── who may manage garages ─────────────
set role anon;
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','4821')$$, 'permission denied', 'anon cannot create access');
select pg_temp.fails($$select public.garage_login('x','1234')$$, 'permission denied', 'anon cannot call the login function');
select pg_temp.fails($$select count(*) from public.garage_access$$, 'permission denied', 'anon cannot read access rows');
select pg_temp.fails($$select count(*) from public.garage_assignments$$, 'permission denied', 'anon cannot read assignments');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','4821')$$, 'not allowed', 'a stranger is refused');
select pg_temp.fails($$select count(*) from public.garage_access$$, 'permission denied', 'a signed-in user cannot read access rows directly');
select pg_temp.fails($$select public.garage_login('x','1234')$$, 'permission denied', 'a signed-in user cannot call the login function');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','4821')$$, 'permission', 'a sales agent is refused');
select pg_temp.fails($$select public.crm_garage_assign('77777777-0000-0000-0000-000000000001','99999999-0000-0000-0000-00000000a001','x',null)$$, 'permission', 'a sales agent cannot assign');
select pg_temp.fails($$select public.crm_garage_estimates_inbox()$$, 'permission', 'a sales agent cannot read the inbox');
select pg_temp.fails($$select public.crm_garage_assignments_list()$$, 'permission', 'a sales agent cannot list assignments');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','4821')$$, 'permission', 'the Technician lead (technician side) is refused');
select pg_temp.fails($$select public.crm_garage_settlement_set('77777777-0000-0000-0000-000000000001', 100, false)$$, 'permission', 'a technician cannot enter amounts');
-- staff admin creates access for both garages; the link is shown once
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into gk select split_part(public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','4821') ->> 'link', '=', 2), 0;
select pg_temp.ok((select tok ~ '^[0-9a-f]{48}$' from gk), 'the private link has a 192-bit token');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000a001','5821')$$, 'already has access', 'a second Owner access for the same garage is refused');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000b001','111111')$$, 'not all the same', 'a one-digit PIN is refused');
select pg_temp.fails($$select public.crm_garage_access_create('99999999-0000-0000-0000-00000000b001','12')$$, '4 to 6', 'a short PIN is refused');
reset role;
-- supervisor (owner) creates garage B's access
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into gk select split_part(public.crm_garage_access_create('99999999-0000-0000-0000-00000000b001','739204') ->> 'link', '=', 2), 0;
reset role;
select pg_temp.ok((select count(*) from public.garage_access) = 2, 'two accesses exist');
select pg_temp.ok(not exists (select 1 from public.garage_access where link_hash in (select tok from gk)), 'the token itself is not stored');
select pg_temp.ok(not exists (select 1 from public.garage_access where pin_hash in ('4821','739204') or pin_hash !~ '^\$2'), 'PINs are stored as bcrypt hashes');
select pg_temp.ok(not exists (select 1 from public.audit_log where details::text ~ '4821|739204'), 'no PIN in the audit log');

-- ───────────── login (service role, like the Edge Function) ─────────────
create temp table ta as select tok from gk limit 1; create temp table tb as select tok from gk offset 1 limit 1; grant all on ta, tb to public;
set role service_role;
select pg_temp.ok((public.garage_login('0000000000000000000000000000000000000000000000ab','4821') ->> 'error') = 'link', 'an unknown link fails');
select pg_temp.ok((public.garage_login('bad','4821') ->> 'error') = 'link', 'a malformed link fails');
select pg_temp.ok((public.garage_login((select tok from ta),'1111') ->> 'error') = 'pin', 'a wrong PIN fails');
select pg_temp.ok((public.garage_login((select tok from ta),'1111') ->> 'left') = '3', 'the wrong tries are counted');
select pg_temp.ok((public.garage_login((select tok from ta),'4821') ->> 'ok') = 'true', 'the right PIN works and resets the count');
select pg_temp.ok((select failed_attempts from public.garage_access where link_hash = encode(extensions.digest((select tok from ta),'sha256'),'hex')) = 0, 'success clears the failures');
select public.garage_login((select tok from ta),'1111'), public.garage_login((select tok from ta),'1111'), public.garage_login((select tok from ta),'1111'), public.garage_login((select tok from ta),'1111');
select pg_temp.ok((public.garage_login((select tok from ta),'1111') ->> 'error') = 'locked', 'the 5th wrong PIN locks the access');
select pg_temp.ok((public.garage_login((select tok from ta),'4821') ->> 'error') = 'locked', 'even the right PIN is refused while locked');
reset role;
update public.garage_access set locked_until = now() - interval '1 minute' where link_hash = encode(extensions.digest((select tok from ta),'sha256'),'hex');
set role service_role;
select pg_temp.ok((public.garage_login((select tok from ta),'4821') ->> 'ok') = 'true', 'after 15 minutes the lock is over');
select pg_temp.ok((public.garage_login((select tok from tb),'4821') ->> 'error') = 'pin', 'garage A''s PIN does not open garage B''s link');
reset role;
create temp table sa as select (public.garage_login((select tok from ta),'4821') ->> 'access_id')::uuid as acc, (public.garage_login((select tok from ta),'4821') ->> 'session_version')::int as ver;
create temp table sb as select (public.garage_login((select tok from tb),'739204') ->> 'access_id')::uuid as acc, (public.garage_login((select tok from tb),'739204') ->> 'session_version')::int as ver;
grant all on sa, sb, ta, tb to public;
select pg_temp.ok((public.garage_session_check((select acc from sa), (select ver from sa)) ->> 'ok') = 'true', 'a fresh session is valid');
select pg_temp.ok((public.garage_session_check((select acc from sa), 99) ->> 'ok') = 'false', 'a wrong session version is refused');

-- ───────────── assignment ─────────────
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.ok((public.crm_garage_assign('77777777-0000-0000-0000-000000000001','99999999-0000-0000-0000-00000000a001','Front brake pads worn, chain loose', now() + interval '2 days') ->> 'status') = 'sent', 'supervisor sends job 1 to garage A');
reset role;
select pg_temp.ok((select count(*) from public.garage_assignments where status = 'sent') = 1, 'one open assignment');
select pg_temp.fails($$insert into public.garage_assignments (lead_id, garage_id) values ('77777777-0000-0000-0000-000000000001','99999999-0000-0000-0000-00000000b001')$$, 'garage_assignments_one_open', 'a lead has only one open assignment');
select pg_temp.ok((select count(*) from public.crm_activities where body like 'Sent to partner garage Test Garage A%') = 1, 'a history line says it was sent');
-- reassign while still "sent": the old one is cancelled, the new one opens
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.crm_garage_assign('77777777-0000-0000-0000-000000000001','99999999-0000-0000-0000-00000000b001','Moved', null);
reset role;
select pg_temp.ok((select count(*) from public.garage_assignments where status = 'cancelled') = 1, 'the old assignment is cancelled');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.crm_garage_assign('77777777-0000-0000-0000-000000000001','99999999-0000-0000-0000-00000000a001','Front brake pads worn, chain loose', now() + interval '2 days');
reset role;
select pg_temp.ok((select count(*) from public.garage_assignments where status in ('sent','received','in_work','ready')) = 1, 'back to garage A: still one open');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(not (public.crm_garage_assignments_list()::text ~ '9876500101|asha.private|Private Lane'), 'the staff list holds no phone, email or address');
reset role;
create temp table asg as select id from public.garage_assignments where status = 'sent' and garage_id = '99999999-0000-0000-0000-00000000a001';
grant all on asg to public;

-- ───────────── garage B (other garage) and a switched-off access cannot touch garage A's job ─────────────
select pg_temp.ok((public.garage_progress_set((select acc from sb), (select id from asg), 'received') ->> 'error') = 'This job is not available.', 'another garage cannot update this job');
select pg_temp.ok(not public.garage_contact_view((select acc from sb), (select id from asg)), 'another garage cannot open the contact');
select pg_temp.ok((public.garage_estimate_save((select acc from sb), (select id from asg), '[{"kind":"parts","name":"Pads","amount":100}]', null, 3, null, true) ->> 'ok') = 'false', 'another garage cannot send an estimate for it');

-- ───────────── progress, the quote gate, estimates ─────────────
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'error') = 'Mark Vehicle received first.', 'work cannot start before the vehicle is received');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'ready') ->> 'error') = 'Mark Vehicle received first.', 'ready cannot come first');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'bogus') ->> 'ok') = 'false', 'an unknown update is refused');
insert into storage.objects (bucket_id, name) values ('garage-updates', '99999999-0000-0000-0000-00000000a001/' || (select id from asg) || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'received', array['99999999-0000-0000-0000-00000000b001/' || (select id from asg) || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg']) ->> 'ok') = 'false', 'a photo path under another garage is refused');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'received', array['99999999-0000-0000-0000-00000000a001/' || (select id from asg) || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg']) ->> 'ok') = 'false', 'a photo that was never uploaded is refused');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'received', array['99999999-0000-0000-0000-00000000a001/' || (select id from asg) || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg'], 'Scratch on left mirror') ->> 'status') = 'received', 'vehicle received with a photo and a note');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'received') ->> 'already') = 'true', 'the same tap twice changes nothing');
select pg_temp.ok((select count(*) from public.garage_progress where event = 'received') = 1, 'one progress row');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'received', null, 'Aadhaar 1234 5678 9012') ->> 'already') = 'true', 'repeat is a no-op even with a bad note');
-- the gate: no quote at all, then a sent quote, both block "Work started"
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'blocked') = 'quote', 'Work started is blocked with no approved quote');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'error') like 'The customer has not approved the quote yet%', 'the message is plain');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[]', null, 3, null, true) ->> 'error') = 'Add at least one line.', 'an estimate needs a line');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"gold","name":"Pads","amount":100}]', null, 3, null, true) ->> 'ok') = 'false', 'a bad line kind is refused');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Pads","amount":-5}]', null, 3, null, true) ->> 'ok') = 'false', 'a negative amount is refused');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Pads","amount":100}]', null, null, null, true) ->> 'error') = 'Give the estimated hours or a return day.', 'submitting needs hours or a day');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Pads","amount":100}]', null, 3, current_date + 1, true) ->> 'ok') = 'false', 'hours and a day together are refused');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Pads","amount":100}]', 'notes', 3, null, false) ->> 'submitted') = 'false', 'a draft can be saved');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Brake pads","amount":850},{"kind":"labour","name":"Fit pads and tune chain","amount":400}]', 'Both pads worn', 6, null, true) ->> 'total')::numeric = 1475, 'submitted: 1250 + 18% GST = 1475');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"x1","amount":1}]', null, 2, null, true) ->> 'error') like 'Your estimate is with the Mechanix Pro team%', 'only one estimate waits for review at a time');
create temp table est as select id from public.garage_estimates where status = 'submitted'; grant all on est to public;
select pg_temp.ok((select count(*) from public.job_quotes where lead_id = '77777777-0000-0000-0000-000000000001') = 0, 'nothing reached the customer: no quote exists yet');
-- inbox and review: staff only
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_garage_estimate_review((select id from est), true)$$, 'permission', 'an agent cannot review');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(jsonb_array_length(public.crm_garage_estimates_inbox()) = 1 and (public.crm_garage_estimates_inbox() -> 0 ->> 'gst')::numeric = 225, 'the inbox shows the submitted estimate with GST apart');
select pg_temp.ok((public.crm_garage_estimate_review((select id from est), true, 'ok') ->> 'status') = 'converted', 'admin approves: a draft quote is made');
select pg_temp.fails($$select public.crm_garage_estimate_review((select id from est), false)$$, 'already reviewed', 'an estimate is reviewed once');
reset role;
select pg_temp.ok((select status = 'draft' and subtotal = 1250 and total = 1475 from public.job_quotes where lead_id = '77777777-0000-0000-0000-000000000001'), 'the draft quote has the garage lines and GST');
select pg_temp.ok((select converted_quote_id is not null from public.garage_estimates where status = 'converted'), 'the estimate points at the draft quote');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'blocked') = 'quote', 'a draft quote still blocks work (the customer has seen nothing)');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.crm_quote_send('77777777-0000-0000-0000-000000000001');
reset role;
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'blocked') = 'quote', 'a sent quote still blocks work until the customer approves');
select public.quote_decide((select track_token from public.booking_secrets where lead_id = '77777777-0000-0000-0000-000000000001'), 1, 'approve', null);
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'work_started') ->> 'status') = 'in_work', 'work starts once the customer approved');
-- a rejected estimate: the garage can send a new one
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Chain kit","amount":1200}]', null, null, current_date + 2, true) ->> 'ok') = 'true', 'a second estimate (revision) can be sent');
create temp table est2 as select id from public.garage_estimates where status = 'submitted'; grant all on est2 to public;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.crm_garage_estimate_review((select id from est2), false, 'Too high, please recheck') ->> 'status') = 'rejected', 'admin rejects with a note');
reset role;
select pg_temp.ok((select count(*) from public.job_quotes where lead_id = '77777777-0000-0000-0000-000000000001') = 1, 'a rejected estimate creates no quote');
-- ready: the stage stays when the visit was only "started"; closed jobs are not editable
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'ready') ->> 'stage_moved') = 'false', 'ready leaves a "started" visit stage alone');
select pg_temp.ok((select visit_stage from public.leads where id = '77777777-0000-0000-0000-000000000001') = 'started', 'visit stage unchanged');
select pg_temp.ok((public.garage_estimate_save((select acc from sa), (select id from asg), '[{"kind":"parts","name":"Late","amount":1}]', null, 2, null, true) ->> 'error') = 'This job is closed.', 'no estimate once the job is ready');

-- ───────────── customer contact: only while the job is open ─────────────
select pg_temp.ok(public.garage_contact_view((select acc from sa), (select id from asg)), 'the contact opens while the job is open (ready counts as open)');
select pg_temp.ok((select count(*) from public.crm_activities where body = 'Partner garage viewed customer contact (Test Garage A)') = 1, 'one history line per view');
select pg_temp.ok(not exists (select 1 from public.crm_activities where body ~ '9876500101') and not exists (select 1 from public.audit_log where details::text ~ '9876500101'), 'the number is in no history line or log');
select pg_temp.ok(public.garage_contact_view((select acc from sa), (select id from asg)), 'a second view works');
update public.garage_access set active = false where id = (select acc from sa);
select pg_temp.ok(not public.garage_contact_view((select acc from sa), (select id from asg)), 'a switched-off garage gets no contact');
select pg_temp.ok((public.garage_session_check((select acc from sa), (select ver from sa)) ->> 'ok') = 'false', 'a switched-off garage has no session');
select pg_temp.ok((public.garage_login((select tok from ta),'4821') ->> 'error') = 'off', 'a switched-off garage cannot log in');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.crm_garage_enable((select acc from sa));
reset role;
select pg_temp.ok(public.garage_contact_view((select acc from sa), (select id from asg)), 'switched on again: the contact opens');
-- PIN reset ends old sessions; revoke ends the link
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.crm_garage_pin_reset((select acc from sa), '902417');
reset role;
select pg_temp.ok((public.garage_session_check((select acc from sa), (select ver from sa)) ->> 'ok') = 'false', 'a PIN reset ends the old session');
select pg_temp.ok((public.garage_login((select tok from ta),'4821') ->> 'error') = 'pin', 'the old PIN no longer works');
select pg_temp.ok((public.garage_login((select tok from ta),'902417') ->> 'ok') = 'true', 'the new PIN works');
-- rate limit: 40 contact views per 10 minutes
do $$ declare i int; ok boolean; begin for i in 1..45 loop ok := public.garage_contact_view((select acc from sa), (select id from asg)); end loop; if ok then raise exception 'FAILED: contact views are not rate limited'; end if; end $$;
delete from public.audit_log where action = 'garage_contact_view';
-- settlement (Admin enters the amount)
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.fails($$select public.crm_garage_settlement_set((select id from asg), 1500, false)$$, 'permission', 'an agent cannot enter a settlement');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select public.crm_garage_settlement_set((select id from asg), -5, false)$$, 'amount', 'a negative amount is refused');
select pg_temp.ok((public.crm_garage_settlement_set((select id from asg), 1500, false, 'Entered by admin') ->> 'ok') = 'true', 'admin enters the amount');
select public.crm_garage_settlement_set((select id from asg), 1500, true, 'Paid');
reset role;
select pg_temp.ok((select settled and settled_at is not null and amount = 1500 from public.garage_settlements), 'settled with a time');
reset role;

-- ───────────── the return closes the job; the contact closes with it ─────────────
update public.leads set visit_stage = 'ready' where id = '77777777-0000-0000-0000-000000000001';
update public.leads set visit_stage = 'returned' where id = '77777777-0000-0000-0000-000000000001';
select pg_temp.ok((select status from public.garage_assignments where id = (select id from asg)) = 'returned', 'returned: the assignment closes');
select pg_temp.ok(not public.garage_contact_view((select acc from sa), (select id from asg)), 'no contact after the return');
select pg_temp.ok((public.garage_progress_set((select acc from sa), (select id from asg), 'ready') ->> 'error') = 'This job is closed.', 'a closed job takes no updates');

-- ───────────── job 2: ready moves the visit stage to Ready; a lost lead cancels ─────────────
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.crm_quote_save('77777777-0000-0000-0000-000000000002','[{"kind":"parts","name":"Oil","amount":300}]','{"kind":"hours","hours":4}'::jsonb); select public.crm_quote_send('77777777-0000-0000-0000-000000000002');
reset role;
select public.quote_decide((select track_token from public.booking_secrets where lead_id = '77777777-0000-0000-0000-000000000002'), 1, 'approve', null);
update public.leads set visit_stage = 'picked_up', visit_stage_at = now() where id = '77777777-0000-0000-0000-000000000002';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.crm_garage_assign('77777777-0000-0000-0000-000000000002','99999999-0000-0000-0000-00000000b001','Oil change', null);
reset role;
create temp table asg2 as select id from public.garage_assignments where lead_id = '77777777-0000-0000-0000-000000000002' and status = 'sent'; grant all on asg2 to public;
select public.garage_progress_set((select acc from sb), (select id from asg2), 'received');
select pg_temp.ok((public.garage_progress_set((select acc from sb), (select id from asg2), 'work_started') ->> 'status') = 'in_work', 'the approved quote lets work start at once');
select pg_temp.ok((public.garage_progress_set((select acc from sb), (select id from asg2), 'ready') ->> 'stage_moved') = 'true', 'ready moves a picked-up visit to Ready');
select pg_temp.ok((select visit_stage from public.leads where id = '77777777-0000-0000-0000-000000000002') = 'ready', 'the visit stage is Ready');
update public.leads set status = 'lost', crm_lost_reason = 'Other' where id = '77777777-0000-0000-0000-000000000002';
select pg_temp.ok((select status from public.garage_assignments where id = (select id from asg2)) = 'cancelled', 'a lost lead cancels the assignment');
select pg_temp.ok(not public.garage_contact_view((select acc from sb), (select id from asg2)), 'no contact for a closed lead');

-- ───────────── notifications and the bucket ─────────────
select pg_temp.ok(public.notification_claim('77777777-0000-0000-0000-000000000001', 'team_garage_ready'), 'the new "ready" alert kind is accepted');
select pg_temp.ok(public.notification_claim('77777777-0000-0000-0000-000000000001', 'team_garage_estimate:2'), 'the numbered estimate alert kind is accepted');
select pg_temp.fails($$select public.notification_claim('77777777-0000-0000-0000-000000000001', 'team_garage_other')$$, 'booking_notifications_kind_check', 'unknown kinds are still refused');
select pg_temp.ok((select public = false and file_size_limit = 1572864 and allowed_mime_types = array['image/jpeg','image/png','image/webp'] from storage.buckets where id = 'garage-updates'), 'the bucket is private, 1.5 MB, images only');
-- anon and signed-in users never read the new tables
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select count(*) from public.garage_estimates$$, 'permission denied', 'even an admin reads the tables only through functions');
select pg_temp.fails($$select count(*) from public.garage_settlements$$, 'permission denied', 'settlements are closed');
select pg_temp.fails($$select count(*) from public.garage_progress$$, 'permission denied', 'progress is closed');
reset role;
select 'ALL GARAGE APP SQL CHECKS PASSED' as result;
