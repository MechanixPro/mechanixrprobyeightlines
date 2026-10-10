// The hand-off document must exist, point to the right places, and never contain a secret.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/PROJECT-MEMORY.md'), 'utf8');

test('the memory document covers the business facts, deploy commands, ads setup and open items', () => {
  for (const k of ['NOVA VENTURES', '29DVCPR0895G1Z3', 'npm test', 'wrangler pages deploy', 'supabase', 'AW-18504366564', 'Open items', 'WhatsApp']) assert.ok(doc.includes(k), k);
});
test('the memory document holds no secrets or keys', () => {
  assert.doesNotMatch(doc, /AIza[\w-]{20,}/); // a Google key
  assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{20,}/); // a JWT, such as a Supabase key
  assert.doesNotMatch(doc, /\bsk-[A-Za-z0-9]{16,}/); // an API secret
  assert.doesNotMatch(doc, /re_[A-Za-z0-9]{16,}/); // a Resend key
  assert.doesNotMatch(doc, /postgres(ql)?:\/\/[^\s]*:[^\s@]+@/); // a database URL with a password
});
test('CLAUDE.md points new sessions to the memory document', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'), /docs\/PROJECT-MEMORY\.md/);
});
