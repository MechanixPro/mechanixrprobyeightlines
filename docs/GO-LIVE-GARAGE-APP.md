# Go-live: partner garage app (/garage/)

Built on branch `garage-app` (from 160599c4). Nothing here is deployed, pushed or applied. Design: `docs/superpowers/specs/2026-11-06-partner-garage-app-design.md`.

## FLAG: privacy wording (owner / lawyer must approve BEFORE the first garage goes live)

**Customer phone is shared with the partner garage handling the job; the privacy policy must say so: owner/lawyer to approve wording.** The build does not touch any legal page. Lines to update (both are generated from `scripts/build_pages.py`):

1. `privacy/index.html`, section "Who we share it with", the sentence beginning "Only as needed: the mechanic assigned to your job; ...": add the partner garage that repairs the vehicle, and that it receives the customer's first name and mobile number for that job only, while the job is open.
2. `terms/index.html`, section 6 "Vehicle handover" (and the pickup-and-drop line under "Garage partners"): add that the partner garage may call the customer about the job, and that it never receives the customer's address or email.

Suggested wording to review: "When your vehicle goes to a partner workshop, we share your first name and mobile number with that workshop so it can call you about the repair. The workshop sees them only while your job is open and may not use them for anything else. We never share your address or email with the workshop."

The number is shown to the garage only in the job detail of an open job, and every view is written to the booking history ("Partner garage viewed customer contact") without the number. Masked calling is postponed; the code has one switch (`CONTACT_MODE` in `supabase/functions/_shared/garage.ts`) for that later.

## Order of steps

1. **Review the migration (dry run).** Read `supabase/migrations/20270101000000_garage_app.sql` (rollback notes are at the top). It is idempotent. Local proof: `sh supabase/local-test/run.sh` must end with `ALL GARAGE APP SQL CHECKS PASSED` (it also re-runs the migration to prove it is repeatable).
2. **Apply the migration** in the Supabase SQL editor (or `supabase db push`). It creates five tables (closed to everyone except through functions), the private bucket `garage-updates`, the Crew/Admin functions, and two new notification kinds. It changes no existing lead or garage.
3. **Set the session secret** (owner-run, hidden): `sh scripts/set_garage_secret.sh`. It makes a random `GARAGE_SESSION_SECRET` and never shows it. Optional: set `GARAGE_TEAM_WHATSAPP` and `GARAGE_TEAM_PHONE` (12 digits, 91 + number) if the garage app should use different team numbers from the website; otherwise the page uses `assets/js/config.js` (`whatsapp`, `callNumber`).
4. **Deploy the functions** (these three changed):
   - `supabase functions deploy garage-app --no-verify-jwt --project-ref mejdxsbpyscujpvbwvmg`
   - `supabase functions deploy track-booking --no-verify-jwt --project-ref mejdxsbpyscujpvbwvmg` (shows "Your vehicle is at a partner garage"; use the same flags it was deployed with before)
   - `garage-app` imports `_shared/after-payment.ts`, so redeploy any function you want to carry the new notification kind label (only `garage-app` sends it).
5. **Bucket check:** Storage shows `garage-updates` as private, 1.5 MB, JPEG/PNG/WebP only.
6. **Deploy the site:** `npm run deploy:site` (copies `/garage/`, `garage.webmanifest`, the new `_headers` rules). `sw.js` now skips `/garage/`.
7. **Check on a phone** (see below) before sending a real link.

## Onboard the first garage

1. In Crew, make sure the garage exists on the Garages page (name, mobile, status not paused).
2. The Crew/Admin Garages screen is not built yet, so until then run the functions in the Supabase SQL editor *as an admin*. They check who is calling, and the SQL editor has no signed-in user, so start the same run with your own admin user id (Authentication > Users):
   `select set_config('request.jwt.claim.sub', '<your admin user id>', true);`
   `select public.crm_garage_access_create('<garage id>', '<4 to 6 digit PIN>');`
   Run both lines together (one run). The result holds the private link. It is shown once and only its hash is stored. The same two-line pattern works for every function below. (Not tested in the real SQL editor: this build only proved the functions on a local scratch Postgres.)
3. Send the link and the PIN to the garage on WhatsApp in two separate messages.
4. Assign a job: `select public.crm_garage_assign('<lead id>', '<garage id>', 'what was found and what is needed', '<return time>');`
5. Test on a real phone: open the link, enter the PIN, see the job, add to home screen, mark Vehicle received, send a test estimate. Then in Crew: `select public.crm_garage_estimates_inbox();` and approve with `select public.crm_garage_estimate_review('<estimate id>', true);` (makes a DRAFT quote; send it with the usual Send quote button).
6. To stop access: `crm_garage_revoke('<access id>')` (sessions end at once), `crm_garage_pin_reset`, `crm_garage_link_new` (new link, old one dies), `crm_garage_enable`.

Amounts for the statement: `select public.crm_garage_settlement_set('<assignment id>', 1850, false, 'note');` (Admin enters each amount; nothing is calculated).

## Rollback

- Site: redeploy the previous Pages build (the app is a separate folder and manifest; removing `/garage/` changes nothing else).
- Functions: `supabase functions delete garage-app`; redeploy the old `track-booking`.
- Database: the rollback block at the top of the migration, in order. Garage data is separate from leads, so dropping it loses only garage progress and estimates.
- Fast switch-off without rolling back: `update public.garage_access set active = false;` ends every garage session.

## Notes and limits

- The session lasts 12 hours and is kept on the phone until it ends or the garage taps Lock. A lost phone is cut off by `crm_garage_revoke` or a PIN reset.
- The PIN is checked inside Postgres with bcrypt. 5 wrong PINs lock the access for 15 minutes. The login also has per-IP (20) and per-link (15) limits per 10 minutes.
- Work started is blocked until the latest sent quote is approved, only for bookings with a confirmation fee (the same rule as the existing gate).
- Approving an estimate refuses if a draft quote already exists, or the booking has not reached the stage where a quote can be saved; Crew sees the reason.
- Team alerts (estimate sent, ready) go by email to the desk, like the other team alerts.
