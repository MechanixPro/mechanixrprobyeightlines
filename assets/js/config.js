/* Mechanix Pro — site configuration.
   Only PUBLIC values go here. Never put secret keys in this file:
   it is downloaded by every visitor. Secrets live in Supabase Edge Function secrets. */
window.MXP = {
  whatsapp: '91XXXXXXXXXX',        // Business WhatsApp number: 91 + 10 digits, no spaces or +
  callNumber: '91XXXXXXXXXX',      // Number customers call (91 + 10 digits). Leave as is to reuse the WhatsApp number
  phoneDisplay: '+91 XXXXX XXXXX', // Shown on the site
  email: 'support@mechanixpro.in',

  supabaseUrl: '',                 // e.g. https://abcdefgh.supabase.co  (leave empty = WhatsApp-only mode)
  supabaseAnonKey: '',             // Supabase "anon public" key (safe to expose; protected by RLS)
  turnstileSiteKey: '',            // Cloudflare Turnstile site key (bot protection on the booking form)

  gaId: '',                        // Google Analytics 4, e.g. G-ABC123
  googleAdsSendTo: '',             // Google Ads conversion, e.g. AW-1234567890/AbCdEfGh

  bookingAdvance: 199,             // Advance to lock a slot (adjusted in the final bill)
  bigBikeSurcharge: 300            // Added to service packages for bikes above 180cc
};
