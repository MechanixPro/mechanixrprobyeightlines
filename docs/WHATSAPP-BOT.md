# WhatsApp chatbot: two ways to build it

The owner asked for a WhatsApp chatbot that answers customer questions and runs the booking flow, with a **different number for calls and support**. Both options below are prepared. Decide after the first week of ads.

## What the bot does (same for both options)

1. Greets the customer and answers common questions with **true answers only** (see "Frequently asked questions").
2. Collects the booking details one question at a time: name, bike (brand and model), service, area or PIN, day and time slot.
3. Saves the booking into the admin as a WhatsApp lead.
4. Hands over to a person for the **itemised quote** (quote first, work after the customer's OK). The ₹349 checkup and quote fee is asked only after the customer approves the quote.
5. Hands over to a person at once for: an accident or injury, a complaint or refund, a request for a human, or anything not covered here.

The bot **never** states a price that is not in the price list, never offers discounts, never promises an arrival time, never asks for card numbers, OTPs or Aadhaar.

## Two numbers

| Number | Used for | Where it is set |
|---|---|---|
| **WhatsApp number** (new, dedicated) | The chatbot and your team's WhatsApp chats | `whatsapp` in `assets/js/config.js`, and `WHATSAPP_URL` (Supabase secret) |
| **Call and support number** (a normal SIM you answer) | "Call us" buttons, the number shown on the site, and the call number in emails | `callNumber` and `phoneDisplay` in `config.js`, and `PHONE_DISPLAY`, `PHONE_TEL` (Supabase secrets) |

The WhatsApp number must **not** be active on the normal WhatsApp app (use a new number, or migrate it). Keep the support number as an ordinary phone line.

## Frequently asked questions (the bot's knowledge)

Prices come from the admin Prices tab. Check them before pasting these answers into AiSensy.

- **Where do you work?** All of Bengaluru, PIN codes 560001 to 560110. Outside Bengaluru, send your details and we will say when we reach you.
- **How does it work?** Tell us your bike and what it needs. We send a quote on WhatsApp. Work starts only after you say yes.
- **What does a service cost?** Starting prices, GST included, for bikes up to 180cc: Basic ₹599, General ₹1,299, Full ₹1,999, Repair or problem check ₹349. Above 180cc add ₹300 to Basic, General and Full. Your exact quote comes on WhatsApp.
- **What is the ₹349 fee?** The checkup and quote fee. It locks your slot after you approve the quote. If you go ahead with the service it is adjusted in your final bill.
- **Can I cancel?** Free up to 2 hours before your slot, and the ₹349 is refunded in full. Less than 2 hours before, or after the mechanic has left, the fee covers the visit and is not refunded. See https://mechanixpro.in/refund-policy/
- **Which parts do you use?** OEM-certified parts, fitted only after you approve the quote.
- **Is there a warranty?** 30 days on our service work.
- **Who comes to my place?** A Mechanix Pro-certified mechanic. If your bike has to go to a workshop, it leaves only after you share a one-time code.
- **Electric scooters?** We do a problem check first and quote the fix before any work.
- **My bike broke down right now.** Share your live location here. The roadside emergency visit starts at ₹699. A team member will reply.
- **How do I pay?** Through a secure payment link (UPI, cards, wallets, net banking). We never ask for card numbers or OTPs on chat.
- **Where is my booking?** Enter your reference and mobile number at https://mechanixpro.in/track/
- **Opening hours?** We reply from 8 AM to 9 PM, every day.
- **Fleets, delivery riders, apartments?** Yes. See https://mechanixpro.in/fleet/ and https://mechanixpro.in/societies/
- **Car service, e-challan, bike rental, OEM parts, insurance claims?** Coming soon. Join the waitlist at https://mechanixpro.in/coming-soon/

## Option A: our own bot (already built)

Runs on Supabase with Claude (`whatsapp-webhook`, `_shared/ai.ts`). Bookings and chats appear in the admin. Lowest running cost; we maintain it.

The assistant's rules were updated to the real flow: it collects details, quotes only the starting price from the live price list, then hands over for the itemised quote.

**Set-up (the owner does the Meta steps, then tells Claude to test):**
1. business.facebook.com: verify the business.
2. developers.facebook.com: create an app, add **WhatsApp**, add and verify the new WhatsApp number.
3. Create a System User with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`).
4. In your own terminal set the secrets (never paste them in chat):
   `npx supabase secrets set WA_TOKEN=... WA_PHONE_NUMBER_ID=... WA_APP_SECRET=... WA_VERIFY_TOKEN=... ANTHROPIC_API_KEY=...`
5. Meta, WhatsApp, Configuration: webhook `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/whatsapp-webhook`, subscribe to **messages**.
6. Submit the templates in `docs/WHATSAPP_TEMPLATES.md` (category Utility).
7. Admin, Settings: turn on "AI replies and reminders". Update `config.js` and the Supabase secrets with the two numbers.
8. Test with 10 realistic chats (prices, cancellation, a complaint, an accident, a request for a human, Hindi and Kannada). Confirm every answer matches the list above.

## Option B: AiSensy (managed, no-code)

AiSensy is a WhatsApp Business provider with a flow builder, a shared team inbox and broadcasts. It holds the WhatsApp number. Plans and prices change, so check AiSensy's own site (third-party pages suggest roughly ₹1,500 to ₹3,200 a month, extra for chatbot flows, plus Meta's message charges and a markup). Full API and webhook access may need a higher plan.

**Our side is ready:** the function `aisensy-lead` receives a finished booking from AiSensy and saves it in the admin as a WhatsApp lead.

1. Make a long random secret in your own terminal with `openssl rand -hex 24`. Copy it, then store it in Supabase (do not paste it in chat):
   `npx supabase secrets set AISENSY_WEBHOOK_SECRET=<the value you just made>`
   You will type the same value into AiSensy in the next step.
2. In the AiSensy flow, add an **API / webhook step** at the end of the booking questions:
   - Method `POST`, URL `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/aisensy-lead`
   - Header `Content-Type: application/json` and header `x-aisensy-secret: <your secret>`
   - Body, mapping the flow's variables:
   ```json
   {
     "name": "{{name}}",
     "phone": "{{phone}}",
     "service": "general",
     "bike_brand": "{{bike_brand}}",
     "bike_model": "{{bike_model}}",
     "area": "{{area}}",
     "pincode": "{{pincode}}",
     "preferred_date": "{{date}}",
     "preferred_slot": "morning",
     "note": "{{note}}"
   }
   ```
   `service` is one of `basic`, `general`, `full`, `repair`, `sos`. `preferred_slot` is `morning`, `afternoon`, `evening` or `asap`. `preferred_date` is `YYYY-MM-DD`. Only `name` and `phone` are required.
3. The function answers `{ "ok": true, "ref": "MP-XXXXXX", "estimate": 1299 }`. Show the reference to the customer: "Your reference is {{ref}}. Our expert will send your quote shortly."
4. Wrong or missing secret returns 403. More than 3 bookings from one number in 10 minutes returns 429.

**Flow to build in AiSensy** (each step one message):
1. Welcome: "Hi, I'm Mechanix Pro's assistant. How can I help?" Buttons: Book a service, Roadside help, Prices, Talk to a person.
2. Book a service: ask name, bike brand and model, which service (Basic, General, Full, Repair or problem check), area or PIN, day, time slot. Confirm the details back.
3. Call the webhook step above, then show the reference.
4. Prices: send the starting prices list from "Frequently asked questions".
5. Roadside help: ask them to share live location, then route to a person.
6. Talk to a person: assign to the team inbox. Use that route for accident, complaint and refund keywords too.
7. Anything unmatched: "Let me get a team member." and route to a person.

## Choosing

| | Option A (ours) | Option B (AiSensy) |
|---|---|---|
| Time to launch | Days, after Meta approvals | Days, no developer work |
| Running cost | Meta messages and Claude usage | Monthly plan, flow add-on, Meta charges plus markup |
| Team inbox | Admin, one chat view | Built in, multi-agent |
| Control and data | Full, in your own database | Chats live in AiSensy; bookings come to us by webhook |

Either way the website and admin stay the main record. Start with the option that matches how many people answer chats.
