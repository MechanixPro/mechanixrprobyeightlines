import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const FX = require('../assets/js/fx.js'); const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const win = (reduce) => ({ matchMedia: () => ({ matches: reduce }), document: { createElement: () => ({}), head: { appendChild() {} } } });
test('visitors who prefer reduced motion get no animation and no download', async () => {
  const w = win(true); assert.equal(await FX.play(w, 'steps', { querySelectorAll: () => [1] }), false); assert.equal(await FX.load(w), null);
});
test('an unknown effect or a missing root does nothing', async () => {
  assert.equal(await FX.play(win(false), 'nope', {}), false); assert.equal(await FX.play(win(false), 'steps', null), false);
});
test('with the library ready it moves only what is on the page, and nothing is hidden first', async () => {
  const calls = []; const w = win(false); w.MXP_ANIME = { stagger: (g, o) => ({ g, o }), animate: (t, o) => calls.push([t.length, o]) };
  const root = { querySelectorAll: (s) => (s === '.track-steps li' ? [1, 2, 3] : []) };
  assert.equal(await FX.play(w, 'steps', root), true); assert.equal(calls.length, 1); assert.equal(calls[0][0], 3); assert.deepEqual(calls[0][1].opacity, [0, 1]);
});
test('a failed library load leaves the page as it was', async () => {
  const w = win(false); w.document.createElement = () => { const s = {}; setTimeout(() => s.onerror(), 0); return s; };
  assert.equal(await FX.play(w, 'cards', { querySelectorAll: () => [1] }), false);
});
test('effects are limited to the three agreed places and never invent numbers', () => {
  assert.deepEqual(Object.keys(FX.KINDS).sort(), ['cards', 'steps', 'thanks']); assert.doesNotMatch(read('assets/js/fx.js'), /\bcount|Math\.random|₹/);
});
test('the library is the small build, loaded from our own domain, and the pages carry fx.js', () => {
  assert.ok(fs.statSync(new URL('../assets/js/anime-lite.js', import.meta.url)).size < 45000); assert.equal(FX.SRC, '/assets/js/anime-lite.js');
  for (const p of ['track/index.html', 'book/index.html', 'customer/index.html']) assert.match(read(p), /\/assets\/js\/fx\.js" defer/, p);
  assert.match(read('assets/js/thanks.js'), /MXP_FX\.play\(win, 'thanks'/); assert.match(read('assets/js/track.js'), /play\(win, 'steps'/); assert.match(read('assets/js/customer-app.js'), /play\(win, 'cards'/);
  assert.match(read('package.json'), /node --check assets\/js\/fx\.js/);
});
