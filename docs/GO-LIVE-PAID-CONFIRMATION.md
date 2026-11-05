# Go-live: paid confirmation booking

Built on branch `booking-pay-flow`. Nothing here is applied, deployed or sent yet. Say "apply and deploy" and follow these steps in order. Design: `docs/superpowers/specs/2026-11-05-paid-confirmation-booking-design.md`.

What it does: a customer (on `/book/`) or a sales call pays a confirmation fee (Rs 49 up to 149cc, Rs 69 for 150 to 250cc, Rs 99 for 251cc and above and for cars; always inside Rs 49 to Rs 99). Paid means confirmed: booking ID, confirmation email, fee receipt, WhatsApp confirmation and a team alert all go out on their own. The team assigns a mechanic in Dispatch. At the door the customer's one-time code starts the job. The mechanic checks the vehicle, Crew or Admin sends an itemised quote with an estimated delivery, the customer approves on the tracking page, and only then can work start or the vehicle be picked up.

## 0. Before anything
- [ ] Merge nothing yet. Check out `booking-pay-flow`, run `npm test` and `npm run check` (both must be green).
- [ ] Run the local database proof (no Supabase involved): `sh supabase/local-test/run.sh`. It loads every migration into a scratch Postgres, runs the new one twice, and checks admin, Crew, stranger, gating and idempotency. It must end with `ALL PAID CONFIRMATION SQL CHECKS PASSED`.
- [ ] The owner or the lawyer approves the wording listed in section 9.

## 1. Migration dry run, then apply
One new file: `supabase/migrations/20261228000000_paid_confirmation.sql` (after `20261227000000_crew_conversion.sql`). It is idempotent and adds only: fee rows, new columns that are empty for old leads, three new tables (`booking_secrets`, `booking_notifications`, `job_quotes`), triggers that apply only to leads with a confirmation fee, functions, and admin-aware versions of `crm_move_guard`, `crm_tech_link`, `crm_payment_context` and `crm_handover_code`.
1. Dry run: `npx supabase db push --dry-run` (lists only this file).
2. Apply: `npx supabase db push --yes`.
3. Check: `npx supabase db query --linked "select id, price from services where id like 'confirm_%' order by id"` shows 49, 99, 69, 49 in the order big, car, mid, std.
4. The fee rows are edited in the admin Prices tab. The database refuses any value outside 49 to 99.

## 2. Edge Functions to deploy
New: `book-start`, `booking-notify`, `quote-decision`.
Changed (they share new code in `_shared/`): `verify-payment`, `razorpay-webhook`, `create-order`, `desk-payment-link`, `payment-link`, `track-booking`, `tech-job`, `desk-automation`.
```
npx supabase functions deploy book-start quote-decision track-booking create-order verify-payment tech-job --use-api
npx supabase functions deploy razorpay-webhook --no-verify-jwt --use-api
npx supabase functions deploy booking-notify desk-payment-link payment-link --use-api
npx supabase functions deploy desk-automation --no-verify-jwt --use-api
```
Use the same JWT flags the project already uses for the existing functions: public site functions are called with the anon key, `razorpay-webhook` and `desk-automation` are called without a user token.

