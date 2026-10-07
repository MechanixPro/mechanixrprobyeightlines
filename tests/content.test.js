const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pages = () => {
  const out = ['index.html', '404.html', 'offline.html'];
  for (const d of fs.readdirSync(root)) { const f = path.join(d, 'index.html'); if (!['node_modules', 'dist-site', 'dist-admin', 'admin'].includes(d) && fs.existsSync(path.join(root, f))) out.push(f); }
  return out;
};
const sources = ['scripts/build_pages.py', 'assets/js/config.js', 'src/home.html', 'src/services.html', 'src/help.html', 'src/book.html', 'README.md'];

test('the contact email is hello@mechanixpro.in everywhere, never the old support address', () => {
  for (const f of [...pages(), ...sources]) assert.doesNotMatch(read(f), /support@mechanixpro\.in/, f);
  assert.match(read('contact/index.html'), /hello@mechanixpro\.in/);
  assert.match(read('index.html'), /hello@mechanixpro\.in/);
});
test('no Wikimedia photos or credits page remain', () => {
  for (const f of [...pages(), ...sources]) assert.doesNotMatch(read(f), /wikimedia|wikipedia|\/credits\/|assets\/img\/photos\//i, f);
  assert.equal(fs.existsSync(path.join(root, 'assets/img/photos')), false);
  assert.equal(fs.existsSync(path.join(root, 'credits')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/fetch_images.py')), false);
});
test('every image the pages reference exists on disk', () => {
  for (const f of pages()) for (const m of read(f).matchAll(/(?:src|href)="(\/assets\/[^"#?]+\.(?:svg|webp|png|jpg))"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), f + ' -> ' + m[1]);
});
test('the sitemap lists no removed page', () => assert.doesNotMatch(read('sitemap.xml'), /credits/));
