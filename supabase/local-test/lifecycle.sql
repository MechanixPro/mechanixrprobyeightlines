-- Behaviour test for 20270144000000_booking_lifecycle.sql on a LOCAL scratch Postgres (never Supabase). Run by hand: sh supabase/local-test/lifecycle.sh
-- Each check raises an exception on failure, so psql with ON_ERROR_STOP=1 fails loudly. Placeholders only: no real names, numbers or emails.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.oks(expr text, msg text) returns void language plpgsql security definer as $$ declare b boolean; begin execute 'select ' || expr into b; if b is not true then raise exception 'FAILED: %', msg; end if; end $$;   -- same as ok, but reads tables as the owner (the signed-in role has no direct table access)
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.st(l uuid) returns text language sql as $$ select public.booking_state(x) from public.leads x where x.id = l $$;

-- people: A = admin (owner), S = sales agent (owns some leads), C = Crew lead (supervisor), X = stranger (no role)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000001a1','la@example.invalid'),('00000000-0000-0000-0000-0000000001c3','ls@example.invalid'),('00000000-0000-0000-0000-0000000001d1','lc@example.invalid'),('00000000-0000-0000-0000-0000000001b2','lx@example.invalid');
insert into public.admins (user_id, name, role) values ('00000000-0000-0000-0000-0000000001a1','Lifecycle Admin','owner');
insert into public.crm_users (user_id, name, role, active) values ('00000000-0000-0000-0000-0000000001c3','Lifecycle Agent','sales',true),('00000000-0000-0000-0000-0000000001d1','Lifecycle Crew Lead','supervisor',true);
insert into public.garages (id, name, mobile, status) values ('99999999-0000-0000-0000-0000000aa001','Lifecycle Garage A','9000000021','live'),('99999999-0000-0000-0000-0000000bb001','Lifecycle Garage B','9000000022','live');

