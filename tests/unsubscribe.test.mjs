import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { unsubToken, verifyUnsub, unsubLinks } from '../supabase/functions/_shared/unsub.ts';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ID = '123e4567-e89b-12d3-a456-426614174000', OTHER = '123e4567-e89b-12d3-a456-426614174999';

test('token is stable for one customer and different for another', async () => {
  assert.equal(await unsubToken(ID, 's'), await unsubToken(ID, 's'));
  assert.notEqual(await unsubToken(ID, 's'), await unsubToken(OTHER, 's'));
  assert.equal((await unsubToken(ID, 's')).length, 32);
});
test('a token only verifies for its own customer and secret', async () => {
  const t = await unsubToken(ID, 'secret');
  assert.equal(await verifyUnsub(ID, t, 'secret'), true);
  assert.equal(await verifyUnsub(OTHER, t, 'secret'), false);
  assert.equal(await verifyUnsub(ID, t, 'other-secret'), false);
  assert.equal(await verifyUnsub(ID, t.slice(0, 10), 'secret'), false);
});
test('links point at the site page and the one-click function', async () => {
  const l = await unsubLinks(ID, 'secret', 'https://mechanixpro.in', 'https://x.supabase.co/functions/v1');
  assert.match(l.page, /^https:\/\/mechanixpro\.in\/unsubscribe\/\?c=/);
  assert.match(l.oneClick, /\/functions\/v1\/unsubscribe\?c=.*&t=[0-9a-f]{32}$/);
});
test('function verifies the token before touching the customer and clears consent', () => {
  const f = read('../supabase/functions/unsubscribe/index.ts');
  assert.ok(f.indexOf('verifyUnsub(') < f.indexOf('.update('));
  assert.match(f, /email_marketing_consent: false/); assert.match(f, /email_unsubscribed_at/);
});
test('page exists, is noindex, is not in the sitemap, and uses no inline script', () => {
  assert.ok(existsSync(new URL('../unsubscribe/index.html', import.meta.url)));
  const h = read('../unsubscribe/index.html');
  assert.match(h, /noindex/); assert.match(h, /unsub\.js/); assert.doesNotMatch(h, /<script(?![^>]*src)/);
  assert.doesNotMatch(read('../sitemap.xml'), /unsubscribe/);
});
test('the unsubscribe function is public, so the one-click link in mail apps works without a login', () => {
  assert.match(read('../supabase/config.toml'), /\[functions\.unsubscribe\]\s*verify_jwt = false/);
});
