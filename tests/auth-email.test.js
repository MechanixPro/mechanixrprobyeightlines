const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Supabase auth hands login emails to our own function (sent through Resend from no-reply), with public sign-ups off', () => {
  const t = read('supabase/config.toml');
  assert.match(t, /enable_signup = false/);
  assert.match(t, /functions\/auth-email/); assert.match(read('docs/AUTH-EMAIL.md'), /functions\/v1\/auth-email/);
  assert.doesNotMatch(t, /re_[A-Za-z0-9]{10,}/); assert.doesNotMatch(t, /whsec_/);
  assert.match(read('supabase/functions/_shared/resend.ts'), /FROM_DEFAULT = 'Mechanix Pro <no-reply@mechanixpro\.in>'/);
});
test('the login code email template exists, shows the code placeholder and uses the brand', () => {
  const t = read('supabase/templates/otp.html');
  assert.match(t, /\{\{ \.Token \}\}/); assert.match(t, /#14295A/i); assert.match(t, /#F2801F/i); assert.doesNotMatch(t, /<script/i);
  assert.match(read('supabase/config.toml'), /content_path = "\.\/supabase\/templates\/otp\.html"/);
});
test('the admin login is password only, with Forgot password and a choose-a-new-password form, and no code login', () => {
  const js = read('admin/admin.js'), html = read('admin/index.html');
  assert.match(js, /signInWithPassword\(/); assert.match(js, /resetPasswordForEmail\(/); assert.match(js, /updateUser\(\{ password/); assert.match(js, /PASSWORD_RECOVERY/);
  assert.doesNotMatch(js, /signInWithOtp|verifyOtp/);
  assert.match(html, /id="forgot"/); assert.match(html, /id="resetForm"/); assert.match(html, /id="pw"[^>]*type="password"|type="password"[^>]*id="pw"/);
  assert.doesNotMatch(html, /id="sendCode"|id="code"|Email me a code|one-time-code/);
});
test('the Email sign-in provider stays on while public sign-ups stay off', () => {
  const fs = require('node:fs');
  const toml = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/config.toml'), 'utf8');
  assert.match(toml, /\[auth\]\s*\n[^\[]*enable_signup = false/);
  const email = toml.slice(toml.indexOf('[auth.email]'));
  assert.match(email.slice(0, email.indexOf('[auth.email.template')), /enable_signup = true/);
});
