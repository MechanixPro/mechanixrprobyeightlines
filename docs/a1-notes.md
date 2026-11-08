# A1 notes (partner availability selfie, terms, tour)
- Worktree ~/Projects/mx-avail, branch partner-avail, supabase linked.
- Migration 20270119000000_partner_avail.sql: private bucket selfies, partner_selfies, partner_terms, service-role helpers. Dry-run only.
- Server: garage-app and mechanic-app get selfie_upload_url, selfie_record, terms_accept; open_set/status_set refuse Available without a selfie under 24 h.
- Front end: assets/js/garage.js and mechanic.js (shared partner-flow module planned).
- Deploy: garage-app and mechanic-app (not tech-job). No migration applied.
- Tests: tests/partner-avail.test.mjs.
