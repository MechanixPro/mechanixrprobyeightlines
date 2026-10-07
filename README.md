# Mechanix Pro — website, admin panel & WhatsApp automation

Lead-capture website for **mechanixpro.in** that turns visitors into WhatsApp bookings, an admin panel to manage
them, and an AI WhatsApp assistant that follows up until the customer pays the checkup and quote fee.

| Part | Tech | Where |
|---|---|---|
| Website (PWA-ready) | Plain HTML/CSS/JS, no build step | `/index.html`, `/bike-service-*/`, `/assets` |
| Admin panel | Supabase Auth + Row Level Security | `/admin/` |
| Database | Supabase Postgres | `supabase/migrations/` |
| Lead API, WhatsApp AI, reminders, payments | Supabase Edge Functions (Deno) | `supabase/functions/` |
| Hosting, SSL, firewall, bot check | Cloudflare Pages + Turnstile + Access | `_headers`, `_redirects` |

---

## Go-live in two stages

**Stage 1 — website live with WhatsApp booking (same day, no approvals needed)**
**Stage 2 — admin panel + AI WhatsApp automation (after Meta approves the WhatsApp number, usually 2–5 days)**

### Stage 1 · Website live (≈1 hour)

1. **Set the WhatsApp number.** Edit `assets/js/config.js` → `whatsapp: '91XXXXXXXXXX'` (91 + 10 digits) and `phoneDisplay`.
   Also replace `+91-XXXXXXXXXX` in `index.html` and `scripts/build_pages.py` (structured data), then run `python3 scripts/build_pages.py`.
2. **Fill legal placeholders.** Search the repo for `[Registered business name]`, `[registered address]`, `[GSTIN]`, `[Name]`, `[date]`, then re-run `python3 scripts/build_pages.py`. Have a lawyer review Terms, Privacy and Refund policy.
3. **Push to GitHub.**
   ```bash
   git init && git add . && git commit -m "Mechanix Pro website v1"
   git branch -M main
   git remote add origin https://github.com/<your-account>/mechanixpro.git
   git push -u origin main
   ```
4. **Move DNS from GoDaddy to Cloudflare (free plan).**
   Cloudflare → *Add a site* → `mechanixpro.in` → Free. Cloudflare shows two nameservers.
   GoDaddy → My Products → mechanixpro.in → DNS → *Nameservers* → *Change* → *I'll use my own* → paste both → Save.
   Propagation usually takes 30 minutes to a few hours.
