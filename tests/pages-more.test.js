const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const photos = Object.keys(JSON.parse(read('src/model-photos.json')));

test('one page per photographed model, in the right folder', () => {
  const dirs = fs.readdirSync(path.join(root, 'bike-service')).filter((d) => fs.existsSync(path.join(root, 'bike-service', d, 'index.html')));
  assert.equal(dirs.length, photos.length);
  assert.ok(dirs.includes('honda-activa-6g'));
});
test('model pages have unique titles and descriptions, a canonical link, JSON-LD and a book link that preselects the bike', () => {
  const titles = new Set(), descs = new Set();
  for (const slug of photos) {
    const h = read(`bike-service/${slug}/index.html`);
    const t = h.match(/<title>(.*?)<\/title>/)[1], d = h.match(/<meta name="description" content="(.*?)"/)[1];
    assert.ok(!titles.has(t), 'dup title ' + t); assert.ok(!descs.has(d), 'dup description ' + slug); titles.add(t); descs.add(d);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://[^"]+/bike-service/${slug}/"`));
    assert.match(h, /"@type": "AutoRepair"/); assert.match(h, /href="\/book\/\?brand=[^"&]+&amp;model=/);
    assert.equal((h.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(h, /\{\{/);
  }
});
test('electric model pages do not talk about engine oil, and big bikes mention the surcharge', () => {
  const ev = read('bike-service/ola-electric-s1-pro/index.html');
  assert.doesNotMatch(ev.replace(/no engine oil[^<]*/gi, ''), /engine oil/i);
  const big = read('bike-service/honda-cb300r/index.html');
  assert.match(big, /above 180cc/);
});
test('model pages credit the photographer and are in the sitemap', () => {
  const h = read('bike-service/honda-activa-6g/index.html');
  assert.match(h, /Alka/); assert.match(h, /CC BY-SA 4\.0/);
  assert.match(read('sitemap.xml'), /\/bike-service\/honda-activa-6g\//);
});
test('fleet and societies pages exist, open WhatsApp with their own message, and are in the sitemap', () => {
  for (const s of ['fleet', 'societies']) {
    const h = read(`${s}/index.html`);
    assert.match(h, /data-wa-text=/); assert.equal((h.match(/<h1/g) || []).length, 1);
    assert.match(read('sitemap.xml'), new RegExp(`/${s}/`));
  }
  assert.match(read('assets/js/page.js'), /data-wa-text/);
});
test('the build copies the new folders to the public site', () => {
  const sh = read('scripts/build_site.sh');
  for (const d of ['bike-service', 'fleet', 'societies']) assert.ok(sh.includes(d), d);
});
