import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const body = home.slice(home.indexOf('<main'), home.indexOf('</main>'));

test('the home page is short: only the sections that help someone book', () => {
  const ids = [...body.matchAll(/<section[^>]*id="([a-z-]+)"/g)].map((m) => m[1]);
  for (const gone of ['showcase', 'brands', 'video', 'stories', 'coming-soon']) assert.ok(!ids.includes(gone), gone + ' removed');
  for (const kept of ['prices', 'trust', 'brief', 'areas']) assert.ok(ids.includes(kept), kept + ' kept');
});
test('the Instagram strip is gone from the home page', () => {
  assert.doesNotMatch(body, /instagram/i);
});
test('WhatsApp is the first and main button in the home hero', () => {
  const hero = body.slice(body.indexOf('<section class="hero">'), body.indexOf('</section>'));
  assert.ok(hero.indexOf('btn-wa') > -1 && hero.indexOf('btn-wa') < hero.indexOf('Build your service'));
});
test('the two owner-confirmed numbers stay, in one short line', () => {
  assert.match(body, /10,000\+ services done/); assert.match(body, /1,300\+ gated communities trust us/);
});
test('no helper character is loaded on any page', () => {
  for (const f of ['index.html', 'book/index.html', 'services/index.html', 'offers/bike-service/index.html']) {
    const h = read(f); assert.doesNotMatch(h, /assets\/js\/pro\.js/); assert.doesNotMatch(h, /assets\/js\/pro-script\.js/); assert.doesNotMatch(h, /assets\/js\/sphere\.js/);
  }
});
test('the home page no longer loads the slideshow script', () => {
  assert.doesNotMatch(home, /assets\/js\/showcase\.js/);
});
test('the areas block is one short block: the PIN checker and a link, not a long list', () => {
  const a = body.slice(body.indexOf('id="areas"'), body.indexOf('</section>', body.indexOf('id="areas"')));
  assert.match(a, /data-pincheck/); assert.ok((a.match(/<a /g) || []).length <= 3);
});
