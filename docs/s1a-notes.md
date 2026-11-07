# S1a: Lead speed and follow-up queue (plan)

No new migration needed: everything is computable client-side from existing lead fields.

- First contact: `leads.crm_first_contact_at` (set by `crm_log` on first call/whatsapp/etc). Arrival: `created_at`. Owner: `crm_owner`.
- Next follow-up: `leads.crm_next_action_at`. Lost reason: `crm_lost_reason`. Value: `est_total` (money, hidden from supervisors).
- Crew feed: `crm_queue('mine')` (open leads, includes the fields above). Supervisors: `crm_queue('all')`. Admin has `S.leads` (select *).
- Writes: `crm_log(p_id, p_kind, p_body, p_next_action, p_status, p_lost_reason)` for snooze and mark lost.

Steps
1. Pure functions `crm/speed.js` (copied to admin/ by sync_shared) + `tests/speed.test.mjs`.
2. Crew Follow-ups view `crm/pages/followups.js`, nav entry in `crm/crm.js`.
3. Admin speed panel on Sales page.
4. Build scripts, screenshots at 390 and 1280.

Targets (S1b) not built.