-- leads (paid confirmation of 49 where it matters). The sales agent owns D1 and D2 (delivery) and Q5 (phone approval).
insert into public.leads (id, name, phone, preferred_date, preferred_slot, status, confirm_fee, paid_amount, vehicle, area, pincode, source, crm_owner) values
 ('d1111111-0000-0000-0000-000000000001','Delivery One','9876600001', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website','00000000-0000-0000-0000-0000000001c3'),
 ('d2222222-0000-0000-0000-000000000002','Delivery Two','9876600002', current_date,'morning','scheduled',49,49,'bike','HSR Layout','560102','website','00000000-0000-0000-0000-0000000001c3'),
 ('d3333333-0000-0000-0000-000000000003','Delivery Three','9876600003', current_date,'morning','new',null,null,'bike','HSR Layout','560102','website',null);
-- states
insert into public.leads (id, name, phone, status, vehicle, source) values
 ('5a000000-0000-0000-0000-000000000001','State New','9876600011','new','bike','website'),('5a000000-0000-0000-0000-000000000002','State Contacted','9876600012','contacted','bike','website'),
 ('5a000000-0000-0000-0000-000000000003','State Quoted','9876600013','quoted','bike','website'),('5a000000-0000-0000-0000-000000000004','State Link','9876600014','payment_sent','bike','website'),
 ('5a000000-0000-0000-0000-000000000005','State Lost','9876600015','lost','bike','website'),('5a000000-0000-0000-0000-000000000006','State Junk','9876600016','junk','bike','website');
select pg_temp.ok(pg_temp.st('5a000000-0000-0000-0000-000000000001') = 'new' and pg_temp.st('5a000000-0000-0000-0000-000000000002') = 'contacted' and pg_temp.st('5a000000-0000-0000-0000-000000000003') = 'quoted'
  and pg_temp.st('5a000000-0000-0000-0000-000000000004') = 'payment_sent' and pg_temp.st('5a000000-0000-0000-0000-000000000005') = 'lost' and pg_temp.st('5a000000-0000-0000-0000-000000000006') = 'junk', 'state keys for the early statuses');
select pg_temp.ok(pg_temp.st('d1111111-0000-0000-0000-000000000001') = 'paid' and pg_temp.st('d2222222-0000-0000-0000-000000000002') = 'scheduled', 'paid and scheduled keep their keys');
select pg_temp.ok((select array_agg(public.booking_state_label(k) order by o) from unnest(array['new','contacted','quoted','payment_sent','paid','scheduled','cancelled_customer','cancelled_company','lost','completed','ready_for_delivery','delivered','closed']) with ordinality as t(k, o))
  = array['New','Contacted','Quote sent','Advance link sent','Booked','Booked (visit scheduled)','Customer cancelled','Cancelled by us','Lost','Done','Vehicle ready for delivery','Vehicle delivered','Booking closed'], 'labels are exact');

-- ───────────── delivery lifecycle ─────────────
set role anon;
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','done')$$, 'permission denied', 'anon cannot set a delivery stage');
select pg_temp.fails($$select public.crm_booking_state('d1111111-0000-0000-0000-000000000001')$$, 'permission denied', 'anon cannot read the state');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b2');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','done')$$, 'not allowed', 'a stranger cannot set a delivery stage');
select pg_temp.fails($$select public.crm_booking_state('d1111111-0000-0000-0000-000000000001')$$, 'not allowed', 'a stranger cannot read the state');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001c3');   -- Crew agent who owns the booking
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','bogus')$$, 'choose done', 'unknown stage refused');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','ready')$$, 'mark the service done first', 'ready needs Done first');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','handed over')$$, 'mark the service done first', 'delivered needs Done first');
select pg_temp.fails($$select public.crm_delivery_set('d3333333-0000-0000-0000-000000000003','done')$$, 'only a booked job', 'a new lead cannot be marked done');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','done') ->> 'state') = 'completed', 'Crew marks the paid job done');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','done') ->> 'already') = 'true', 'Done twice is harmless');
select pg_temp.oks($q$(select completed_at is not null from public.leads where id = 'd1111111-0000-0000-0000-000000000001')$q$, 'completed_at is stamped by the existing trigger');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','closed')$$, 'deliver the vehicle first', 'closed needs delivered');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','ready') ->> 'state') = 'ready_for_delivery', 'ready after done');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','ready') ->> 'already') = 'true', 'ready twice is harmless');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','ready') ->> 'by_name') = 'Lifecycle Agent', 'the repeat reports who did it');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered')$$, 'short remark', 'remarks are required for delivered');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','ok')$$, 'short remark', 'remarks need 3 characters');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','Aadhaar 1234 5678 9012 given')$$, 'remove ID', 'no ID numbers in remarks');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','Handed over at the doorstep, customer happy') ->> 'state') = 'delivered', 'delivered with remarks');
select pg_temp.oks($q$(select delivered_at is not null and ready_at is not null and delivery_by = '00000000-0000-0000-0000-0000000001c3' and delivery_note like 'Handed over%' from public.leads where id = 'd1111111-0000-0000-0000-000000000001')$q$, 'time, person and remarks are stored');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','again please') ->> 'already') = 'true', 'delivered twice is harmless');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','ready')$$, 'already delivered', 'cannot go back to ready');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','closed') ->> 'state') = 'closed', 'closed after delivered');
select pg_temp.ok((public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','closed') ->> 'already') = 'true', 'closed twice is harmless');
select pg_temp.fails($$select public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','delivered','one more time')$$, 'already closed', 'cannot deliver a closed booking');
select pg_temp.ok((public.crm_booking_state('d1111111-0000-0000-0000-000000000001') ->> 'label') = 'Booking closed', 'the screen reads Booking closed');
select pg_temp.oks($q$(select count(*) from public.crm_activities where lead_id = 'd1111111-0000-0000-0000-000000000001' and actor = '00000000-0000-0000-0000-0000000001c3' and body like 'Vehicle ready for delivery%') = 1$q$, 'one history line for ready, with the actor');
select pg_temp.oks($q$exists (select 1 from public.crm_activities where lead_id = 'd1111111-0000-0000-0000-000000000001' and body like 'Vehicle delivered (by Lifecycle Agent). Remarks: Handed over%')$q$, 'the delivered line carries remarks and the name');
select pg_temp.oks($q$(select count(*) from public.audit_log where action in ('delivery_done','delivery_ready','delivery_delivered','delivery_closed')) = 4$q$, 'one audit row per stage');
-- skipping ready on a scheduled job with a garage job in ready: delivered sets ready_at and returns the garage job
reset role;
insert into public.garage_assignments (lead_id, garage_id, status) values ('d2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001','ready');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((public.crm_delivery_set('d2222222-0000-0000-0000-000000000002','done','Work finished') ->> 'state') = 'completed', 'Admin marks a scheduled job done');
select pg_temp.ok((public.crm_delivery_set('d2222222-0000-0000-0000-000000000002','delivered','Collected by the customer') ->> 'state') = 'delivered', 'delivered straight after done');
select pg_temp.oks($q$(select ready_at is not null from public.leads where id = 'd2222222-0000-0000-0000-000000000002')$q$, 'ready_at is set when ready was skipped');
select pg_temp.oks($q$(select status = 'returned' from public.garage_assignments where lead_id = 'd2222222-0000-0000-0000-000000000002')$q$, 'the garage job is returned');
reset role;

-- ───────────── notification kinds ─────────────
select pg_temp.ok(public.notification_claim('d1111111-0000-0000-0000-000000000001','delivery_ready_email') and public.notification_claim('d1111111-0000-0000-0000-000000000001','delivery_done_whatsapp')
  and public.notification_claim('d1111111-0000-0000-0000-000000000001','approval_email:2') and public.notification_claim('d1111111-0000-0000-0000-000000000001','approval_whatsapp:2')
  and public.notification_claim('d1111111-0000-0000-0000-000000000001','garage_approved:2') and public.notification_claim('d1111111-0000-0000-0000-000000000001','refund_whatsapp')
  and public.notification_claim('d1111111-0000-0000-0000-000000000001','refund_email') and public.notification_claim('d1111111-0000-0000-0000-000000000001','delivery_ready_whatsapp') and public.notification_claim('d1111111-0000-0000-0000-000000000001','delivery_done_email')
  and public.notification_claim('d1111111-0000-0000-0000-000000000001','garage_estimate_rejected:1'), 'the new kinds are accepted');
select pg_temp.fails($$select public.notification_claim('d1111111-0000-0000-0000-000000000001','delivery_bogus')$$, 'booking_notifications_kind_check', 'unknown kinds are still refused');
select pg_temp.fails($$select public.notification_claim('d1111111-0000-0000-0000-000000000001','approval_email:abc')$$, 'booking_notifications_kind_check', 'the suffix must be a number');
select pg_temp.ok(not public.notification_claim('d1111111-0000-0000-0000-000000000001','approval_email:2'), 'never twice for the same event');
select public.notification_finish('d1111111-0000-0000-0000-000000000001','approval_email:2','sent');
select pg_temp.oks($q$exists (select 1 from public.crm_activities where lead_id = 'd1111111-0000-0000-0000-000000000001' and body = 'Approval email sent')$q$, 'the history line uses the new label');
select pg_temp.ok(public.notification_claim('d1111111-0000-0000-0000-000000000001','team_paid'), 'old kinds still work');

-- ───────────── quotes: approve on behalf, self approvals, approval status ─────────────
insert into public.leads (id, name, phone, preferred_date, preferred_slot, status, confirm_fee, paid_amount, vehicle, area, pincode, source, crm_owner, visit_stage) values
 ('9a111111-0000-0000-0000-000000000001','Quote One','9876600021', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website',null,'started'),
 ('9a222222-0000-0000-0000-000000000002','Quote Two','9876600022', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website',null,'started'),
 ('9a333333-0000-0000-0000-000000000003','Quote Three','9876600023', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website',null,'started'),
 ('9a444444-0000-0000-0000-000000000004','Quote Four','9876600024', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website',null,'started'),
 ('9a555555-0000-0000-0000-000000000005','Quote Five','9876600025', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website','00000000-0000-0000-0000-0000000001c3','started'),
 ('9a666666-0000-0000-0000-000000000006','Quote Six','9876600026', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website',null,'started');
select public.booking_open_secrets(id) from public.leads where id::text like '9a%';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'approval' ->> 'status') = 'none', 'no quote: approval none');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','customer said yes on call')$$, 'no sent quote', 'nothing to approve yet');
select public.crm_quote_save(id, '[{"kind":"parts","name":"Brake pad","part_type":"genuine","amount":400}]', '{"kind":"hours","hours":3}') from public.leads where id::text like '9a%';
select pg_temp.ok((public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'approval' ->> 'status') = 'none', 'a draft is not an approval state');
select pg_temp.ok(jsonb_array_length(public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'quotes') = 1, 'the draft is in the history');
select public.crm_quote_send(id) from public.leads where id::text like '9a%';
select pg_temp.ok((public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'approval' ->> 'status') = 'pending', 'sent quote: pending');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','carrier pigeon','customer said yes on call')$$, 'choose phone or whatsapp', 'the method is checked');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','')$$, 'remarks', 'remarks are required');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','ok')$$, 'at least 5', 'remarks need 5 characters');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','PAN ABCDE1234F shared')$$, 'remove ID', 'no ID numbers in remarks');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','whatsapp','said yes on chat', 7)$$, 'no sent quote', 'a version that does not exist is refused');
select pg_temp.ok((public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','whatsapp','Customer replied YES on WhatsApp, chat checked') ->> 'by_name') = 'Lifecycle Admin', 'admin approval returns the admin name');
select pg_temp.ok((public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','whatsapp','Customer replied YES on WhatsApp, chat checked') ->> 'already') = 'true', 'approving twice is harmless');
select pg_temp.oks($q$(select status = 'approved' and decided_method = 'whatsapp' and decided_by_name = 'Lifecycle Admin' and decided_via = 'phone' and decided_at is not null and decided_remarks like 'Customer replied YES%' from public.job_quotes where lead_id = '9a111111-0000-0000-0000-000000000001')$q$, 'method, name, remarks, time and the old decided_via are stored');
select pg_temp.ok((public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'approval' ->> 'status') = 'approved_admin', 'status approved_admin');
select pg_temp.ok((public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001') -> 'approval' ->> 'method') = 'whatsapp', 'approval method shown');
select pg_temp.oks($q$exists (select 1 from public.crm_activities where lead_id = '9a111111-0000-0000-0000-000000000001' and actor = '00000000-0000-0000-0000-0000000001a1' and body like 'Quote v1 approved by WhatsApp, recorded by Lifecycle Admin on behalf of the customer. Remarks: %')$q$, 'history line');
select pg_temp.oks($q$exists (select 1 from public.audit_log where action = 'quote_approved_whatsapp' and details ->> 'remarks' like 'Customer replied%')$q$, 'audit row');
reset role;
-- the visit may now start (the quote gate sees an approved quote)
update public.leads set visit_stage = 'repair_doorstep' where id = '9a111111-0000-0000-0000-000000000001';
-- customer paths: tracking page, email link (default), changes then admin approval, decline
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets where lead_id = '9a222222-0000-0000-0000-000000000002'), 1, 'approve', null, 'track') ->> 'status') = 'approved', 'customer approves on the tracking page');
select pg_temp.oks($q$(select decided_method = 'customer_app' and decided_by_name = 'Customer' and decided_via = 'link' from public.job_quotes where lead_id = '9a222222-0000-0000-0000-000000000002')$q$, 'tracking page: customer_app');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets where lead_id = '9a333333-0000-0000-0000-000000000003'), 1, 'approve') ->> 'status') = 'approved', 'a 4-argument call still works');
select pg_temp.oks($q$(select decided_method = 'customer_link' from public.job_quotes where lead_id = '9a333333-0000-0000-0000-000000000003')$q$, 'default source: customer_link');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets where lead_id = '9a333333-0000-0000-0000-000000000003'), 1, 'approve', null, 'track') ->> 'already') = 'true', 'the same approval from the other place is recorded once');
select pg_temp.oks($q$(select decided_method = 'customer_link' from public.job_quotes where lead_id = '9a333333-0000-0000-0000-000000000003')$q$, 'the first method stays');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets where lead_id = '9a444444-0000-0000-0000-000000000004'), 1, 'decline', 'too costly', 'track') ->> 'status') = 'declined', 'customer declines');
select pg_temp.ok((public.quote_decide((select track_token from public.booking_secrets where lead_id = '9a666666-0000-0000-0000-000000000006'), 1, 'changes', 'use a cheaper pad', 'link') ->> 'status') = 'changes_requested', 'customer asks for changes');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((public.crm_booking_estimates('9a222222-0000-0000-0000-000000000002') -> 'approval' ->> 'status') = 'approved_self', 'status approved_self');
select pg_temp.ok((public.crm_booking_estimates('9a222222-0000-0000-0000-000000000002') -> 'approval' ->> 'decided_by_name') = 'Customer', 'by Customer');
select pg_temp.ok((public.crm_booking_estimates('9a444444-0000-0000-0000-000000000004') -> 'approval' ->> 'status') = 'rejected', 'status rejected');
select pg_temp.ok((public.crm_booking_estimates('9a666666-0000-0000-0000-000000000006') -> 'approval' ->> 'status') = 'changes_requested', 'status changes_requested');
select pg_temp.ok((public.crm_booking_estimates('9a666666-0000-0000-0000-000000000006') -> 'quotes' -> 0 ->> 'change_request') = 'use a cheaper pad', 'the change request is in the history');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a444444-0000-0000-0000-000000000004','phone','changed mind on phone')$$, 'declined', 'a declined quote cannot be approved: send a new one');
select pg_temp.ok((public.crm_quote_admin_approve('9a666666-0000-0000-0000-000000000006','phone','Agreed to the same price on the call') ->> 'method') = 'phone', 'admin can approve after the customer asked for changes');
-- the old phone button
select pg_temp.as_user('00000000-0000-0000-0000-0000000001c3');
select pg_temp.ok((public.crm_quote_phone_approve('9a555555-0000-0000-0000-000000000005','said yes') ->> 'version') = '1', 'the old phone approval still works for the owner of the lead');
select pg_temp.ok((public.crm_quote_phone_approve('9a555555-0000-0000-0000-000000000005','again') ->> 'already') = 'true', 'and is idempotent');
select pg_temp.oks($q$(select decided_method = 'phone' and decided_remarks = 'said yes' and decided_by_name = 'Lifecycle Agent' from public.job_quotes where lead_id = '9a555555-0000-0000-0000-000000000005')$q$, 'phone approval stores method, remarks and name');
select pg_temp.oks($q$exists (select 1 from public.crm_activities where lead_id = '9a555555-0000-0000-0000-000000000005' and body like 'Quote v1 approved by phone, recorded by Lifecycle Agent%')$q$, 'the old history wording is kept');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','trying a lead that is not mine')$$, 'permission|not found', 'an agent cannot approve for a lead they do not own');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b2');
select pg_temp.fails($$select public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','a stranger approving')$$, 'not allowed', 'a stranger cannot approve');
select pg_temp.fails($$select public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001')$$, 'not allowed', 'a stranger cannot read estimates');
reset role;

-- ───────────── garage estimate review: reject needs a remark, approve makes a draft the screen can edit ─────────────
insert into public.garage_assignments (id, lead_id, garage_id, status, received_at) values ('aa000000-0000-0000-0000-000000000001','9a333333-0000-0000-0000-000000000003','99999999-0000-0000-0000-0000000aa001','received', now());
insert into public.garage_estimates (id, assignment_id, lines, hours, status, submitted_at) values
 ('ee000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','[{"kind":"labour","name":"Chain set work","amount":300}]', 5,'submitted', now());
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.fails($$select public.crm_garage_estimate_review('ee000000-0000-0000-0000-000000000001', false, null)$$, 'why the estimate is rejected', 'reject needs a remark');
select pg_temp.fails($$select public.crm_garage_estimate_review('ee000000-0000-0000-0000-000000000001', false, 'no')$$, 'why the estimate is rejected', 'the remark needs 3 characters');
select pg_temp.ok((public.crm_garage_estimate_review('ee000000-0000-0000-0000-000000000001', false, 'Labour is too high, revise it') ->> 'status') = 'rejected', 'reject with a remark');
select pg_temp.oks($q$(select review_note = 'Labour is too high, revise it' from public.garage_estimates where id = 'ee000000-0000-0000-0000-000000000001')$q$, 'the garage can read the remark');
select pg_temp.ok((public.crm_booking_estimates('9a333333-0000-0000-0000-000000000003') -> 'garage_estimates' -> 0 ->> 'reviewed_by_name') = 'Lifecycle Admin' and (public.crm_booking_estimates('9a333333-0000-0000-0000-000000000003') -> 'garage_estimates' -> 0 ->> 'garage') = 'Lifecycle Garage A', 'estimate history shows garage and reviewer');
reset role;
insert into public.garage_estimates (id, assignment_id, lines, hours, status, submitted_at) values ('ee000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000001','[{"kind":"labour","name":"Clutch work","amount":500}]', 6,'submitted', now());
update public.job_quotes set status = 'superseded' where lead_id = '9a333333-0000-0000-0000-000000000003' and status = 'approved';   -- room for a new draft
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((public.crm_garage_estimate_review('ee000000-0000-0000-0000-000000000002', true, null) ->> 'status') = 'converted', 'approve makes a draft quote');
select pg_temp.ok((public.crm_quote_save('9a333333-0000-0000-0000-000000000003', '[{"kind":"labour","name":"Clutch work","amount":450}]', '{"kind":"hours","hours":6}') ->> 'version')::int = 2, 'the screen edits the same draft with crm_quote_save');
select pg_temp.oks($q$(select count(*) from public.job_quotes where lead_id = '9a333333-0000-0000-0000-000000000003' and status = 'draft') = 1$q$, 'still one draft');
reset role;

-- ───────────── refunds ─────────────
insert into public.leads (id, name, phone, status, confirm_fee, paid_amount, vehicle, source, cancelled_at, cancel_kind, refund_due) values
 ('f1111111-0000-0000-0000-000000000001','Refund One','9876600031','cancelled',49,0,'bike','website', now(), 'company', 349),
 ('f2222222-0000-0000-0000-000000000002','Refund Two','9876600032','paid',49,0,'bike','website', null, null, null);
insert into public.ledger_entries (lead_id, entry_type, amount, collected_by, method, source, reference) values
 ('f1111111-0000-0000-0000-000000000001','customer_payment', 349, 'company_manual', 'upi', 'admin', 'UTR-PLACEHOLDER'),
 ('f2222222-0000-0000-0000-000000000002','customer_payment', 349, 'company_manual', 'cash', 'admin', null);
insert into public.ledger_entries (lead_id, entry_type, amount, collected_by, method, source, reference, reason, created_by) values
 ('f1111111-0000-0000-0000-000000000001','refund', 100, 'company_manual', 'upi', 'admin', 'REF-PLACEHOLDER-1', 'Part refund', '00000000-0000-0000-0000-0000000001a1');
select pg_temp.oks($q$(select kind = 'partial' and method = 'manual' and status = 'refunded' and amount = 100 and created_by = '00000000-0000-0000-0000-0000000001a1' from public.booking_refunds where lead_id = 'f1111111-0000-0000-0000-000000000001')$q$, 'a manual ledger refund makes a partial refunded row');
insert into public.ledger_entries (lead_id, entry_type, amount, collected_by, method, source, reason) values ('f2222222-0000-0000-0000-000000000002','refund', 349, 'company_manual', 'cash', 'admin', 'Full refund');
select pg_temp.oks($q$(select kind = 'full' from public.booking_refunds where lead_id = 'f2222222-0000-0000-0000-000000000002')$q$, 'a refund of everything paid is full');
-- a gateway refund starts pending (the function and the webhook move it on)
insert into public.ledger_entries (lead_id, entry_type, amount, collected_by, method, source, reference, gateway_txn_id, reason, note) values
 ('f1111111-0000-0000-0000-000000000001','refund', 249, 'company_portal', 'cashfree', 'gateway', 'rfplaceholdern1', 'cfr_rfplaceholdern1', 'Booking cancelled by us', 'Cashfree order mxp_X; refund pending');
select pg_temp.oks($q$(select method = 'cashfree' and status = 'pending' and reference = 'rfplaceholdern1' from public.booking_refunds where lead_id = 'f1111111-0000-0000-0000-000000000001' and method = 'cashfree')$q$, 'a gateway refund row starts pending');
update public.booking_refunds set gateway_refund_id = '9001', status = 'processing' where reference = 'rfplaceholdern1';
select pg_temp.oks($q$(select count(*) from public.booking_refunds where lead_id = 'f1111111-0000-0000-0000-000000000001') = 2$q$, 'one row per refund');
-- a reversal of the gateway refund turns its row failed
insert into public.ledger_entries (lead_id, entry_type, amount, reverses_id, reason, source) select lead_id, 'reversal', amount, id, 'Refund failed at the gateway', 'gateway' from public.ledger_entries where gateway_txn_id = 'cfr_rfplaceholdern1';
select pg_temp.oks($q$(select status = 'failed' from public.booking_refunds where reference = 'rfplaceholdern1')$q$, 'a reversal marks the refund failed');
select pg_temp.oks($q$(select status = 'refunded' from public.booking_refunds where reference = 'REF-PLACEHOLDER-1')$q$, 'other refunds are untouched');
-- who sees what
set role anon; select pg_temp.fails($$select count(*) from public.booking_refunds$$, 'permission denied', 'anon cannot read refunds'); reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select pg_temp.ok((select count(*) from public.booking_refunds) = 0, 'a signed-in non-admin sees no refund rows directly');
select pg_temp.fails($$insert into public.booking_refunds (lead_id, kind, amount, method) values ('f1111111-0000-0000-0000-000000000001','full',1,'manual')$$, 'permission denied', 'clients cannot write refunds');
select pg_temp.fails($$update public.booking_refunds set status = 'refunded'$$, 'permission denied', 'clients cannot update refunds');
select pg_temp.ok((public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') ->> 'paid')::numeric = 349 and (public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') ->> 'refunded')::numeric = 100 and (public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') ->> 'refundable')::numeric = 249, 'Crew sees paid, refunded and refundable');
select pg_temp.ok((public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') ->> 'refund_due')::numeric = 349 and (public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') ->> 'refund_outstanding')::numeric = 249, 'refund due and still outstanding');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') -> 'rows') x where x ->> 'gateway_refund_id' is not null or (x ->> 'method' = 'cashfree' and x ->> 'reference' is not null)), 'Crew sees no gateway ids');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') -> 'rows') x where x ->> 'created_by_name' = 'Lifecycle Admin'), 'rows carry the name of who created them');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((select count(*) from public.booking_refunds) = 3, 'an admin reads the rows directly');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001') -> 'rows') x where x ->> 'gateway_refund_id' = '9001'), 'Admin sees the gateway id');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b2');
select pg_temp.fails($$select public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001')$$, 'not allowed', 'a stranger cannot read refunds');
reset role;

-- ───────────── one assignment ─────────────
insert into public.leads (id, name, phone, status, confirm_fee, paid_amount, vehicle, area, pincode, source) values
 ('a1111111-0000-0000-0000-000000000001','Assign Unpaid','9876600041','payment_sent',49,null,'bike','HSR Layout','560102','website'),
 ('a2222222-0000-0000-0000-000000000002','Assign Paid','9876600042','paid',49,49,'bike','HSR Layout','560102','website'),
 ('a3333333-0000-0000-0000-000000000003','Assign Outside','9876600043','paid',49,49,'bike','HSR Layout','560102','website');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001c3');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001')$$, 'permission', 'a sales agent cannot assign');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b2');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001')$$, 'not allowed', 'a stranger cannot assign');
