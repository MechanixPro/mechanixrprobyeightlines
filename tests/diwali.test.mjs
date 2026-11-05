import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../assets/js/diwali.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the Diwali banner shows only inside the festival window, by India date', () => {
  assert.equal(D.active(Date.parse('2026-10-22T12:00:00+05:30')), false);
  assert.equal(D.active(Date.parse('2026-11-08T09:00:00+05:30')), true);
  assert.equal(D.active(Date.parse('2026-11-08T23:30:00+05:30')), true, 'last day is 8 November');
  assert.equal(D.active(Date.parse('2026-11-09T00:30:00+05:30')), false);
  assert.equal(D.active(Date.parse('2026-11-12T12:00:00+05:30')), false);
});
test('an offer line comes only from config, and is cleaned', () => {
  assert.equal(D.offerLine({}), '');
  assert.equal(D.offerLine({ diwaliOffer: ' Use <b>DIWALI</b> ' }), 'Use bDIWALI/b');
});
test('every page keeps the Diwali banner, the join page exists, and no discount is invented', () => {
  const home = read('../index.html');
  assert.match(home, /href="\/join\/"/);
  const built = /"dateModified": "(\d{4}-\d{2}-\d{2})"/.exec(read('../bike-service-hsr-layout/index.html'))[1];
  if (built <= '2026-11-08') { // the banner is built into pages only until 8 November 2026; later builds carry none
    assert.match(home, /data-diwali-bar/);
    assert.doesNotMatch(home.match(/<div class="diwali-bar"[\s\S]*?<\/div>/)[0], /\d+\s?%|₹\s?\d|flat|off\b/i);
  } else assert.doesNotMatch(home, /data-diwali-bar/);
  assert.match(read('../join/index.html'), /submit-partner|partner\.js/);
});
test('the fireworks respect reduced motion and the script has no inline code', () => {
  const js = read('../assets/js/diwali.js');
  assert.match(js, /prefers-reduced-motion/);
  assert.doesNotMatch(read('../index.html'), /<script>[^<]*diwali/i);
});

test('the Diwali offer page sends visitors to /services/ after 8 November, and not before', () => {
  const run = (isoNow, path) => {
    const real = Date.now; Date.now = () => Date.parse(isoNow);
    const calls = [];
    const win = { MXP: {}, location: { pathname: path, replace: (u) => calls.push(u) }, document: { querySelectorAll: () => [], querySelector: () => null } };
    try { D.start(win); } finally { Date.now = real; }
    return calls;
  };
  assert.deepEqual(run('2026-11-08T23:00:00+05:30', '/offers/diwali-ready/'), []);
  assert.deepEqual(run('2026-11-09T00:30:00+05:30', '/offers/diwali-ready/'), ['/services/']);
  assert.deepEqual(run('2026-11-09T00:30:00+05:30', '/offers/bike-service/'), []);
});
