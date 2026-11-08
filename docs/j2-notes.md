# J2 notes (2026-11-09)
- Garage app now gets the customer address for its own OPEN job only (owner decision 2026-11-09); email never.
- Photo step gets a Take photo (camera) button beside Choose from gallery; previews stay data: URLs.
- Garage open/closed becomes a top-of-Home "Available for jobs" card.
- Mechanics already have availability ('available'/'busy', mechanic_status_set): no new column, no available_set action needed; the mechanic app is relabelled instead.
- Migration 20270113000000 only extends crm_garage_picker / crm_mechanic_picker (adds available key, sorts unavailable last).
- Deploys needed: garage-app, mechanic-app (only if its UI needs nothing server-side: none), plus the migration.