5. **Deploy on Cloudflare Pages.** Workers & Pages → Create → Pages → *Connect to Git* → choose the repo.
   Framework preset: **None** · Build command: *(empty)* · Output directory: **/** → Deploy.
   Then *Custom domains* → add `mechanixpro.in` and `www.mechanixpro.in`.
6. **Cloudflare security settings.**
   SSL/TLS → **Full (strict)**; Edge Certificates → **Always Use HTTPS** on, **HSTS** on;
   Security → Bots → **Bot Fight Mode** on; Security → WAF → keep managed rules on.
   Analytics → **Web Analytics** → enable for the site (cookie-free page tracking).
7. **Google.** Add the site in Google Search Console (DNS verification through Cloudflare), submit `https://mechanixpro.in/sitemap.xml`. Create a Google Business Profile for "Mechanix Pro" (service-area business, Bengaluru).

The site now works: the builder sends a pre-filled booking message to WhatsApp. Nothing is stored yet.

### Stage 2 · Admin panel, lead storage and AI automation

**A. Supabase (database + admin login)**
1. Supabase → your project → SQL Editor → paste `supabase/migrations/20261006000000_init.sql` → **Run**.
   Then paste `supabase/migrations/20261007000000_lead_details.sql` and run it too. It adds the booking details, referral and campaign columns.
2. Authentication → Users → **Add user** (owner email + strong password). Then in SQL Editor:
   ```sql
   insert into public.admins (user_id, name, role)
   select id, 'Owner', 'owner' from auth.users where email = 'owner@example.com';
   ```
   Add staff the same way with `role = 'staff'` (staff cannot change prices or settings).
3. Authentication → Providers → Email: turn **off** "Allow new users to sign up" (admins are added manually).
4. Project Settings → API: copy **Project URL** and **anon public** key into `assets/js/config.js` (`supabaseUrl`, `supabaseAnonKey`). The anon key is safe in the browser; RLS blocks it from reading leads. **Never** put the `service_role` key in any file in this repo.
5. Commit and push → Cloudflare redeploys. Admin panel: `https://mechanixpro.in/admin/`.

**B. Protect /admin with Cloudflare Access (free up to 50 users)**
Zero Trust → Access → Applications → Add → Self-hosted → domain `mechanixpro.in`, path `admin` →
policy *Allow* → emails of the owner and staff → one-time PIN login. Now /admin needs both a Cloudflare email code and the Supabase password.

**C. Bot protection on the booking form**
Cloudflare → Turnstile → Add site `mechanixpro.in` (Managed). Put the **site key** in `config.js` → `turnstileSiteKey`; the **secret key** goes into Supabase secrets below.

**D. Edge Functions**
```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy submit-lead --no-verify-jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy follow-up --no-verify-jwt
supabase functions deploy payment-link
```
Secrets (only the ones you have so far; each feature switches on when its keys exist):
```bash
supabase secrets set ALLOWED_ORIGINS=https://mechanixpro.in,https://www.mechanixpro.in
supabase secrets set IP_SALT=$(openssl rand -hex 16) CRON_SECRET=$(openssl rand -hex 24)
supabase secrets set TURNSTILE_SECRET=<turnstile-secret>
supabase secrets set WA_TOKEN=<permanent-system-user-token> WA_PHONE_NUMBER_ID=<id> WA_APP_SECRET=<meta-app-secret> WA_VERIFY_TOKEN=$(openssl rand -hex 16)
supabase secrets set ANTHROPIC_API_KEY=<key>          # AI replies (model: claude-haiku-4-5, very low cost)
supabase secrets set RAZORPAY_KEY_ID=<id> RAZORPAY_KEY_SECRET=<secret> RAZORPAY_WEBHOOK_SECRET=<secret>
```

**E. WhatsApp Cloud API (Meta)**
1. business.facebook.com → verify the business (GST certificate or similar).
2. developers.facebook.com → Create app → Business → add **WhatsApp** → add and verify the business phone number (it must not be active on the normal WhatsApp app; use a new number or migrate).
3. Create a **System User** with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`) → `WA_TOKEN`.
4. WhatsApp → Configuration → Webhook URL: `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`, verify token = `WA_VERIFY_TOKEN` → subscribe to **messages**.
5. Submit the templates in `docs/WHATSAPP_TEMPLATES.md` (category: Utility). Approval usually takes minutes to a day.
6. Put the same business number in `config.js` so website bookings land in this inbox.

**F. Razorpay**
Dashboard → API keys (live) → secrets above. Webhooks → URL `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`, event **payment_link.paid**, secret = `RAZORPAY_WEBHOOK_SECRET`.

**G. Automatic reminders**
Database → Extensions → enable **pg_cron** and **pg_net**, then run the `cron.schedule` block at the bottom of the migration file with your project ref and `CRON_SECRET`.

---

## How a booking flows
1. Visitor builds a service (bike → service → add-ons → slot). Build is saved on their phone.
2. **Book on WhatsApp** → `submit-lead` validates, checks Turnstile and rate limits, prices it on the server, saves the lead (ref `MP-XXXXXX`) → WhatsApp opens with the booking pre-filled.
3. Customer sends it → `whatsapp-webhook` links the chat to the lead → AI assistant confirms details and sends a Razorpay link for the checkup and quote fee.
4. No reply or no payment → `follow-up` sends up to 4 polite reminders over 3 days (never 9 PM–9 AM). STOP opts out.
5. Customer pays → `razorpay-webhook` marks it **Paid**, stops reminders, confirms on WhatsApp. Admin assigns the mechanic.
Admins see everything live in `/admin/` and can switch AI off per booking or globally.

## Security checklist
- Secrets only in Supabase secrets / Cloudflare. `config.js` holds public values only.
- RLS on every table; browser can read active prices only. Leads are written only by the Edge Function.
- Webhooks verify Meta and Razorpay signatures; prices are recomputed on the server.
- Turnstile + rate limits on the booking API; Cloudflare WAF, Bot Fight Mode, HSTS, strict CSP (`_headers`).
- Admin behind Cloudflare Access + Supabase Auth; owner/staff roles; every admin action in the audit log.

## Running costs (approx., Oct 2026 — check provider pricing)
| Item | Monthly |
|---|---|
| Cloudflare Pages, Turnstile, Access, Web Analytics | ₹0 |
| Supabase Free → Pro when live traffic grows (Free pauses after a week of no activity) | ₹0 → ~₹2,200 |
| WhatsApp: customer-started chats free within 24h; utility templates ≈ ₹0.12–0.15 each + GST | ₹200–800 |
| AI replies (Claude Haiku) | ~₹100–500 |
| Razorpay | ~2% per payment |
| Domain renewal (GoDaddy) | yearly |

## Roadmap
See `docs/ROADMAP.md` for the path from this website to a web app and Play Store / App Store apps on the same database.


---

## Deploying on Cloudflare Pages (two projects)

| Project | What | Build command | Output directory | Address |
|---|---|---|---|---|
| `mechanixpro-site` | Customer website | `sh scripts/build_site.sh` | `dist-site` | mechanixpro-site.pages.dev, later mechanixpro.in |
| `mechanixpro-admin` | Admin panel | `sh scripts/build_admin.sh` | `dist-admin` | mechanixpro-admin.pages.dev, later admin.mechanixpro.in |

Publish by hand from this Mac (signed in with `npx wrangler login` as the Mechanix Pro account):
```bash
sh scripts/build_site.sh  && npx wrangler pages deploy dist-site  --project-name mechanixpro-site  --branch main
sh scripts/build_admin.sh && npx wrangler pages deploy dist-admin --project-name mechanixpro-admin --branch main
```
Bookings are saved only from the addresses listed in the Supabase secret `ALLOWED_ORIGINS`
(`npx supabase secrets set ALLOWED_ORIGINS="https://mechanixpro.in,https://www.mechanixpro.in" --project-ref <ref>`).
Remove any temporary `*.pages.dev` address from it before launch.
