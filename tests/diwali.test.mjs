import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../assets/js/diwali.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the Diwali banner shows only inside the festival window, by India date', () => {
  assert.equal(D.active(Date.parse('2026-10-22T12:00:00+05:30')), false);
  assert.equal(D.active(Date.parse('2026-11-08T09:00:00+05:30')), true);
  assert.equal(D.active(Date.parse('2026-11-12T23:30:00+05:30')), true);
  assert.equal(D.active(Date.parse('2026-11-13T00:30:00+05:30')), false);
});
test('an offer line comes only from config, and is cleaned', () => {
  assert.equal(D.offerLine({}), '');
  assert.equal(D.offerLine({ diwaliOffer: ' Use <b>DIWALI</b> ' }), 'Use bDIWALI/b');
});
test('the home page has the Diwali card, the join page exists, and no discount is invented', () => {
  const home = read('../index.html');
  assert.match(home, /data-diwali-bar/); assert.match(home, /id="diwali"/); assert.match(home, /axlio\.in/); assert.match(home, /href="\/join\/"/);
  assert.doesNotMatch(home.match(/<section id="diwali"[\s\S]*?<\/section>/)[0], /\d+\s?%|₹\s?\d|flat|off\b/i);
  assert.match(read('../join/index.html'), /submit-partner|partner\.js/);
});
test('the fireworks respect reduced motion and the script has no inline code', () => {
  const js = read('../assets/js/diwali.js');
  assert.match(js, /prefers-reduced-motion/);
  assert.doesNotMatch(read('../index.html'), /<script>[^<]*diwali/i);
});
