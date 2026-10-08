const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SERVICES = { 'car-service': 'car', 'e-challan-services': 'echallan', 'ai-pdi-reports': 'pdi', 'ai-damage-analysis': 'damage', 'bike-rental': 'rental', 'oem-parts': 'oem', 'insurance-claim-service': 'insurance', 'franchise': 'franchise' };

test('there is an overview page with every service and the early-bird form', () => {
  const h = read('coming-soon/index.html');
  assert.equal((h.match(/<h1/g) || []).length, 1); assert.equal((h.match(/<a class="soon-card/g) || []).length, 8);
  assert.match(h, /id="waitlistForm"/); assert.equal((h.match(/name="wl-interest"/g) || []).length, 8); assert.match(h, /canonical/);
});
test('each service has its own page where the visitor shows their interest', () => {
  const titles = new Set();
  for (const [slug, id] of Object.entries(SERVICES)) {
    const h = read(`coming-soon/${slug}/index.html`);
    assert.equal((h.match(/<h1/g) || []).length, 1, slug);
    const title = h.match(/<title>(.*?)<\/title>/)[1]; assert.ok(!titles.has(title), 'duplicate title ' + slug); titles.add(title);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://[^"]+/coming-soon/${slug}/"`));
    assert.match(h, new RegExp(`id="waitlistForm"[^>]*data-preselect="${id}"`)); assert.match(h, /Coming soon/); assert.match(h, /name="wl-interest"/);
    assert.equal((h.match(/class="soon-feature reveal"/g) || []).length, 3, slug + ' features'); assert.equal((h.match(/class="soon-step reveal"/g) || []).length, 3, slug + ' steps');
    assert.ok((h.match(/href="\/coming-soon\/[a-z-]+\/"/g) || []).length >= 7, slug + ' links to the others');
    assert.match(read('sitemap.xml'), new RegExp(`/coming-soon/${slug}/`));
  }
});
test('bike rental names Eightlines Fleet Private Limited as its backer, and no other page does', () => {
  assert.match(read('coming-soon/bike-rental/index.html'), /Backed by Eightlines Fleet Private Limited/);
  assert.doesNotMatch(read('coming-soon/car-service/index.html'), /Eightlines/);
  assert.doesNotMatch(read('coming-soon/franchise/index.html'), /Eightlines/);
});
test('the pages are lively but calm: icons draw in, glow and float, with reduced motion respected', () => {
  const css = read('assets/css/style.css'); const i = css.indexOf('/* coming soon pages');
  assert.ok(i > 0); for (const k of ['@keyframes soonDraw', '@keyframes soonFloat', '@keyframes soonGlow', '@keyframes soonUp']) assert.ok(css.includes(k), k);
  assert.match(css.slice(i), /prefers-reduced-motion/);
});
test('the form on a service page ticks that service and records which page it came from', () => {
  const js = read('assets/js/waitlist.js');
  assert.match(js, /dataset\.preselect/); assert.match(js, /source:/); assert.match(js, /page:/);
  assert.match(read('supabase/functions/join-waitlist/index.ts'), /source/);
});
test('the build publishes the coming-soon pages and reveals content as it scrolls into view', () => {
  assert.match(read('scripts/build_site.sh'), /coming-soon/); assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets/js/reveal.js')));
  assert.match(read('index.html'), /reveal\.js/);
});
