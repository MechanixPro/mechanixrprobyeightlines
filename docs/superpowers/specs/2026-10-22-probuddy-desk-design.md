# Mechanix Desk for ProBuddies: design

Status: **draft for approval** (22 Oct 2026). Source: "Sales Dashboard Platform Updates Specification" (a car-rental reference), adapted for Mechanix Pro. Builds on the Mechanix Desk CRM already live (`crm/`, migration `20261108000000_crm.sql`). Related: Master Service Agreement Schedules 2 to 4, `docs/superpowers/specs/2026-10-21-crm-design.md`.

## 1. Goal
One desk where the hired sales team (**ProBuddies**) and support staff handle every lead from Google Ads, Meta, the website and WhatsApp; onboard and inspect partner garages; send payment links on WhatsApp; call from the calling tool; raise tickets; collect ratings; and where management sees targets, attribution and client reports. What each person sees is controlled by permissions the Super Admin sets when creating the login.

## 2. Vocabulary (reference to Mechanix Pro)
| Reference | Mechanix Pro |
|---|---|
| Fleet, car owner | **Garage**, garage partner |
| Car inspection | **Garage visit** (onboarding visit, inspection) |
| Car pricing list | **Service price list** (admin Prices tab is the source of truth) |
| Sales agent and support agent | **ProBuddy** (both sales and support staff; confirmed by the owner 22 Oct) |
| Super Admin | Supervisor and Owner |
| RSA | Roadside assistance |

## 3. Pages
Navigation, in order: **Dashboard, Inbox, Leads, RSA Cases, Tickets, Garage Visits, Garages, Mechanics, Knowledge** (SOPs live inside Knowledge) (plus Team for supervisors). Each page shows only if the login has its permission.

### 3.1 Dashboard (was Today)
- **Chats card:** total chats and unreplied chats together, with numbers. Click opens the unreplied list in Inbox.
- **Leads card:** total, won, lost with count and percentage. Click opens lost leads.
- **ProBuddy performance card:** per person, assigned, won, lost with count and percentage. Click on a person opens that person's lost leads.
- **Unassigned counter:** number of unassigned leads. Click opens the list.
- **Targets:** team and individual, daily and monthly, set against achieved, count and percentage. Super Admin edits all targets here.
- **User provisioning:** create a login with a checkbox for every page, feature and action (section 6).
- **Platform attribution:** leads by platform (Google Ads, Meta, website, WhatsApp, phone, walk-in), count and share, with the same filter dates.
- **Price list shortcut:** open, edit and add a service on the live price list (writes the same rows as the admin Prices tab).

### 3.2 Inbox
WhatsApp conversations, newest first. Filters: Open, Closed, Unanswered, All, By ProBuddy. Close with a disposition. **Assignment rules:** a supervisor can assign any chat; if nobody is assigned and someone replies, the replier becomes the owner; a ProBuddy can take an unassigned chat for themselves; a ProBuddy cannot reassign or give unassigned chats to others. Requires AiSensy (phase 2).

### 3.3 Leads
Mandatory columns, in this order: **Lead, Mobile number, Source, Stage, Owner, Disposition, Sub-disposition, Follow-up, Created date, Last activity date.** In-row owner dropdown for supervisors (ProBuddies see "Take"). Unassigned queue filter. **No automatic assignment anywhere**: a ProBuddy who only writes a note does not become owner. Multi-select works across every filter; authorised deletion moves the lead to Deleted (restorable). One summary card: All, Converted, Won, Follow-ups, Lost, each with count and percentage. Manual lead creation form. The existing rules stay: next step required, Lost needs a reason, 15-minute first contact, no ID or card numbers in notes.

### 3.4 Tickets
Categories: Escalation, Booking issue, Roadside assistance, Legal or accident, Garage partner issue (payout difference, dashboard visibility, quality complaint), Garage inspection (creates a Garage visit). Fields: category, linked lead or garage, priority, owner, status (Open, In progress, Waiting, Resolved), notes thread. Legal or accident tickets are supervisor-only and alert the owner.

