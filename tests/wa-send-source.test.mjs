import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const send = read('supabase/functions/wa-send/index.ts'), graph = read('supabase/functions/_shared/wa-graph.ts'), media = read('supabase/functions/wa-media/index.ts'), cfg = read('supabase/config.toml');

test('wa-send: verify_jwt false in config, but the user JWT is validated and the database decides', () => {
  assert.match(cfg, /\[functions\.wa-send\]\nverify_jwt = false/); assert.match(cfg, /\[functions\.wa-media\]\nverify_jwt = false/);
  assert.match(send, /auth\.getUser\(\)/); assert.match(send, /Sign in again/); assert.match(send, /rpc\('crm_wa_send_context'/);
  assert.ok(send.indexOf('crm_wa_send_context') < send.indexOf('sendMessage('));
});
test('wa-send: the window rule runs before any network call and a closed window is a 409 from decideSend', () => {
  assert.ok(send.indexOf('decideSend(') < send.indexOf('sendMessage('));
  assert.ok(send.indexOf('decideSend(') < send.indexOf('uploadMedia('));
  assert.match(send, /return json\(req, \{ error: d\.error, code: d\.code \?\? null, window_open: !!ctx\.window_open \}, d\.status\)/);
});
test('wa-send: templates only from the list, every variable required, language checked', () => {
  assert.match(send, /templates\.find\(\(x\) => x\.name === String\(b\.template\.name\)\)/); assert.match(send, /That template is not on the list/);
  assert.match(send, /vars\.length !== t\.vars\.length/); assert.match(send, /normalizeLang\(b\.template\.lang\)/);
});
test('wa-send: never retries; unknown delivery is saved as unknown and reported', () => {
  assert.equal((send.match(/sendMessage\(/g) || []).length, 1);
  assert.match(send, /rec\(null, 'unknown'\)/); assert.match(send, /may or may not have been delivered/);
  assert.doesNotMatch(send + graph, /retry\(|for \(let attempt|while \(.*attempt/);
  assert.match(graph, /AbortSignal\.timeout/); assert.match(graph, /r\.status >= 500/);
});
test('wa-send: records the outgoing row with wa_message_id and status, as the staff sender', () => {
  assert.match(send, /rec\(r\.id, 'sent'\)/); assert.match(send, /p_sender: 'staff'/); assert.match(send, /wa_record_outbound/);
});
test('wa-media: on demand only, nothing stored, permission checked first', () => {
  assert.ok(media.indexOf('crm_wa_media_ok') < media.indexOf('fetchMedia('));
  assert.doesNotMatch(media + graph, /storage\.from|\.upload\(|from\('messages'\)/);
  assert.match(media, /no-store/);
});
test('no secret values in the new files', () => {
  for (const f of ['supabase/functions/wa-send/index.ts', 'supabase/functions/wa-media/index.ts', 'supabase/functions/_shared/wa-graph.ts', 'supabase/functions/_shared/wa-cloud.ts', 'supabase/migrations/20270106000000_wa_inbox.sql'])
    assert.doesNotMatch(read(f), /EAA[A-Za-z0-9]{20,}|sbp_[a-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}/, f);
});
