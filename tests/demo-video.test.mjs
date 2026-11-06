import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Changed on purpose: the 4-step booking demo video shows the OLD booking builder and says "pay only after you say OK". Booking now starts with a small confirmation fee, so the video is out of date and is no longer shown anywhere until it is re-recorded.
test('the outdated booking demo video is not shown on any page', () => {
  for (const p of ['index.html', 'help/index.html']) {
    const t = read(p);
    assert.doesNotMatch(t, /how-to-book\.mp4|how-to-book-poster/, p + ' must not show the old demo');
    assert.doesNotMatch(t, /pay only after you say OK/i);
  }
});

test('the demo video and poster exist and stay small enough for phones', () => {
  assert.ok(statSync(new URL('../assets/video/how-to-book.mp4', import.meta.url)).size < 2.5 * 1024 * 1024);
  assert.ok(statSync(new URL('../assets/img/how-to-book-poster.jpg', import.meta.url)).size < 120 * 1024);
});
