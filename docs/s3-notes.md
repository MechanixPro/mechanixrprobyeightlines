# S3-1 notes: Playbooks in the Crew desk
- Exists: crm/pages/knowledge.js has tabs "RSA playbooks", "Fitment guide", "SOPs". SOPs and RSA playbooks are database-backed (crm_sops_list) and edited by supervisors.
- Exists: crm/crm.js has a "Send follow-up template" button (desk-template function) for approved WhatsApp templates. Nothing for call scripts or free-text canned replies.
- Exists: crm-rules.js has waUrl(phone, text) and telUrl, which we reuse for Open WhatsApp.
- Add: crm/playbooks.js, a static list of call scripts, SOP checklists and WhatsApp reply texts, plus fill(text, vars).
- Add: crm/pages/playbooks.js, Crew screen "Playbooks" after Follow-ups, tabs Scripts / SOPs / Replies, search, tickable steps (local only), copy and Open WhatsApp.
- Add: tests/playbooks.test.mjs, styles in crm/crm.css, screenshot cases in scripts/ui-shots.mjs.
- Not touched: database, knowledge page, migrations. Content is static and read-only.
