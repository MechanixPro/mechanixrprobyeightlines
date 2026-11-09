// Pro Check 20 screens: pure helpers and source patterns for the shared module and its two hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sandbox = {}; new Function('window', read('assets/js/pro-check-data.js'))(sandbox);
globalThis.window = sandbox; globalThis.self = sandbox;
const U = require('../assets/js/pro-check-ui.js');
const G = sandbox.MXP_PRO_CHECK.groups;
const answered = (n) => { const pts = {}; let i = 0; for (const g of G) for (const p of g.points) { if (i++ < n) pts[p.key] = { r: 'ok' }; } return { points: pts, test_ride: null }; };

test('firstOpen jumps to the first group with an unanswered point, then the ride, then the finish', () => {
  assert.equal(U.firstOpen(G, answered(0)), 0);
  assert.equal(U.firstOpen(G, answered(3)), 1);   // brakes done (3 points)
  assert.equal(U.firstOpen(G, answered(19)), 6);  // last group has the single last point
  assert.equal(U.firstOpen(G, answered(20)), G.length);
  const r = answered(20); r.test_ride = { r: 'done_fine' }; assert.equal(U.firstOpen(G, r), G.length + 1);
});
test('a group is done only when every point on it is answered', () => {
  const r = answered(2); assert.equal(U.groupDone(G[0], r), false); r.points.brake_cable_fluid = { r: 'not_applicable' }; assert.equal(U.groupDone(G[0], r), true);
});
test('the ride needs an answer, and a reason when not done', () => {
  assert.equal(U.rideDone({ points: {}, test_ride: null }), false);
  assert.equal(U.rideDone({ points: {}, test_ride: { r: 'done_fine' } }), true);
  assert.equal(U.rideDone({ points: {}, test_ride: { r: 'not_done' } }), false);
  assert.equal(U.rideDone({ points: {}, test_ride: { r: 'not_done', why: 'no_safe_road' } }), true);
});
test('suggested quote lines come from the needs-attention points with their notes', () => {
  const r = answered(20); r.points.horn = { r: 'needs_attention', n: 'weak' }; r.points.chain = { r: 'needs_attention' };
  assert.deepEqual(U.suggested(G, r), ['Horn: weak', 'Chain tension and lubrication']);
  assert.deepEqual(U.counts(G, r), { ok: 18, attention: 2, skipped: 0 });
});
test('the module loads data, opens with check_get, saves per screen, and never uses inline script or style', () => {
  const s = read('assets/js/pro-check-ui.js');
  assert.match(s, /o\.call\('check_get'/); assert.match(s, /o\.call\('check_save'/); assert.match(s, /data\.safety/); assert.match(s, /b\.disabled = !ok \|\| busy/);
  assert.doesNotMatch(s, /innerHTML|\.style\.|setAttribute\('style'/);
});
test('hosts: the job page and the garage page load the module, css and data', () => {
  const j = read('job/index.html'); assert.match(j, /pro-check-data\.js/); assert.match(j, /pro-check-ui\.js/); assert.match(j, /pro-check\.css/);
  assert.match(read('assets/js/job.js'), /check_open/);
});
test('the public /pro-check/ page lists exactly the 20 points and the test ride, and is in the sitemap', () => {
  const h = read('pro-check/index.html');
  for (const g of G) for (const p of g.points) assert.ok(h.includes('<li>' + p.label + '</li>'), p.label);
  assert.equal((h.match(/<div class="pc-g">/g) || []).length, 7);
  assert.match(h, /Then a test ride/); assert.match(h, /valid licence/);
  assert.doesNotMatch(h, /guarantee|100%|insured/i);
  assert.match(read('sitemap.xml'), /\/pro-check\//);
});