select pg_temp.fails($$select public.crm_assignment_info('a2222222-0000-0000-0000-000000000002')$$, 'not allowed', 'a stranger cannot read the assignment');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');   -- Crew lead
select pg_temp.fails($$select public.crm_assign_booking('a1111111-0000-0000-0000-000000000001','99999999-0000-0000-0000-0000000aa001')$$, 'The customer has not paid the confirmation fee yet', 'unpaid: plain refusal');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002')$$, 'not both|choose a partner', 'one of garage or outside is needed');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001','Some Outside Works')$$, 'not both|choose a partner', 'not both');
select pg_temp.ok((public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001', p_note => 'Bring a clean cover', p_eta => now() + interval '1 day') ->> 'garage') = 'Lifecycle Garage A', 'a garage assignment goes through crm_garage_assign');
select pg_temp.ok((public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'garage' ->> 'name') = 'Lifecycle Garage A' and (public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'garage' ->> 'status') = 'sent', 'assignment info shows the garage and status');
select pg_temp.ok((public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'garage' ->> 'assigned_by_name') = 'Lifecycle Crew Lead', 'and who assigned it');
select pg_temp.ok((public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'garage' -> 'phone_for_admin') = 'null'::jsonb, 'Crew never gets the garage phone');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002', null, 'Some Outside Works')$$, 'cancel or move the garage job first', 'outside partner refused while a garage job is open');
select pg_temp.ok((public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000bb001') ->> 'garage') = 'Lifecycle Garage B', 'reassigned to another garage');
select pg_temp.oks($q$(select count(*) from public.garage_assignments where lead_id = 'a2222222-0000-0000-0000-000000000002' and status = 'cancelled') = 1 and (select count(*) from public.garage_assignments where lead_id = 'a2222222-0000-0000-0000-000000000002' and status = 'sent') = 1$q$, 'the old job is cancelled and the new one is open');
select pg_temp.ok(jsonb_array_length(public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'history') = 2, 'history lists both');
reset role;
update public.garage_assignments set status = 'in_work' where lead_id = 'a2222222-0000-0000-0000-000000000002' and status = 'sent';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select pg_temp.fails($$select public.crm_assign_booking('a2222222-0000-0000-0000-000000000002','99999999-0000-0000-0000-0000000aa001')$$, 'already started', 'no move after the work started');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok((public.crm_assignment_info('a2222222-0000-0000-0000-000000000002') -> 'garage' ->> 'phone_for_admin') = '9000000022', 'Admin gets the garage phone');
select pg_temp.ok((public.crm_assign_booking('a3333333-0000-0000-0000-000000000003', null, '  Outside Partner Works  ') ->> 'outside') = 'Outside Partner Works', 'an outside partner is saved cleaned');
select pg_temp.ok((public.crm_assignment_info('a3333333-0000-0000-0000-000000000003') ->> 'outside') = 'Outside Partner Works' and (public.crm_assignment_info('a3333333-0000-0000-0000-000000000003') -> 'garage') = 'null'::jsonb, 'info shows the outside partner and no garage');
select pg_temp.ok((public.crm_assign_booking('a3333333-0000-0000-0000-000000000003', null, 'Outside Partner Works') ->> 'already') = 'true', 'the same outside partner twice is harmless');
select pg_temp.ok((public.crm_assign_booking('a3333333-0000-0000-0000-000000000003','99999999-0000-0000-0000-0000000aa001') ->> 'kind') = 'garage', 'a garage can replace the outside partner');
select pg_temp.ok((public.crm_assignment_info('a3333333-0000-0000-0000-000000000003') ->> 'outside') is null, 'and clears it');
select pg_temp.oks($q$(select mechanic_id is null from public.leads where id = 'a3333333-0000-0000-0000-000000000003')$q$, 'no mechanic is ever set');
reset role;

-- ───────────── timeline ─────────────
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.ok(jsonb_array_length(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')) >= 4, 'the money timeline has the payment, refunds and reversal');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')) x where x ->> 'title' = 'Payment received' and x ->> 'detail' like 'Rs 349%'), 'Admin sees amounts');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')) x where x ->> 'title' = 'Refund recorded' and x ->> 'by_name' = 'Lifecycle Admin'), 'a refund shows who recorded it');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('9a111111-0000-0000-0000-000000000001')) x where x ->> 'by_name' is null), 'every row has a responsible name');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('9a111111-0000-0000-0000-000000000001')) x where x ->> 'kind' = 'quote' and x ->> 'title' like 'Quote v1 approved by WhatsApp%' and x ->> 'by_name' = 'Lifecycle Admin'), 'the approval is on the timeline with the admin name');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('9a222222-0000-0000-0000-000000000002')) x where x ->> 'title' like 'Customer approved quote v1 on the tracking page%' and x ->> 'by_name' = 'Customer'), 'a customer approval shows Customer');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('d1111111-0000-0000-0000-000000000001')) x where x ->> 'kind' = 'delivery' and x ->> 'title' = 'Vehicle delivered (by Lifecycle Agent)' ), 'delivery events are there');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('d1111111-0000-0000-0000-000000000001')) x where x ->> 'kind' = 'message' and x ->> 'title' = 'Approval email sent' and x ->> 'by_name' = 'System'), 'message results are listed once');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('d1111111-0000-0000-0000-000000000001')) x where x ->> 'title' = 'Approval email sent' and x ->> 'kind' <> 'message'), 'no duplicate history line for the same message');
select pg_temp.ok((select bool_and((x ->> 'at')::timestamptz >= (y ->> 'at')::timestamptz) from (select x, lead(x) over () as y from jsonb_array_elements(public.crm_booking_timeline('9a111111-0000-0000-0000-000000000001')) x) q(x, y) where y is not null), 'newest first');
select pg_temp.ok(jsonb_array_length(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001', 2)) = 2, 'the limit is honoured');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');   -- Crew
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')) x where x ->> 'title' = 'Payment received'), 'Crew sees the payment line');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')) x where coalesce(x ->> 'detail', '') ~ 'Rs [0-9]' and x ->> 'kind' in ('payment', 'refund', 'reversal')), 'Crew gets no amounts on money lines');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b2');
select pg_temp.fails($$select public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')$$, 'not allowed', 'a stranger cannot read the timeline');
reset role;

-- ───────────── cancellation carries who cancelled; refund semantics ─────────────
insert into public.leads (id, name, phone, status, confirm_fee, paid_amount, vehicle, source) values
 ('ca111111-0000-0000-0000-000000000001','Cancel Cust','9876600051','paid',49,49,'bike','website'),('ca222222-0000-0000-0000-000000000002','Cancel Us','9876600052','paid',49,49,'bike','website');
insert into public.ledger_entries (lead_id, entry_type, amount, collected_by, method, source) values ('ca111111-0000-0000-0000-000000000001','customer_payment',49,'company_portal','cashfree','gateway'),('ca222222-0000-0000-0000-000000000002','customer_payment',49,'company_portal','cashfree','gateway');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select public.crm_cancel_booking('ca111111-0000-0000-0000-000000000001','customer','changed my mind');
select public.crm_cancel_booking('ca222222-0000-0000-0000-000000000002','company','no mechanic free', true);
select pg_temp.ok((public.crm_booking_state('ca111111-0000-0000-0000-000000000001') ->> 'state') = 'cancelled_customer' and (public.crm_booking_state('ca111111-0000-0000-0000-000000000001') ->> 'label') = 'Customer cancelled', 'cancelled by the customer');
select pg_temp.ok((public.crm_booking_state('ca222222-0000-0000-0000-000000000002') ->> 'state') = 'cancelled_company' and (public.crm_booking_state('ca222222-0000-0000-0000-000000000002') ->> 'label') = 'Cancelled by us', 'cancelled by us');
select pg_temp.oks($q$(select x ->> 'refund_label' from jsonb_array_elements(public.crm_cancellations_list() -> 'cancelled') x where x ->> 'booking_id' = (select coalesce(booking_id, ref) from public.leads where id = 'ca222222-0000-0000-0000-000000000002')) = 'Full'$q$, 'a refund of everything paid is Full');
reset role;
update public.leads set refund_due = 20 where id = 'ca222222-0000-0000-0000-000000000002';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select pg_temp.oks($q$(select x ->> 'refund_kind' from jsonb_array_elements(public.crm_cancellations_list() -> 'cancelled') x where x ->> 'booking_id' = (select coalesce(booking_id, ref) from public.leads where id = 'ca222222-0000-0000-0000-000000000002')) = 'partial'$q$, 'a smaller refund is Partial');
select pg_temp.ok(((public.crm_cancellations_list() -> 'cancelled' -> 0) ->> 'refund_outstanding') is not null, 'refund_outstanding is still there');
reset role;

-- ───────────── every new function is closed to anon ─────────────
set role anon;
select pg_temp.fails('select ' || f, 'permission denied', f || ' is closed to anon') from unnest(array[
  $$public.crm_delivery_set('d1111111-0000-0000-0000-000000000001','done')$$, $$public.crm_quote_admin_approve('9a111111-0000-0000-0000-000000000001','phone','12345')$$, $$public.crm_booking_estimates('9a111111-0000-0000-0000-000000000001')$$,
  $$public.crm_booking_refunds('f1111111-0000-0000-0000-000000000001')$$, $$public.crm_assignment_info('a2222222-0000-0000-0000-000000000002')$$, $$public.crm_assign_booking('a2222222-0000-0000-0000-000000000002', null, 'X Y')$$,
  $$public.crm_booking_timeline('f1111111-0000-0000-0000-000000000001')$$, $$public.crm_booking_state('d1111111-0000-0000-0000-000000000001')$$, $$public.quote_decide('x', 1, 'approve', null, 'track')$$]) f;
reset role;
select 'lifecycle ok';
