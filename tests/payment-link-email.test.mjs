import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentLinkEmail } from '../supabase/functions/_shared/email-templates.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const site = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 83106 21498', phoneTel: '+918310621498', whatsappUrl: 'https://wa.me/918310621498', email: 'hello@mechanixpro.in' };
const d = { ...site, name: 'Asha Rao', ref: 'MP-AB12CD', amount: 99, payUrl: 'https://rzp.io/rzp/abc123' };

test('the payment email carries the secure link, the amount and the reference', () => {
  const m = paymentLinkEmail(d);
  assert.match(m.subject, /MP-AB12CD/); assert.match(m.subject, /₹99/);
  assert.ok(m.html.includes('href="https://rzp.io/rzp/abc123"')); assert.ok(m.text.includes('https://rzp.io/rzp/abc123'));
  assert.match(m.html, /Asha/); assert.doesNotMatch(m.html, /Rao/);
});
test('the payment email never asks for card details or OTPs and escapes the customer name', () => {
  const m = paymentLinkEmail({ ...d, name: '<script>x</script>' });
  assert.doesNotMatch(m.html, /<script>x/); assert.match(m.html, /never ask for (your )?card/i);
});
test('payment-link emails the customer and reports it to the admin', () => {
  const f = read('supabase/functions/payment-link/index.ts');
  assert.match(f, /paymentLinkEmail/); assert.match(f, /sendEmail/); assert.match(f, /emailed/);
  assert.match(f, /payment_link['"]?\s*\}|template: 'payment_link'/);
});
test('the admin tells the truth about where the link went', () => {
  const a = read('admin/admin.js');
  assert.match(a, /data\.emailed/);
});

test('a WhatsApp message is logged as sent only when WhatsApp really accepted it', () => {
  const w = read('supabase/functions/_shared/whatsapp.ts');
  const fn = w.slice(w.indexOf('export async function sendSmart'));
  assert.match(fn, /if \(!id\) return null;[\s\S]*messages'\)\.insert/);
});

test('the admin can email the payment link to an address typed in, and resend the same link', () => {
  const f = read('supabase/functions/payment-link/index.ts'), a = read('admin/admin.js');
  assert.match(f, /b\.email/); assert.match(f, /resend/); assert.match(f, /email_unsubscribed_at|customers'\)\.update\(\{ email/);
  assert.match(a, /id="pe"/); assert.match(a, /data-act="emailLink"/); assert.match(a, /emailLink\(\)/);
});
