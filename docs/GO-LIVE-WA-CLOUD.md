# Go-live: WhatsApp Cloud inbox for +91 83106 21498

Built on branch `wa-inbox` (from `admin-simple` 09bc766c). Nothing here is pushed, deployed or applied. The AiSensy desk number (+91 80423 03061) is not touched: it keeps sending payment links.

**Why it is not live today:** the webhook function exists, but none of `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` is set in Supabase, so it rejects every call. Production has 52 outbound and 0 inbound messages ever. Steps 1 to 5 below connect it.

## What you get
- **Crew > Inbox > Website number:** live conversations (Unread, Mine, Unassigned, Waiting on us, Closed), search, claim, close, internal notes, quick replies, voice notes, photos, documents, a 24 hour countdown, a template picker when the window is closed, delivery ticks. The old list sits under **Desk number (AiSensy)**.
- **Admin > Bookings > WhatsApp:** every conversation both sides, counts, median first response time, per agent, unanswered over 15/30/60 minutes. Admin can open any chat and reply.
- **AI auto reply:** unchanged by default. It never replies after a person claims the chat, can be switched off per chat (button "AI ..." in the thread), and globally (see step 8).

## 1. Meta: find the app and the WhatsApp Business Account for this number
1. Open business.facebook.com/settings (Meta Business Suite settings) for the business that owns the number.
2. **Accounts > WhatsApp accounts.** Open the account that lists **+91 83106 21498**. Write down its **WhatsApp Business Account ID (WABA ID)**.
3. If the number is in no account, go to developers.facebook.com > **My Apps** > your Business app (or **Create app**, type Business, add the **WhatsApp** product) > **WhatsApp > API Setup > Add phone number**, and verify it by SMS or call.
4. Open developers.facebook.com > the app > **WhatsApp > API Setup**. Pick **+91 83106 21498** in the "From" box. Write down its **Phone number ID** (a long number, not the phone number itself) and the WABA ID.

## 2. Confirm it is a Cloud API number (not the consumer or Business app)
- In **WhatsApp Manager** (business.facebook.com > WhatsApp Manager > Phone numbers) the number must show status **Connected** and appear under the API setup of your app.
- A number still logged in on the WhatsApp or WhatsApp Business phone app is **not** a Cloud API number. Moving it to the Cloud API logs it out of that phone app, and the old chats stay only on that phone. Decide that before you register it. If you want both, Meta's "coexistence" for the Business app must be enabled for the account first.
- Optional check from your own terminal after you have a token (never paste it anywhere): `curl -s "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>?fields=platform_type,status,quality_rating&access_token=$WA_TOKEN"` should show `platform_type: CLOUD_API` and `status: CONNECTED`.

## 3. Create a system user and a permanent token
1. business.facebook.com/settings > **Users > System users > Add**. Name it `mechanix-desk`, role **Admin**.
2. **Add assets** for that system user: your **app** (Full control) and the **WhatsApp account** from step 1 (Full control).
3. **Generate new token** > choose the app > expiry **Never** > tick **whatsapp_business_messaging** and **whatsapp_business_management** > Generate. Copy it once; you type it into the script in step 4. Do not paste it into chat or any file.
4. App secret: developers.facebook.com > the app > **App settings > Basic > App secret > Show**. You type it into the script too.

## 4. Store the secrets (hidden prompts, nothing is echoed)
`bash scripts/set_wa_cloud_secrets.sh` asks for `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` (a private phrase you choose now, you will type the same phrase into Meta in step 6) and optionally `WA_GRAPH_VERSION` (default v21.0). It runs `supabase secrets set --env-file ... --project-ref mejdxsbpyscujpvbwvmg --yes` with a temporary file that is deleted when it ends. Optional template name overrides use the same `WA_TPL_*` secrets the website already reads.

