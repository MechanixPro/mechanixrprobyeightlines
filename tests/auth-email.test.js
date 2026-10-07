const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Supabase auth sends its emails through Resend from the no-reply address, with public sign-ups off', () => {
  const t = read('supabase/config.toml');
  assert.match(t, /enable_signup = false/);
  assert.match(t, /\[auth\.email\.smtp\]/); assert.match(t, /host = "smtp\.resend\.com"/); assert.match(t, /user = "resend"/);
  assert.match(t, /pass = "env\(RESEND_API_KEY\)"/); assert.match(t, /admin_email = "no-reply@mechanixpro\.in"/);
  assert.doesNotMatch(t, /re_[A-Za-z0-9]{10,}/);
});
test('the login code email template exists, shows the code placeholder and uses the brand', () => {
  const t = read('supabase/templates/otp.html');
  assert.match(t, /\{\{ \.Token \}\}/); assert.match(t, /#14295A/i); assert.match(t, /#F2801F/i); assert.doesNotMatch(t, /<script/i);
  assert.match(read('supabase/config.toml'), /content_path = "\.\/supabase\/templates\/otp\.html"/);
});
test('the admin login offers an email code and checks it, without creating new users', () => {
  const js = read('admin/admin.js');
  assert.match(js, /signInWithOtp\(\{[^}]*shouldCreateUser: false/);
  assert.match(js, /verifyOtp\(\{[^}]*type: 'email'/);
  const html = read('admin/index.html');
  assert.match(html, /id="sendCode"/); assert.match(html, /id="code"[^>]*inputmode="numeric"/);
});
