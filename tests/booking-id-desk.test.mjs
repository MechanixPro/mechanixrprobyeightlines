import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bookingLabel, idOr, isJunk, countable, canConfirmBooking, canMarkJunk, canRestoreJunk, nextStatuses, timerInfo, techJobMessage, handoverMessage, STATUS_LABEL } from '../crm/crm-rules.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const M = read('supabase/migrations/20261225000000_booking_id_after_confirmation.sql');

test('the booking ID shows only when set; a lead shows a neutral word', () => {
  assert.equal(bookingLabel({ booking_id: 'MP-26-27-0001', ref: 'L-ABC234' }), 'MP-26-27-0001');
  assert.equal(bookingLabel({ ref: 'L-ABC234' }), ''); assert.equal(idOr({ ref: 'L-ABC234' }), 'Lead'); assert.equal(idOr({ ref: 'L-ABC234' }, 'Job'), 'Job');
  const lead = { name: 'A', phone: '9000000001', ref: 'L-ABC234' };
  assert.doesNotMatch(techJobMessage(lead), /L-ABC234/); assert.match(techJobMessage(lead), /^Hi, new job\./);
  assert.match(techJobMessage({ ...lead, booking_id: 'MP-26-27-0001' }), /^Hi, new job MP-26-27-0001\./);
  assert.match(handoverMessage({ name: 'Asha', ref: 'L-ABC234' }, 'pickup', '4821'), /code for your booking is 4821/);
  assert.match(handoverMessage({ name: 'Asha', booking_id: 'MP-26-27-0001' }, 'pickup', '4821'), /code for booking MP-26-27-0001 is 4821/);
});

test('Confirm booking is offered for an open lead with no ID, to someone who may see it and can create bookings', () => {
  const me = { canCreate: true, userId: 'u1', boss: false };
  assert.equal(canConfirmBooking({ status: 'quoted', crm_owner: 'u1' }, me), true);
  assert.equal(canConfirmBooking({ status: 'new', crm_owner: null }, me), true);                       // the unassigned queue
  assert.equal(canConfirmBooking({ status: 'quoted', crm_owner: 'u2' }, me), false);                  // a colleague's lead
  assert.equal(canConfirmBooking({ status: 'quoted', crm_owner: 'u2' }, { ...me, boss: true }), true);
  assert.equal(canConfirmBooking({ status: 'quoted', crm_owner: 'u1', booking_id: 'MP-26-27-0001' }, me), false);   // already has one
  assert.equal(canConfirmBooking({ status: 'lost', crm_owner: 'u1' }, me), false); assert.equal(canConfirmBooking({ status: 'junk', crm_owner: 'u1' }, me), false);
  assert.equal(canConfirmBooking({ status: 'quoted', crm_owner: 'u1' }, { ...me, canCreate: false }), false);
});

test('Mark as junk and Restore are admin only, and a confirmed booking is never junk', () => {
  const lead = { status: 'contacted' };
  assert.equal(canMarkJunk(lead, true), true); assert.equal(canMarkJunk(lead, false), false); assert.equal(canMarkJunk(lead, undefined), false);
  assert.equal(canMarkJunk({ status: 'junk' }, true), false); assert.equal(canMarkJunk({ status: 'scheduled' }, true), false); assert.equal(canMarkJunk({ status: 'new', booking_id: 'MP-26-27-0001' }, true), false);
  assert.equal(canRestoreJunk({ status: 'junk' }, true), true); assert.equal(canRestoreJunk({ status: 'junk' }, false), false); assert.equal(canRestoreJunk({ status: 'new' }, true), false);
});

test('junk is not a lead: not counted, no moves, labelled', () => {
  const rows = [{ status: 'new' }, { status: 'junk' }, { status: 'completed' }];
  assert.equal(countable(rows).length, 2); assert.equal(isJunk({ status: 'junk' }), true);
  assert.deepEqual(nextStatuses('junk', 'supervisor'), []); assert.equal(STATUS_LABEL.junk, 'Junk');
  assert.deepEqual(timerInfo({ status: 'junk', junk_reason: 'spam' }), { label: 'Junk: spam', tone: 'muted' });
});

