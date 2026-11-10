import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('the job page can be installed: manifest, icons, scope and a pass-through worker', () => {
  const m = JSON.parse(read('job.webmanifest'));
  assert.equal(m.start_url, '/job/'); assert.equal(m.scope, '/job/'); assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  assert.match(read('job/index.html'), /rel="manifest" href="\/job\.webmanifest"/);
  assert.match(read('scripts/build_site.sh'), /job\.webmanifest/);
  const sw = read('job/sw.js'); assert.match(sw, /addEventListener\('fetch'/); assert.doesNotMatch(sw, /caches\./);
  assert.match(read('assets/js/job.js'), /register\('\/job\/sw\.js'/);
});
test('the installed job app reopens the last job link on this phone', () => {
  const js = read('assets/js/job.js');
  assert.match(js, /localStorage\.setItem\(KEEP, t\)/); assert.match(js, /location\.replace\('\/job\/\?t=' \+ last\)/);
});
