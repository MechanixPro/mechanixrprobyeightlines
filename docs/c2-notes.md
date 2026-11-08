# C2 notes: unpaid booking reminder
- Pattern copied from mechanic alert (step 9): ready-map guard, crm_alerts_sent once-per-lead, hourly 'skipped' log, settings switch.
- New step 10 in desk-automation; pure rules in _shared/unpaid-reminder.ts; template mxp_booking_unpaid in desk-templates.ts.
- book-start saves these leads with status payment_sent (not new/contacted), so payment_sent is included as open.
- No resume link exists; link is plain https://mechanixpro.in/book/.
- Sent with sendCampaign, same as the journey messages (there is no sendSmart in desk-automation).
- Quiet hours 21 to 09 IST wait; eligibility ends 24h after start.
- Tests: tests/unpaid-reminder.test.mjs. Docs: docs/UNPAID-REMINDER-GO-LIVE.md.
- Nothing pushed, deployed or migrated.
