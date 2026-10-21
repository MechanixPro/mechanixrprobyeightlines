# Mechanix Desk for ProBuddies: Phase 1 implementation plan

Spec: `docs/superpowers/specs/2026-10-22-probuddy-desk-design.md`. Method: test first, small commits, deploy after Task 12. Stack unchanged (plain JS, Supabase, Cloudflare Pages).

## Traceability (reference to task)
| Reference item | Task |
|---|---|
| Dashboard: chats card, leads card, performance card, unassigned counter | 4 |
| Team and individual daily and monthly targets, admin edit | 3, 4 |
| User provisioning with checkboxes | 2, 4 |
| Platform attribution | 4 |
| Price list edit and add | 4 (uses Prices rows) |
| Leads: in-row assignment, unassigned queue, no auto-assignment | 5 |
| Leads: delete, multi-select, summary card, manual create, 10 columns | 5 |
| Inbox | Phase 2 |
| SOPs | 7 |
| Tickets and categories, inspection ticket | 6 |
| Garage Visits (inspection schedule, edit, allocate inspector) | 8 |
| Garages (availability, pricing table, onboarding, import) | 8, 9 |
| RBAC: agent sees only what is authorised | 2 (database), 1 (screens) |
| RSA: assist over the call, fitments and solutions | 11 |
| RSA: track every case properly | 10 |
| Onboard mechanics and garages | 8, 9, 12 |

## Tasks
1. **Shell and navigation.** Split `crm/crm.js` into `crm/app.js` (shell, router, permission-aware nav) and `crm/pages/*.js` (one file per page). Pure helpers stay in `crm/*-rules.js`. Test: nav shows only permitted pages. Files: `crm/app.js`, `crm/pages/`, `crm/nav.js`, `tests/crm-nav.test.mjs`.
2. **Permissions in the database.** Display label "ProBuddy" for sales and support everywhere (screens, welcome email, reports); keep the `sales`, `support` and `supervisor` role values; designation Sales or Support selects the preset. Migration `20261110000000_desk_permissions.sql`: `crm_users.permissions jsonb`, presets, `crm_can(text)`, retrofit `crm_*` functions to call it, `crm_set_permissions`. Tests (SQL transaction, rolled back): each preset, a blocked call is refused, an unticked box stops the action. Update `crm-user` function to accept a permission set.
3. **Targets.** Same migration or `...0001`: `monthly_target`, team targets in settings, `crm_targets_get`, `crm_targets_set`, achieved counts by day and month. Test: percentages, month boundary in IST.
4. **Dashboard.** `crm_dashboard()` returns the cards (chats card returns zeros until Phase 2), attribution by platform, targets, unassigned count. Page `crm/pages/dashboard.js` with click-throughs as saved filters. Provisioning panel with a checkbox grid. Price list shortcut. Tests: totals, percentages with zero denominators, each click-through filter.
5. **Leads.** Migration: `disposition`, `sub_disposition`, `crm_dispositions` lookup, `crm_delete_leads(ids)`, `crm_assign` for in-row owner, remove automatic ownership in `crm_log`. Page with the ten columns in order, summary card, multi-select, manual create. Tests: no auto-owner on note or contact, ProBuddy cannot assign to others, delete is restorable and permission-gated.
6. **Tickets.** Tables `crm_tickets`, `crm_ticket_notes`; functions create, list, update, note; categories enforced; legal or accident supervisor-only; inspection category creates a visit stub. Page and tests.
7. **SOPs.** `crm_sops`, functions, page with search; seed with the BRD rules, data-protection rule and a ProBuddy first-contact script. Supervisor edit only.
8. **Garages and Garage Visits.** Tables `garages`, `garage_documents`, `garage_bank` (restricted), `garage_visits`, `garage_mechanics`; Schedule 2 validation (`garage-rules.js`: mobile, PIN against `src/pincodes.json`, GPS range, categories, hours); hub assignment from PIN and direction; status pipeline; scorecard; availability fields; visits calendar list with edit and inspector allocation. Tests for validation, pipeline order, bank field masking.
9. **Import.** CSV and Excel (CSV first) in the Schedule 2 format: dry run with a per-row error report, then commit; duplicates by mobile or trade id. Tests with good, bad and duplicate rows.
10. **RSA Cases.** Tables `rsa_cases`, `rsa_case_events`; functions create, list, update status, add note, dispatch, close; status order enforced; accident or injury flag creates a supervisor-only ticket (Task 6); SLA timers computed from event times; timeline view; reports query. Page `crm/pages/rsa.js` and `crm/rsa-rules.js`. Tests: status order, safety flag, timers, permission gates.
11. **Knowledge and fitments.** `crm_playbooks` (symptom, safety note, steps, ask-first, stop-and-dispatch, parts, cost range from the price list, owner, version, review date, reviewed_by), `crm_playbook_flags`, `fitments` (brand, model, part, spec, alternatives, source, last_checked). Search by symptom, bike or part. Draft seed content for the topics in the design; a playbook with a safety note cannot be shown to agents until `reviewed_by` is set. Tests: search, review gate, flagging. The technical head reviews the seed content before release.
12. **Mechanics onboarding.** Tables `mechanic_onboarding`, `mechanic_skills`, `mechanic_documents` (restricted); pipeline, skills and tools checklist, PIN areas, shift, training record, link to garage and to the finance ledger rate; import of the existing mechanics; page `crm/pages/mechanics.js`. Tests: pipeline order, skill filters, document masking.
13. **Verify and ship.** Full `npm test`; rolled-back SQL test as before; mock-backend screenshot pass on phone and desktop; apply migrations; deploy `dist-crm`; update `docs/PROJECT-MEMORY.md` and the Master Service Agreement Schedule 5.

## Risks
- Retrofitting `crm_can` across existing functions must not lock out the owner; owners always pass.
- Excel import adds a library; start with CSV, add Excel only if the client sends .xlsx.
- Bank details are sensitive: separate table, masked reads, supervisor or owner only, never in notes or exports.

## Phase 2 and 3 tasks (outline)
Inbox over `messages` with `crm_chats`; AiSensy send for payment link, rating and reports; `ratings` table and ticket rule; coupons screen; `crm_report_schedules` with a daily function; calling tool adapter with `crm_calls`.
