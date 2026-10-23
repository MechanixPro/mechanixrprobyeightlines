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
- **Profile (Dashboard, pencil next to the number):** logo (the shield icon, 640x640 from `assets/img/icon-512.png`), description "Doorstep bike service and roadside help across Bengaluru. A mechanic comes to you with a quote first, and you pay only after you say yes. Book on mechanixpro.in or message us here. Open 24/7.", address "Doorstep service across Bengaluru, Karnataka, India", email hello@mechanixpro.in, website https://mechanixpro.in/, category Automotive.
- **Automatic replies (Manage, Live Chat Settings):** both ON. Working hours Mon to Sun 12:00 AM to 11:59 PM (Asia/Kolkata), open 24/7.
  - Welcome message, sent on a customer's first message during working hours: "Hi! Thanks for contacting Mechanix Pro, doorstep bike service in Bengaluru. To get your quote faster, please send your bike model, your area and what the bike needs. A team member will reply shortly."
  - Working hours: Mon–Sun 12:00 AM–11:59 PM (Asia/Kolkata), so the off-hours message effectively never fires.
  - Off-hours message: "Hi! Thanks for contacting Mechanix Pro. We are open 24/7. Please send your bike model, your area and what the bike needs, and a team member will reply shortly."
- **Still pending on the owner:** Meta Business Verification (FBM/KYC) and display-name approval. The display name shows as "Mechanix pro" until Meta approves it. Verification also raises the 250 a day limit.

## Getting customer messages to the desk without webhooks (built 2026-10-22)
Webhooks are not in the PRO plan (they start at Premium) and the one flow runs only for test numbers, so incoming messages are tracked by asking AiSensy, which the plan allows:
- **Schedule:** a database job (`pg_cron`, name `desk-poll-replies`) calls the function `desk-poll-replies` every 3 minutes between about 7:30 AM and 10:30 PM IST. It checks the AiSensy contact record of every open lead from the last 14 days (up to 120) and saves when the customer last wrote and when the last message by either side was. It uses the secret `DESK_CRON_SECRET`.
- **Desk Inbox:** `crm_replies_waiting()` lists leads where the customer wrote last and nobody has answered (no call or WhatsApp logged in the desk after it, and no reply in AiSensy more than 90 seconds after it, because a reply inside 90 seconds is the automatic welcome message). The Inbox tab shows it with a badge, My day shows a banner, and cards are marked. Open a lead to reply from the lead sheet.
- **Limits:** the words customers type are readable only in AiSensy Live Chat (link in the Inbox and lead sheet). A number that has never been a lead appears only in Live Chat until a Care Buddy adds it with + Lead.
- **Context for Live Chat:** when a lead sheet is opened, the desk writes the bike, service, PIN code and slot onto the customer's AiSensy contact (attributes `vehicle_model`, `service_need`, `location_pincode`, `preferred_slot`), and creates the contact if the customer gave WhatsApp consent.
- **To stop the job:** `select cron.unschedule('desk-poll-replies');`

## Other AiSensy features switched on (2026-10-22)
- Canned messages for Care Buddies in Live Chat: Ask bike details, Ask day and time, Ask location, Payment link coming, Roadside safety first, Thank you.
- Tags (category "Desk stage"): New enquiry, Quote sent, Booked, Needs callback, Roadside.
- Opt-out and opt-in confirmation replies switched on (keywords Stop and Allow); API campaigns skip opted-out contacts.
- Already on: sound and push notifications for new chats. Team: 5 free agent logins are unused; add each Care Buddy under Manage, Team when they join.

## Website WhatsApp bubble and buttons (2026-10-23)
Every WhatsApp button on mechanixpro.in, including the floating bubble and the booking messages, now opens the desk number +91 80423 03061 (`whatsapp` in `assets/js/config.js`). The call number is unchanged (+91 83106 21498). Emails link to the same number through the `WHATSAPP_URL` secret. To go back, set `whatsapp` in `config.js` to `918310621498` and set `WHATSAPP_URL` to `https://wa.me/918310621498`.
The bubble is the site's own, not AiSensy's script: it keeps the strict content security policy and shares no visitor data with a third party.

## AI agent (AiSensy Agent Studio), configured 2026-10-23
- Agent "Mechanix Pro" is configured and published but **paused**: going live needs AiSensy's AI Chat Agent add-on (Upgrade to go live, about ₹1,350 a month). Until then it can only be tried with the free test messages (500).
- It qualifies enquiries (bike model, service, area, PIN code, slot), never states a price (it points to mechanixpro.in/services and says the team sends the quote), never creates payment links (the team sends the Razorpay link for the initial booking amount, or the customer pays at mechanixpro.in/pay), puts safety first on accidents, and hands over to a person on complaints, refunds, accidents and roadside emergencies.
- The stale product list (it had Basic service at ₹499) was removed so the agent cannot quote old prices.
- The "Push qualified leads to your CRM" setting (to the `aisensy-lead` function, header `x-aisensy-secret`) did not keep its values after saving in AiSensy, so leads from the agent are not yet pushed to the desk. After going live, check that screen again.


## Customer journey messages (added 2026-10-23)
The desk now keeps the customer posted on WhatsApp on its own, from the same scheduled job as the rating request (`desk-automation`, every 3 minutes, 24/7). Each message is sent **once per job** and is logged in the lead's activity. One switch, **Keep the customer posted on WhatsApp**, is on the Team screen under Automation.

| When the desk shows | Template | Message |
|---|---|---|
| Status **Quoted** with a total | `mxp_quote_ready` | "Your quote for booking X is Rs N, GST included. Nothing starts until you approve it. Reply YES…" (a revised total sends once more) |
| Status **Scheduled** with a mechanic and a slot | `mxp_booking_confirmed` | Booking confirmed for the slot, the mechanic's first name and the area |
| Status **Completed** | `mxp_service_done` | Service done, the 30-day service warranty has started, the GST invoice is on its way |
| Two hours after Completed | `mxp_desk_rating_link` | Rating request with the signed link (already live) |
| Payment link button | `mxp_desk_payment_link` | Payment link (already live) |

Rules: only customers who agreed to WhatsApp and have not opted out; only jobs that changed after the switch-on time (`desk_journey_since`) and in the last 24 hours, so old leads never get a burst of messages; the first message of a job never repeats.

**To go live:** open the desk, Team, WhatsApp setup, and press **Submit templates**. WhatsApp must approve the three new templates (usually within a day). The desk then creates their API campaigns by itself, with no further action.
Not built, because the desk has no such status yet: "mechanic is on the way". It needs an "en route" step in the mechanic flow first.
