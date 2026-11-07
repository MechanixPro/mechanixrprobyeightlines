# S2a notes
- Scope: Duplicates panel only (Crew crm/pages/dupes.js, Admin admin/dupes-panel.js). No bulk tools, no import.
- Logic in crm/dupes.js (shared to admin), tests in tests/dupes.test.mjs.
- Uses existing RPCs from 20270104000000_duplicate_merge.sql; no new migrations.
- Money visible to admins only; merges always need explicit confirm; Undo via unmerge.
