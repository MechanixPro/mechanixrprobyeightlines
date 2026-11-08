# P1: Collect payment step (technician link + garage app), online first
Migration 20270117000000_collect_payment.sql (NOT applied, dry-run only): leads.inspect_first(+_at,_by), final_link_id/url/amount, final_paid_at/method/amount. Only Razorpay link ids and amounts are stored.
Pure helper supabase/functions/_shared/collect-payment.ts: amountDue(bill - confirmation fee paid), cashAllowed(arrived AND inspect_first), message text, cleanCash.
Actions in tech-job and garage-app: payment_request (create or reuse open link for same lead and amount, returns url, amount, paid state), payment_cash (server refuses unless arrived AND inspect_first), inspect_first_set (logged to crm_activities).
Cash/UPI uses the EXISTING ledger: customer_payment, collected_by 'mechanic', source 'technician' (same as tech-job report), so mech-dues remit logic and the remittance link apply unchanged.
Online: link notes purpose 'final'; razorpay-webhook gets a branch that records customer_payment (company_portal), sets leads.final_paid_*, and does not re-send the slot-confirmed message.
UI: one 'Pay' step in assets/js/mechanic.js and assets/js/garage.js: huge amount, QR (assets/js/qr.js), WhatsApp/Copy link, polls every 10 s, flips to Paid; cash/UPI hidden behind 'Customer wants to inspect first'.
Crew/Admin: the lead row now carries final_* and inspect_first columns; showing them in the Dispatch card is done only if the card already reads the lead row (see final report).
Deploy: tech-job, garage-app, razorpay-webhook (+ migration, owner-run).