### 3.5 Garage Visits (replaces People)
Directory of scheduled onboarding visits and inspections. Edit time, place and details. Allocate an inspector (a field executive login). Visit result feeds the garage scorecard (Master Service Agreement, Schedule 2, and the coverage plan's 100-point scorecard).

### 3.6 Garages (replaces Fleet)
- **Onboarding pipeline:** Applied, Visited, KYC done, Trained, Pilot, Live, Paused. Mandatory fields exactly as Schedule 2: name and trade id, owner mobile, full address with PIN, GPS, service categories, working hours and bays, payout details. Bank details are stored in a restricted table and shown masked.
- **Import:** CSV or Excel upload in the Schedule 2 format with row-by-row error report.
- **Coverage:** each garage sits in one of the 24 hubs of the coverage plan and a PIN code; hub map and counts.
- **Availability:** open now, on leave until, closed days, bay capacity, jobs today, "paused by owner until".
- **Service and quality:** rating, rework count, tier (Bronze, Silver, Gold).
- **Price list:** model-wise and tier-wise service tariff table; add and edit.

### 3.7 SOPs (replaces Workdesk)
Searchable pages for scripts, onboarding steps, escalation rules, WhatsApp templates and data-protection rules. Supervisors edit; ProBuddies read.

### 3.8 RSA Cases (roadside assistance, track every case)
A case is created from a call, a WhatsApp location share, a lead or a ticket. Fields: customer, mobile, bike (brand, model, fuel or electric), live location (pin and address), problem type, safety check (rider safe, on a busy road, injured), priority, ETA given, assigned mechanic or garage, status and outcome.
- **Statuses, in order:** New, Triage, Phone guidance, Dispatched, On site, Fixed on site, Towed or moved to garage, Closed (with outcome and reason), Escalated.
- **Timeline:** every call, message, status change, dispatch and note is stamped with time and person, so the whole case can be replayed.
- **SLA timers:** first response, dispatch and arrival times shown against targets (targets are set by management; the system never promises an arrival time to the customer unless one is entered).
- **Safety rules built in:** an injury or accident flag creates a supervisor-only Legal or accident ticket at once and shows the emergency steps first; an unsafe location shows "move to a safe place first".
- **Outcome and billing:** fix details, parts used, amount, payment link, rating request when closed.
- **Reports:** cases by type, response and arrival times, fixed on site versus towed, repeat breakdowns by bike model.

### 3.9 Knowledge (RSA playbooks, fitments and solutions)
The ProBuddy and Support team can guide a customer over the call from searchable playbooks. Each playbook has a symptom, a safety note, step-by-step phone guidance in plain words, what to ask first, when to stop and dispatch, parts and fitment notes, and the expected cost range from the price list.
- **Topics:** puncture and tubeless repair, flat battery and jump-start (and why not for electric bikes), chain and sprocket, clutch and cable, brake issues (stop riding), engine overheating, fuel and spark problems, starter and electrics, electric scooters (do not open the battery; tow), towing and transport, accident steps.
- **Fitment guide:** brand and model, part, specification, compatible alternatives, OEM notes, source and last-checked date. Starts with the models already in the site catalogue (171 model pages).
- **Controls:** every playbook carries an owner, a version and a review date. Safety-critical pages are marked "reviewed by" a named technical head before they show to agents. Supervisors edit; agents read and can flag "this did not work" so the page is reviewed.
- **Seed content:** drafted from standard practice and clearly marked as a draft until the Mechanix Pro technical head approves it; no repair step is shown to agents as final before that review.

### 3.10 Mechanics (individual onboarding)
Alongside garage onboarding: a pipeline for individual mechanics (Applied, Visited, KYC done, Trained, Pilot, Live, Paused) with skills (two-wheeler, scooter, Royal Enfield, electric, tyre, battery), tools checklist, service area and PIN codes, availability and shift, languages, documents in a restricted store, training record, rating and rework count, and the commission rate used by the finance ledger. A mechanic can belong to a garage or work independently. The existing admin mechanics list becomes the same records.

## 4. Revenue actions (phase 2)
- **First payment link on WhatsApp:** from a lead, "Send payment link" creates the slot-fee order (existing `create-order` and `payment-link` logic: new customer slot fee or returning fee from the price list) and sends it through AiSensy. Logged in the lead timeline and the ledger on payment.
- **Coupons:** create and pause coupons from the Desk (same table as the admin Coupons tab). Permission-gated, with a ceiling a supervisor sets.
- **Ratings:** when a job is marked completed, a WhatsApp rating request goes out (1 to 5). The answer is stored; below 3 opens a ticket and alerts the supervisor; 4 and 5 can prompt a Google review link.
- **Client reports:** scheduled report to the owner and the client by WhatsApp or email: leads, bookings, completions, by source and by ProBuddy, targets, ratings, tickets. PDF attached.

## 5. Calling (phase 3)
Click-to-call from lead, chat and ticket through the chosen calling tool ("Agentive": to be confirmed). Calls are logged on the lead (who, when, length, recording link). Needs the tool's API documentation and a key entered by the owner in the backend secret store.

## 6. Permissions (role-based access)
`crm_users.permissions` is a JSON set. **Pages:** dashboard, inbox, leads, tickets, garage_visits, garages, sops, team. **Features and actions** (each its own checkbox), for example: view_all_leads, assign_leads, take_leads, delete_leads, add_leads, edit_targets, manage_users, send_payment_link, create_coupons, edit_price_list, view_reports, export, close_chats, create_tickets, resolve_tickets, view_garage_bank, schedule_visits. Everyone on the sales and support team is a **ProBuddy**. The login has a designation (Sales or Support) that only picks the starting permission preset; supervisors and the owner keep their own preset. The screens, emails and reports always say "ProBuddy". The database roles `sales`, `support` and `supervisor` stay as they are so nothing built so far breaks. The preset fills the boxes; the Super Admin can change any box per person. The **database enforces** every action (a `crm_can(action)` check inside each function); the screen only hides what a person cannot use. The interface of a ProBuddy shows only the pages, columns and cards the profile allows. Money, payouts and prices stay hidden unless the permission is on.

## 7. Data model (new)
| Object | Purpose |
|---|---|
| `crm_users.permissions`, `monthly_target`, `designation` | permissions and targets per person |
| `crm_targets` (team daily, team monthly) or settings keys | team targets |
| `leads.disposition`, `leads.sub_disposition` and `crm_dispositions` | dispositions and sub-dispositions (lookup, editable) |
| `crm_chats` (per phone: owner, status, disposition, last inbound and outbound times) | Inbox state; messages stay in `messages` |
| `crm_tickets`, `crm_ticket_notes` | Tickets |
| `garages`, `garage_documents`, `garage_bank` (restricted), `garage_visits` | Garages and visits |
| `crm_sops` (SOPs and knowledge) , `crm_playbooks`, `crm_playbook_flags`, `fitments` | SOPs, RSA playbooks, fitment guide |
| `rsa_cases`, `rsa_case_events` | RSA cases and their timeline |
| `mechanic_onboarding`, `mechanic_documents` (restricted), `mechanic_skills` | individual mechanic onboarding |
| `ratings` | rating requests and answers |
| `crm_report_schedules` | client reports |
| `crm_calls` | call log (phase 3) |

All new tables use row-level security with no agent policies; access is only through `security definer` functions that check `crm_can`.

## 8. Relationship to the existing admin
The admin stays the owner's money console (prices, invoices, ledger, payouts). The Desk reads and writes prices and coupons only through the same rows, with permission. Existing mechanics remain individuals in the admin; **garages** are workshop partners and may employ one or more of them (link table `garage_mechanics`).

## 8A. Booking sync with the admin (single source of truth)
A booking made or changed in the Desk **is** the same row the admin uses (`leads`, with its customer, bike, invoices and ledger). There is no copy and no sync job, so the two can never disagree.
- **Requirements captured on every booking** (the Desk form uses the same fields as the admin Add booking form): customer name and mobile, bike brand and model, service package, add-ons, area and PIN code, address or pinned location, preferred date and time slot, customer requirements and notes (what is wrong, special requests), estimated quote, coupon, source and campaign (Ref code), job place (doorstep or garage), assigned mechanic or garage, and the ProBuddy who owns it.
- **Same rules in both places:** quote first, slot fee by new or returning customer, PIN must be inside the service area, duplicate mobile in the last 30 days opens the existing booking.
- **Stage mapping:** Desk stages and admin statuses are the same values (New, Contacted, Quoted, Payment sent, Paid, Scheduled, Completed, Lost). ProBuddies move a booking up to Payment sent; Paid, Scheduled and Completed are set by the payment webhook or by the admin, as today.
- **Who can change what:** a ProBuddy edits requirements, notes and follow-ups on their own bookings. Prices, invoices, ledger, payouts and commission stay admin-only. Every edit writes who, when, what changed and the old value to the activity history (visible in both the Desk and the admin).
- **Live view:** both consoles read the same table, refresh on a short interval, and the admin shows "Created by" and the owning ProBuddy; the Desk shows the admin's mechanic assignment and invoice status read-only.
- **Conflict rule:** the database stamps `updated_at`; a save made on a stale copy is refused with "this booking changed, reload" instead of overwriting.
- **Deleted bookings** follow the existing admin archive rule (bookings with invoices or payments are archived, never erased).

## 9. Phasing and dependencies
| Phase | Scope | Needs |
|---|---|---|
| 1 | Navigation, permissions, Dashboard, Leads, Tickets, SOPs and Knowledge, RSA Cases, Garage Visits, Garages and Mechanics onboarding with import, targets, attribution | nothing external (RSA playbook content needs technical-head review) |
| 2 | Inbox, payment link on WhatsApp, ratings, coupons screen, client reports | AiSensy number and approved templates (expected 23 Oct) |
| 3 | Calling tool | tool name, API documentation, key |

## 10. Out of scope
Car-specific fleet items from the reference (trip tracking, owner personal use) are replaced by garage availability and leave. Commission payouts to ProBuddies. Native mobile app.

## 11. Acceptance
Every bullet of the reference is traced in the plan's traceability table, and each has a test or a documented manual check. Phase 1 ships when: all tests pass; a ProBuddy login with a limited permission set sees only the allowed pages and columns; a database call by that login to a blocked action is refused; the Leads table has the ten columns in order; assignment is manual only; and a garage can be imported, onboarded and scheduled for a visit.
