# AiSensy number for the Care Buddy desk

The desk has its own WhatsApp number on AiSensy: **+91 80423 03061** (918042303061), active on AiSensy since 2026-10-22. It is **different** from the number the website, ads and AI replies use (that one stays on Meta's Cloud API, so nothing there changes).

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

## Inbound without webhook access: flow step (built)
Function `aisensy-inbound` saves each customer message on their lead (shown in the lead sheet's WhatsApp chat). It never replies. STOP-type words opt the customer out.
In AiSensy: create a flow that runs on every incoming message and add an **API / Webhook** step with: method POST, URL `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/aisensy-inbound`, header `x-aisensy-secret` (value in the secret `AISENSY_WEBHOOK_SECRET`), JSON body with the contact's number, name and last message, for example `{"phone":"{{phone}}","name":"{{name}}","message":"{{last_message}}"}` using the variable names AiSensy offers. Field names `waNumber`, `userName` and `userMessage` are also accepted.

## Project API (from AiSensy's docs)
Auth header `X-AiSensy-Project-API-Pwd: <password>`; the first value sent becomes the project password. Other headers exist for app and partner access. The endpoint list (send message, conversations, webhooks) still needs to be read.

## Inbound by webhook: waiting on AiSensy
Needed for the desk Inbox. Ask AiSensy whether incoming messages and delivery status can be forwarded to a webhook URL we control, and on which plan. Bot-flow bookings already work through `aisensy-lead` (secret `AISENSY_WEBHOOK_SECRET`, header `x-aisensy-secret`).

## Project API facts (read from AiSensy's docs, 2026-10-22)
- Base `https://apis.aisensy.com/project-apis/v1/`, header `X-AiSensy-Project-API-Pwd` (the Custom App password; we store it as `AISENSY_PROJECT_KEY`).
- Send a session (free text, within 24 hours of the customer's last message): `POST /project/{project_id}/messages` with `{to, type:"text", recipient_type:"individual", text:{body}}`. Needs the secret `AISENSY_PROJECT_ID`.
- Native webhooks come from a **Custom App** created in the AiSensy dashboard (key, password and shared secret; up to 5 subscriptions). Topic `message.sender.user` is a customer message. Signature header `X-AiSensy-Signature` = HMAC SHA-256 of the body with the shared secret.

## Functions
| Function | Purpose | Secrets |
|---|---|---|
| `desk-payment-link` | first payment link, sent with a template campaign | `AISENSY_API_KEY`, `AISENSY_CAMPAIGN_PAYMENT` |
| `desk-reply` | a Care Buddy's free-text reply (24-hour window) | `AISENSY_PROJECT_ID`, `AISENSY_PROJECT_KEY` |
| `aisensy-inbound` | customer messages from an AiSensy flow API step | `AISENSY_WEBHOOK_SECRET` |
| `aisensy-webhook` | customer messages from a native Custom App webhook | `AISENSY_SHARED_SECRET` |
