// Apollo website tracker: only on the fleet and apartments pages, off until an ID is set, disclosed in the privacy policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function run(cfg, pathname) {
  const calls = { scripts: [], onLoad: [] };
  const doc = { head: { appendChild: (s) => { calls.scripts.push(s); } }, createElement: () => ({}) };
  const win = { MXP: cfg, document: doc, location: { pathname }, trackingFunctions: { onLoad: (o) => calls.onLoad.push(o) } };
  win.window = win; vm.createContext(win); vm.runInContext(read('assets/js/apollo.js'), win);
  return calls;
}
test('nothing loads without an ID, or on pages other than fleet and apartments', () => {
  assert.equal(run({}, '/fleet/').scripts.length, 0);
  for (const p of ['/', '/book/', '/services/', '/roadside/', '/offers/monsoon-check/', '/track/', '/privacy/', '/bike-service/honda-activa-6g/']) assert.equal(run({ apolloAppId: '6ac9ea0d24cdaa0014db50b0' }, p).scripts.length, 0, p);
});
test('on /fleet/ and /societies/ it loads Apollo from its own host and starts it with the app ID', () => {
  for (const p of ['/fleet/', '/societies/']) {
    const c = run({ apolloAppId: '6ac9ea0d24cdaa0014db50b0' }, p);
    assert.equal(c.scripts.length, 1);
    assert.match(c.scripts[0].src, /^https:\/\/assets\.apollo\.io\/micro\/website-tracker\/tracker\.iife\.js\?nocache=/);
    c.scripts[0].onload();
    assert.equal(JSON.stringify(c.onLoad), JSON.stringify([{ appId: '6ac9ea0d24cdaa0014db50b0' }]));
  }
});
test('a malformed ID is ignored', () => {
  assert.equal(run({ apolloAppId: '<script>' }, '/fleet/').scripts.length, 0);
});
test('the ID is set in config.js, the script ships on every page but only runs on two, and the policy discloses it', () => {
  assert.match(read('assets/js/config.js'), /apolloAppId: '[0-9a-f]{24}'/);
  assert.match(read('fleet/index.html'), /assets\/js\/apollo\.js/); assert.match(read('societies/index.html'), /assets\/js\/apollo\.js/);
  const p = read('privacy/index.html'); assert.match(p, /Apollo/); assert.match(p, /Fleets and delivery riders/);
});
test('the security policy allows Apollo and nothing else new', () => {
  const h = read('_headers');
  assert.match(h, /script-src[^;]*https:\/\/assets\.apollo\.io/); assert.match(h, /connect-src[^;]*https:\/\/\*\.apollo\.io/); assert.match(h, /connect-src[^;]*https:\/\/aplo-evnt\.com/);
});
