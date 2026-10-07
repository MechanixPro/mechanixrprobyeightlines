# Mechanix Pro — project guide for Claude Code

Doorstep bike service + roadside help, Bengaluru. Domain: mechanixpro.in (GoDaddy → Cloudflare).
Client budget for this phase: ₹22,000 (website + admin panel + WhatsApp AI automation). ₹10,000 advance received.

## Stack (keep it this way unless asked)
- Website: plain HTML/CSS/JS, **no build step**. Hosted on Cloudflare Pages (output dir `/`).
- Data: Supabase (Postgres + Auth + Edge Functions in Deno). Schema in `supabase/migrations/`.
- WhatsApp Cloud API + Claude (Haiku) for AI replies; Razorpay payment links.
- Public config only in `assets/js/config.js`. **Never** put secrets (service_role key, API keys) in this repo.

## Map
- `index.html` home · `assets/css/style.css` design system · `assets/js/app.js` booking builder → Supabase `submit-lead` → WhatsApp
- `scripts/build_pages.py` generates area pages, legal pages, sitemap. Edit it, then run `python3 scripts/build_pages.py`.
- `admin/` admin panel (Supabase Auth, RLS). `supabase/functions/` lead API, WhatsApp webhook, follow-ups, payments.
- `docs/` WhatsApp templates and the app roadmap. `README.md` = go-live steps.

## Run locally
`npm run dev` → http://localhost:3000 (static server). Booking falls back to WhatsApp-only if Supabase isn't configured.

## Next task: premium redesign (make it clearly better than competitors)
Competitors to beat: ridenrepair.com, drivex.in/bike-services-in-bangalore, readyassist.in, bromechanic.com, bikerz-hub.com, ride-xpert.in.
Brief:
- Apple-level polish: system font stack (SF Pro on Apple, Inter fallback), large confident type, generous whitespace,
  frosted-glass nav, 24px radii, subtle depth, smooth but restrained motion (respect prefers-reduced-motion).
- Brand: navy #14295A, ember #F2801F, logo is the client's exact artwork (`assets/img/brand-src/logo-original.png`) — never redraw it. Regenerate every logo file with `python3 scripts/make_logo.py` (needs Pillow + numpy). The "An 8-Lines Group Company" line is cut out; no "8-Lines Group" text anywhere. Owner confirmed the "10,000+ services done" claim on the home page.
- Hero with a real product moment: animated preview of the "Build your service" card (bike name → package → price).
- Keep the IKEA effect: customer names the bike, builds the package, sees "Your package for <bike>", build is saved.
- Add: sticky price summary, trust strip (only TRUE claims — no fake reviews, ratings or "10,000 bikes serviced"),
  service cards with icons, "What happens at your doorstep" timeline, area chips, FAQ, strong final CTA, WhatsApp-first.
- Real photos later: placeholders in `assets/img/` with clear alt text; no stock images of other brands.
- Performance: Lighthouse 95+ mobile, no layout shift, images WebP/AVIF lazy-loaded, no heavy frameworks.
- Accessibility: WCAG 2.1 AA contrast, 44px tap targets, labelled inputs, keyboard focus states.
- SEO: keep titles, JSON-LD (AutoRepair + FAQPage), canonical, sitemap; one H1 per page.
- CSP in `_headers` forbids inline scripts — use files + addEventListener.

## Rules
- Keep prices consistent across `app.js` defaults, `build_pages.py`, the SQL seed and the FAQ.
- Before finishing: `node --check assets/js/*.js admin/admin.js`, open the site locally on a phone-size viewport.
