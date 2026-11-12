# Booking lifecycle (backend)

One booking screen in Admin manages the whole life of a booking. It is backed by real database functions and is in step with the Garage app and the customer's tracking page.
Migration: `supabase/migrations/20270144000000_booking_lifecycle.sql` (additive, runs twice cleanly). Apply, as the project owner:
`npx supabase db query --linked -f supabase/migrations/20270144000000_booking_lifecycle.sql`
**Apply the migration before deploying the functions** (track-booking and garage-app read the new columns).
Deploy: `booking-notify`, `quote-decision`, `admin-refund`, `cashfree-webhook`, `track-booking`, `garage-app` (the shared files are bundled into each).

## Delivery lifecycle
`leads.status` is unchanged (`completed` still means won). Beside it: `delivery_stage` (null, `ready`, `delivered`, `closed`), `ready_at`, `delivered_at`, `closed_at`, `delivery_note`, `delivery_by`.
`crm_delivery_set(p_lead, p_stage, p_remarks)` with `p_stage` = `done` (status paid or scheduled becomes completed, same as Mark done; the invoice is still made by the Admin screen), `ready`, `delivered` (remarks required, 3+ characters; sets `ready_at` if skipped; a garage job in `ready` becomes `returned`), `closed`.
A repeat returns `ok` with `already: true`; the wrong order is refused in plain words. Returns `{ok, state, stage, at, by_name}`. History line and audit row are written with the actor.
`crm_booking_state(p_lead)` returns `{state, label, status, delivery_stage, cancel_kind}`. Keys and labels: new New, contacted Contacted, quoted Quote sent, payment_sent Advance link sent, paid Booked, scheduled Booked (visit scheduled), cancelled_customer Customer cancelled, cancelled_company Cancelled by us, lost Lost, completed Done, ready_for_delivery Vehicle ready for delivery, delivered Vehicle delivered, closed Booking closed, junk Junk. SQL function `booking_state(leads)` gives the key.

## Messages (booking-notify, signed-in desk user)
- `{action:'delivery_update', lead_id, stage:'ready'|'delivered'}` after `crm_delivery_set`: email and WhatsApp to the customer, once per stage.
- `{action:'approval_notice', lead_id}` after an approval: email and WhatsApp to the customer and a WhatsApp notice to the assigned garage, once per quote version. A customer approval (quote-decision) runs the same path.
- `{action:'estimate_rejected', lead_id, estimate_id}` after a rejected garage estimate: WhatsApp notice to the garage (the remark is also shown on the job in the garage app).
- `resend` also accepts the delivery_* and approval_* kinds.
Kinds in `booking_notifications` (optional `:N` suffix): delivery_ready_email/whatsapp, delivery_done_email/whatsapp, approval_email/whatsapp:N, garage_approved:N, garage_estimate_rejected:N, refund_email/whatsapp (reserved, not sent yet). The claim row makes every event send once.
WhatsApp uses the Meta Cloud `sendSmart` pattern: plain text inside the 24 hour window, the template outside it. **Templates the owner must create in Meta** (UTILITY, English; names can be changed with the env vars in brackets):
- `mxp_delivery_ready` [WA_TPL_DELIVERY_READY], variables: 1 first name, 2 vehicle, 3 booking ID. "Hi {{1}}, your {{2}} is ready for delivery. We will hand it over as planned. Booking {{3}}."
- `mxp_delivery_done` [WA_TPL_DELIVERY_DONE], same variables. "Hi {{1}}, your {{2}} has been delivered. Thank you for choosing Mechanix Pro. Booking {{3}}."
- `mxp_quote_approved` [WA_TPL_APPROVAL], 1 first name, 2 booking ID. "Hi {{1}}, we got your approval of the quote. The work can start now. Booking {{2}}."
- `mxp_garage_approved` [WA_TPL_GARAGE_APPROVED], 1 garage name, 2 booking ID. "Quote approved for booking {{2}}. You can start the work."
- `mxp_garage_estimate_rejected` [WA_TPL_GARAGE_REJECTED], 1 booking ID, 2 reason. "Your estimate for booking {{1}} was not accepted: {{2}}. Please send a new one in the app."
Until a template is approved, a message outside the 24 hour window is recorded as failed (retry from Resend); the email always goes. The customer needs WhatsApp consent.