## 3. Secrets, templates and senders that must already exist (names only, never print values)
- Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. In the Razorpay dashboard, the webhook (same URL and secret as today) must also send **`order.paid`** and **`payment.captured`** (today only `payment_link.paid`). Without them a customer who pays and closes the tab is confirmed only when our retry sweep notices, not at once.
- Email: `RESEND_API_KEY`, and `mechanixpro.in` verified in Resend so `booking@mechanixpro.in` can send (confirmation, fee receipt, quote, delivery update). Team alerts send from `no-reply@mechanixpro.in`.
- WhatsApp through AiSensy: `AISENSY_API_KEY`, and the desk templates already approved and their campaigns ready (Team page, WhatsApp setup): **`mxp_booking_confirmed`** (5 variables) for the paid confirmation and **`mxp_quote_ready_v2`** (3 variables) for the quote, **`mxp_desk_payment_link`** (4 variables) for the sales-call link. No new template is created. The `desk_campaigns` setting must show them ready, otherwise those messages are logged as "skipped" with the reason.
- Site and desk: `SITE_URL` (https://mechanixpro.in), `DESK_URL` (https://crew.mechanixpro.in/crm/), `ALLOWED_ORIGINS` (includes https://mechanixpro.in), `IP_SALT`, `DESK_CRON_SECRET`, `SUPABASE_*` (set by Supabase).
- **Turnstile:** if `TURNSTILE_SECRET` is set, `book-start` requires a Turnstile token and `/book/` does not render the widget yet (the site key in `assets/js/config.js` is empty today). Leave `TURNSTILE_SECRET` unset until the widget is added to `/book/`.
- Settings rows (optional): `lead_alert_emails` (extra team addresses; the active Crew and admin logins are always included), `confirm_nudge_minutes` (default 30), `unassigned_alert_minutes` (default 15).
- The 3-minute `desk-automation` cron already exists; it now also retries failed messages and sends the "link unpaid" and "no mechanic" team alerts.

## 4. Deploy the sites
```
sh scripts/build_site.sh   && npx wrangler pages deploy dist-site  --project-name mechanixpro-site  --branch main
sh scripts/build_crm.sh    && npx wrangler pages deploy dist-crm   --project-name mechanixpro-crm   --branch main
sh scripts/build_admin.sh  && npx wrangler pages deploy dist-admin --project-name mechanixpro-admin --branch main
```
Deploy with `~/.cf-mxp-env` as usual. `/book/` is now the paid page; the old quote builder is at `/quote/` (`scripts/build_site.sh` copies it). Add `/quote/` to `sitemap.xml` when the sitemap is next regenerated (the working-tree sitemap was not touched).

## 5. Razorpay test-mode run (before any real money)
1. Put the test keys and test webhook secret in the secrets, deploy, open `/book/` and book a bike (for example "Pulsar 150", slot tomorrow morning, a test email you control).
2. The page must show "Confirmation fee for your bike size: Rs 69. Adjusted in your final bill." Pay with a Razorpay test card.
3. Check, in this order: the success card shows a booking ID and a Track link; the email arrived (booking ID, address, slot, amount with GST split, tracking link, 4-digit code, "Give this code to the mechanic when they arrive. Do not share it before."); the fee receipt email arrived; Crew shows the booking in Dispatch with a "Paid Rs 69" badge; the booking history lists each message as sent or skipped with the reason.
4. Retry safety: replay the same webhook from the Razorpay dashboard and refresh the success page. There must be no second email, no second ledger row (`select count(*) from ledger_entries where lead_id = ...` is 1) and no second WhatsApp.
5. Sales-call flow: in Crew, open a lead, press **Send payment link**, copy the message, open the link on a phone, pay with a test card. The lead must turn Paid and Confirmed only after the payment.
6. Door and quote: assign a mechanic in Dispatch, send the job link, open it on a phone, mark On the way and Arrived, type the customer's code, then try **Start work**. It must be blocked. Build a quote in Crew (set the delivery estimate), approve it on the tracking link, and Start work must now work. Repeat with a revised quote: work must be blocked again until the new approval.
7. Switch to live keys only after all of this passes.

## 6. One real Rs 49 test
Book a small bike ("Activa 125") on `/book/` with the owner's own email and phone, pay Rs 49 for real, and walk through section 5 steps 3 to 6. Then refund it from the Razorpay dashboard and mark the lead lost or junk so it is out of the reports. The existing refund policy applies unchanged.

## 7. Roll back
- Website only: redeploy the previous `dist-site` (the old `/book/` builder is the previous deploy). Nothing else needs to change.
- Functions: redeploy the previous versions from `main`. The new database columns and tables are harmless to old code.
- Database: the rollback statements are at the top of the migration file. The four re-created guard functions can be restored from their original migrations (listed there). No old lead is changed by the migration, so rolling back loses only the new paid-confirmation data.
- Switch off customer messages without a rollback: remove the template campaigns from `desk_campaigns` (WhatsApp is then logged as skipped) or unset `RESEND_API_KEY` (email is logged as skipped). Every message is logged and can be sent later with Resend.

## 8. Who can do what
- Admin (owner or staff role) passes every check in this flow: Send payment link, Dispatch, assign and reassign, job link, door code, quote, phone approval, delivery estimate, Ready and Delivered, notification log with Resend. Admin uses the same database functions and Edge Functions as Crew; the shared screen code is `crm/flow-core.js` with an identical copy `admin/flow-core.js` (a test checks they match).
- Crew: supervisors and the Technician lead (`assign_leads` or `manage_technicians`) can dispatch, assign, build quotes and record phone approvals. A lead's owner can use these on their own lead. Sales agents cannot touch other agents' leads, and technicians have no Crew login (they use the job link).

## 9. Words that need the owner's or the lawyer's approval (not changed)
- UPDATED on branch `site-cleanup`: `/refund-policy/`, `/terms/`, help, home, area and model pages, `/offers/*`, `/rate-card/`, `/pay/` and `llms.txt` now describe the Rs 49 to Rs 99 confirmation fee. Every changed legal line is in `docs/LEGAL-REVIEW-FEE-WORDING.md` and needs the lawyer's approval before deploy.
- The Rs 349 and Rs 99 fees no longer appear on any public page (test `tests/fee-retired.test.mjs`).
- GST: the confirmation fee is treated as including 18% GST. The receipt shows the taxable value, CGST 9% and SGST 9% and calls itself a receipt for an advance. Please have the accountant confirm this is the right document for an advance.
- The quote email and tracking page say "Nothing starts until you approve", "The fee is adjusted in your final bill" and "Your code protects your vehicle". These are the system's behaviour, not new legal terms.

## 10. Known limits
- Mechanic-built quotes are not built: Crew and Admin build and send the quote; the mechanic's `/job/` page shows the quote status and blocks work until it is approved.
- A sales-call lead with no email: the email steps are logged as skipped ("no email address"); the code is still on the tracking link and Crew can read it. Add the email in the payment link dialog, then press Resend.
- The WhatsApp confirmation reuses `mxp_booking_confirmed`, which names a mechanic. No mechanic is known at payment, so the mechanic slot reads "from our team". When a mechanic is assigned and the booking is scheduled, the existing automation sends the same template again with the real name.
- The team alert goes by email (the existing staff-alert channel). There is no WhatsApp alert to staff because that would need a new template.
