# Mechanic job alert: go-live (owner steps)

Nothing is sent until you finish steps 1 to 5. Until then the automation skips this step silently.

1. Deploy `desk-automation` (and the shared files) from this branch. No database migration is needed.
2. Open the Crew app, Team page, WhatsApp setup.
3. Press **Submit templates** (needs a supervisor sign-in). This now includes `mxp_job_assigned`.
4. Wait for AiSensy/Meta approval (usually minutes to a day, UTILITY category).
5. Press **Create campaigns**. The automation also does this by itself within minutes of approval.
6. From then on, when a booking is Scheduled with a mechanic and today-or-later slot, that mechanic gets a WhatsApp with the job link. Once per (booking, mechanic): reassigning alerts the new mechanic only.

Rules: mechanic must have a phone on the Team page; 9 PM to 9 AM no alerts, except jobs starting within 2 hours. The link is the same 7-day /job/ link as the Crew button (a new one expires the old).

Switch off: set `desk_auto_mechanic_alert` to `false` in the `settings` table (value `false`). Switch on again: `true`.
Check: `crm_automation_log`, job `mechanic_alert`; the lead timeline shows "Job alert sent to <name>".
Note: the job is marked alerted even if AiSensy fails (no retry loop); resend from the Crew "Tell mechanic" button.