## Approval
`crm_quote_admin_approve(p_lead, p_method 'phone'|'whatsapp', p_remarks (5+ chars), p_version default null)` approves the latest sent quote (or a changes-requested one) for the customer: stores `decided_method`, `decided_by_name`, `decided_remarks`, `decided_at`; `decided_via` stays `phone`. Returns `{ok, version, approved_at, by_name, method}` (`already: true` on a repeat). `crm_quote_phone_approve` still works (it calls the new one with method `phone`).
Customer approvals: `quote_decide(p_token, p_version, p_decision, p_reason, p_source)`; the quote-decision function passes `source`: `'track'` (tracking page) stores `customer_app`, anything else (the private link in the email) stores `customer_link`. **The tracking page (assets/js/track.js) must send `source: 'track'`**; until then its approvals are recorded as `customer_link`.
The quote email button opens the private tracking page, which has Approve, Decline and Ask for changes (all three call quote-decision).
`crm_booking_estimates(p_lead)` returns `{approval:{status,version,decided_at,decided_by_name,method,remarks}, quotes:[...every version, newest first...], garage_estimates:[...]}`. `approval.status`: none, pending, approved_self, approved_admin, rejected, changes_requested.

## Garage estimate review
`crm_garage_estimate_review(p_id, p_approve, p_note)`: reject now needs a remark (3+ characters), which the garage reads on the job in its app. Approve makes a DRAFT quote. To edit it the screen opens the quote builder and saves with `crm_quote_save` (it updates the one draft in place, same version), then sends it with booking-notify `quote_send`.

## Refunds
`booking_refunds` (admin read only, no client writes) follows the ledger: a trigger adds a row for every refund (manual: `refunded`, kind full when it covers everything paid, else partial; gateway: starts `pending`), and a reversal marks the row `failed`. admin-refund and the Cashfree webhook set `pending/processing/refunded/failed` (PENDING and ONHOLD are processing, SUCCESS refunded, CANCELLED/REJECTED/FAILED failed), the reference and Cashfree's `cf_refund_id`; a finished status is never undone by a late one.
`crm_booking_refunds(p_lead)` (Admin and Crew; Crew gets no gateway ids or references) returns `{paid, refunded, refundable, refund_due, refund_outstanding, rows}`.
`crm_cancellations_list` rows gain `refund_kind` (full, partial, none) and `refund_label` (Full, Partial).

## One assignment
`crm_assignment_info(p_lead)` returns `{garage:{id,name,code,status,seen_at,eta,notes,assigned_at,assigned_by_name,phone_for_admin}, outside, history:[{garage,status,at}]}`; the garage phone is Admin only.
`crm_assign_booking(p_lead, p_garage, p_outside, p_note, p_eta)`: exactly one of garage or outside partner. A garage goes through `crm_garage_assign` (all its guards; unpaid fee: "The customer has not paid the confirmation fee yet"). An outside partner is saved in `leads.assigned_to` and is refused while a garage job is open ("cancel or move the garage job first"). The mechanic assignment stays retired.

## Timeline
`crm_booking_timeline(p_lead, p_limit default 200)` returns `[{at, kind, title, detail, by_name}]`, newest first, from the booking history (which already holds status changes, notes, quote events with who approved and how, assignments, garage progress, delivery, cancellation), the message log (the history lines that only repeat a message result are left out so nothing shows twice), the ledger (amounts for Admin only; Crew sees the line without amounts), quote drafts, gateway refund status, and garage declines or timeouts. `by_name` is a person, `Customer` or `System`.

## Customer tracking payload (track-booking)
New keys on every payload: `delivery:{stage:'none'|'ready'|'delivered'|'closed', at}` and `cancel:{cancelled, kind:'customer'|'company'|null, refund:{status:'none'|'pending'|'processing'|'refunded'|'failed', amount}}`. A cancelled booking now shows as closed with a plain note. In the private-link view the quote also carries `approval`. No gateway id and never the private ref.

## Garage app (garage-app job and jobs)
Each job carries `approval:{status,by:'customer'|'admin'|null,at,version,label}`, `delivery:{stage,at}` and `customer_cancelled`. `quote.label` reads "Approved by admin on behalf of the customer" for an admin approval. A job cancelled because the customer cancelled the booking stays in the list for 7 days marked Cancelled and can be opened. No new customer contact data.

## Tests
`sh supabase/local-test/lifecycle.sh` (scratch Postgres, runs the migration twice then `lifecycle.sql`); `node --test tests/booking-lifecycle.test.mjs`. Not verified here: a live Supabase, Cashfree or Meta; Deno type-check (no deno installed).