test('the Crew screens: Confirm booking, admin-only junk actions, a Junk view, and no private ref on screen', () => {
  const crm = read('crm/crm.js');
  assert.match(crm, /canConfirmBooking\(l, \{ canCreate: can\('create_bookings'\), userId: S\.me\.user_id, boss: canTech\(\) \}\)/);
  assert.match(crm, /data-act=\\?"confirmBooking\\?">Confirm booking</); assert.match(crm, /rpc\('confirm_booking', \{ p_lead: S\.open \}\)/);
  assert.match(crm, /canMarkJunk\(l, S\.me\.is_admin\)/); assert.match(crm, /canRestoreJunk\(l, S\.me\.is_admin\)/);
  assert.match(crm, /rpc\('mark_lead_junk'/); assert.match(crm, /rpc\('restore_lead_junk'/);
  assert.match(read('crm/pages/leads.js'), /\['junk', 'Junk'\]/); assert.match(read('crm/pages/leads.js'), /k !== 'junk' \|\| \(ctx\.me && ctx\.me\.is_admin\)/);
  assert.match(read('crm/pages/leads.js'), /\[r\.booking_id, r\.bike, r\.area\]/);           // the list shows the ID only when set
  assert.doesNotMatch(read('crm/pages/booking.js'), /\$\{r\.ref\}|\$\{lead\.ref\}/);
  for (const f of readdirSync(new URL('../crm/pages', import.meta.url))) assert.doesNotMatch(read('crm/pages/' + f), /esc\((r|c|lead|l)\.ref\)/, f);
});

test('the admin screens: Give booking ID, Mark as junk and Restore, a Junk list, and the ID or the word Lead', () => {
  const a = read('admin/admin.js');
  assert.match(a, /const bid = \(l\) => \(l && l\.booking_id\) \|\| 'Lead'/);
  assert.match(a, /sb\.rpc\('confirm_booking', \{ p_lead: l\.id \}\)/); assert.match(a, /sb\.rpc\('mark_lead_junk'/); assert.match(a, /sb\.rpc\('restore_lead_junk'/);
  assert.match(a, /value="junk"/); assert.doesNotMatch(a.slice(a.indexOf('const STATUSES')).split('\n')[0], /junk/);   // junk is set by its own button, not the status dropdown
  assert.match(a, /toast\('New lead'\)/);
});

test('the migration: new column, junk status, private refs, and automatic IDs on paid, scheduled or completed', () => {
  assert.match(M.split('\n').slice(0, 20).join('\n'), /-- rollback/);                                                  // the undo note is at the top
  for (const s of ['add column if not exists booking_id text', 'create unique index if not exists leads_booking_id_uq', "check (status in ('new','contacted','quoted','payment_sent','paid','scheduled','completed','lost','junk'))",
    'junk_reason', 'junk_at', 'junk_by', 'junk_prev_status', 'ref_aliases text[]', "r := 'L-'", "new.ref !~ '^L-[A-Z0-9]{6}$'", 'alter column ref drop default']) assert.ok(M.includes(s), s);
  assert.doesNotMatch(M, /leads_serial_ref_tr before insert/);                                                         // inserts no longer take a serial number
  assert.match(M, /new\.status in \('paid','scheduled','completed'\) or coalesce\(new\.paid_amount, 0\) > 0/);
  assert.match(M, /before insert or update on public\.leads for each row execute function public\.leads_booking_id_auto\(\)/);
  assert.match(M, /leads_booking_id_log_tr after insert or update/);                                                   // who and when, for every way it is given
  assert.match(M, /'Booking ID ' \|\| new\.booking_id \|\| ' given '/); assert.match(M, /'booking_id_assigned'/);
});

test('confirm_booking: roles, visibility, idempotent, uses the serial counter', () => {
  const f = M.slice(M.indexOf('function public.confirm_booking'), M.indexOf('-- (b) Online payment'));
  for (const s of ['security definer', 'public.is_admin()', 'public.crm_need_role()', "public.crm_require('create_bookings')", 'public.crm_can_see(l, r)', 'for update', 'if l.booking_id is not null then return l.booking_id; end if;', 'public.order_ref_next()', "l.status in ('lost','junk')"]) assert.ok(f.includes(s), s);
  assert.ok(f.indexOf('if l.booking_id is not null then return') < f.indexOf('public.order_ref_next()'), 'the existing ID is returned before a new number is taken');
  assert.match(M, /revoke all on function public\.confirm_booking\(uuid\) from public, anon;\ngrant execute on function public\.confirm_booking\(uuid\) to authenticated;/);
});

test('invoice_no_alloc makes sure a booking ID exists and uses it as the invoice number', () => {
  const f = M.slice(M.indexOf('function public.invoice_no_alloc'), M.indexOf('-- ───────────────────────── Junk leads'));
  assert.match(f, /select booking_id into n from public\.leads where id = p_lead for update/);
  assert.match(f, /if n is null then update public\.leads set booking_id = public\.order_ref_next\(\)/);
  assert.match(f, /values \(p_lead, substr\(n, 4, 5\), nullif\(right\(n, 4\), ''\)::integer, n\)/);
  assert.match(f, /grant execute on function public\.invoice_no_alloc\(uuid\) to service_role/);
});

test('junk RPCs are admin only, audited, keep the reason and restore the earlier status', () => {
  const j = M.slice(M.indexOf('function public.mark_lead_junk'), M.indexOf('-- ───────────────────────── Desk screens'));
  assert.equal([...j.matchAll(/if not public\.is_admin\(\) then raise exception 'only an admin/g)].length, 2);       // both, and no crm_require: desk roles cannot use them
  assert.doesNotMatch(j, /crm_require|crm_need_role/);
  for (const s of ["junk_prev_status = status, status = 'junk', junk_reason = why, junk_at = now(), junk_by = auth.uid()", "'lead_marked_junk'", "'lead_junk_restored'", 'a confirmed booking cannot be marked as junk', 'junk_prev_status in', "'Restored from junk to '"]) assert.ok(j.includes(s), s);
  assert.match(M, /new\.status in \('paid','scheduled','completed','lost','junk'\) or new\.opted_out then\n    new\.next_followup_at := null/);   // no follow-ups for junk
});

test('the desk lists, summary and dashboard leave junk out and add the Junk view', () => {
  for (const s of ["and (p_filter = 'junk') = (l.status = 'junk')", "when 'junk' then l.status = 'junk'", 'booking_id text)', "'junk', (select count(*) from public.crm_desk_leads"]) assert.ok(M.includes(s), s);
  const dash = M.slice(M.indexOf('function public.crm_dashboard'), M.indexOf('function public.crm_lead('));
  assert.equal([...dash.matchAll(/status <> 'junk'/g)].length >= 3, true);                                          // totals, per-agent counts, attribution
  assert.match(M, /create or replace view public\.crm_desk_leads as select \* from public\.leads where source is distinct from 'website'/);
  assert.match(M, /'is_admin', public\.is_admin\(\)/);
  assert.doesNotMatch(M, /update public\.order_counters|delete from public\.order_counters|truncate/);                 // serial numbers are never reset
});

test('the migration keeps won leads as they are and moves every other lead to a private ref', () => {
  const d = M.slice(M.indexOf('-- ───────────────────────── Existing data'), M.indexOf('-- ───────────────────────── Assigning'));
  // a lead is won if its status is paid, scheduled or completed, or it has any payment, payment link, invoice or ledger entry
  for (const s of ["l.status in ('paid','scheduled','completed')", 'l.paid_amount', 'l.payment_link is not null', 'public.invoices i', 'public.invoice_numbers n', 'public.ledger_entries e']) assert.ok(d.includes(s), s);
  assert.match(d, /set booking_id = l\.ref where l\.booking_id is null and l\.ref ~ ''\^MP-\[0-9\]\{2\}-\[0-9\]\{2\}-\[0-9\]\{4\}\$'' and \(' \|\| won/);
  assert.match(d, /not \(' \|\| won \|\| '\)/);                                                                       // the other branch is "not won"
  assert.match(d, /old_ref = coalesce\(old_ref, ref\),\n\s+ref_aliases = case when ref = any \(ref_aliases\) then ref_aliases else array_append\(ref_aliases, ref\) end,\n\s+ref = public\.lead_ref_new\(\), booking_id = null/);
  assert.doesNotMatch(d.split("-- every other lead")[1], /update public\.(invoices|invoice_numbers)/);              // an invoice keeps its number
  assert.ok(M.indexOf('create trigger leads_booking_id_log_tr') > M.indexOf('-- ───────────────────────── Existing data'), 'history triggers come after the data move');
});

test('the migration is the newest and in order', () => {
  const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const i = files.indexOf('20261225000000_booking_id_after_confirmation.sql');
  assert.ok(i > 0, 'the booking ID migration exists');
  assert.equal(files[i - 1], '20261224000002_handover_purge_api.sql');   // nothing slipped in before it
  assert.deepEqual(files.slice(i + 1), ['20261226000000_lead_vehicle.sql', '20261227000000_crew_conversion.sql', '20261228000000_paid_confirmation.sql', '20261229000000_customer_updates.sql', '20261230000000_tech_location.sql', '20261231000000_customer_documents.sql', '20270101000000_garage_app.sql', '20270102000000_desk_actions_technician_lead_restore.sql', '20270103000000_mechanic_app.sql', '20270104000000_duplicate_merge.sql', '20270105000000_funnel_quote.sql', '20270106000000_wa_inbox.sql', '20270107000000_sales_targets.sql', '20270108000000_bulk_leads.sql', '20270109000000_import_leads.sql', '20270110000000_quote_waiting.sql', '20270111000000_unpaid_bookings.sql', '20270112000000_dispatch_garage.sql', '20270113000000_mechanic_available.sql', '20270114000000_auto_garage.sql', '20270115000000_garage_code_gate.sql', '20270116000000_partner_kyc.sql', '20270117000000_collect_payment.sql', '20270118000000_service_watch.sql', '20270119000000_partner_avail.sql', '20270120000000_mechanic_offer.sql', '20270121000000_pro_check.sql', '20270122000000_live_leads.sql', '20270123000000_redo_requests.sql', '20270124000000_part_type.sql', '20270125000000_shield_claims.sql', '20270126000000_shield_cap.sql', '20270127000000_live_updates.sql', '20270128000000_job_check_flow.sql', '20270129000000_kyc_onboard_active.sql', '20270130000000_garage_brd.sql', '20270131000000_partner_plans_history.sql', '20270132000000_garage_server_gates.sql', '20270133000000_admin_garage_delete.sql', '20270134000000_admin_garages_code_issue.sql', '20270135000000_garage_quote_gate.sql', '20270136000000_agreement_autofill.sql']);   // only the vehicle tag, the crew conversion steps and the paid confirmation come after (each carries its own tests)
});
