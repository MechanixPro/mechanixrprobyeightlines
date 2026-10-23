import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the home page shows every service as a tile, with cars going to the partner page', () => {
  const home = read('../index.html');
  const b = home.match(/<div class="bento">[\s\S]*?<\/section>/)[0];
  for (const href of ['/book/', '/book/?service=repair', '/roadside/', '#addons-home', '/partners/axlio/', '/fleet/']) assert.ok(b.includes(`href="${href}"`), href);
});
test('the Axlio page says what Axlio does, attributes it, and links out safely', () => {
  const p = read('../partners/axlio/index.html');
  assert.match(p, /run separately by Bushra Automobiles/);
  assert.match(p, /Jayanagar/); assert.match(p, /30 minutes/); assert.match(p, /Periodic service/);
  for (const a of p.match(/<a [^>]*href="https:\/\/axlio\.in[^"]*"[^>]*>/g)) assert.match(a, /rel="noopener"/);
  assert.doesNotMatch(p, /Eightlines/);
});
test('the phone bar has fixed-height buttons so it never stretches', () => {
  const css = read('../assets/css/style.css');
  assert.match(css, /\.mbar \.btn\{[^}]*height:48px/);
});
test('the phone bar is toggled with its own class, not the .show class of the image showcase', () => {
  assert.match(read('../assets/js/app.js'), /mb\.classList\.toggle\('on'/);
  assert.match(read('../assets/css/style.css'), /\.mbar\.on\{transform:none\}/);
});
test('the experience cards use only our own Instagram creatives, with no prices baked in, and say what they are', () => {
  const home = read('../index.html');
  const sec = home.match(/<section id="experience"[\s\S]*?<\/section>/)[0];
  assert.equal((sec.match(/<img /g) || []).length, 6);
  for (const img of sec.match(/<img [^>]*>/g)) { assert.match(img, /width="480" height="640"/); assert.match(img, /alt="Scene from our Instagram:/); }
  assert.match(sec, /not a specific customer or job/);
  assert.match(sec, /rel="me noopener"/);
});
test('key pages have a link-preview card of their own, and the files exist', () => {
  for (const [page, card] of [['services', 'services'], ['roadside', 'roadside'], ['join', 'join'], ['partners/axlio', 'axlio'], ['help', 'how'], ['areas', 'areas'], ['offers/diwali-ready', 'diwali']]) {
    assert.match(read(`../${page}/index.html`), new RegExp(`og:image" content="https://mechanixpro.in/assets/img/og/${card}\\.jpg"`), page);
    assert.ok(readFileSync(new URL(`../assets/img/og/${card}.jpg`, import.meta.url)).length > 10000, card);
  }
});
test('the hero has one cut-out picture, not a grid of tiles', () => {
  const h = read('../index.html');
  const hero = h.slice(h.indexOf('<section class="hero">'), h.indexOf('</section>'));
  assert.equal((hero.match(/<img [^>]*>/g) || []).filter((i) => /hero-roadside/.test(i)).length, 1);
  assert.doesNotMatch(hero, /mo-grid|hero-strip/);
  assert.ok(readFileSync(new URL('../assets/img/hero-roadside.webp', import.meta.url)).length > 20000);
});
