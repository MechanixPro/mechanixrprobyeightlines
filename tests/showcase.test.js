const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const S = require('../assets/js/showcase.js');
const read = (p) => fs.readFileSync(require('node:path').join(__dirname, '..', p), 'utf8');

test('normalizeSlides keeps only https images with a caption, in order, capped at 12', () => {
  const rows = [{ url: 'https://x.supabase.co/a.webp', caption: 'A' }, { url: 'http://bad/b.jpg', caption: 'B' }, { url: 'javascript:alert(1)', caption: 'C' }, { url: 'https://x.supabase.co/d.webp' }];
  const out = S.normalizeSlides(rows);
  assert.deepEqual(out.map((s) => s.url), ['https://x.supabase.co/a.webp', 'https://x.supabase.co/d.webp']);
  assert.equal(out[1].caption, '');
  assert.equal(S.normalizeSlides(Array.from({ length: 30 }, (_, i) => ({ url: 'https://x.co/' + i + '.webp' }))).length, 12);
});
test('nextIndex wraps around', () => { assert.equal(S.nextIndex(0, 3), 1); assert.equal(S.nextIndex(2, 3), 0); assert.equal(S.nextIndex(0, 1), 0); });
test('the home page no longer has the slideshow and does not load its script', () => {
  const h = read('src/home.html');
  assert.doesNotMatch(h, /data-show/); assert.doesNotMatch(read('scripts/build_pages.py'), /showcase\.js/);
});
test('slideshow stops moving for people who prefer reduced motion', () => {
  assert.match(read('assets/js/showcase.js'), /prefers-reduced-motion/);
  assert.match(read('assets/css/style.css'), /\.slide/);
});
test('home_images migration: public can read active images, only admins write, bucket is limited', () => {
  const sql = read('supabase/migrations/20261017000000_home_images.sql');
  assert.match(sql, /create table if not exists public\.home_images/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to anon, authenticated using \(active\)/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.match(sql, /allowed_mime_types/);
  assert.doesNotMatch(sql, /disable row level security/i);
});
test('admin has a Home images tab that uploads to storage and saves rows', () => {
  assert.match(read('admin/index.html'), /data-tab="homeimgs"/);
  const a = read('admin/admin.js');
  assert.match(a, /storage\.from\('home'\)\.upload/);
  assert.match(a, /from\('home_images'\)/);
  for (const act of ['uploadHome', 'homeUp', 'homeDown', 'homeToggle', 'homeDelete']) assert.ok(a.includes(act), act);
});
