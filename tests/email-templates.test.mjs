import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingReceived, bookingConfirmed, otpCode, marketing, escapeHtml } from '../supabase/functions/_shared/email-templates.ts';

const SITE = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 97430 31301', phoneTel: '+919743031301', whatsappUrl: 'https://wa.me/919743031301', email: 'hello@mechanixpro.in' };
const received = () => bookingReceived({ ...SITE, name: 'Asha', ref: 'MP-1042', bike: 'Honda Activa 6G', service: 'General service', area: 'HSR Layout', whenText: 'Tomorrow, 11 Oct · Morning (9 AM – 12 PM)', estimate: 1299 });
const all = () => [received(), bookingConfirmed({ ...SITE, name: 'Asha', ref: 'MP-1042', bike: 'Honda Activa 6G', service: 'General service', area: 'HSR Layout', whenText: 'Saturday, 11 Oct · Morning', mechanicName: 'Kiran', amountDue: 1299 }), otpCode({ ...SITE, code: '482913', minutes: 10 }), marketing({ ...SITE, subject: 'Monsoon check', preheader: 'Get your bike ready', headline: 'Ready for the rains?', body: 'First paragraph.\n\nSecond paragraph.', ctaText: 'Book a service', ctaUrl: 'https://mechanixpro.in/book/', unsubscribeUrl: 'https://mechanixpro.in/unsubscribe?t=abc' })];

test('escapeHtml escapes the five dangerous characters', () => assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'));
test('every email has a subject, an HTML body and a plain-text body', () => {
  for (const m of all()) { assert.ok(m.subject.length > 5); assert.ok(m.html.length > 500); assert.ok(m.text.length > 40); }
});
test('every email uses the brand: white header with the logo and name, ember accent, 600px layout', () => {
  for (const { html } of all()) {
    assert.match(html, /#F2801F/i);
    assert.match(html, /<img[^>]+logo[^>]+alt="Mechanix Pro"/i); assert.match(html, /<img[^>]+email-wordmark[^>]+alt="MECHANIX PRO"/i);
    assert.match(html, /width="600"/);
    assert.match(html, /<meta name="viewport"/);
  }
});
test('every email is safe: no scripts, no external stylesheets, an inbox preview line, the business footer', () => {
  for (const { html } of all()) {
    assert.doesNotMatch(html, /<script|<link /i);
    assert.match(html, /display:none[^>]*>[^<]{8,}/);
    assert.match(html, /hello@mechanixpro\.in/);
  }
});
test('the booking-received email shows the reference, bike, service, area, time and estimate', () => {
  const { subject, html, text } = received();
  assert.match(subject, /MP-1042/);
  for (const s of ['MP-1042', 'Honda Activa 6G', 'General service', 'HSR Layout', 'Morning (9 AM – 12 PM)', '₹1,299']) { assert.ok(html.includes(s), s); assert.ok(text.includes(s), s); }
});
test('the booking-received email says a quote follows on WhatsApp and nothing starts without approval', () => {
  const { html, text } = received();
  assert.match(html, /quote/i); assert.match(html, /approve/i); assert.match(text, /approve/i);
  assert.ok(html.includes('https://wa.me/919743031301')); assert.ok(html.includes('tel:+919743031301'));
});
test('customer-supplied text is escaped in the HTML', () => {
  const { html } = bookingReceived({ ...SITE, name: '<script>alert(1)</script>', ref: 'MP-1', bike: '"><img src=x>', service: 'S', area: 'A', whenText: 'W', estimate: 1 });
  assert.doesNotMatch(html, /<script>alert/); assert.doesNotMatch(html, /"><img src=x>/);
  assert.match(html, /&lt;script&gt;/);
});
test('the confirmed email names the mechanic and the time and has no marketing footer', () => {
  const { html, subject } = bookingConfirmed({ ...SITE, name: 'Asha', ref: 'MP-1042', bike: 'B', service: 'S', area: 'A', whenText: 'Saturday, 11 Oct · Morning', mechanicName: 'Kiran', amountDue: 199 });
  assert.match(subject, /confirmed/i); assert.ok(html.includes('Kiran')); assert.ok(html.includes('Saturday, 11 Oct')); assert.doesNotMatch(html, /unsubscribe/i);
});
test('the login code email shows the code, its lifetime and a warning, and has no buttons or links to click', () => {
  const { html, text, subject } = otpCode({ ...SITE, code: '482913', minutes: 10 });
  assert.ok(html.includes('482913')); assert.ok(text.includes('482913')); assert.match(html, /10 minutes/); assert.match(html, /did not (ask|request)/i); assert.match(subject, /code/i);
  assert.doesNotMatch(html.replace(/hello@mechanixpro\.in/g, ''), /<a [^>]*href="http/i);
});
test('the marketing email has an unsubscribe link in HTML and text, a button, and paragraphs from the body', () => {
  const m = all()[3];
  assert.equal(m.subject, 'Monsoon check');
  assert.ok(m.html.includes('https://mechanixpro.in/unsubscribe?t=abc')); assert.ok(m.text.includes('https://mechanixpro.in/unsubscribe?t=abc'));
  assert.match(m.html, /Book a service/); assert.match(m.html, /Ready for the rains\?/);
  assert.equal((m.html.match(/<p [^>]*>(First|Second) paragraph\./g) || []).length, 2);
  assert.match(m.html, /you are receiving this because/i);
});
