import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanBroadcast, isEligible } from '../supabase/functions/_shared/broadcast.ts';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ok = { subject: 'Monsoon offer', headline: 'Get your bike monsoon-ready', body: 'Brakes, chain and tyres checked.\n\nBook this week.', ctaText: 'Build your service', ctaUrl: 'https://mechanixpro.in/book/' };

test('a complete message is accepted and trimmed', () => {
  const r = cleanBroadcast({ ...ok, subject: '  Monsoon offer  ' });
  assert.equal(r.ok, true); assert.equal(r.value.subject, 'Monsoon offer'); assert.equal(r.value.preheader.length > 0, true);
});
test('subject, headline and body are required', () => {
  for (const k of ['subject', 'headline', 'body']) assert.equal(cleanBroadcast({ ...ok, [k]: ' ' }).ok, false, k);
});
test('lengths are capped', () => {
  assert.equal(cleanBroadcast({ ...ok, subject: 'x'.repeat(121) }).ok, false);
  assert.equal(cleanBroadcast({ ...ok, body: 'x'.repeat(2001) }).ok, false);
});
test('the button link must be https; the button text and link come together or not at all', () => {
  assert.equal(cleanBroadcast({ ...ok, ctaUrl: 'http://x.in' }).ok, false);
  assert.equal(cleanBroadcast({ ...ok, ctaUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(cleanBroadcast({ ...ok, ctaText: '' }).ok, false);
  assert.equal(cleanBroadcast({ ...ok, ctaText: '', ctaUrl: '' }).ok, true);
});
test('only customers who said yes, have an address, are not unsubscribed and not blocked get offers', () => {
  const c = { email: 'a@b.in', email_marketing_consent: true, email_unsubscribed_at: null, blocked: false };
  assert.equal(isEligible(c), true);
  assert.equal(isEligible({ ...c, email: null }), false);
  assert.equal(isEligible({ ...c, email_marketing_consent: false }), false);
  assert.equal(isEligible({ ...c, email_unsubscribed_at: '2026-10-01' }), false);
  assert.equal(isEligible({ ...c, blocked: true }), false);
});
test('send-broadcast is owner-only, tests to the sender first, adds a one-click unsubscribe, and logs each send', () => {
  const f = read('../supabase/functions/send-broadcast/index.ts');
  assert.match(f, /role.*owner|'owner'/); assert.match(f, /unsubLinks\(/); assert.match(f, /unsubscribeUrl/);
  assert.match(f, /mode === 'test'/); assert.match(f, /email_log/); assert.match(f, /template: 'marketing'/);
});
test('admin has an Offers tab with a test button and a confirmed send', () => {
  assert.match(read('../admin/index.html'), /data-tab="offers"/);
  const a = read('../admin/admin.js');
  assert.match(a, /functions\.invoke\('send-broadcast'/); assert.match(a, /data-act="offerTest"/); assert.match(a, /data-act="offerSend"/);
});
