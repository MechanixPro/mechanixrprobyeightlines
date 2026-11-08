# J4 notes: automatic garage assignment
- Setting `auto_assign_garage` {enabled:false, max_open_jobs:3, radius_km:15}; settings row seeded by migration 20270114000000 (Admin writes via the existing owner-only settings update).
- New step in desk-automation (after paid confirmation sweep): paid leads with no mechanic, no open garage_assignments row, 2+ minutes old, slot today or later.
- Pick: nearest within radius (haversine), else same pincode, else fewest open jobs then oldest last assignment.
- Assign through service-role-only garage_auto_assign(lead, garage); locks the lead row, skips anything Crew already assigned.
- Garage must be status live/pilot, ops_state active, is_open, under max_open_jobs; garage coordinates use shop_lat/shop_lng else lat/lng.
- Manual crm_garage_assign and mechanic assignment are untouched. No new alert: existing team_unassigned stays.
- Needs deploy: desk-automation. Migration is dry-run only.