## 5. Deploy (owner, in this order)
1. Apply `supabase/migrations/20270106000000_wa_inbox.sql` (idempotent; rollback notes at the top of the file). It adds columns to `messages` (old rows stay channel `aisensy`), three closed tables and the Crew and Admin functions.
2. Deploy the three functions: `whatsapp-webhook`, `wa-send`, `wa-media`. All three use `verify_jwt = false` in `supabase/config.toml` (the webhook is checked by Meta's signature; wa-send and wa-media check the desk user's JWT and the inbox permission themselves). Example: `npx supabase functions deploy whatsapp-webhook wa-send wa-media --project-ref mejdxsbpyscujpvbwvmg`.
3. Deploy Crew and Admin (`sh scripts/build_crm.sh`, `sh scripts/build_admin.sh`). Both build scripts now allow `media-src 'self' blob:` and `img-src ... blob:` so a loaded voice note or photo can play.

## 6. Meta: point the webhook at Supabase
1. developers.facebook.com > the app > **WhatsApp > Configuration > Webhook > Edit**.
2. **Callback URL:** `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/whatsapp-webhook`
3. **Verify token:** the phrase you typed for `WA_VERIFY_TOKEN`. Click **Verify and save** (Meta calls the function; a wrong phrase gives 403).
4. Under **Webhook fields** click **Subscribe** on **messages**. Delivery receipts (sent, delivered, read, failed) arrive in the same field.
5. Make sure the app is subscribed to the WABA: WhatsApp Manager > the account > **Settings**, or `POST /<WABA_ID>/subscribed_apps` with the token.
6. Templates: in WhatsApp Manager > **Message templates**, the names `mxp_followup`, `mxp_booking_received`, `mxp_payment_reminder`, `mxp_payment_received`, `mxp_last_reminder` must be **Approved** in English (and in Hindi and Kannada if the desk will pick those languages). A template that is not approved in the chosen language is refused by Meta and the desk sees the reason.

## 7. Test checklist (use your own phone as the customer)
- [ ] **Message in:** send "hello" from your phone to +91 83106 21498. Within a few seconds it appears in Crew > Inbox > Website number under Unread with a badge, and in Admin > WhatsApp.
- [ ] **No second copy:** Meta may resend a webhook; the chat shows the message once.
- [ ] **Reply:** claim the chat, type a reply, Send. It arrives on your phone. The AI does not answer your next message while the chat is claimed.
- [ ] **Ticks:** the reply shows one tick (sent), two (delivered), blue two (read) after you open it.
- [ ] **Voice note in:** send a voice note from your phone. The thread shows "Voice note" with a **Load** button; Load plays it. Nothing is stored in our database or storage.
- [ ] **Photo and document in:** same, Load shows the photo or a download link.
- [ ] **Voice note out:** Attach an `.ogg` (Opus), `.mp3`, `.m4a`, `.aac` or `.amr` file. WhatsApp does not accept WebM or WAV recordings; a browser microphone recording is therefore not offered.
- [ ] **Window closed:** for a customer who wrote more than 24 hours ago the chip says "Window closed: use a template", the text box is replaced by the template picker, and a direct API call returns 409 with the same message.
- [ ] **Template:** pick Follow-up, language English, Send template. It arrives. Try Hindi and Kannada once you have approved translations.
- [ ] **Unknown delivery:** if a send ends with "may or may not have been delivered", check the customer chat before sending again. The desk never retries by itself.
- [ ] **STOP:** send STOP; the customer is opted out and the composer is blocked.
- [ ] **AiSensy:** send a payment link from the desk as usual; it still goes from +91 80423 03061.

## 8. Switches and rollback
- AI auto reply for all chats on this number off: `update public.settings set value = 'false'::jsonb where key = 'wa_ai_auto';` (back on: `'true'`). Per chat: the AI button in the thread (on, off, follow global). The older global key `ai_enabled` still applies as before.
- Roll the database back with the notes at the top of the migration file. Un-deploying the three functions returns the webhook to rejecting everything, exactly as before.
- Never share the token, the app secret or the verify phrase in chat, email or the repo. To rotate: create a new system user token in Meta, run the script again, delete the old token.

## Notes
- Media is fetched from Meta only when someone presses Load, and Meta keeps it for about 30 days. We store the media id and mime type only.
- Crew agents who have the Inbox page can read and reply; a chat claimed by one agent can only be replied to by that agent, a supervisor or an admin. No money amounts are shown in this inbox, only a PAID badge.
- Not verified without live Meta credentials: the real webhook handshake, real delivery receipts, media download, template approval and the Hindi and Kannada codes. Everything else is covered by tests and the local Postgres harness.
