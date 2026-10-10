// Home prices and fee explainer, gated reviews and mechanics, gated languages, track page, receipt extras, payment note.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = read('scripts/build_pages.py');

// Run a slice of build_pages.py in Python against a throwaway ROOT, so the real src/ files are never touched.
function py(sliceFrom, sliceTo, files, code) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mxp-'));
  fs.mkdirSync(path.join(tmp, 'src', 'i18n'), { recursive: true });
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(tmp, 'src', f), body);
  const slice = SRC.slice(SRC.indexOf(sliceFrom), SRC.indexOf(sliceTo));
  const prog = `import html, json, os, re\nROOT = ${JSON.stringify(tmp)}\n${slice}\n${code}`;
  const r = spawnSync('python3', ['-I', '-c', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('home shows real prices from the price source and explains the checkup fee', () => {
  const h = read('index.html');
  assert.match(h, /id="prices"/);
  for (const n of ['Basic service', 'General service', 'Full service', 'Repair or problem check']) assert.ok(h.includes('<h3>' + n + '</h3>'), n);
  assert.match(h, /How the .{0,40}349.{0,10} checkup and quote fee works/);
  assert.match(h, /More than 2 hours before your slot/);
  assert.doesNotMatch(h, /\{\{/);
});
test('home shows no reviews or mechanics block while there is no real content', () => {
  const h = read('index.html');
  assert.doesNotMatch(h, /id="reviews"|id="mechanics"/);
  assert.deepEqual(JSON.parse(read('src/reviews.json')), []);
  assert.deepEqual(JSON.parse(read('src/mechanics.json')), []);
});
test('reviews appear only when complete (name, text, date, link) and mechanics need a name and years', () => {
  const rev = [{ name: 'Asha', text: 'Great', date: '2026-10-01', url: 'https://g.page/r/x' }, { name: 'No link', text: 'x', date: '2026-10-01' }];
  const mech = [{ name: 'Ravi', years: 6, speciality: 'Scooters' }, { name: 'No years' }];
  const out = py('def _load_json', '# Track page', { 'reviews.json': JSON.stringify(rev), 'mechanics.json': JSON.stringify(mech) }, 'print(reviews_html()); print(mechanics_html())');
  assert.match(out, /Asha/); assert.doesNotMatch(out, /No link/); assert.match(out, /Ravi/); assert.match(out, /6 years of experience/); assert.doesNotMatch(out, /No years/);
});
test('a language page is only built when every line is reviewed', () => {
  const run = (rows) => py('LANG_META =', '# ---- Ad landing pages', {}, `print(i18n_ready(json.loads(${JSON.stringify(JSON.stringify({ strings: rows }))})))`);
  assert.equal(run([{ en: 'a', t: 'x', reviewed: true }, { en: 'b', t: 'y', reviewed: false }]), 'False');
  assert.equal(run([]), 'False');
  assert.equal(run([{ en: 'a', t: 'x', reviewed: true }]), 'True');
  assert.equal(run([{ en: 'a', t: '', reviewed: true }]), 'False');
});
test('translation swaps longest lines first and fails loudly when a line is missing', () => {
  const data = { strings: [{ en: 'Build your service', t: 'B', reviewed: true }, { en: 'Build your service in a minute', t: 'LONG', reviewed: true }] };
  assert.equal(py('LANG_META =', '# ---- Ad landing pages', {}, `print(i18n_apply('<p>Build your service in a minute</p><b>Build your service</b>', json.loads(${JSON.stringify(JSON.stringify(data))})))`), '<p>LONG</p><b>B</b>');
  const bad = spawnSync('python3', ['-I', '-c', `import html, json, os\nROOT='/tmp'\n${SRC.slice(SRC.indexOf('LANG_META ='), SRC.indexOf('# ---- Ad landing pages'))}\ni18n_apply('<p>x</p>', json.loads(${JSON.stringify(JSON.stringify({ strings: [{ en: 'nope', t: 'y', reviewed: true }] }))}))`], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
test('every draft translation line exists on the English home page and starts unreviewed', () => {
  const page = read('src/home.html') + SRC;
  for (const code of ['kn', 'hi']) {
    const d = JSON.parse(read('src/i18n/' + code + '.json'));
    assert.ok(d.strings.length > 20);
    for (const s of d.strings) { assert.ok(page.includes(s.en), code + ': ' + s.en); assert.equal(s.reviewed, false); assert.ok(s.t.trim()); }
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'kn')) || fs.existsSync(path.join(ROOT, 'hi')), false);
});
test('track page exists, is kept out of search, and uses the lookup function', () => {
  const t = read('track/index.html');
  assert.match(t, /noindex/); assert.match(t, /id="trackForm"/);
  assert.match(read('assets/js/track.js'), /functions\/v1\/track-booking/);
  assert.doesNotMatch(read('sitemap.xml'), /\/track\//);
  assert.match(read('index.html'), /href="\/track\/"/);
  assert.match(read('scripts/build_site.sh'), /\btrack\b/);
});
test('the booking form states payment and cancellation, and the receipt can share, install and track', () => {
  const a = read('assets/js/app.js');
  assert.match(a, /Payment and cancellation/); assert.match(a, /refund-policy/);
  assert.match(a, /data-act="shareRef"/); assert.match(a, /beforeinstallprompt/); assert.match(a, /\/track\/\?ref=/);
  assert.match(a, /b\.closest\('#doneSheet'\)/);
});
test('the admin Add booking form asks for more than name and number', () => {
  const a = read('admin/admin.js');
  for (const id of ['nb-name', 'nb-phone', 'nb-email', 'nb-brand', 'nb-model', 'nb-service', 'nb-pin', 'nb-addr', 'nb-date', 'nb-slot', 'nb-note', 'nb-status']) assert.ok(a.includes(id), id);
  assert.doesNotMatch(a, /prompt\('Customer name'\)/);
});
test('track-booking and service-reminder are public functions with their own checks', () => {
  const cfg = read('supabase/config.toml');
  assert.match(cfg, /\[functions\.track-booking\]\nverify_jwt = false/); assert.match(cfg, /\[functions\.service-reminder\]\nverify_jwt = false/);
  assert.match(read('supabase/functions/service-reminder/index.ts'), /x-cron-secret/);
  assert.match(read('supabase/functions/track-booking/index.ts'), /track_attempts/);
  assert.match(read('supabase/migrations/20261028000000_track_and_reminders.sql'), /enable row level security/);
});
test('Instagram: follow card and footer link always; posts only for valid post links; no tracking token kept', () => {
  const h = read('index.html');
  assert.match(h, /id="instagram"/); assert.match(h, /href="https:\/\/www\.instagram\.com\/themechanixpro\/"/);
  assert.doesNotMatch(h, /stkn=|utm_source|srtk|exln/);
  for (const c of ['p/DeR2Vd_SRh-', 'p/DeQe_BOCEKp', 'reel/DeQd2W9iUYD']) assert.ok(h.includes('instagram.com/' + c + '/embed'), c);
  assert.match(read('_headers'), /frame-src[^;]*https:\/\/www\.instagram\.com/);
  assert.match(read('src/home.jsonld'), /"sameAs":\["https:\/\/www\.instagram\.com\/themechanixpro\/"\]/);
  const out = py('def _load_json', '# Track page', { 'instagram.json': JSON.stringify({ handle: 'themechanixpro', posts: ['https://www.instagram.com/p/ABCde12345/', 'https://evil.example/p/ABCde12345/', 'https://www.instagram.com/reel/Zz9_-Aaaaa/?igsh=x', 'javascript:alert(1)'] }) }, 'import re\nprint(instagram_html())');
  assert.match(out, /instagram\.com\/p\/ABCde12345\/embed/); assert.match(out, /instagram\.com\/reel\/Zz9_-Aaaaa\/embed/);
  assert.doesNotMatch(out, /evil\.example|javascript:/); assert.match(out, /loading="lazy"/);
});
