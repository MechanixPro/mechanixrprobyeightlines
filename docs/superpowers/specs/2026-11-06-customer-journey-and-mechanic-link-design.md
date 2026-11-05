# Customer journey after payment and the mechanic live-job link: design (2026-11-06)

Branch `site-journey`, built on the paid-confirmation system (main at 837066e5). Nothing here is applied, deployed or sent. Go-live steps: `docs/GO-LIVE-JOURNEY.md`.

Owner request, in one line: after payment the customer gets a thank-you, tracking, add-to-home-screen, a way to add details and report an issue; the mechanic gets a separate link with his jobs, On the way / Arrived, live location and the quote; after completion the customer rates, sees documents and past bookings, and can book again. Crew and Admin see the same things.

## Ground truth found in the code (differs from the brief in three places)
- **There is no mechanic PIN login.** `/job/` works only from a per-job link (`tech_job_links`, 64-hex token, only the SHA-256 hash stored, 7 days). "Find by PIN" in Crew is a PIN *code* (postal) search. So "My jobs" is built on the same link: the link identifies the mechanic, so `my_jobs` lists that mechanic's other open jobs, and opening one mints a link for that job (only if the job is assigned to him). If the owner wants a real mechanic PIN login, that is a separate piece (see open questions).
- **No customer invoice page, token or download exists.** Invoices are emailed by `send-invoice`; `invoices` rows are readable only by admins. "Your documents" therefore shows the receipt and the invoice as in-page documents built from the same figures (`invoices` row, `confirm_fee`), printable with the browser's Print / Save as PDF. No new token type.
- **No Google review link exists** in the config. A public config key `googleReviewUrl` is added (empty). "Share on Google" shows only for 4 and 5 stars and only if it is set.
- `/rate/` is signed with `RATING_SECRET` (ref + k). The in-page rating uses the private tracking token as proof instead and calls the same function and the same rules.

## Who may do what (permission matrix)
| Actor | Proof | May read | May write |
|---|---|---|---|
| Customer | private tracking token (`booking_secrets.track_token`, 128-bit) | own booking: progress, quote, own added details, own issues (status only), mechanic's live point and ETA while On the way or Arrived, own receipt and invoice, up to 10 earlier bookings of the same customer (see trade-off) | own details until work starts, up to 3 photos, issues, quote decision, one rating |
| Mechanic | job link token (hash) | assigned job: first name, address, extra address note, vehicle details, issue text, photo links (signed, 10 min), quote read-only, his other open jobs (area, slot, vehicle, status) | visit steps, live location only while On the way or Arrived and only on his own job |
| Agent (Crew) | login | per existing rules (`crm_can_see`: own and unassigned leads): added details, issues, last seen; photos only with `assign_leads` or `manage_technicians` | resolve issues on leads he can see |
| Supervisor / Technician lead (Crew) | login | all leads; photos | resolve any issue |
| Admin | login (`is_admin`) | everything above (superset) | everything above |
| Stranger / anon | none | nothing (tables closed; RPCs revoked from anon, the service role calls them) | nothing |

Customer-added photos live in the private bucket `booking-updates` (folder = lead id). Desk read policy: supervisor or admin or `assign_leads` / `manage_technicians`, and `crm_can_see`. The mechanic and customer never get bucket access; the Edge Function mints signed URLs.

## 1. Thank-you after payment
`/book/` success state (and `/track/` right after payment, `?paid=1`): warm short thank-you, booking ID, three lines of what happens next, big "Track your booking" (`/track/?t=`), "Add Mechanix Pro to your home screen", "Add details or report an issue" (goes to the same page, section anchored), WhatsApp and Call. `assets/js/install.js` is extended with an exported API: Chrome and Android use the saved `beforeinstallprompt`; on iPhone Safari it shows "Tap Share, then Add to Home Screen". The link to the booking is kept in `localStorage` key `mxp_last_booking` (token only, no name, no phone) and the home page, `/track/` and the install row show "Your booking" with that link. The manifest `start_url` stays `/?source=pwa` (a manifest cannot hold a per-customer link); instead the home page of an installed app (`display-mode: standalone`) shows "Your booking" first when the key exists.

## 2. Add details and report an issue
New Edge Function `booking-update` (actions `get`, `save`, `photo_url`, `photo_done`, `issue`). Token verified through RPC; rate limit by IP hash (same pattern as `book-start`); CORS like the others; error shape `{ error }`. Fields: landmark, gate/parking note, registration number (optional), kilometres, vehicle note, "what is the issue". Editable until work starts (stage not in repair_doorstep, picked_up, ready, returned, and not completed or closed). Photos: up to 3, JPEG/PNG/WebP, 1.5 MB each (the page compresses to about 150 KB), uploaded to one-time signed URLs, then registered. "Report a problem with my booking" is a separate typed issue (`late`, `mechanic`, `payment`, `safety`, `other`) with 500 characters; at most 5 open per booking. No customer text is written to logs; the booking history gets neutral lines ("Customer added details", "Customer reported an issue: <type>").

