# M1a: mechanic app gets the garage partner experience
Migration 20270120000000_mechanic_offer.sql (additive; dry-run in begin..rollback passed): leads.mechanic_assigned_at, leads.mechanic_accepted_at, a trigger that stamps assignment and clears acceptance on (re)assign, RPCs mechanic_offer_accept and mechanic_offer_decline.
Actions added to mechanic-app: offers (assigned open jobs with assigned_at and accepted_at), accept (own job only, idempotent, activity 'Mechanic accepted'), decline (activity 'Mechanic cannot take this job' plus audit row; never unassigns).
The existing 'jobs' action is a per-day list with no accepted state, so it is unchanged; 'offers' is the new list the 15 s poll uses.
After Accept the app mints the job link with the existing job_link action and opens /job/?t=...
UI reuses assets/css/garage.css (already loaded by mechanic/index.html); mechanic.js gets splash, offer page (red pulsing border, ring, Web Audio alarm and vibrate until Accept), Home next-job card and 'Today: N jobs'.
mechanic/index.html is hand-maintained (build_pages.py does not generate it).
Deploy: function mechanic-app (and apply the migration first). Not deployed.
Gap: Can't take it does not release the job; Crew sees the note and reassigns.
Gap: no sound or vibration heard on a real phone.
