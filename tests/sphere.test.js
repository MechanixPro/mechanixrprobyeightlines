// The sphere helper: our own renderer for the owner's avatar design, as a second look next to Pro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SP = require('../assets/js/sphere.js');
const DEF = JSON.parse(read('assets/data/sphere.json'));

test('the design data is small, brand navy with white eyes, and every animation step points to a real expression', () => {
  assert.ok(read('assets/data/sphere.json').length < 8000);
  assert.equal(DEF.colors.body, '#14295A'); assert.equal(DEF.colors.eyes, '#ffffff');
  for (const [n, a] of Object.entries(DEF.animations)) { assert.ok(a.steps.length >= 2, n); for (const s of a.steps) assert.ok(DEF.expressions[s.expression], n + ' -> ' + s.expression); assert.ok(a.blink.durationMs > 0); }
  for (const n of ['idle', 'happy', 'curious', 'listening', 'celebrate']) assert.ok(DEF.animations[n], n);
});
test('no angry, sad or scared looks ship to customers', () => {
  const names = Object.keys(DEF.expressions).concat(Object.keys(DEF.animations)).join(' ');
  assert.doesNotMatch(names, /angry|sad|scared|suspicious|skeptical|drowsy|sleep/);
});
test('a neutral head puts the eyes side by side at the face centre', () => {
  const e = SP.eyes(DEF.expressions.neutral, DEF.size);
  assert.equal(e.length, 2); assert.ok(Math.abs(e[0].cx - (150 - 17.5)) < 0.01); assert.ok(Math.abs(e[1].cx - (150 + 17.5)) < 0.01);
  assert.ok(Math.abs(e[0].cy - (150 - 7)) < 0.01); assert.equal(e[0].rx, 10); assert.equal(e[0].ry, 25);
});
test('turning the head right slides the eyes right and narrows them; looking up moves them up; roll tilts them', () => {
  const base = SP.eyes(DEF.expressions.neutral, DEF.size);
  const right = SP.eyes({ ...DEF.expressions.neutral, head: { x: 0, y: 30, z: 0 } }, DEF.size);
  assert.ok(right[0].cx > base[0].cx + 30 && right[1].cx > base[1].cx + 30); assert.ok(right[0].rx < base[0].rx);
  const up = SP.eyes({ ...DEF.expressions.neutral, head: { x: 20, y: 0, z: 0 } }, DEF.size);
  assert.ok(up[0].cy < base[0].cy - 20);
  const roll = SP.eyes({ ...DEF.expressions.neutral, head: { x: 0, y: 0, z: 20 } }, DEF.size);
  assert.ok(roll[1].cy > roll[0].cy + 5); assert.ok(Math.abs(roll[0].rot - 20) < 0.01);
});
test('an eye turned past the edge of the sphere is hidden, never drawn on the back', () => {
  const far = SP.eyes({ ...DEF.expressions.neutral, head: { x: 0, y: 85, z: 0 } }, DEF.size);
  assert.ok(far.every((e) => e.visible === false || e.rx < 6));
});
test('mixing two looks halfway gives the middle values, and easing starts and ends gently', () => {
  const m = SP.mix(DEF.expressions.neutral, DEF.expressions['joyful-wide'], 0.5);
  assert.ok(Math.abs(m.eyes.left.height - (50 + 85.33) / 2) < 0.01); assert.ok(Math.abs(m.head.y - (-15.9 / 2)) < 0.01);
  assert.equal(SP.ease(0), 0); assert.equal(SP.ease(1), 1); assert.ok(SP.ease(0.5) > 0.49 && SP.ease(0.5) < 0.51); assert.ok(SP.ease(0.1) < 0.1);
});
test('the animation clock walks the steps: transition, hold, then the next step, looping', () => {
  const a = DEF.animations.idle; // 2 steps, 500ms transition + 5200ms hold
  const at = (t) => SP.frame(a, DEF.expressions, t);
  assert.equal(at(0).from, 'neutral'); assert.equal(at(0).to, 'upward-side-glance');
  assert.equal(at(600).to, 'upward-side-glance'); assert.equal(at(600).k, 1); // holding
  assert.equal(at(500 + 5200 + 100).to, 'curious-left');
  const loop = (500 + 5200) * 2; assert.equal(at(loop + 100).to, 'upward-side-glance');
});
test('a blink closes the eyes quickly and opens them again', () => {
  assert.equal(SP.blink(0, 280), 1); assert.ok(SP.blink(140, 280) < 0.2); assert.equal(SP.blink(280, 280), 1); assert.equal(SP.blink(500, 280), 1);
});
test('this is our own code: no import of the Avatar Lab packages, and reduced motion draws one still look', () => {
  const j = read('assets/js/sphere.js');
  assert.doesNotMatch(j, /bible-strong|avatar-web|avatar-core|avatar-react/i);
  assert.match(j, /reduce/);
});
test('Pro can show either helper: config switch pro, sphere or ab, one stable pick per visitor, variant recorded', () => {
  const c = read('assets/js/config.js'), j = read('assets/js/pro.js');
  assert.match(c, /helperStyle: '(pro|sphere|ab)'/);
  assert.match(j, /helperStyle/); assert.match(j, /mxp_pro_variant/); assert.match(j, /variant/); assert.match(j, /sphere\.js/); assert.match(j, /sphere\.json/);
  assert.match(j, /catch[\s\S]{0,80}(pro|fallback)/i);
});
test('the build copies the avatar data and script', () => {
  assert.match(read('scripts/build_site.sh'), /assets/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/data/sphere.json')));
});
