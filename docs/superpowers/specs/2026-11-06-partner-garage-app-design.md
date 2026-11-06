# Partner garage app (/garage/) design

Mechanix Pro is a brand of NOVA VENTURES. Date: 2026-11-06. Branch `garage-app` from origin/main 160599c4 (the live code).
Status: built locally, not deployed, migration not applied. Go-live steps: `docs/GO-LIVE-GARAGE-APP.md`.

## What it is

An installable web app at `/garage/` where each partner garage opens a private screen with the bookings sent to it. No email or password: each garage has a private link plus a PIN of 4 to 6 digits. The phone keeps the link, so the home-screen icon opens straight to the PIN screen.

## FLAG FOR OWNER AND LAWYER (do not skip)

**Customer phone is shared with the partner garage handling the job; the privacy policy must say so: owner/lawyer to approve wording.**
This build does NOT change any legal page. Lines that need updating before the first garage goes live:

- `privacy/index.html` (generated from `scripts/build_pages.py`, section "Who we share it with", the sentence beginning "Only as needed: the mechanic assigned to your job; ..."): add the partner garage that repairs your vehicle, and say the garage receives your first name and mobile number for that job only, while the job is open.
- `terms/index.html` (same file, Terms section 6 "Vehicle handover", and the pickup-and-drop wording in "Garage partners"): add that the partner garage may call the customer about the job, and that the garage never receives the customer's address or email.

Suggested wording for the owner/lawyer to review: "When your vehicle goes to a partner workshop, we share your first name and mobile number with that workshop so it can call you about the repair. The workshop sees them only while your job is open and may not use them for anything else. We never share your address or email with the workshop."

## Existing pieces reused

| Need | Reused |
| --- | --- |
| Garage master data | `public.garages` (name, code, status, owner, pincode), `crm_garage_save`, Crew page `crm/pages/garages.js` (read only: not edited here) |
| Pickup and drop to a workshop | `leads.job_place = 'garage'`, `leads.visit_stage` (`picked_up`, `ready`, `returned`), `handovers` (pickup photos and note, OTP), Terms section 6 |
| Quotes | `job_quotes`, `crm_quote_save` (draft quote), `crm_quote_send`, the gate in `leads_quote_gate`, `quote_decide` |
| Customer tracking | `_shared/track.ts` `trackView`, `track-booking` function |
| Notifications | `booking_notifications` (+ `notification_claim`, `notification_finish`), `_shared/notify.ts` `deliver`, `after-payment.ts` team mail |
| Public function patterns | `tech-job` (hashed token, hashed IP, audit_log rate limits), `booking-update` (signed upload URLs, private bucket) |
| Permissions | `flow_role()`, `flow_can()` (admin is a superset of supervisor), `flow_need()` |
| History and audit | `crm_activities` (booking history), `audit_log` |
| Install | `assets/js/install.js` patterns (beforeinstallprompt, iPhone hint, standalone), `manifest.webmanifest` icons |
| Page build | `scripts/build_pages.py` single-task page pattern (like `/warranty/`, `/rate/`), `scripts/build_site.sh` copy list |
| Local test | `supabase/local-test/run.sh`, `stub.sql` |

## New pieces

1. Migration `supabase/migrations/20270101000000_garage_app.sql`: tables `garage_access`, `garage_assignments`, `garage_progress`, `garage_estimates`, `garage_settlements`; private bucket `garage-updates`; service-role functions for the app; Crew/Admin functions `crm_garage_*`; two notification kinds `team_garage_estimate`, `team_garage_ready`.
2. Edge Function `supabase/functions/garage-app` (public, deployed with `--no-verify-jwt`) plus pure module `_shared/garage.ts` (session signing, whitelist serializer, estimate checks).
3. Page `/garage/` (generated), `assets/js/garage.js`, `assets/css/garage.css`, `garage.webmanifest`.
4. `track.ts`: one extra customer line "Your vehicle is at a partner garage" (no garage name or address).
5. Docs and tests.

## Access and sessions

- `garage_access` row per access: `garage_id`, `label` (so several staff PINs per garage can be added later; today one row per garage is created), `link_hash` (SHA-256 of a 192-bit random token; the token itself is shown once when created), `pin_hash` (pgcrypto `crypt` with `gen_salt('bf')`), `failed_attempts`, `locked_until`, `active`, `revoked_at`, `session_version`, `created_by`.
- Login: `login { token, pin }`. 5 wrong PINs lock that access for 15 minutes. Per-IP and per-link rate limits (hashed, via `audit_log`, like tech-job). Same answer for an unknown link and a wrong PIN.
- Session: stateless token signed with HMAC-SHA256 and the secret `GARAGE_SESSION_SECRET`, 12 hours, carries the access id and `session_version`. Every request re-reads the access row, so switching a garage off, resetting the PIN or revoking the link ends sessions at once (the version is bumped).
- Constant-time: the session signature is compared in constant time in the function. The PIN is checked inside Postgres with bcrypt (`crypt`), which is slow by design.

