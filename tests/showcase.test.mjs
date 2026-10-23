import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the home page leads with what we offer, then the entry points, in a clear order', () => {
  const home = read('../index.html');
  const ids = [...home.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  const at = (id) => ids.indexOf(id);
  assert.deepEqual(['diwali', 'why', 'needs', 'rsa', 'prices', 'addons-home', 'brief', 'rider-tools', 'every-job', 'trust', 'experience', 'home-faq', 'areas', 'partners'].map(at).every((v, i, a) => v > -1 && (i === 0 || v > a[i - 1])), true, ids.join(','));
  const why = home.match(/<div class="promo-grid">[\s\S]*?<\/section>/)[0];
  for (const href of ['/two-wheeler-service-at-home-bangalore/', '/scooty-repair-at-home-bangalore/', '/ev-and-petrol-bike-care-bangalore/', '/verified-bike-garages-bangalore/', '/digital-service-records/', '/doorstep-bike-and-car-repair-near-me/']) assert.ok(why.includes(`href="${href}"`), href);
  assert.ok(!ids.includes('services-all'), 'the duplicate services tiles are gone');
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
  assert.equal((hero.match(/<img [^>]*>/g) || []).filter((i) => /hero-activa/.test(i)).length, 1);
  assert.doesNotMatch(hero, /mo-grid|hero-strip/);
  assert.ok(readFileSync(new URL('../assets/img/hero-activa-p.webp', import.meta.url)).length > 20000);
});
test('the site pictures use the plate-covered versions only', () => {
  const home = read('../index.html');
  for (const m of home.matchAll(/assets\/img\/(stories\/[a-z-]+|hero-(?:roadside|repair|activa)[a-z-]*)\.webp/g)) assert.match(m[1], /-p$/, m[0]);
});
