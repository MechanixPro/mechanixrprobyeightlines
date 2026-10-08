const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
global.window = {}; require('../assets/js/pingeo.js'); const GEO = global.window.MXP_PIN_GEO;
const M = require('../assets/js/pinmap.js');

test('every served PIN code becomes a dot inside the map frame', () => {
  const pts = M.layout(GEO, 300, 300);
  assert.equal(Object.keys(pts).length, Object.keys(GEO).length);
  for (const [pin, p] of Object.entries(pts)) { assert.ok(p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 300, pin); }
});
test('north is up and east is right', () => {
  const pts = M.layout(GEO, 300, 300);
  assert.ok(pts['560064'].y < pts['560100'].y, 'Jakkur (north) above Electronic City (south)');
  assert.ok(pts['560066'].x > pts['560060'].x, 'Whitefield (east) right of Kengeri (west)');
});
test('the map shows all dots, and the visitor\'s own PIN as a pin drop with a ripple', () => {
  const none = M.svg(GEO, {});
  assert.equal((none.match(/class="pm-dot"/g) || []).length, 105); assert.doesNotMatch(none, /pm-pin/);
  const sel = M.svg(GEO, { pin: '560102' });
  assert.match(sel, /pm-pin/); assert.match(sel, /pm-ripple/); assert.match(sel, /aria-hidden="true"/);
  assert.equal((sel.match(/class="pm-dot"/g) || []).length, 104);
  assert.doesNotMatch(M.svg(GEO, { pin: '999999' }), /pm-pin/);
});
test('an exact place on the map can be shown instead of the PIN centre', () => {
  const a = M.svg(GEO, { pin: '560102' }), b = M.svg(GEO, { pin: '560102', lat: 12.9116, lng: 77.6389 });
  assert.notEqual(a, b); assert.match(b, /pm-pin/);
  assert.doesNotMatch(M.svg(GEO, { lat: 13.0827, lng: 80.2707 }), /pm-pin/);
});
test('the PIN map is on the home page check, the booking form and the confirmation receipt', () => {
  assert.match(read('index.html'), /data-pinmap/); assert.match(read('areas/index.html'), /data-pinmap/);
  const app = read('assets/js/app.js');
  assert.match(app, /id="pinMap"/); assert.match(app, /MXP_PINMAP\.draw\(/); assert.match(app, /id="rcptMap"/);
  for (const f of ['index.html', 'book/index.html']) assert.match(read(f), /pinmap\.js/);
});
test('the pin drop and ripple animate, and stay still for people who prefer reduced motion', () => {
  const css = read('assets/css/style.css'); const i = css.indexOf('/* PIN map');
  assert.ok(i > 0); for (const k of ['@keyframes pmDrop', '@keyframes pmRipple', '@keyframes pmDot']) assert.ok(css.includes(k), k);
  assert.match(css.slice(i), /prefers-reduced-motion/);
});