## What a garage sees (whitelist serializer)

Per job: vehicle and model, work needed, what was found (Crew note), pickup notes and photos (signed URLs), status, expected return time, quote status (none / waiting for customer / approved / declined), the customer's FIRST NAME only, its own timeline and estimate.

- Job LIST: never a phone, address or email.
- Job DETAIL: includes `customer_phone` (digits only) ONLY while that garage has an OPEN assignment for that lead (status sent, received, in_work or ready), the lead is not closed, and the access is active. Never after the assignment is returned or cancelled, the link is revoked or the garage is switched off.
- The customer's address and email never reach the garage in any response, any page, any log.
- Each detail read that includes the number writes a booking-history line "Partner garage viewed customer contact" and an audit row; the number is not stored in either. Detail reads are rate limited per access (40 per 10 minutes).
- The serializer is `garageJob(raw, { includeContact })`: it builds the output field by field from a whitelist. One switch decides how contact is delivered: `CONTACT_MODE = 'direct'`. Masked calling can replace the number later by changing that one mode (see Later).
- A fuzz test feeds leads whose every text field contains the phone, address and email and asserts none appears in any list response or any non-open detail, and that address and email never appear anywhere.

## Garage actions

- Progress: `Vehicle received` (sent to received), `Work started` (received to in_work), `Ready for return` (in_work to ready). Optional photos each (JPEG, PNG, WebP, 1.5 MB, 4 per update; private bucket `garage-updates`, one-time signed upload URLs; Crew/Admin and that garage read via signed URLs).
- `Work started` is blocked in the database until the latest sent quote is approved by the customer (same rule as the existing gate: `quote_is_approved`). The app shows "The customer has not approved the quote yet. Send your estimate; work can start once the customer approves."
- `Ready for return` moves `leads.visit_stage` to `ready` when it is `picked_up` or `repair_doorstep`; otherwise the stage is left alone. The customer's /track/ page shows "Your vehicle is at a partner garage" with the status in plain words. Crew sees history lines. `returned` is set by the existing return flow (a trigger closes the assignment).
- Estimate: lines (parts, labour, other; amounts before GST), notes, estimated hours (1 to 72) or a return day. Goes to the Crew/Admin inbox as `submitted`. Nothing reaches the customer. On approval, `crm_garage_estimate_review` creates the DRAFT customer quote through `crm_quote_save` (same GST maths, same required delivery estimate); Crew/Admin then send it with the existing flow. It refuses if a draft quote already exists, or the lead is not yet at a stage where a quote may be saved, and says so.
- Statement: completed jobs with the amount ENTERED BY ADMIN per job and settled or pending. No rates, commissions or payout rules are computed.
- Contact: "Call or WhatsApp our team" from `window.MXP` (`whatsapp`, `callNumber`, `callViaWhatsApp`), no hard-coded numbers. "Call customer" is a plain `tel:` link in the job detail while the job is open.

## Crew and Admin database functions (screens come later)

`crm_garage_access_create(garage, pin)` (returns the private link once), `crm_garage_pin_reset`, `crm_garage_revoke`, `crm_garage_enable`, `crm_garage_assign(lead, garage, note, eta)`, `crm_garage_assignments_list`, `crm_garage_estimates_inbox`, `crm_garage_estimate_review(id, approve, note)`, `crm_garage_settlement_set(assignment, amount, settled, note)`. Allowed: supervisor and admin (`flow_can('manage_garages')` or `assign_leads`; admin always). Agents and technicians are refused.

## Privacy and security decisions

- Tables are closed to anon and authenticated (RLS on, no policies, all privileges revoked); only definer functions with explicit grants. App functions are granted to `service_role` only.
- Only hashes of the link token and PIN are stored. The PIN never appears in logs.
- No service worker for `/garage/`; nothing private is cached. `Cache-Control: no-store` and `X-Robots-Tag: noindex` on `/garage/*`. Not in the sitemap or `llms.txt`.
- Photos are served only by short-lived signed URLs created after the session check.

## Later

- Masked customer calling via the Agentive Click to Call API once the owner confirms the account supports it. Not built: no table, setting, secret or button exists.
- Several staff PINs per garage (the table already allows more than one access row per garage).
