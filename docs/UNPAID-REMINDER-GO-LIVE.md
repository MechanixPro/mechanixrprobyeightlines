# Unpaid booking reminder: go-live (owner steps)

Template `mxp_booking_unpaid` (UTILITY) messages a customer once, 30 minutes to 24 hours after they started a /book/ booking and did not pay the confirmation fee. Nothing sends until the steps below are done.

1. Deploy the functions (desk-automation) after this branch is merged. No migration is needed.
2. Crew, Team page, WhatsApp setup: click **Submit templates**. This submits `mxp_booking_unpaid` with the other pending templates.
3. Wait for Meta approval (the page shows the status).
4. Click **Create campaigns** once approved. The automation also does this by itself within minutes.
5. Until then the step logs "skipped: campaign not ready" about once an hour and sends nothing.
6. Rules: customer ticked WhatsApp updates, not opted out, not paid, status open, no human contact in the last 30 minutes, once per booking, never 21:00 to 09:00 IST (it waits, up to 24 hours from the start).
7. The link in the message is https://mechanixpro.in/book/ (there is no resume link; the customer re-enters their choices).
8. Switch off: settings key `desk_auto_unpaid_reminder` = false (Admin settings, or SQL `upsert into settings (key,value) values ('desk_auto_unpaid_reminder','false')`).
9. Switch on again: set it to true or delete the key (default is on).
10. Check results: the desk automation log, kind `unpaid_reminder`, and a "Unpaid booking reminder sent automatically" line on the lead.
11. The Crew "Not paid yet" tab still lists these leads for a human call.
12. Roll back: set the key to false; no data changes to undo.
