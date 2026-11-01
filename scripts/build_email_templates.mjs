// Writes the Supabase login-code email from the same design as every other Mechanix Pro email.
// Run: node scripts/build_email_templates.mjs
import { writeFileSync } from 'node:fs';
import { otpCode } from '../supabase/functions/_shared/email-templates.ts';
const site = { siteUrl: process.env.SITE_URL || 'https://mechanixpro.in', phoneDisplay: '+91 79652 95649', phoneTel: '+917965295649', whatsappUrl: 'https://wa.me/918042303061', email: 'hello@mechanixpro.in' };
writeFileSync(new URL('../supabase/templates/otp.html', import.meta.url), otpCode({ ...site, code: '{{ .Token }}', minutes: 10 }).html);
console.log('Wrote supabase/templates/otp.html');
