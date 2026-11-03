import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the booking demo video is on the home and help pages, starts only when tapped and loads nothing until then', () => {
  for (const p of ['index.html', 'help/index.html']) {
    const t = read(p), v = t.match(/<video[^>]*how-to-book[^>]*>|<video[^>]*>(?=\s*<source src="\/assets\/video\/how-to-book\.mp4")/)?.[0] ?? '';
    assert.ok(v, p + ' has the demo video');
    for (const need of ['controls', 'muted', 'playsinline', 'preload="none"', 'width="540"', 'height="960"', 'poster="/assets/img/how-to-book-poster.jpg"', 'aria-label=']) assert.ok(v.includes(need), p + ' video: ' + need);
    assert.doesNotMatch(v, /\bautoplay\b/, p + ' must not autoplay');
    assert.ok(t.includes('Pick your bike.') && t.includes('Add your area.'), p + ' writes the steps out as text');
  }
});

test('the demo video and poster exist and stay small enough for phones', () => {
  assert.ok(statSync(new URL('../assets/video/how-to-book.mp4', import.meta.url)).size < 2.5 * 1024 * 1024);
  assert.ok(statSync(new URL('../assets/img/how-to-book-poster.jpg', import.meta.url)).size < 120 * 1024);
});
