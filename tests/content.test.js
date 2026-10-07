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
  for (const f of [...pages(), ...sources]) assert.doesNotMatch(read(f), /wikimedia|wikipedia|\/credits\//i, f);
  assert.equal(fs.existsSync(path.join(root, 'credits')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/fetch_images.py')), false);
});
test('every image the pages reference exists on disk', () => {
  for (const f of pages()) for (const m of read(f).matchAll(/(?:src|href)="(\/assets\/[^"#?]+\.(?:svg|webp|png|jpg))"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), f + ' -> ' + m[1]);
});
test('the sitemap lists no removed page', () => assert.doesNotMatch(read('sitemap.xml'), /credits/));

test('every page credits the free-licence images it was given (Freepik author and Vecteezy)', () => {
  for (const f of pages().filter((x) => x !== '404.html' && x !== 'offline.html')) {
    const h = read(f);
    assert.match(h, /Designed by <a href="http:\/\/www\.freepik\.com"[^>]*>macrovector \/ Freepik<\/a>/, f);
    assert.match(h, /<a href="https:\/\/www\.vecteezy\.com"[^>]*>Vecteezy<\/a>/, f);
  }
});
test('the licensed images are used where intended, with real alt text', () => {
  assert.match(read('index.html'), /photos\/cruiser-illustration\.webp/);
  assert.match(read('help/index.html'), /photos\/garage-illustration\.webp/);
  assert.match(read('services/index.html'), /photos\/oil-change\.webp/);
  for (const f of ['index.html', 'help/index.html', 'services/index.html']) for (const m of read(f).matchAll(/<img[^>]*photos\/[^>]*>/g)) assert.match(m[0], /alt="[^"]{12,}"/, m[0]);
});
test('the hero is the darker charcoal-to-navy look', () => assert.match(fs.readFileSync(path.join(root, 'assets/css/style.css'), 'utf8'), /\.hero\{[^}]*#0B1220/));

test('every page says brand names are used only to show which bikes are serviced, and that Mechanix Pro is independent', () => {
  for (const f of pages().filter((x) => x !== '404.html' && x !== 'offline.html')) {
    assert.match(read(f), /Brand and model names belong to their owners[^<]*independent service and is not affiliated with or endorsed by them\./, f);
  }
});
