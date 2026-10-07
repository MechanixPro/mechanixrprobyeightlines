const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const site = JSON.parse(read('src/site.json'));
const pages = () => { const o = ['index.html']; for (const d of fs.readdirSync(root)) if (!['node_modules', 'dist-site', 'dist-admin', 'admin'].includes(d) && fs.existsSync(path.join(root, d, 'index.html'))) o.push(d + '/index.html'); return o.filter((f) => f !== '404.html'); };
const sources = ['src/home.html', 'src/help.html', 'src/services.html', 'src/help.jsonld', 'scripts/build_pages.py', 'assets/js/app.js', 'admin/admin.js', 'supabase/functions/_shared/ai.ts', 'supabase/functions/_shared/email-templates.ts', 'README.md'];

test('the checkup and quote fee is 349, and the repair or problem check costs the same', () => {
  assert.equal(site.advance, 349); assert.equal(site.services.repair.price, 349);
});
test('the old "booking advance" wording is gone everywhere: it is the checkup and quote fee', () => {
  for (const f of [...pages(), ...sources]) assert.doesNotMatch(read(f), /booking advance|₹\s?199 advance|Advance and final payments/i, f);
});
test('customers are told the fee is for the checkup and quote and is adjusted in the final bill if they go ahead', () => {
  const h = read('help/index.html');
  assert.match(h, /checkup and quote fee/i); assert.match(h, /adjusted in your final bill if you go ahead/i);
  assert.match(read('terms/index.html'), /checkup and quote fee[\s\S]{0,90}adjusted in your final bill if you go ahead/i);
  assert.match(read('refund-policy/index.html'), /checkup and quote/i);
  assert.match(read('assets/js/app.js'), /checkup and quote fee/i);
  assert.match(read('supabase/functions/_shared/ai.ts'), /checkup and quote fee/i);
});
test('the confirmation email explains the fee when it is known', () => {
  const t = read('supabase/functions/_shared/email-templates.ts');
  assert.match(t, /checkupFee/); assert.match(t, /checkup and quote fee/i);
});
test('parts are OEM certified and mechanics are Mechanix Pro certified, said plainly on the key pages', () => {
  for (const f of ['index.html', 'services/index.html', 'help/index.html']) { const h = read(f); assert.match(h, /OEM[- ]certified parts/i, f); }
  for (const f of ['index.html', 'help/index.html']) assert.match(read(f), /Mechanix Pro[- ]certified mechanic/i, f);
  assert.match(read('terms/index.html'), /OEM[- ]certified/i);
  assert.match(read('supabase/functions/_shared/ai.ts'), /OEM[- ]certified/i);
});
test('there is no vague "certified mechanic" left without saying who certified them', () => {
  for (const f of pages()) { const h = read(f).replace(/Mechanix Pro[- ]certified/gi, ''); assert.doesNotMatch(h, /(^|[^-])\b[Cc]ertified mechanic/, f); }
});
