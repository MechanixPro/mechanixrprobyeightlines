import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { verifyWebhook, authMailFor } from '../supabase/functions/_shared/auth-hook.ts';
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
const SITE = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 83106 21498', phoneTel: '+918310621498', whatsappUrl: 'https://wa.me/918310621498', email: 'hello@mechanixpro.in' };
const SB = 'https://mejdxsbpyscujpvbwvmg.supabase.co';
test('a password-reset request becomes a mail with the one-time link, built from the hook payload', () => {
  const m = authMailFor({ user: { email: 'hello@mechanixpro.in' }, email_data: { token: '482913', token_hash: 'abc123hash', redirect_to: 'https://admin.mechanixpro.in/', email_action_type: 'recovery' } }, SITE, SB);
  assert.equal(m.to, 'hello@mechanixpro.in');
  assert.ok(m.html.includes(SB + '/auth/v1/verify?token=abc123hash&amp;type=recovery&amp;redirect_to=https%3A%2F%2Fadmin.mechanixpro.in%2F') || m.html.includes(SB + '/auth/v1/verify?token=abc123hash&type=recovery&redirect_to=https%3A%2F%2Fadmin.mechanixpro.in%2F'));
  assert.match(m.text, /auth\/v1\/verify\?token=abc123hash&type=recovery/); assert.match(m.subject, /reset/i);
  assert.doesNotMatch(m.html + m.text, /482913/);
});
test('Care Buddies get a login code, admins never do, and anything else is refused', () => {
  const code = (type, admin) => authMailFor({ user: { email: 'a@b.in' }, email_data: { token: '123456', token_hash: 'h', email_action_type: type } }, SITE, SB, { isAdmin: admin });
  const cb = code('magiclink', false); assert.match(cb.html, /123456/); assert.match(cb.subject, /login code/i); assert.equal(cb.template, 'login_code');
  assert.ok(code('email', false));
  assert.equal(code('magiclink', true), null); assert.equal(code('email', true), null);
  for (const type of ['signup', 'invite', 'email_change', 'reauthentication', undefined]) assert.equal(code(type, false), null, String(type));
  assert.equal(authMailFor({ user: {}, email_data: { email_action_type: 'recovery', token_hash: 'h' } }, SITE, SB), null);
  assert.equal(authMailFor({ user: { email: 'a@b.in' }, email_data: { email_action_type: 'recovery' } }, SITE, SB), null);
  const r = authMailFor({ user: { email: 'a@b.in' }, email_data: { email_action_type: 'recovery', token_hash: 'h', token: '999999' } }, SITE, SB, { isAdmin: true });
  assert.equal(r.template, 'password_reset'); assert.doesNotMatch(r.html + r.text, /999999/);
});
test('auth-email checks the signature first, sends from no-reply, logs without the code, and is public for Supabase Auth', () => {
  const f = read('../supabase/functions/auth-email/index.ts');
  assert.ok(f.indexOf('verifyWebhook(') < f.indexOf('sendEmail('));
  assert.match(f, /SEND_EMAIL_HOOK_SECRET/); assert.match(f, /template: mail\.template/); assert.match(f, /from\('admins'\)/); assert.match(f, /401/);
  assert.doesNotMatch(f, /console\.(log|error)\([^)]*(token|code)/i); assert.doesNotMatch(f, /insert\([^)]*(token|code:)/i);
  assert.doesNotMatch(f, /FROM_BOOKING/);
  const toml = read('../supabase/config.toml');
  assert.match(toml, /\[functions\.auth-email\]\s*verify_jwt = false/);
  assert.doesNotMatch(toml, /whsec_/); assert.doesNotMatch(toml, /^secrets = /m);
  assert.match(read('../docs/AUTH-EMAIL.md'), /SEND_EMAIL_HOOK_SECRET/);
});
