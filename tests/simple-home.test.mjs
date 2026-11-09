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
test('the old Instagram strip is gone; the only Instagram link or handle is the credit under the experience cards', () => {
  const rest = body.replace(/<section id="experience"[\s\S]*?<\/section>/, '');
  assert.doesNotMatch(rest, /instagram\.com|@themechanixpro/i);
});
test('the two owner-confirmed numbers stay, in one short line', () => {
  assert.match(body, /106 PIN codes served/); assert.match(body, /Mechanix Shield: up to ₹5,000/);   // changed on purpose 2026-11-09 (assumed figures removed)
});
test('no helper character is loaded on any page', () => {
  for (const f of ['index.html', 'book/index.html', 'services/index.html', 'offers/bike-service/index.html']) {
    const h = read(f); assert.doesNotMatch(h, /assets\/js\/pro\.js/); assert.doesNotMatch(h, /assets\/js\/pro-script\.js/); assert.doesNotMatch(h, /assets\/js\/sphere\.js/);
  }
});
test('the home page no longer loads the slideshow script', () => {
  assert.doesNotMatch(home, /assets\/js\/showcase\.js/);
});
