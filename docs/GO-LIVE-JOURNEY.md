# Go-live: customer journey after payment and the mechanic live-job link

Branch `site-journey` (built on the paid-confirmation system, main at 837066e5). Nothing here is applied, deployed or sent. Design and permission matrix: `docs/superpowers/specs/2026-11-06-customer-journey-and-mechanic-link-design.md`. Placeholders only: no real customer data in this document.

## 0. Before anything
- [ ] `npm test` and `npm run check` green on `site-journey`.
- [ ] `sh supabase/local-test/run.sh` must end with `ALL PAID CONFIRMATION SQL CHECKS PASSED` and `ALL JOURNEY SQL CHECKS PASSED` (it loads every migration into a scratch Postgres, runs the four newest a second time, and checks customer, mechanic, agent, Technician lead, supervisor, admin, stranger and anon).
- [ ] Decide the open questions at the end of this file (mechanic PIN login, Google review link, WhatsApp template).

## 1. Migrations: dry run, then apply (in this order, after 20261228000000)
1. `20261229000000_customer_updates.sql`: customer details, photos, issues, the private bucket `booking-updates`, notification kinds `ontheway_email` and `team_issue`.
2. `20261230000000_tech_location.sql`: `tech_locations`, `tech_location_put`, purge trigger, last-seen functions, My jobs functions.
3. `20261231000000_customer_documents.sql`: `booking_documents`, `booking_history`, setting `track_show_history` (default true).
`npx supabase db push --dry-run` must list exactly these three; then `npx supabase db push --yes`. All are idempotent. Check: `select id, public from storage.buckets where id = 'booking-updates'` shows public = false.

## 2. Storage bucket
Created by migration 1 (private, JPEG/PNG/WebP, 1.5 MB). Nothing to do by hand. Customer photos are removed by `select public.booking_photos_purge()` (default 12 months, same setting as handover photos). Nothing schedules it yet: run it by hand now and then, or add it to the same cron as `handover_purge_photos`.

## 3. Edge Functions to deploy
New: `booking-update`.
Changed: `track-booking`, `tech-job`, `submit-rating`, `booking-notify`, `desk-automation`.
```
npx supabase functions deploy booking-update track-booking tech-job submit-rating booking-notify --use-api
npx supabase functions deploy desk-automation --no-verify-jwt --use-api
```
Use the same JWT flags the existing functions already use (public site functions are called with the anon key). No new secrets.

## 4. Sites
```
sh scripts/build_site.sh  && npx wrangler pages deploy dist-site  --project-name mechanixpro-site  --branch main
sh scripts/build_crm.sh   && npx wrangler pages deploy dist-crm   --project-name mechanixpro-crm   --branch main
sh scripts/build_admin.sh && npx wrangler pages deploy dist-admin --project-name mechanixpro-admin --branch main
```
Deploy the functions and migrations BEFORE the pages. `/book/` now has a success state that was throwing in the live build (see "Fixes to existing code" below): deploying the site fixes it.

## 5. Config flags
- `assets/js/config.js` `googleReviewUrl` (empty): put the Google review link there to show "Share on Google" after a 4 or 5 star rating. Empty means the button never appears.
- `settings.track_show_history` (database, default true): set to false to hide "Your other bookings" for everyone, no deploy: `update public.settings set value = to_jsonb(false) where key = 'track_show_history';`
- Optional `lead_alert_emails` already sets who gets team alerts (now also customer-issue alerts).

## 6. Templates
- **On the way:** no approved WhatsApp template fits ("Booking confirmed" says the mechanic will come; it does not say he has left). Only an email (`mechanic_on_the_way`) is sent, plus the live tracking page. To add WhatsApp, create and approve a UTILITY template, for example `mxp_mechanic_on_the_way`: "Hi {{1}}, {{2}} is on the way for booking {{3}}. Track live: {{4}}" and then add a send next to `sendOnTheWay` in `_shared/after-payment.ts`. Not built, no template invented.
- Completion and "please rate" use the existing `mxp_service_done` and `mxp_desk_rating_link`: unchanged.

## 7. Test run (before telling customers)
1. Pay on `/book/` (Razorpay test keys): the thank-you shows with the booking ID, Track button, home-screen option, "Add details or report an issue".
2. On a phone: add to the home screen; open the app: it should open the booking. On an iPhone: add it from the tracking page.
3. Add landmark, a photo, and report a problem: Crew and Admin show "Added by customer" and the open issue; the team email arrives; Resolve records the name and time.
4. Assign a mechanic, send the job link, open it on the mechanic's phone: tap On the way (email to the customer), tap Share my live location, walk 100 m: the customer's page shows "about N min away (estimate)" and Crew shows "Mechanic last seen".
5. Verify the code: sharing stops by itself and the points are deleted. Send a quote: the mechanic sees it read-only; approve on the tracking page; "Approved: you can start".
6. Complete the job: the tracking page shows the rating card, the receipt and invoice, and earlier bookings.

## 8. Roll back
- Pages: redeploy the previous `dist-site`, `dist-crm`, `dist-admin`. Functions: redeploy from `main`. New tables and functions are harmless to old code.
- Database: rollback statements are at the top of each migration file (drop functions, tables, trigger, policy). The widened notification kinds can stay.
- Switch off pieces without a rollback: `track_show_history` false (history), empty `googleReviewUrl` (Google), unset `RESEND_API_KEY` (emails skipped and logged).

## 9. Fixes to existing code found while testing with the real CSP
- `/book/` success state threw `Cannot set properties of null` right after a successful payment (the step list is outside the form), so the customer saw "No connection" and the pay button again, never the success card. Fixed.
- Photo preview and compression on `/job/` used `blob:` images, which the site CSP (`img-src 'self' data: https:`) blocks, so handover photos could not be read. Now data: URLs, CSP unchanged. The same applies to the new customer photos.
- `track-booking` limited every link to 20 calls in 10 minutes; the page polls every 20 to 30 s, so a page left open would hit it. The secret link now gets 150; the reference-and-phone lookup keeps 20.

## 10. Known limits
- Live location works only while the mechanic keeps the job page open in the foreground; phones may pause a background browser tab.
- Estimate is a straight-line distance x 1.3 / 18 km/h, rounded up to 5 minutes. No traffic data, no map tiles.
- If the booking has no map pin (customer typed the address), the customer sees last seen and a Maps link but no estimate.
- Add-to-home-screen on Android opens the home page, which redirects to the saved booking for 14 days; on iPhone the icon opens the page it was added from.
- Invoices have no customer link or token in the system; "Your documents" shows the receipt and the invoice (once saved or emailed by the admin) in the page, printable as PDF.
