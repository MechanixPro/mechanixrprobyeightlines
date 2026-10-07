import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailPayload, sendEmail, FROM_DEFAULT } from '../supabase/functions/_shared/resend.ts';

test('the default sender is the no-reply address on the Mechanix Pro domain', () => assert.equal(FROM_DEFAULT, 'Mechanix Pro <no-reply@mechanixpro.in>'));
test('payload has from, to list, subject, html, text and a reply-to', () => {
  const p = buildEmailPayload({ to: 'a@b.in', subject: 'S', html: '<p>x</p>', text: 'x' });
  assert.deepEqual(p.to, ['a@b.in']); assert.equal(p.from, FROM_DEFAULT); assert.equal(p.reply_to, 'hello@mechanixpro.in'); assert.equal(p.subject, 'S');
});
test('marketing mail carries the one-click unsubscribe headers', () => {
  const p = buildEmailPayload({ to: 'a@b.in', subject: 'S', html: 'h', text: 't', unsubscribeUrl: 'https://mechanixpro.in/unsubscribe?t=1' });
  assert.equal(p.headers['List-Unsubscribe'], '<https://mechanixpro.in/unsubscribe?t=1>');
  assert.equal(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});
test('tags are limited to safe characters', () => assert.deepEqual(buildEmailPayload({ to: 'a@b.in', subject: 'S', html: 'h', text: 't', tags: { template: 'booking received!' } }).tags, [{ name: 'template', value: 'booking_received_' }]));
test('a bad address is rejected before anything is sent', async () => {
  let called = false;
  const r = await sendEmail({ to: 'not-an-email', subject: 'S', html: 'h', text: 't' }, { apiKey: 'k', fetch: async () => { called = true; return new Response('{}'); } });
  assert.equal(r.ok, false); assert.equal(called, false);
});
test('without an API key nothing is sent and the result says it was skipped', async () => {
  const r = await sendEmail({ to: 'a@b.in', subject: 'S', html: 'h', text: 't' }, { apiKey: '', fetch: async () => { throw new Error('should not be called'); } });
  assert.deepEqual(r, { ok: false, skipped: true, error: 'Email is not set up yet.' });
});
test('a good send posts to Resend with the key and returns the message id', async () => {
  let seen;
  const r = await sendEmail({ to: 'a@b.in', subject: 'S', html: 'h', text: 't' }, { apiKey: 'key123', fetch: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); } });
  assert.deepEqual(r, { ok: true, id: 'em_1' });
  assert.equal(seen.url, 'https://api.resend.com/emails'); assert.equal(seen.init.headers.Authorization, 'Bearer key123');
});
test('an error from Resend comes back as a failure, never a crash', async () => {
  const r = await sendEmail({ to: 'a@b.in', subject: 'S', html: 'h', text: 't' }, { apiKey: 'k', fetch: async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 }) });
  assert.equal(r.ok, false); assert.match(r.error, /Domain not verified/);
  const r2 = await sendEmail({ to: 'a@b.in', subject: 'S', html: 'h', text: 't' }, { apiKey: 'k', fetch: async () => { throw new Error('network down'); } });
  assert.equal(r2.ok, false); assert.match(r2.error, /network down/);
});
