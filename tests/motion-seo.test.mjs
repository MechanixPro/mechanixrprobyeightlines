import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../assets/js/motion.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the count-up reads the confirmed numbers and leaves the words alone', () => {
  assert.deepEqual(M.parseCount('10,000+ services done'), { n: 10000, plus: '+', rest: ' services done' });
  assert.deepEqual(M.parseCount('1,300+ gated communities trust us'), { n: 1300, plus: '+', rest: ' gated communities trust us' });
  assert.equal(M.parseCount('No number here'), null);
  assert.equal(M.fmt(10000), '10,000');
});
test('the continue nudge appears only for a build with a name, and is cleaned', () => {
  assert.equal(M.resumeName(null), ''); assert.equal(M.resumeName({}), '');
  assert.equal(M.resumeName({ nick: ' Bullet <b>Raja</b> ' }), 'Bullet bRaja/b');
  assert.equal(M.resumeName({ brand: 'Honda', model: 'Activa 6G' }), 'Honda Activa 6G');
  assert.equal(M.resumeName({ brand: 'Other' }), ''); assert.equal(M.resumeName({ brand: 'Other', model: 'Other' }), '');
});
test('the home page tells search engines its FAQ, its site and its business, with the same words as the page', () => {
  const h = read('../index.html');
  const types = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1])['@type']);
  for (const t of ['AutoRepair', 'FAQPage', 'WebSite']) assert.ok(types.includes(t), t);
  const faq = JSON.parse([...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]).find((s) => s.includes('FAQPage')));
  assert.ok(faq.mainEntity.length >= 4);
  for (const q of faq.mainEntity) assert.ok(h.includes(q.name), q.name);
});
test('home title and description are the right length for search results', () => {
  const h = read('../index.html');
  assert.ok(h.match(/<title>(.*?)<\/title>/)[1].length <= 62);
  const d = h.match(/<meta name="description" content="(.*?)"/)[1];
  assert.ok(d.length >= 100 && d.length <= 165, String(d.length)); assert.doesNotMatch(d, /…$/);
});
test('every structured-data block on every page is valid JSON', () => {
  const walk = (d) => readdirSync(new URL(d, import.meta.url)).flatMap((n) => { const p = d + n; if (['node_modules', 'dist-site', 'dist-crm', 'dist-admin', '.git', 'docs', 'crm', 'admin', 'supabase', 'tests', 'scripts', 'src', 'assets', 'brand-src'].includes(n)) return []; return statSync(new URL(p, import.meta.url)).isDirectory() ? walk(p + '/') : p.endsWith('index.html') ? [p] : []; });
  const pages = walk('../');
  assert.ok(pages.length > 100);
  for (const f of pages) for (const m of read(f).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) assert.doesNotThrow(() => JSON.parse(m[1]), f);
});
test('join, Axlio and roadside pages carry breadcrumbs and structured data', () => {
  for (const [f, t] of [['../join/index.html', 'WebPage'], ['../partners/axlio/index.html', 'WebPage'], ['../roadside/index.html', 'Service']]) { const h = read(f); assert.match(h, /BreadcrumbList/, f); assert.match(h, new RegExp('"@type": "' + t + '"'), f); }
});
