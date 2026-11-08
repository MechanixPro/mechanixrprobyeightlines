# J1 notes: assign a booking to a garage (what already exists, 2026-11-09)
- Garage assignment already exists: table garage_assignments (20270101000000_garage_app.sql), one open row per lead, status sent/received/in_work/ready/returned/cancelled, received_at = garage opened it.
- RPC crm_garage_assign(p_lead, p_garage, p_note, p_eta) does the permission check (garage_staff_need), cancels a not-started job at another garage, writes a crm_activities row.
- crm_garage_picker() already exists (20261114000000_desk_pickers.sql), used by 4 pages; it returns id, name, code, pincode, status. Do not redefine it.
- Garage app (supabase/functions/garage-app) actions jobs and dashboard already read garage_assignments by garage_id; the garage opening a job sets received_at.
- UI: crm/garage-desk.js assignDialog, reached from the booking card (flow action garageAssign). Dispatch (crm/flow-core.js dispatchHtml) only has the mechanic button and does not show the garage.
- Missing: Dispatch list has no garage columns, no Assign to garage button, no not-seen chip.
- Decision: no new leads.garage_id (would be a second source of truth). Extend crm_dispatch_list from garage_assignments, add the Dispatch button and chip.
