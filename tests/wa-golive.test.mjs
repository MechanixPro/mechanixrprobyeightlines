import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sh = read('scripts/set_wa_cloud_secrets.sh'), doc = read('docs/GO-LIVE-WA-CLOUD.md');

test('secrets script: hidden input for every secret, never echoes a value, npx fallback, right project, owner confirmation', () => {
  for (const n of ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'WA_GRAPH_VERSION']) assert.match(sh, new RegExp(n));
  assert.match(sh, /read -r -s v/); assert.match(sh, /command -v npx/); assert.match(sh, /npx supabase/);
  assert.match(sh, /secrets set --env-file "\$tmp" --project-ref "\$REF" --yes/); assert.match(sh, /REF="mejdxsbpyscujpvbwvmg"/);
  assert.match(sh, /Type yes/); assert.match(sh, /rm -f "\$tmp"/); assert.match(sh, /chmod 600/);
  assert.doesNotMatch(sh, /echo "?\$v|echo "?\$\{?v|printf '%s\\n' "\$v"|set -x|--debug/);
  assert.doesNotMatch(sh, /EAA[A-Za-z0-9]{20,}/); assert.ok(statSync(new URL('../scripts/set_wa_cloud_secrets.sh', import.meta.url)).mode & 0o100);
});
test('go-live doc: this number, the callback URL, the permissions, the secrets, the test checklist and rollback', () => {
  for (const s of ['+91 83106 21498', 'https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/whatsapp-webhook', 'whatsapp_business_messaging', 'whatsapp_business_management', 'System users', 'Phone number ID', 'WABA ID', 'CLOUD_API',
    'WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'scripts/set_wa_cloud_secrets.sh', 'whatsapp-webhook', 'wa-send', 'wa-media', '20270106000000_wa_inbox.sql', '**messages**', 'Message in', 'Voice note', 'Template', 'Ticks', 'Window closed', 'wa_ai_auto', '+91 83106 21498'])
    assert.ok(doc.includes(s), s);
  assert.doesNotMatch(doc, /EAA[A-Za-z0-9]{20,}|sbp_[a-z0-9]{20,}/);
});
