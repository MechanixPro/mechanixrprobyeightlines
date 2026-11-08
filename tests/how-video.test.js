// The "See it in 12 seconds" video on the home page: light, no autoplay, honest about being AI-made, accessible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const size = (p) => fs.statSync(path.join(ROOT, p)).size;

test('the video and its poster are in the project and small enough for phones', () => {
  assert.ok(size('assets/video/how-it-works.mp4') < 3 * 1024 * 1024);
  assert.ok(size('assets/video/how-it-works-poster.webp') < 150 * 1024);
});
// Changed on purpose (owner's hero video): the home page now has ONE autoplay video, the muted hero loop (tests/hero.test.mjs covers it). Every other video stays muted tap-to-play, .
test('the home page has one muted autoplay hero loop; every other video is muted tap-to-play, ', () => {
  const all = read('index.html').match(/<video[^>]*>/g) || [];
  const hero = all.filter((v) => /class="hm-v"/.test(v)), vids = all.filter((v) => !/class="hm-v"/.test(v));
  assert.equal(hero.length, 1); assert.match(hero[0], /muted/); assert.match(hero[0], /autoplay/); assert.match(hero[0], /loop/); assert.match(hero[0], /playsinline/);
  assert.equal(vids.length, 5, 'the two oil-change videos in Our work, the welcome video, the apartment service day video and the garage partner video (all tap-to-play)');   // changed on purpose 2026-11-08: welcome and apartment videos added, then the garage partner video with sound
  vids.forEach((v) => { if (!/garage-partner-poster/.test(v)) assert.match(v, /muted/); assert.doesNotMatch(v, /autoplay/); assert.match(v, /preload="none"/); });   // the garage partner video is the one tap-to-play video that carries sound, so it is not muted
  assert.match(vids[0], /\bcontrols\b/);
});
test('the first play is recorded through the shared tags, with no personal data', () => {
  const j = read('assets/js/media.js');
  assert.match(j, /mxpTrack\('video_play'/); assert.doesNotMatch(j, /\bphone\b|\bemail\b|\bname\b/i);
  assert.match(read('index.html'), /assets\/js\/media\.js/);
});
test('the video is not on every page and the build ships it', () => {
  assert.doesNotMatch(read('book/index.html'), /<video/);
  assert.match(read('scripts/build_site.sh'), /cp -R "\$root\/assets"|assets/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/video/how-it-works.mp4')));
});
