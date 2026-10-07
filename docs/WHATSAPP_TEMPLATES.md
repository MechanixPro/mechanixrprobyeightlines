# WhatsApp templates to submit in Meta (category: Utility, language: English)

Names must match the Supabase secrets (`WA_TPL_*`) or these defaults.

| Name | Body | Variables |
|---|---|---|
| `mxp_booking_received` | Hi {{1}}, we have received your Mechanix Pro booking {{2}} for {{3}}. Reply here to confirm your slot. | 1 first name · 2 ref · 3 service |
| `mxp_followup` | Hi {{1}}, your Mechanix Pro booking {{2}} is still open. Reply YES to confirm your slot or tell us a better time. | 1 first name · 2 ref |
| `mxp_payment_reminder` | Hi {{1}}, pay ₹{{2}} to lock your slot for booking {{3}}: {{4}}. This amount is adjusted in your final bill. | 1 first name · 2 amount · 3 ref · 4 link |
| `mxp_payment_received` | Payment of ₹{{1}} received for booking {{2}}. Your slot is confirmed and we will share your mechanic's details before the visit. | 1 amount · 2 ref |
| `mxp_last_reminder` | Hi {{1}}, should we keep your Mechanix Pro booking {{2}} open? Reply YES to continue or STOP to close it. | 1 first name · 2 ref |

Add a footer to each: "Reply STOP to opt out." Keep them Utility (booking-related). Promotional offers need a separate Marketing template and opt-in.
