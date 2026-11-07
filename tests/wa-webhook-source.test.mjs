import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const hook = read('supabase/functions/whatsapp-webhook/index.ts');

test('webhook: signature is checked on the raw body before anything is parsed or stored', () => {
  assert.ok(hook.indexOf('verifyMetaSignature') < hook.indexOf('JSON.parse(raw)'));
  assert.ok(hook.indexOf('verifyMetaSignature') < hook.indexOf('wa_record_inbound'));
  assert.match(hook, /return new Response\('Bad signature', \{ status: 401 \}\)/);
  assert.match(hook, /const raw = await req\.text\(\)/);
});
test('webhook: verify token handshake refuses an empty token', () => {
  assert.match(hook, /token && url\.searchParams\.get\('hub\.mode'\) === 'subscribe'/);
});
test('webhook: de-dup, statuses, STOP and the claim and switch guards are all wired', () => {
  assert.match(hook, /rec\?\.duplicate\) return/);
  assert.match(hook, /rpc\('wa_apply_status'/);
  assert.match(hook, /STOP_WORDS\.test\(text\)/);
  assert.match(hook, /opted_out: true, ai_enabled: false/);
  assert.match(hook, /if \(rec\?\.assigned_to\) return;/);
  assert.match(hook, /rec\?\.ai_auto === false \|\| \(rec\?\.ai_auto == null && rec\?\.global_ai === false\)/);
  assert.ok(hook.indexOf('rec?.assigned_to') < hook.indexOf('aiReply('));
  assert.match(hook, /source: 'whatsapp'/);
});
test('webhook: AI and system replies are logged through wa_record_outbound with the sender kept', () => {
  assert.match(hook, /p_sender: 'ai'/); assert.match(hook, /p_sender: 'system'/);
  assert.doesNotMatch(hook, /from\('messages'\)\.insert/);
});
test('webhook: media bytes are never downloaded or stored here', () => {
  assert.doesNotMatch(hook, /fetch\(|storage\.from|arrayBuffer/);
});
