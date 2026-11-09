// About page (story chapters) and the home "On the job, in pictures" strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('/about/ has seven chapters in order, a chapter nav, real figures and no invented claims', () => {
  const full = read('about/index.html'), h = full.slice(full.indexOf('<div class="ab">'), full.indexOf('</main>'));   // the story itself, without the shared header and footer
  assert.deepEqual([...h.matchAll(/<span class="num">Chapter (\d)<\/span>/g)].map((m) => m[1]), ['1', '2', '3', '4', '5', '6', '7']);
  for (const id of ['question', 'worries', 'built', 'people', 'honest', 'city', 'partners']) { assert.match(h, new RegExp('<section class="ab-ch" id="' + id + '"')); assert.match(h, new RegExp('href="#' + id + '"')); }
  const pins = Object.keys(JSON.parse(read('src/pincodes.json')).pins).length;
  assert.ok(h.includes(`<b>${pins}</b><span>Bengaluru PIN codes we serve`));
  assert.doesNotMatch(h, /guarantee|100%|insured|since 20\d\d|founded|years of experience|\d{2,},?\d{3}\+/i);
  assert.match(h, /illustrations created for Mechanix Pro/);
  assert.match(read('sitemap.xml'), /\/about\//); assert.match(read('index.html'), /href="\/about\/"/);
});
test('/about/ images exist and carry alt text', () => {
  const full = read('about/index.html'), h = full.slice(full.indexOf('<div class="ab">'), full.indexOf('</main>'));
  for (const m of h.matchAll(/<img[^>]*\bsrc="(\/assets\/[^"?]+)[^>]*>/g)) { assert.ok(existsSync(new URL('..' + m[1], import.meta.url)), m[1]); assert.match(m[0], /\balt="[^"]{20,}"/); }
});
test('home: twelve vertical story cards (owner pictures, changed on purpose from eight), lazy, 9:16, alt text, real files, no old caption', () => {
  const h = read('index.html');
  const cards = [...h.matchAll(/<li class="reel"><img src="(\/assets\/img\/reels\/[a-z]+\.webp)[^"]*" width="540" height="960" loading="lazy"[^>]*alt="([^"]{20,})"/g)];
  assert.equal(cards.length, 12);
  for (const c of cards) assert.ok(existsSync(new URL('..' + c[1], import.meta.url)), c[1]);
  assert.match(h, /id="pictures"/); assert.doesNotMatch(h, /Example photos of each model, not customers/);
  assert.match(h, /href="\/terms\/#credits"/, 'credits link stays in the footer');
});
test('reel images are sharp enough: 540x960 webp under 130 KB each', async () => {
  const { statSync } = await import('node:fs');
  for (const n of ['collage', 'quote', 'selfie', 'code', 'car', 'rating', 'society', 'owner']) assert.ok(statSync(new URL(`../assets/img/reels/${n}.webp`, import.meta.url)).size < 130000, n);
});
