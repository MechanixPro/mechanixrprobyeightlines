// The phone apps (assets/css/garage.css, used by /garage/ and /mechanic/) cannot link crm/ds.css, so they carry a mirror of the shared tokens. The mirror must match the desk values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ds = read('crm/ds.css'), g = read('assets/css/garage.css');
const val = (css, n) => (css.match(new RegExp('--' + n + ':([^;}]+)[;}]')) || [])[1];
test('garage.css mirrors the ds.css token values (same names, same values)', () => {
  const names = ['bg', 'surface', 'surface2', 'surface3', 'border', 'border2', 'text', 'text2', 'text3', 'accent', 'accent-bg', 'accent-text', 'good', 'good-bg', 'good-text', 'warn', 'warn-bg', 'warn-text', 'bad', 'bad-bg', 'bad-text', 'info', 'info-bg', 'info-text', 'on-accent', 'navy', 'fs-1', 'fs-2', 'fs-3', 'fs-4', 'fs-5', 'fs-6', 's1', 's2', 's3', 's4', 's5', 'radius', 'radius-field', 'radius-pill', 'radius-sheet', 'tap', 'tap-lg', 'shadow-sm'];
  for (const n of names) { assert.ok(val(ds, n), '--' + n + ' missing in ds.css'); assert.equal(val(g, n), val(ds, n), '--' + n); }
});
test('the phone apps use only the six type sizes and keep 16px body text and 48px tap targets', () => {
  const sizes = new Set([...g.matchAll(/font-size:(\d+)px/g)].map((m) => m[1]));
  for (const s of sizes) assert.ok(['10', '12', '14', '16', '20', '24'].includes(s), s + 'px is not on the scale');
  assert.match(g, /body\.garage\{[^}]*font:400 var\(--fs-4\)/); assert.match(g, /--tap-lg:48px/);
});
