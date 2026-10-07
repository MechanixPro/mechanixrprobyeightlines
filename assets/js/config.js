/* Mechanix Pro — site configuration.
   Only PUBLIC values go here. Never put secret keys in this file:
   it is downloaded by every visitor. Secrets live in Supabase Edge Function secrets. */
window.MXP = {
  whatsapp: '919743031301',        // Business WhatsApp number: 91 + 10 digits, no spaces or +
  callNumber: '919743031301',      // Number customers call (91 + 10 digits). Leave as is to reuse the WhatsApp number
  phoneDisplay: '+91 97430 31301', // Shown on the site
  email: 'hello@mechanixpro.in',

  supabaseUrl: 'https://mejdxsbpyscujpvbwvmg.supabase.co', // Supabase project URL (public). Booking saves leads only once supabaseAnonKey is also set
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lamR4c2JweXNjdWpwdmJ3dm1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzA2MzAsImV4cCI6MjEwNjgwNjYzMH0.utvGcWqXAQyONtPNiKDNQyCajixQJuU1tWHoRR8kbZk',             // Supabase "anon public" key (safe to expose; protected by RLS)
  turnstileSiteKey: '',            // Cloudflare Turnstile site key (bot protection on the booking form)

  gaId: '',                        // Google Analytics 4, e.g. G-ABC123
  googleAdsSendTo: '',             // Google Ads conversion, e.g. AW-1234567890/AbCdEfGh

  bookingAdvance: 199,             // Advance to lock a slot (adjusted in the final bill)
  bigBikeSurcharge: 300            // Added to service packages for bikes above 180cc
};
