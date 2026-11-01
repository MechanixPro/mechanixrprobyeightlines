# Ads day setup (what only the owner can do, in order)

## 1. Meta pixel (Instagram and Facebook lead tracking)
1. Open business.facebook.com, Events Manager, **Connect data sources**, **Web**, name it "Mechanix Pro", enter https://mechanixpro.in.
2. Copy the **Pixel ID** (digits only) and send it. It goes in `assets/js/config.js` as `metaPixelId`. The site already sends PageView, Lead (booking sent) and Contact (WhatsApp or call tap) once the ID is set.
3. In Events Manager, Test events, open mechanixpro.in and tap a WhatsApp button: Contact should appear.
4. Optimise the ad set for **Leads**, not clicks.

## 2. Google Analytics 4 (optional)
1. analytics.google.com, Admin, **Create property** "Mechanix Pro", India, INR.
2. Data stream, **Web**, https://mechanixpro.in. Copy the **Measurement ID** that starts with G-.
3. Send it. It goes in `assets/js/config.js` as `gaId`. Events already sent: generate_lead, whatsapp_click, call_click.
4. In GA4, mark generate_lead as a key event.

## 3. Ad funds
Check Google Ads billing (account 842-907-1550) and the Meta ad account. Add enough for at least 3 days at the daily budget before switching anything on.

## 4. Number setup (see docs/IVR-FLOW.md)
1. **AiSensy:** Flows (or Chatbot builder), create the welcome list and the branches in the WhatsApp section. Create the six `ivr_*` utility templates and wait for approval (usually minutes to a day).
2. **IVR provider** (the one that owns +91 79652 95649): create the menu from the Call flow table, upload or record the prompts, create the ring groups, set the missed-call rule.
3. Test every key from a spare phone and every WhatsApp branch.

## 5. Desk
Add at least one Care Buddy in crew.mechanixpro.in, Team, so new leads have an owner.
