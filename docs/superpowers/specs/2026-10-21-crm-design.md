# Mechanix CRM: design

Approved by the owner in chat on 2026-10-21 ("go"). Defaults chosen by the owner's silence: Mechanix Pro look, built from scratch, 15 minute first-contact limit, target of 3 bookings a day per sales agent, no commission yet.

## Goal
A separate site (`crm.mechanixpro.in`, first at `mechanixpro-crm.pages.dev`) where a hired Sales and Support team works every lead from the website, WhatsApp, Google Ads, Instagram or Meta, and manual entries (phone, walk in). Meta and Google Ads are the only paid sources; there is no JustDial. Sales exist to convert enquiries into bookings, and the system enforces that.

## Roles
| Role | Sees | Does |
|---|---|---|
| sales | leads assigned to them and the unassigned queue | claim, call, message, notes, move the pipeline, close Won or Lost with a reason |
| support | same, plus customers needing help | same actions |
| supervisor | the whole team | assign, reassign, targets, add or disable agents |
| owner | everything, in the existing admin | prices, money, payouts |

Agents never see money, mechanic payouts, prices, invoices or settings. The database enforces it: agents have no table policies at all and work only through `security definer` functions that return a fixed safe set of columns.

## Rules the system enforces
1. A lead cannot be saved without a next step: either a dated follow-up or a closing outcome.
2. Lost needs a reason from a fixed list (price, no answer, wrong area, booked elsewhere, not interested, other with notes).
3. A lead untouched for 15 minutes after it arrives is late (red) and listed for the supervisor.
4. The headline number is bookings: a lead that reaches `payment_sent` is "booking made, advance pending"; `paid`, `scheduled` or `completed` is "booked".
5. A supervisor can take back any lead whose follow-up is overdue.
6. Notes and messages cannot hold Aadhaar, PAN, bank or card numbers; the database rejects them.

## Data
- `crm_users(user_id, name, role, active, daily_target)`
- `crm_activities(id, lead_id, actor, kind, body, outcome, created_at)`
- `leads` gets: `crm_owner`, `crm_next_action_at`, `crm_lost_reason`, `crm_first_contact_at`, `crm_won_at`.
- `leads.source` also allows `instagram` (Meta).
- RPCs: `crm_me`, `crm_queue`, `crm_lead`, `crm_claim`, `crm_assign`, `crm_log`, `crm_add_lead`, `crm_team_stats`, `crm_set_target`, `crm_set_user_active`.
- Edge function `crm-user` creates agent sign-ins (needs the service role). Supervisor or owner only.

## Screens
Sign in, My day, Queue and pipeline, Lead page (call, WhatsApp, notes, history), Supervisor (team results, late leads, assign, targets, agents).

## Connections
Leads already land in `leads` from the website, WhatsApp and ads, so they appear in the queue with no change. The call button dials from the agent's phone. The WhatsApp button opens a prepared chat now; sending through AiSensy waits for approved template names and the new number.

## Out of scope for now
Commission payouts, call recording, a Knowledge Hub, training, meetings.
