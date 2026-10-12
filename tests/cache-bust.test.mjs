import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function build(files) {
  const d = mkdtempSync(join(tmpdir(), 'cb-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c); }
  execFileSync('python3', ['-I', new URL('../scripts/cachebust.py', import.meta.url).pathname, d]);
  return (p) => readFileSync(join(d, p), 'utf8');
}

test('every page reference to a style or script file gets a version that changes when the file changes', () => {
  const page = '<link rel="stylesheet" href="/assets/css/style.css"><script src="/assets/js/app.js" defer></script><img src="/assets/img/x.png">';
  const a = build({ 'index.html': page, 'assets/css/style.css': 'a{}', 'assets/js/app.js': 'x=1' })('index.html');
  assert.match(a, /href="\/assets\/css\/style\.css\?v=[0-9a-f]{8}"/); assert.match(a, /src="\/assets\/js\/app\.js\?v=[0-9a-f]{8}"/);
  assert.match(a, /src="\/assets\/img\/x\.png"/); // images are left alone
  const b = build({ 'index.html': page, 'assets/css/style.css': 'a{color:red}', 'assets/js/app.js': 'x=1' })('index.html');
  assert.notEqual(a.match(/style\.css\?v=([0-9a-f]+)/)[1], b.match(/style\.css\?v=([0-9a-f]+)/)[1]);
  assert.equal(a.match(/app\.js\?v=([0-9a-f]+)/)[1], b.match(/app\.js\?v=([0-9a-f]+)/)[1]);
});
test('pages in sub folders and files that are missing are handled, and running twice does not stack versions', () => {
  const rd = build({ 'a/b/index.html': '<script src="/assets/js/app.js?v=old"></script><script src="/assets/js/gone.js"></script>', 'assets/js/app.js': 'x=1' });
  const h = rd('a/b/index.html');
  assert.equal((h.match(/app\.js\?v=/g) || []).length, 1); assert.doesNotMatch(h, /v=old/); assert.match(h, /gone\.js"/);
});
test('the site build runs it on the finished site folder', () => {
  assert.match(read('scripts/build_site.sh'), /cachebust\.py "\$out"/);
});
