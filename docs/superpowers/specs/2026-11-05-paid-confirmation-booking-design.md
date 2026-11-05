# Paid confirmation booking: design (2026-11-05)

Goal: a customer (or a sales call) pays a small confirmation fee (min Rs 49, max Rs 99, by engine size) to confirm a doorstep slot for a bike or a car. The booking is then tracked, a mechanic is dispatched in Crew, and the customer gives a one-time code to the mechanic at the door before any work starts. Built on a local branch (`booking-pay-flow`). Nothing is applied, deployed or sent.

## What already exists (reused)
| Piece | Where | Reuse |
|---|---|---|
| Razorpay Standard Checkout: order, signature check, capture check | `create-order`, `verify-payment`, `_shared/checkout.ts` | reused; both get a post-payment hook |
| Webhook (payment links only) | `razorpay-webhook` | extended to `order.paid` / `payment.captured` so a closed tab still confirms |
| Desk and admin payment links | `desk-payment-link`, `payment-link`, `crm_payment_context` | extended with `purpose: 'confirm'` |
| Money record | `ledger_entries` (unique gateway id), trigger keeps `leads.paid_amount` | reused; this makes payment idempotent and the fee adjusts into the final bill through `paid_amount` (invoice.ts) |
| Booking ID after payment | `leads_booking_id_auto_tr`, `confirm_booking` | reused unchanged: paid gives the MP-yy-yy-#### ID |
| Mail | `_shared/resend.ts`, `FROM_BOOKING` (booking@mechanixpro.in), `email_log`, `email-templates.ts` | new template `paidConfirmation` |
| WhatsApp paid template | `sendSmart`, `TPL.paid()` | unchanged, same 2 params |
| Tracking | `track-booking`, `_shared/track.ts`, `/track/` (ref + phone) | kept; new secret-link mode `?t=` and a real visit timeline |
| Technician job link, PIN login, assignment | `tech_job_links`, `tech-job`, `crm_tech_link`, `crm_assign_technician`, `/job/` | extended with visit steps |
| OTP handover (pickup, return), lockout 5 tries, hash with id salt, private photo bucket | `handovers`, `_shared/handover.ts` | new kind `start` (door code) for every job; photos policy by vehicle |
| Vehicle tag | `leads.vehicle` | picks the car flow and the fee table |
| Address, PIN, lat/lng, email, engine class columns | `leads`, `bikes` | already there, no new address column needed |
| Step bar | `crm/crm-rules.js`, `admin/booking-steps.js` | six steps kept; step 3 shows "Payment link sent" |
| Follow-up nudges | `leads.next_followup_at`, `follow-up` | link sent sets the next nudge in N minutes (setting `confirm_nudge_minutes`, default 30) |
| Dispatch base | `crm_tech_board`, `crm_unstaffed_jobs` | new `crm_dispatch_list` |

## Decisions (defaults, one place to change)
- **Fee by engine size**, rows in `services` (kind `fee`, editable in the admin Prices tab): `confirm_std` 49 (up to 149cc), `confirm_mid` 69 (150 to 250cc), `confirm_big` 99 (251cc and above), `confirm_car` 99 (no car engine tiers exist). A database check keeps every `confirm_*` row between 49 and 99 and `_shared/confirm-fee.ts` clamps again. The fee is always worked out on the server from vehicle and model; the browser only sends what the customer picked.
- Engine class: a cc number in the model name wins (same rule as `engineGuess` in logic.js); else the class the form sent. If neither is usable the fee is Rs 69 and the lead is flagged for Crew review (`confirm_fee_review`).
- The fee includes GST (as every website amount does). Emails show the GST part separately (18% inclusive).
- Adjusted against the final bill through `paid_amount`. Cancel and refund behaviour: the existing refund policy wording is reused unchanged.
- Confirmed only when paid: database triggers stop a lead with a confirmation fee from becoming scheduled or getting a booking ID until `confirm_paid_at` is set (payment, or an admin recording the payment).
- Idempotency: browser key `client_key` (unique) so a double tap or refresh gives one lead; one Razorpay order per lead (`rzp_order_id`); the ledger's unique gateway id, so verify and webhook can both run.
- Door code: 4 digits, hash stored in `handovers` (kind `start`, 5-try lock as before), plaintext kept in private table `booking_secrets` (no grants, definer RPC only, cleared when the job is done) so the email, the tracking page and Crew can show it. The tracking secret link token is in the same table.
- `/book/` becomes the paid page; the old builder (quote on WhatsApp) moves to `/quote/`.

## New pieces
Migration `20261228000000_paid_confirmation.sql`; functions `book-start`, `confirmation-email`; shared `confirm-fee.ts`, `after-payment.ts`; changes to `verify-payment`, `razorpay-webhook`, `create-order`, `desk-payment-link`, `payment-link`, `track-booking`, `tech-job`; pages `/book/` (+`book-pay.js`), `/track/` link mode, `/job/` visit steps; Crew Dispatch page, payment modal, call script, paid badge; docs `GO-LIVE-PAID-CONFIRMATION.md`.
