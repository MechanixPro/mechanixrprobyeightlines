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
test('the home page no longer shows the video, and the video files stay in the project', () => {
  assert.doesNotMatch(read('index.html'), /<video/);
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
