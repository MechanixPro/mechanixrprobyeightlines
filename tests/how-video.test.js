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
test('the home page shows the video with controls, a poster, no autoplay, and loads nothing until played', () => {
  const h = read('index.html');
  assert.match(h, /id="video"/);
  const v = h.match(/<video[^>]*>/)[0];
  assert.match(v, /controls/); assert.match(v, /preload="none"/); assert.match(v, /playsinline/); assert.match(v, /poster="\/assets\/video\/how-it-works-poster\.webp"/);
  assert.doesNotMatch(v, /autoplay|loop/); assert.match(v, /width="1280"/); assert.match(v, /height="720"/);
  assert.match(h, /<source src="\/assets\/video\/how-it-works\.mp4" type="video\/mp4">/);
});
test('the page says the video is an AI illustration and describes it in words', () => {
  const h = read('index.html');
  assert.match(h, /made with AI/i); assert.match(h, /not a real customer or mechanic/i);
  assert.match(h, /Quote first\. Work after your OK\./);
  assert.match(h, /aria-label="[^"]*video/i);
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
