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

## Templates and campaigns (set up through the Project API, 2026-10-22)
Submitted for approval on the desk number: `mxp_desk_payment_link` and `mxp_desk_rating` (Utility), `mxp_desk_followup` (Marketing). They start as PENDING; AiSensy rejects a campaign for a template that is not approved yet.
In the desk, Team, WhatsApp section (supervisors): **Template status** shows approval, then **Create campaigns** creates the API campaign for each approved template. Template text lives in `supabase/functions/_shared/desk-templates.ts` (sample text uses [Label] brackets, which is what AiSensy accepts).
Project id: `AISENSY_PROJECT_ID` (secret). Native webhooks still need a Custom App created in the AiSensy dashboard; the flow endpoint `aisensy-inbound` covers incoming messages until then.

## The incoming-message flow (built in AiSensy 2026-10-22)
Plan facts: no native webhook slots (they are a paid add-on), 1 flow in the quota, API Request actions available.
Flow **Desk** (Flows, Flow Builder): trigger = regex `.+` (any text), then an **API Request** step: POST to `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/aisensy-inbound`, header `x-aisensy-secret` (value = secret `AISENSY_WEBHOOK_SECRET`), body `{"phone":"$mobilenumber","name":"$name"}`. AiSensy's attribute list has no variable for the customer's message text, so the desk shows "New WhatsApp message. Open the AiSensy chat to read it." and the Care Buddy reads the words in AiSensy Live Chat (or asks the customer in the desk chat).
The flow sends no reply. Keep it Active. If a second flow is ever needed it needs a purchased flow slot.

## How the desk works without webhooks or flows (chosen 2026-10-22)
The plan has no webhook slots and its single flow runs only for test numbers, so the desk uses what is included:
- **Outbound:** payment link (`desk-payment-link`), follow-up and rating templates (`desk-template`), and free-text replies inside the 24-hour window (`desk-reply`).
- **Knowing when a customer wrote:** `desk-chat-sync` reads the customer's AiSensy contact record (Project API) and stores `last_active` on the lead. That opens or closes the reply window. The lead sheet's chat has **Check for a reply** and refreshes about every 20 seconds.
- **Reading what they wrote:** only in AiSensy Live Chat (the lead sheet has an **Open AiSensy chat** button). The API gives no message text.
- **New enquiries from the desk number:** appear in AiSensy Live Chat first; a Care Buddy adds the lead with **+ Lead** or **+ Booking**.
- The `aisensy-inbound` and `aisensy-webhook` functions stay deployed and idle. If AiSensy webhooks are ever bought, set `AISENSY_SHARED_SECRET` and create the Custom App webhook (topic `message.sender.user`) and incoming messages fill the lead chat automatically.
- The Desk flow in AiSensy can stay: it is harmless and still useful for testing with Test Numbers.

## Number profile and automatic replies (set up in AiSensy 2026-10-22)
Desk number +91 80423 03061, plan PRO (monthly), quality High, messaging limit 250 a day.
- **Profile (Dashboard, pencil next to the number):** logo (the shield icon, 640x640 from `assets/img/icon-512.png`), description "Doorstep bike service and roadside help across Bengaluru. A mechanic comes to you with a quote first, and you pay only after you say yes. Book on mechanixpro.in or message us here. Replies 8 AM to 9 PM, every day.", address "Doorstep service across Bengaluru, Karnataka, India", email hello@mechanixpro.in, website https://mechanixpro.in/, category Automotive.
- **Automatic replies (Manage, Live Chat Settings):** both ON. Working hours Mon to Sun 8:00 AM to 9:00 PM (Asia/Kolkata).
  - Welcome message, sent on a customer's first message during working hours: "Hi! Thanks for contacting Mechanix Pro, doorstep bike service in Bengaluru. To get your quote faster, please send your bike model, your area and what the bike needs. A team member will reply shortly."
  - Off-hours message: "Hi! Thanks for contacting Mechanix Pro. Our team replies from 8 AM to 9 PM, every day. Please send your bike model, your area and what the bike needs, and we will reply as soon as we are back."
- **Still pending on the owner:** Meta Business Verification (FBM/KYC) and display-name approval. The display name shows as "Mechanix pro" until Meta approves it. Verification also raises the 250 a day limit.
