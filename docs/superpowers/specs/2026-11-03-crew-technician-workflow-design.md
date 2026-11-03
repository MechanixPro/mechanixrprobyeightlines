# Crew: technician workflow (dispositions, PIN search, technician lead, job link and company share)

Date: 3 Nov 2026. Status: draft for owner approval.

## Goal
The Care Buddy team can take an interested lead to a confirmed booking with a technician in a few taps. Mubarak, the technician lead, runs the technician network. Each technician can report the amount collected after the job and pay the company's share by Razorpay without logging in.

## What the owner asked for
1. Under the disposition "Interested", add the sub-dispositions "Technician assigned" and "Booking confirmed".
2. A "move this lead" option.
3. A PIN code search that shows the nearest garage and technicians.
4. Mubarak is the super technician who handles the whole technician network.
5. Share the booking details with the technician on WhatsApp as soon as the booking is done.
6. After the job, the technician gets a link to enter the amount collected and to pay the company's share through a Razorpay link (option A: each technician gets their own link, no login).

## What exists today
- **Dispositions:** "Interested" has the sub-options Will book later, Price high, No mechanic available and Follow-up (`crm_dispositions`).
- **Technician features already in Crew:** a technician on each booking, Edit booking ranking (free in the slot, covers the PIN), "Send job to [name]" on WhatsApp, the Technicians today board, and an alert for unstaffed jobs.
- **Customer message:** when a booking is Scheduled and has a technician, the customer automatically gets `mxp_booking_confirmed` with the technician's name (desk-automation journey).
- **Company-share link:** `mechanic-pay-link` makes a Razorpay link for the company's share, admin panel only. `razorpay-webhook` records a paid link as a `remittance` ledger row.
- **Share rule:** the technician's share comes from `effectiveRate` (booking override, then garage default, then the technician's `payout_rate`, then a 30% default). The company's share is the rest.
- **Data gaps:**
  - Only 1 garage exists, with no map location, and none are live.
  - The 6 technicians have no PIN codes saved. The PIN is only written in the name, for example "MUBARAK-560068".

## Design

### Part 1: dispositions that move the lead (Crew only)
- Add `Interested → Technician assigned` and `Interested → Booking confirmed` to `crm_dispositions`.
- **Choosing "Technician assigned":**
  - The log form shows the technician picker, ranked as in Edit booking.
  - Saving sets the technician and logs the disposition in one step.
  - It's refused if no technician is chosen.
- **Choosing "Booking confirmed":**
  - It needs a date, a slot and a technician. The form asks for any that are missing.
  - Saving moves the booking to **Scheduled**. That triggers what already exists: the confirmation email and the customer's "booking confirmed" WhatsApp with the technician's name.
  - Saving is allowed for the lead's owner and for supervisors. The database checks this.
- **"Move this lead" bar on the lead sheet:** one-tap buttons for **Assign technician**, **Confirm booking**, **Call back later** and **Not interested**. Each opens the log form with the matching disposition already chosen, so every move is still logged with a next step.
- **After either save:** Crew offers **"Send job to [name] on WhatsApp now"**. The message now includes the technician's job link from Part 3.

### Part 2: technician lead and PIN search
- **New Crew permission `manage_technicians`:**
  - It allows setting the technician on any booking without the broader `assign_leads`.
  - It allows editing technicians' PIN codes and shift.
  - It allows seeing the board and the PIN search.
- **New role preset "Technician lead":** pages Mechanics, Garages and Leads, plus My day with the board, with the permission `manage_technicians`.
  - Mubarak gets a Crew login with this preset. The owner adds him on the Team page with his email. The email is needed from the owner.
- **PIN data fill:**
  - A one-time step copies the 6-digit PIN already in each technician's name into their PIN list.
  - From then on, Mubarak keeps each technician's PIN list up to date on the Mechanics page.
- **PIN search:** a "Find by PIN" box on My day and on the Mechanics page. Type a 6-digit PIN to see:
  1. **Technicians who cover that PIN:** for each, today's job count and whether they're free now (from the board).
  2. **Other technicians**, with their area.
  3. **Garages with that PIN**, and live garages in the hub that covers it.
- **Limit:** "nearest" means coverage by PIN, not map distance. There are no map locations for PINs or garages yet. Real distance can be added later when garages have locations, and the result order will stay the same.

### Part 3: technician job link, amount collected and company share
- **New table `tech_job_links`:**
  - Columns: id, lead_id, mechanic_id, token_hash, created_at, expires_at (7 days), opened_at, reported_at, amount_collected, company_share, pay_link_url.
  - Only a SHA-256 hash of the token is stored.
- **Making the link:**
  - Crew calls `crm_tech_link(p_lead)`. It needs `manage_technicians` or `assign_leads`, and the booking must have a technician.
  - It returns `https://mechanixpro.in/job/?t=<token>`. Making a new link expires the old one for that booking.
- **The job page** (`/job/`, a static page under the site's CSP with no inline scripts) calls the edge function `tech-job`:
  - **Get:** shows the booking ref, customer first name and number, bike, service, address, date and slot, and notes without ID numbers. No prices or other bookings are shown.
  - **Report:** the technician enters the amount collected from the customer (₹0 to ₹1,00,000) and an optional note. The server then:
    - works out the company's share with the same rule as the admin (`effectiveRate`, on the amount collected)
    - records a `customer_payment` ledger row with `collected_by = mechanic` and a new source `technician`
    - makes the Razorpay link for the company's share with notes `purpose = remittance`, so the existing webhook records the payment
    - logs a note on the booking and alerts the desk
  - **The technician sees** "Pay ₹X company share", with the Razorpay link. The link is also sent on WhatsApp through the technician's chat with the desk number.
  - **One report per link.** A wrong amount is corrected in the admin with a reversal, as the ledger already works.
  - **If the company's share is ₹0** (nothing collected, or the customer paid online), no Razorpay link is made.
- **Safety:**
  - The token is random (32 bytes), unguessable, tied to one booking, expires and is stored only as a hash.
  - Wrong tokens get the same "link not valid" answer and are rate-limited per IP.
  - Every open and report is written to the audit log.
- **Admin:**
  - The booking's money box shows the technician's report.
  - The existing "owes the company" figure includes it, so the remittance comes off when the Razorpay payment lands.

## Out of scope
- Map-distance search.
- A technician app or login.
- Automatic WhatsApp from the desk number to the technician. That would need a new approved AiSensy template; the Care Buddy's one-tap share is used instead.
- Changing commission rates.

## Testing
- **Unit tests:**
  - share calculation (same results as `effectiveRate` and `mechanicCut` for the same inputs)
  - token hashing and expiry
  - disposition and move rules
  - PIN search ranking
- **Source checks:** the migrations, the CSP-safe job page with no inline script, and the Crew UI strings.
- **Rolled-back test runs on production** for every database function, run as a Care Buddy, a supervisor and a technician lead.
- **One real test after deploy:** make a link for a test booking, report ₹100 and check the ledger row and the Razorpay link. That link is not paid.

## Delivery order
- **Part 1 first:** it unblocks the team today.
- **Then Part 2:** it needs Mubarak's email.
- **Then Part 3:** it needs a site deploy and an edge function deploy.

Each part ships on its own after an "apply and deploy" from the owner.
