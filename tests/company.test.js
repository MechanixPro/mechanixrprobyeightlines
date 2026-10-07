const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const co = JSON.parse(read('src/company.json'));
const pages = () => { const o = ['index.html']; for (const d of fs.readdirSync(root)) if (!['node_modules', 'dist-site', 'dist-admin', 'admin'].includes(d) && fs.existsSync(path.join(root, d, 'index.html'))) o.push(d + '/index.html'); return o; };
const gstCheck = (g) => { const c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let t = 0; for (let i = 0; i < 14; i++) { const v = c.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); } return c[(36 - (t % 36)) % 36]; };

test('the GSTIN has the right shape and a valid check digit', () => {
  assert.match(co.gstin, /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
  assert.equal(co.gstin.slice(0, 2), '29');
  assert.equal(gstCheck(co.gstin), co.gstin[14]);
});
test('the company record names the operator, the address in HSR Layout and the Bengaluru pincode', () => {
  assert.equal(co.legalName, 'NOVA VENTURES'); assert.equal(co.pincode, '560102'); assert.match(co.addressLines.join(' '), /Haralur Main Rd/); assert.match(co.addressLines.join(' '), /HSR Layout/);
});
test('no legal page keeps a fill-in-the-blank placeholder for the company', () => {
  for (const f of pages()) assert.doesNotMatch(read(f), /\[Registered business name\]|\[registered address\]|\[GSTIN\]|\[date\]|\[address\]/, f);
  assert.doesNotMatch(read('privacy/index.html'), /\[Name\]/);
});
test('Terms, Privacy and Contact name the operator, address and GSTIN', () => {
  for (const f of ['terms/index.html', 'privacy/index.html', 'contact/index.html']) {
    const h = read(f);
    assert.ok(h.includes('NOVA VENTURES'), f); assert.ok(h.includes('Haralur Main Rd'), f); assert.ok(h.includes('560102'), f); assert.ok(h.includes(co.gstin), f);
  }
  assert.match(read('terms/index.html'), /Last updated: 8 October 2026/); assert.match(read('privacy/index.html'), /Last updated: 8 October 2026/);
});
test('every page footer says Mechanix Pro is a brand of the company and shows the GSTIN', () => {
  for (const f of pages().filter((x) => x !== '404.html' && x !== 'offline.html')) {
    const h = read(f);
    assert.match(h, /Mechanix Pro is a brand of NOVA VENTURES/, f); assert.ok(h.includes(co.gstin), f); assert.ok(h.includes('Haralur Main Rd'), f);
  }
});
test('the Grievance Officer section names the company and an email, without inventing a person', () => {
  assert.match(read('privacy/index.html'), /Grievance Officer[\s\S]*NOVA VENTURES[\s\S]*hello@mechanixpro\.in/);
});
test('the email footer and the server copy of the company record match src/company.json', () => {
  const ts = read('supabase/functions/_shared/company.ts');
  for (const v of [co.legalName, co.city, co.state, co.pincode, co.gstin, ...co.addressLines]) assert.ok(ts.includes(v), v);
  const tpl = read('supabase/functions/_shared/email-templates.ts'); assert.match(tpl, /COMPANY/);
  const otp = read('supabase/templates/otp.html'); assert.ok(otp.includes('NOVA VENTURES')); assert.ok(otp.includes('560102'));
});
