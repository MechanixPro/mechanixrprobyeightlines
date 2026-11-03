# OTP handover and bike photos: design (4 Nov 2026)

Status: **for owner approval. Nothing here is built.**

## Why

The website (home, help, terms section 6, roadside, pickup and drop page) and our live ads say: "If your bike needs a workshop, it leaves only after you share a one-time code." Today no software records or enforces that. Crew uses OTP only for staff login, and `docs/ROADMAP.md` lists "OTP handover, inspection photos" as a future phase. The promise is real only if technicians do it by hand and nobody can prove it. This design makes the promise true and gives the desk a record.

## Scope

- **In:** jobs where the bike leaves the customer's place (pickup to a Mechanix Pro Certified garage, `job_place = 'garage'` or `place = 'pickup'`). Two handovers per job: **pickup** and **return**.
- **Out:** doorstep jobs (the bike does not leave), a customer app, SMS provider, AI damage detection.

## Flow (rides on the technician link at /job/ that is already live)

1. **Desk** opens the lead in Crew. A new **Handover** card shows Pickup and Return, each: *not started / code sent / verified at hh:mm by <technician> / N photos*.
2. **Desk taps "Send pickup code".** The system makes a 4-digit code, stores only its hash, and opens WhatsApp to the customer with the code in the message (same pattern as "Send job to technician"). It expires in 24 hours. A new code cancels the old one.
3. **Technician** opens the same /job/ link. A **Pickup** step appears for these jobs:
   - takes **at least 4 photos** (front, back, left, right) and optionally one of the odometer or any damage;
   - asks the customer for the code and types it in.
4. **tech-job** function checks the code (hash compare), allows **5 wrong tries then locks** (desk is alerted), saves the photos, and records who and when. The photos are compressed on the phone (about 150 KB each).
5. **Return** works the same with a new code when the bike is delivered back.
6. **Crew** shows each handover with its photos (signed links, desk permission only) and writes a line in the lead's history.

## Data

- Table `handovers`: `lead_id`, `kind` (pickup or return), `code_hash`, `code_expires_at`, `attempts`, `locked_at`, `verified_at`, `mechanic_id`, `photo_paths[]`, `note`. One verified pickup and one verified return per lead (unique index).
- **Private** storage bucket `handover`. No public URLs. Upload only through a one-time signed URL from the function; desk reads through signed URLs with an expiry.
- RLS on, all grants revoked, access only through functions (same hardening as `tech_job_links`).

## Rules and edge cases

- Refused: lost or deleted lead, a technician who is not the assigned one, a code after expiry or lockout, fewer than 4 photos, a second verified pickup.
- Lost code or customer without WhatsApp: desk resends a new code (old one dies). Everything is logged.
- The technician link stays public by token only: no customer name, phone or prices are shown on the handover screen, same as today.
- Privacy: photos show the registration plate (not on the banned list of Aadhaar, PAN, bank, card or DL numbers). They stay private and are covered by the privacy policy line on inspection photos.

## Website, terms and customer updates (only after the flow is live and tested)

- Wording is changed to match what is enforced: "Your bike leaves only after you share a one-time code with the mechanic, and we photograph it at pickup and return."
- Update: home FAQ, help, terms section 6, pickup and drop page, and the /track/ page (shows "Pickup recorded", "Returned").
- Ads keep the OTP line only while the process is real.

## Decisions needed from the owner

1. **Code delivery:** the desk sends it on WhatsApp by link (works today), or automatically through a WhatsApp template (needs AiSensy and Meta template approval, days). Recommended: desk link now, template later.
2. **Photo storage:** about 1 MB per job (6 photos). At 100 pickup jobs a day that is about 3 GB a month, which will pass Supabase's free storage. Recommended: keep photos **12 months**, then delete automatically. Cost for a paid plan is the owner's call.
3. **Scope:** only pickup jobs (recommended), or every job.

## Tests

- Pure rules (code, hash, expiry, attempt lockout, photo count) as node tests, same style as `tech-job.test.mjs`.
- Source checks for the migration, function and the Crew and /job/ pieces.
- One live end-to-end on a test booking (create, send code, wrong code, right code, photos, return), then the test booking is soft-deleted and its photos removed, as done for the technician link.
- Deploys happen only on your phrases ("apply and deploy ...", "push").

## Build order

1. Migration, storage bucket and functions (code, verify, photo upload, desk read).
2. /job/ page: Pickup and Return steps.
3. Crew: Handover card and "Send code".
4. Tests and a live check.
5. Website, terms and /track/ wording.
6. Ads and posts: keep or tighten the OTP line to match.
