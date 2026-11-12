-- Behaviour test for 20270143000000_cancellations.sql on a LOCAL scratch Postgres (never Supabase). Placeholders only.
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FAILED: %', msg; end if; end $$;
create or replace function pg_temp.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm ~* pattern then return; end if; raise exception 'FAILED: % (wrong error: %)', msg, sqlerrm; end;
  raise exception 'FAILED: % (it did not fail)', msg;
end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1','cadmin@example.invalid'),('00000000-0000-0000-0000-0000000000f2','csales@example.invalid') on conflict do nothing;
insert into public.admins (user_id, name, role) values ('00000000-0000-0000-0000-0000000000f1','Cancel Admin','owner') on conflict do nothing;
insert into public.crm_users (user_id, name, role, active) values ('00000000-0000-0000-0000-0000000000f2','Cancel Agent','sales',true) on conflict do nothing;
insert into public.leads (id, name, phone, preferred_date, preferred_slot, status, confirm_fee, paid_amount, vehicle, area, pincode, source) values
 ('c1111111-1111-1111-1111-111111111111','Early Customer','9876543211', current_date + 3,'morning','paid',49,49,'bike','HSR Layout','560102','website'),
 ('c2222222-2222-2222-2222-222222222222','Late Customer','9876543212', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website'),
 ('c3333333-3333-3333-3333-333333333333','Left Customer','9876543213', current_date + 3,'morning','paid',49,49,'bike','HSR Layout','560102','website'),
 ('c4444444-4444-4444-4444-444444444444','Our Cancel','9876543214', current_date,'morning','paid',49,49,'bike','HSR Layout','560102','website');
update public.leads set visit_stage = 'on_the_way' where id = 'c3333333-3333-3333-3333-333333333333';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
-- the rule, per case
select pg_temp.ok((public.cancel_outcome('c1111111-1111-1111-1111-111111111111','customer') ->> 'refundable')::boolean, 'more than 2 hours before: refundable');
select pg_temp.ok((public.cancel_outcome('c1111111-1111-1111-1111-111111111111','customer') ->> 'amount')::int = 49, 'refund is the fee paid');
update public.leads set preferred_date = (now() at time zone 'Asia/Kolkata')::date, preferred_slot = 'asap' where id = 'c2222222-2222-2222-2222-222222222222';
select pg_temp.ok(not (public.cancel_outcome('c3333333-3333-3333-3333-333333333333','customer') ->> 'refundable')::boolean, 'mechanic already left: not refundable');
select pg_temp.ok((public.cancel_outcome('c3333333-3333-3333-3333-333333333333','company') ->> 'refundable')::boolean, 'we cancel: full refund even after the mechanic left');
select pg_temp.ok((public.cancel_outcome('c4444444-4444-4444-4444-444444444444','unreachable') ->> 'refundable')::boolean, 'could not reach the customer: full refund');
-- reason is required, kind is checked, Crew cannot overrule the refund
select pg_temp.fails($$select public.crm_cancel_booking('c1111111-1111-1111-1111-111111111111','customer','')$$, 'short reason', 'a reason is required');
select pg_temp.fails($$select public.crm_cancel_booking('c1111111-1111-1111-1111-111111111111','nobody','changed my mind')$$, 'who cancelled', 'the kind is checked');
select pg_temp.fails($$select public.crm_cancel_booking('c1111111-1111-1111-1111-111111111111','customer','changed my mind', false)$$, 'only an admin', 'Crew cannot change the refund decision');
-- Crew can cancel and sees the refund due
select pg_temp.ok((public.crm_cancel_booking('c1111111-1111-1111-1111-111111111111','customer','changed my mind') ->> 'refund_due')::int = 49, 'Crew cancels; refund due 49');
select pg_temp.ok((select status from public.leads where id = 'c1111111-1111-1111-1111-111111111111') = 'cancelled', 'status is cancelled');
select pg_temp.ok((public.crm_cancel_booking('c1111111-1111-1111-1111-111111111111','customer','again') ->> 'already')::boolean, 'cancelling twice is safe');
select pg_temp.ok(jsonb_array_length(public.crm_cancellations_list() -> 'cancelled') = 1, 'the cancellations list shows it');
select pg_temp.ok(((public.crm_cancellations_list() -> 'cancelled' -> 0) ->> 'refund_outstanding')::int = 49, 'refund outstanding 49');
-- the customer's request path accepts the new category through the existing function (needs a token: only check the constraint here)
select pg_temp.fails($$insert into public.booking_issues (lead_id, category, body) values ('c2222222-2222-2222-2222-222222222222','bogus','hello there')$$, 'booking_issues_category_check|check', 'unknown categories are still refused');
insert into public.booking_issues (lead_id, category, body) values ('c2222222-2222-2222-2222-222222222222','cancel','Please cancel');
select pg_temp.ok(jsonb_array_length(public.crm_cancellations_list() -> 'requests') = 1, 'the open cancel request is listed');
-- Admin may overrule: no refund although the rule said yes; the request is resolved on cancel
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok((public.crm_cancel_booking('c2222222-2222-2222-2222-222222222222','customer','late and mechanic booked', true) ->> 'refund_due')::int = 49, 'Admin overrules to refund');
select pg_temp.ok((select status from public.booking_issues where lead_id = 'c2222222-2222-2222-2222-222222222222' and category = 'cancel') = 'resolved', 'the cancel request is resolved');
select pg_temp.ok(not exists (select 1 from public.leads where id = 'c2222222-2222-2222-2222-222222222222' and status <> 'cancelled'), 'cancelled');
select 'cancellations ok';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.ok((public.crm_cancel_info('c1111111-1111-1111-1111-111111111111') ->> 'refund_outstanding')::int = 49, 'booking card info shows refund outstanding');
select pg_temp.ok(not (public.crm_cancel_info('c4444444-4444-4444-4444-444444444444') ->> 'cancelled')::boolean, 'an open booking is not cancelled');
