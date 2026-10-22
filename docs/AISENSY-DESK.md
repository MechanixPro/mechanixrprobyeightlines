# AiSensy number for the Care Buddy desk

The desk has its own WhatsApp number on AiSensy. It is **different** from the number the website, ads and AI replies use (that one stays on Meta's Cloud API, so nothing there changes).

## Outbound (desk to customer): built, waiting for the key
- Edge function `desk-payment-link` creates the Razorpay link and sends it through AiSensy's Campaign API.
- It sends only when the secret `AISENSY_API_KEY` is set. Without it the desk still creates the link and shows a copy button and a wa.me link.
- The database decides who may send (`crm_payment_context`): needs the `send_payment_link` permission and owning the lead (supervisors can do any lead). Agents can send at most the slot fee or the quote, whichever is higher.

### Set up on AiSensy
1. Dashboard, Developer, **API Campaign key**: copy the key. If the menu is missing, ask AiSensy chat to enable API access and say which plan is needed.
2. Create a utility template and an API Campaign set to **Live** for each row below (the campaign name must match exactly, or set the matching secret).
3. Enter the key in your own terminal (never in chat): `npx supabase secrets set AISENSY_API_KEY=<key>`
4. Set campaign names only if you used different ones: `AISENSY_CAMPAIGN_PAYMENT`.

| Use | Default campaign name | Template text (params in order) |
|---|---|---|
| First payment link | `mxp_desk_payment_link` | Hi {{1}}, here is your secure link to pay Rs {{2}} for Mechanix Pro booking {{3}}: {{4}}. Reply here if you need any help. |
| Rating request (next) | `mxp_desk_rating` | Hi {{1}}, thanks for choosing Mechanix Pro for booking {{2}}. How was the service? Reply 1 to 5 (5 is best). |
| Follow-up (next) | `mxp_desk_followup` | Hi {{1}}, this is {{2}} from Mechanix Pro about your bike service enquiry. When would you like us to come? |

## Inbound (customer to desk): waiting on AiSensy
Needed for the desk Inbox. Ask AiSensy whether incoming messages and delivery status can be forwarded to a webhook URL we control, and on which plan. Bot-flow bookings already work through `aisensy-lead` (secret `AISENSY_WEBHOOK_SECRET`, header `x-aisensy-secret`).
