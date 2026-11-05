import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const css = read('assets/css/hero.css');
const hero = home.slice(home.indexOf('<section id="hero"'), home.indexOf('id="brief"'));
const scene = hero.slice(hero.indexOf('<figure class="hs'), hero.indexOf('</figure>') + 9);
const imgs = [...scene.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);

test('hero.css is linked from the home page only and stays small', () => {
  assert.match(home, /<link rel="stylesheet" href="\/assets\/css\/hero\.css(\?v=\w+)?">/);
  for (const f of ['book/index.html', 'help/index.html', 'car-service-bangalore/index.html', 'services/index.html']) assert.doesNotMatch(read(f), /hero\.css/, f);
  assert.ok(statSync(new URL('../assets/css/hero.css', import.meta.url)).size < 4500, 'hero.css budget 4,500 bytes');
  assert.ok(Buffer.byteLength(read('assets/css/site.css')) < 32000);
  assert.ok(Buffer.byteLength(home) < 41000);
});
test('the hero scene uses only workshop photos that exist, with the right sizes and loading', () => {
  assert.ok(imgs.length >= 5, 'three frames, the tool-wall card and the logo');
  for (const t of imgs) {
    const src = t.match(/src="([^"]+)"/)[1];
    assert.ok(existsSync(new URL('..' + src, import.meta.url)), src + ' exists');
    assert.match(t, /\balt="/, 'alt attribute on ' + src);
    assert.match(t, /\bwidth="\d+"/); assert.match(t, /\bheight="\d+"/);
    if (src.includes('/workshop/')) { assert.match(src, /^\/assets\/img\/workshop\/(workshop-front|workshop-street|tool-wall|bikes-in-service)-(600|1200)\.webp$/); assert.notEqual(t.match(/alt="([^"]*)"/)[1], '', 'photo alt text'); }
  }
  const photos = imgs.filter((t) => t.includes('/workshop/'));
  assert.match(photos[0], /workshop-front-1200\.webp/); assert.match(photos[0], /fetchpriority="high"/); assert.doesNotMatch(photos[0], /loading="lazy"/);
  for (const t of photos.slice(1)) { assert.match(t, /loading="lazy"/, t); assert.doesNotMatch(t, /fetchpriority/); }
  assert.equal(photos.filter((t) => /fetchpriority="high"/.test(t)).length, 1, 'only one eager image');
});
test('the cut-out with the hard right edge is not used raw in the hero', () => {
  assert.doesNotMatch(hero, /hero-minimal|hero-rain/);
  assert.doesNotMatch(css, /hero-minimal|hero-rain/);
});
test('branding, captions and the edit disclosure are in the scene', () => {
  assert.match(scene, /Our workshop, HSR Layout/);
  assert.match(scene, /Mechanix Pro<\/span>/);
  assert.match(scene, /<figcaption>Photos edited for privacy; signboard artwork\.<\/figcaption>/);
  assert.match(css, /var\(--acc\)/, 'orange accent line from the site tokens');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}\b/, 'colours come from site.css tokens, no new hex values');
});
test('the scene is bike-only: the car view hides it and keeps its list', () => {
  assert.match(scene, /^<figure class="hs bike-only"/);
  assert.match(hero, /<ul class="hero-list car-only"/);
  assert.match(read('assets/css/site.css'), /#veh-car:checked ~ \* \.bike-only\{display:none!important\}/);
  assert.match(css, /#veh-car:checked ~ \* \.hero-list\.car-only/);
});
test('motion is pure CSS and stops for reduced motion and reduced data', () => {
  assert.match(css, /@keyframes hs-b/); assert.match(css, /@keyframes hs-c/); assert.match(css, /@keyframes hs-kb/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\),\(prefers-reduced-data:reduce\)\{[^@]*animation:none!important[^@]*display:none/);
  assert.match(css, /@media\(prefers-reduced-data:reduce\)\{\.hs-s\{display:none!important\}\}/);
  const rot = [...css.matchAll(/rotate\((-?[\d.]+)deg\)/g)].map((m) => Math.abs(+m[1]));
  assert.ok(rot.length >= 2 && Math.max(...rot) <= 2, 'rotation at most 2 degrees');
});
test('CSP: no inline scripts, handlers or style attributes in the hero; no scripts added for it', () => {
  assert.doesNotMatch(hero, /<script|\son\w+=|\sstyle=/i);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/);
  assert.doesNotMatch(css, /expression\(|javascript:/i);
});
test('hero keeps the title, the three buttons and the toggle IDs', () => {
  assert.match(hero, /<h1 id="hero-h">Bike and car service at your home in Bengaluru\.<\/h1>/);
  assert.match(hero, /class="btn btn-wa btn-xl"[\s\S]*class="btn btn-call"[\s\S]*class="btn btn-ghost" href="\/book\/"/);
  assert.match(hero, /class="veh"/); assert.match(hero, /id="hero-h"/);
});
