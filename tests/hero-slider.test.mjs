import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const S = require('../assets/js/hero-slider.js');
const home = read('index.html');
const js = read('assets/js/hero-slider.js');
const css = read('assets/css/hero.css');
const media = home.slice(home.indexOf('<figure class="hero-media"'), home.indexOf('</figure>') + 9);
const sets = [...media.matchAll(/<div class="hs (bike|car)-only"[^>]*>([\s\S]*?)<\/div><\/div>(?=\s*(<div class="hs |<\/figure>))/g)];
const set = (k) => sets.find((m) => m[1] === k);

test('markup: a bike carousel with 5 slides and a car carousel with 2, each a labelled region', () => {
  assert.equal(sets.length, 2);
  for (const k of ['bike', 'car']) assert.match(media, new RegExp('<div class="hs ' + k + '-only" role="region" aria-roledescription="carousel" aria-label="[^"]{10,}"'));
  const b = set('bike')[0], c = set('car')[0];
  assert.equal((b.match(/class="hs-slide/g) || []).length, 5); assert.equal((c.match(/class="hs-slide/g) || []).length, 2);
  for (const [grp, n] of [[b, 5], [c, 2]]) for (let i = 1; i <= n; i++) assert.ok(grp.includes(`role="group" aria-roledescription="slide" aria-label="${i} of ${n}"`), `${i} of ${n}`);
});
test('markup: bike order is video, hero-quote, hero-road, hero-team, hero-delivery; car is hero-car then car-closeup', () => {
  const order = (g) => [...g.matchAll(/<video\b|data-src="\/assets\/img\/hero\/([\w-]+?)-\d+\.webp"/g)].map((m) => m[1] || 'video');
  assert.deepEqual(order(set('bike')[0]), ['video', 'hero-quote', 'hero-road', 'hero-team', 'hero-delivery']);   // changed on purpose 2026-11-09: the four picture slides are the owner's new Indian-character art
  assert.deepEqual(order(set('car')[0]), ['hero-car', 'car-closeup']);
  assert.match(set('bike')[0], /poster="\/assets\/img\/hero\/hero-garage-poster\.webp"[^>]*>\s*<source src="\/assets\/video\/hero-garage\.mp4"/);
});
test('markup: only the first slide is eager (the video poster); the pictures carry data-src, sized, honest alt text, existing files', () => {
  const imgs = [...media.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 6);
  for (const t of imgs) {
    assert.doesNotMatch(t, /\ssrc=|\ssrcset=|fetchpriority|loading="eager"/, 'no eager picture in the carousel markup');
    assert.match(t, /data-src="[^"]+"/); assert.match(t, /data-srcset="[^"]+"/); assert.match(t, /\bwidth="\d+"/); assert.match(t, /\bheight="\d+"/);
    const alt = t.match(/\balt="([^"]{25,})"/); assert.ok(alt, 'alt text'); assert.doesNotMatch(alt[1], /illustration/i);
    for (const m of t.matchAll(/\/assets\/img\/hero\/[\w-]+\.webp/g)) assert.ok(existsSync(new URL('..' + m[0], import.meta.url)), m[0]);
  }
  assert.doesNotMatch(media, /Illustration|hm-ill/);
  // only the first bike slide is on, and the preload in <head> is still the video poster only
  assert.equal((set('bike')[0].match(/hs-slide is-on/g) || []).length, 1); assert.equal((set('car')[0].match(/hs-slide is-on/g) || []).length, 1);
  assert.equal((home.match(/rel="preload" as="image"/g) || []).length, 1); assert.match(home, /rel="preload" as="image" href="\/assets\/img\/hero\/hero-garage-poster\.webp"/);
});
test('script is loaded with defer, no inline script, no handlers or style attributes in the hero', () => {
  assert.match(home, /<script src="\/assets\/js\/hero-slider\.js(\?v=\w+)?" defer><\/script>/);
  assert.doesNotMatch(media, /<script|\son\w+=|\sstyle=/i);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|https?:\/\/|localStorage|document\.cookie/);
});
test('the script handles reduced motion, data saving, hover/focus/touch, hidden tab, off screen, pause button, swipe; controls have labels', () => {
  assert.match(js, /prefers-reduced-motion: reduce/); assert.match(js, /saveData/); assert.match(js, /visibilitychange/); assert.match(js, /IntersectionObserver/);
  assert.match(js, /touchstart/); assert.match(js, /touchend/); assert.match(js, /mouseenter/); assert.match(js, /focusin/); assert.match(js, /ArrowRight/);
  for (const l of ['Previous picture', 'Next picture', 'Pause moving pictures', 'Play moving pictures', 'Picture controls']) assert.ok(js.includes(l), l);
  assert.match(js, /aria-live/); assert.match(js, /hs-still/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.hs-slide/); assert.match(css, /:focus-visible/); assert.match(css, /animation:hs-fill 6s linear/);
  assert.equal(S.DWELL_MS, 6000);
  assert.match(read('assets/js/hero-video.js'), /hs-slide:not\(\.is-on\)/, 'the video stays paused while another slide shows');
});
test('car and bike sets switch with the existing radios (CSS), and the toggle markup and copy are unchanged', () => {
  assert.match(media, /class="hs bike-only"/); assert.match(media, /class="hs car-only"/);
  assert.match(home, /<input class="veh-in" type="radio" name="vehicle" id="veh-bike" value="bike" form="hero-book" checked>/);
  assert.match(js, /\.veh-in/);
  assert.match(home, /<h1 id="hero-h">Bike and car service at your door in Bengaluru\.<\/h1>/);
});
test('state logic: next, prev and go wrap around and never mutate', () => {
  const s = S.create(5, true); assert.equal(s.i, 0);
  assert.equal(S.next(s).i, 1); assert.equal(s.i, 0);
  assert.equal(S.prev(s).i, 4); assert.equal(S.next(S.go(s, 4)).i, 0);
  assert.equal(S.go(s, 7).i, 2); assert.equal(S.go(s, -1).i, 4);
  assert.equal(S.create(0, true).n, 1);
});
test('state logic: playing only when auto and nothing holds it; holds stack and release', () => {
  let s = S.create(5, true); assert.equal(S.playing(s), true);
  s = S.hold(s, 'hover', true); assert.equal(S.playing(s), false); assert.equal(S.held(s), true);
  s = S.hold(s, 'hidden', true); s = S.hold(s, 'hover', false); assert.equal(S.playing(s), false, 'hidden tab still holds');
  s = S.hold(s, 'hidden', false); assert.equal(S.playing(s), true);
  assert.equal(S.playing(S.create(5, false)), false, 'reduced motion or data saver: never plays');
  assert.equal(S.playing(S.create(1, true)), false, 'one slide never plays');
  assert.equal(S.playing(S.hold(S.go(S.create(5, true), 3), 'manual', true)), false);
});
test('state logic: the video plays only on slide 1 while visible; near() names the shown and next slide; swipe direction', () => {
  let s = S.create(5, true); assert.equal(S.wantsVideo(s, 0), true);
  assert.equal(S.wantsVideo(S.next(s), 0), false);
  assert.equal(S.wantsVideo(S.hold(s, 'hidden', true), 0), false); assert.equal(S.wantsVideo(S.hold(s, 'offscreen', true), 0), false);
  assert.deepEqual(S.near(s), [0, 1]); assert.deepEqual(S.near(S.go(s, 4)), [4, 0]);
  assert.equal(S.swipe(-80, 5), 1); assert.equal(S.swipe(80, 5), -1); assert.equal(S.swipe(10, 0), 0); assert.equal(S.swipe(-60, 90), 0);
});
