import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { verifyWebhook, loginMailFor } from '../supabase/functions/_shared/auth-hook.ts';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const KEY = Buffer.from('super-secret-test-key-1234567890').toString('base64');
const SECRET = 'v1,whsec_' + KEY;
function sign(id, ts, body, key = KEY) { return 'v1,' + createHmac('sha256', Buffer.from(key, 'base64')).update(`${id}.${ts}.${body}`).digest('base64'); }
const NOW = 1_800_000_000;

test('a correctly signed message from Supabase is accepted', async () => {
  const body = '{"user":{"email":"a@b.in"}}';
  assert.equal(await verifyWebhook(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: sign('msg_1', NOW, body) }, body, NOW), true);
});
test('wrong signature, changed body, old timestamp or missing headers are refused', async () => {
  const body = '{"x":1}';
  const good = { id: 'm', timestamp: String(NOW), signature: sign('m', NOW, body) };
  assert.equal(await verifyWebhook(SECRET, { ...good, signature: sign('m', NOW, body, Buffer.from('other-key').toString('base64')) }, body, NOW), false);
  assert.equal(await verifyWebhook(SECRET, good, '{"x":2}', NOW), false);
  assert.equal(await verifyWebhook(SECRET, good, body, NOW + 3600), false);
  assert.equal(await verifyWebhook(SECRET, { id: '', timestamp: '', signature: '' }, body, NOW), false);
  assert.equal(await verifyWebhook('', good, body, NOW), false);
});
test('a header with several signatures passes if any one matches', async () => {
  const body = 'b';
  assert.equal(await verifyWebhook(SECRET, { id: 'm', timestamp: String(NOW), signature: 'v1,AAAA ' + sign('m', NOW, body) }, body, NOW), true);
});
test('the login mail carries the code and comes from the hook payload', () => {
  const m = loginMailFor({ user: { email: 'hello@mechanixpro.in' }, email_data: { token: '482913', email_action_type: 'magiclink' } }, { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 83106 21498', phoneTel: '+918310621498', whatsappUrl: 'https://wa.me/918310621498', email: 'hello@mechanixpro.in' });
  assert.equal(m.to, 'hello@mechanixpro.in'); assert.match(m.html, /482913/); assert.match(m.text, /482913/); assert.match(m.subject, /login code/i);
  assert.equal(loginMailFor({ user: {}, email_data: {} }, {}), null);
});
test('auth-email checks the signature first, sends from no-reply, logs without the code, and is public for Supabase Auth', () => {
  const f = read('../supabase/functions/auth-email/index.ts');
  assert.ok(f.indexOf('verifyWebhook(') < f.indexOf('sendEmail('));
  assert.match(f, /SEND_EMAIL_HOOK_SECRET/); assert.match(f, /template: 'login_code'/); assert.match(f, /401/);
  assert.doesNotMatch(f, /console\.(log|error)\([^)]*(token|code)/i); assert.doesNotMatch(f, /insert\([^)]*(token|code:)/i);
  assert.doesNotMatch(f, /FROM_BOOKING/);
  const toml = read('../supabase/config.toml');
  assert.match(toml, /\[functions\.auth-email\]\s*verify_jwt = false/);
  assert.doesNotMatch(toml, /whsec_/); assert.doesNotMatch(toml, /^secrets = /m);
  assert.match(read('../docs/AUTH-EMAIL.md'), /SEND_EMAIL_HOOK_SECRET/);
});
