# J3: garage confirms the customer code and runs the job in one-button steps
Code check reuses tech-job visit_start exactly: handovers row kind 'start', salted SHA-256 (handoverHash/sameHash), try counted before compare, 5 tries then locked, 24h expiry, audit_log + crm_activities.
Flag = handovers.verified_at (kind 'start'). The mechanic flow and the garage share it; a code verified by either counts.
garage_progress_set (migration 20270115000000) refuses work_started until that flag is set, for paid-confirmation leads (confirm_fee set or a 'start' code exists). Old leads with no code are not blocked.
Step -> existing event (no new events): New/Accept = received; Customer here = photo uploaded, held for the next event; Enter code = action verify_code (no event);
Start work = work_started (carries the Customer here photo); Send estimate = estimate_save/submit (shown when the quote blocks Start work); Ready = ready (needs a photo); Handed over = shown after ready, the team marks it (no garage event exists).
Gap: no garage decline/release RPC exists, so Can't take it opens Call/WhatsApp the team (team_contact) instead of releasing the job.
Gap: 'received' is logged as 'received the vehicle' in Crew notes; Accept uses it because it is the only accept event.

## Rework (owner rules): one step per screen, partner-app look
Pages: offer (Accept=received) > navigate (local: I have arrived) > phone (local: Vehicle found) > code (verify_code) > inspect (Start work=work_started, or Send estimate page) > ready (photo + ready) > done. Local steps keep their choice in memory per job; Back views never skip ahead.
Offer page rings (Web Audio tone + vibrate) until Accept; jobs action polled every 15 s opens the offer for a newly assigned unseen job. Splash once per session (CSS/SVG, skipped for reduced motion).
Gaps: the estimate form page scrolls; Home has no earnings, rating or selfie (the dashboard does not return them); the offer has no slot (only return-by); no sound or vibration was heard on a real phone.
