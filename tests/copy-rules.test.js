const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const site = JSON.parse(read('src/site.json'));
const pages = () => { const o = ['index.html']; for (const d of fs.readdirSync(root)) if (!['node_modules', 'dist-site', 'dist-admin', 'dist-crm', 'admin', 'crm', 'garage', 'mechanic'].includes(d) && fs.existsSync(path.join(root, d, 'index.html'))) o.push(d + '/index.html'); return o.filter((f) => f !== '404.html'); };
const sources = ['src/home.html', 'src/help.html', 'src/services.html', 'src/help.jsonld', 'scripts/build_pages.py', 'assets/js/app.js', 'admin/admin.js', 'supabase/functions/_shared/ai.ts', 'supabase/functions/_shared/email-templates.ts', 'README.md'];

test('the checkup and quote fee is set in the admin and is a positive number', () => {
  assert.ok(site.advance > 0); assert.ok(site.services.repair.price > 0); // the owner sets these in the admin Prices tab
});
test('the old "booking advance" wording is gone everywhere: it is the checkup and quote fee', () => {
  for (const f of [...pages(), ...sources]) assert.doesNotMatch(read(f), /booking advance|₹\s?199 advance|Advance and final payments/i, f);
});
test('customers are told about the small confirmation fee (Rs 49 to Rs 99 by engine size), shown before paying and adjusted in the final bill', () => {
  const rule = /a small confirmation fee, ₹49 to ₹99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill/;
  assert.match(read('help/index.html'), rule);
  assert.match(read('index.html'), rule);
  assert.match(read('terms/index.html'), /confirmation fee is a small amount, ₹49 to ₹99 depending on your vehicle's engine size[\s\S]{0,160}adjusted in your final bill if you go ahead/i);
  assert.match(read('refund-policy/index.html'), /Your confirmation fee is refunded in full/i);
  assert.match(read('assets/js/app.js'), /a small confirmation fee, ₹49 to ₹99/);
  // backend wording (the WhatsApp assistant prompt) is outside the public pages; it still names the old fee and is tracked in docs/LEGAL-REVIEW-FEE-WORDING.md
  assert.match(read('supabase/functions/_shared/ai.ts'), /checkup and quote fee/i);
});
test('the confirmation email explains the fee when it is known', () => {
  const t = read('supabase/functions/_shared/email-templates.ts');
  assert.match(t, /checkupFee/); assert.match(t, /checkup and quote fee/i);
});
test('parts are OEM or aftermarket and mechanics are Mechanix Pro certified, said plainly on the key pages', () => {
  for (const f of ['index.html', 'services/index.html', 'help/index.html']) { const h = read(f); assert.match(h, /OEM and aftermarket parts/i, f); }
  for (const f of ['index.html', 'help/index.html']) assert.match(read(f), /Mechanix Pro[- ]certified mechanic/i, f);
  assert.match(read('terms/index.html'), /OEM or aftermarket/i);
  assert.match(read('supabase/functions/_shared/ai.ts'), /OEM or aftermarket/i);
});
test('there is no vague "certified mechanic" left without saying who certified them', () => {
  for (const f of pages()) { const h = read(f).replace(/Mechanix Pro[- ]certified/gi, ''); assert.doesNotMatch(h, /(^|[^-])\b[Cc]ertified mechanic/, f); }
});
