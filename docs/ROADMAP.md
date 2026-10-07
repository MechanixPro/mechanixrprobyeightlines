# From website to web app to Play Store / App Store

The database is already shaped for apps: `customers`, `bikes`, `leads` (bookings), `messages`, `services`.
Nothing built now is thrown away; each phase adds a layer on top.

| Phase | What ships | How | Rough effort |
|---|---|---|---|
| 1 · Now | Lead website, WhatsApp booking, admin panel, AI follow-ups | Static site + Supabase | This quote |
| 2 · Web app | Customer login by OTP, "My bikes", booking history, live status, online invoices | Next.js (or keep vanilla) on the same Supabase; Supabase phone OTP via MSG91/Twilio; installable PWA | 2–3 weeks |
| 3 · Partner app | Mechanic jobs, inspection photos, estimates, OTP handover | Same web app, partner role + RLS | 2 weeks |
| 4 · Store apps | Play Store and App Store apps | **Capacitor** wraps the web app and adds native push notifications, location and camera — needed because Apple rejects plain website wrappers (App Store Guideline 4.2). Later, rebuild screens in React Native/Expo if needed, still on the same Supabase backend | 1–2 weeks + store review |

Accounts to create when Phase 4 starts: Google Play Console (one-time $25), Apple Developer Program ($99/year), both in the business's name.