## 3. Mechanic link, live location
- `tech-job` gets actions `my_jobs`, `my_job_open`, `location_update`, `location_stop`, `quote_view` (the existing `visit_state` also carries the quote lines, the customer's note and photo links).
- Location: `tech_locations(lead_id, mechanic_id, lat, lng, accuracy_m, heading, recorded_at)`; written only by RPC `tech_location_put(token_hash, ...)` (service role) which checks the link, that it belongs to the lead's mechanic, and that the stage is `on_the_way` or `arrived`; ignores points closer than 10 s apart; keeps at most the last 20 points per job. Purged when the stage leaves on_the_way / arrived (code verified), when the job completes or is closed or reassigned, and by `tech_locations_purge()` (older than 24 h) from `desk-automation`.
- The page starts `watchPosition` only after the mechanic taps "Share my live location" with the consent line; sends a point at most every 15 s, only if moved over 20 m (or 60 s passed); stops on Arrived and verified, Completed, `pagehide`, or Stop.
- Customer: `booking_tech_location(token)` returns only the latest point and its age, only while On the way or Arrived and under 10 minutes old, never a trail. `track-booking` adds `eta` computed on the server: haversine distance, a 1.3 detour factor and an average 18 km/h, shown as "about N min away (estimate)", rounded up to 5 minutes. No exact promise.
- Crew and Admin: `crm_tech_location(lead)` returns the latest point and age; the booking sheet and Dispatch list show "Mechanic last seen X min ago" and an Open in Maps link. One code path: `crm/flow-core.js`, copied unchanged to `admin/flow-core.js`.
- "Mark out" maps to the existing states only: On the way, Arrived, Ready, Delivered / Handed back (`on_the_way`, `arrived`, `ready`, `returned`); Completed stays a Crew/Admin close. No new state.
- Navigate button: `https://www.google.com/maps/dir/?api=1&destination=lat,lng` (or the address text), `travelmode=two_wheeler` for bikes, `driving` for cars. Call customer: the existing `/job/` already exposes the phone; no new exposure.

## 4. Issues across roles
`crm_booking_updates(lead)` (details, photos, issues), `crm_issue_resolve(issue, note)`, `crm_open_issues(limit)` for an Issues list in Crew and Admin with who resolved it and when. The lead sheet shows added details and photos (signed URLs from the desk session for permitted roles). Mechanics see the address note and issue text on `/job/`.

## 5. Rating after completion
`track-booking` returns `can_rate` and the existing rating. `/track/` shows "How did we do?" (1 to 5 stars, comment) for a completed booking; `submit-rating` accepts `{ t, rating, comment }` as well as `{ ref, k, ... }`. One rating per booking (the existing 24-hour edit window is unchanged); 3 or less opens the existing ticket and supervisor email. Google button only for 4 and 5 and only if `googleReviewUrl` is set.

## 6. Documents, past bookings, book again
`track-booking` returns `documents` (fee receipt, final invoice for this booking) and `history` (up to 10 earlier bookings of the same customer: date, vehicle, service, status, invoice number, and a `link` only if a tracking token already exists). No address, phone, mechanic. Privacy trade-off: anyone holding the private link sees that customer's list of earlier bookings and invoice numbers (not amounts, not address). One switch turns the block off: setting `track_show_history` (database `settings`, default `true`); the page also hides the block when the function omits it. "Book again" opens `/book/?vehicle=&brand=&model=` with the vehicle only.

## 7. Notifications (all through `booking_notifications`, claim-once)
- `ontheway_email` (customer): "Your mechanic is on the way. Track live: link". No approved WhatsApp template fits ("Booking confirmed" says the mechanic will come; it does not say on the way), so WhatsApp is **not** sent and a new template `mxp_mechanic_on_the_way` is proposed in the go-live document. The tracking page updates at once anyway.
- Completion and "please rate": the existing `mxp_service_done` and `mxp_desk_rating_link` flow is unchanged.
- `team_issue:N` (team email) for each new customer issue; the lead history also gets a line.

## Decisions and limits
- CSP unchanged: no map tiles, no third-party scripts; text, distance and a Maps link; a CSS progress bar for distance.
- Page weight: new code is in the existing files (`track.js`, `job.js`, `install.js`, `book-pay.js`); one small new stylesheet block appended to `book.css`.
- Not verifiable here: real phone GPS accuracy, real iOS install behaviour, real email and WhatsApp.
