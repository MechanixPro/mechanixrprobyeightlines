import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookingReceived } from '../supabase/functions/_shared/email-templates.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SITE = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 83106 21498', phoneTel: '+918310621498', whatsappUrl: 'https://wa.me/918310621498', email: 'hello@mechanixpro.in' };
const base = { ...SITE, name: 'Asha Rao', ref: 'MP-AB12CD', bike: 'Honda Activa 6G', service: 'General service', area: 'HSR Layout', whenText: 'Sat, 11 Oct · 10-11 AM', estimate: 1299 };

test('the one booking email explains the whole journey and how the money is protected', () => {
  const m = bookingReceived({ ...base, checkupFee: 99, newCustomer: true });
  for (const re of [/quote first/i, /only after you approve/i, /2 hours/i, /refunded in full/i, /adjusted in your final bill/i, /Razorpay/i, /never ask for your card/i]) assert.match(m.html, re, String(re));
  assert.match(m.text, /2 hours/); assert.match(m.text, /Razorpay/);
});
test('the email lists the service promises and only true claims', () => {
  const m = bookingReceived({ ...base, checkupFee: 99, newCustomer: true });
  for (const re of [/certified mechanic/i, /OEM-certified parts/i, /30-day/i, /OTP/i, /GST invoice/i]) assert.match(m.html, re, String(re));
  for (const re of [/\b\d[\d,]*\+? (bikes|reviews|ratings|customers)/i, /4\.\d\s*(star|\/)/i, /best/i, /guarantee/i]) assert.doesNotMatch(m.html, re, String(re));
});
test('a new customer is told the Rs 99 slot fee, a returning customer the Rs 349 checkup and quote fee', () => {
  const n = bookingReceived({ ...base, checkupFee: 99, newCustomer: true }), r = bookingReceived({ ...base, checkupFee: 349, newCustomer: false });
  assert.match(n.html, /₹99/); assert.match(n.html, /first booking/i); assert.doesNotMatch(n.html, /₹349/);
  assert.match(r.html, /₹349/); assert.match(r.html, /checkup and quote fee/i); assert.doesNotMatch(r.html, /first booking/i);
});
test('submit-lead works out the fee the same way the payment page does', () => {
  const f = read('supabase/functions/submit-lead/index.ts');
  assert.match(f, /isReturningCustomer/); assert.match(f, /slotFee/); assert.match(f, /newCustomer/);
});
test('the website has a trust section for money protection and service promises, with no invented numbers', () => {
  const h = read('index.html');
  assert.match(h, /id="trust"/); assert.match(h, /Your money is protected/i);
  const t = h.slice(h.indexOf('id="trust"'), h.indexOf('id="trust"') + 6000);
  for (const re of [/Quote first/i, /refunded in full/i, /Razorpay/i, /30-day/i, /OTP/i]) assert.match(t, re, String(re));
  assert.doesNotMatch(t, /\b\d[\d,]*\+/); assert.doesNotMatch(t, /rated|stars?\b|reviews?\b/i);
});
