// The shared design-system files (crm/ is the source, admin/ holds byte-identical copies, listed in scripts/shared-files.txt),
// the brand colour pairs, and the rules for files shared by Crew and Admin: no inline handlers, no script tags, no DOM globals at load time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const shared = read('scripts/shared-files.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('shared-files.txt lists files that exist in crm/ and admin/ with identical bytes', () => {
  assert.ok(shared.includes('ds.css'));
  for (const f of shared) {
    assert.ok(existsSync(new URL('../crm/' + f, import.meta.url)), 'crm/' + f + ' is missing');
    assert.equal(read('admin/' + f), read('crm/' + f), f + ' differs between crm/ and admin/. Run: sh scripts/sync_shared.sh');
  }
});

test('sync_shared.sh copies every listed file and nothing else', () => {
  const sh = read('scripts/sync_shared.sh');
  assert.match(sh, /shared-files\.txt/); assert.match(sh, /cp "\$root\/crm\/\$f" "\$root\/admin\/\$f"/);
  execFileSync('sh', ['scripts/sync_shared.sh'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });   // idempotent: copies identical bytes
  for (const f of shared) assert.equal(read('admin/' + f), read('crm/' + f));
});

test('both index.html files load ds.css last, after every other stylesheet', () => {
  for (const app of ['crm', 'admin']) {
    const html = read(app + '/index.html'), links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(links[links.length - 1], '/' + app + '/ds.css', app + ' must load ds.css last: ' + links.join(', '));
  }
});

test('the build scripts ship ds.css (it sits inside the copied crm/ and admin/ folders)', () => {
  assert.match(read('scripts/build_crm.sh'), /cp -R "\$root\/crm" "\$out\/crm"/);
  assert.match(read('scripts/build_admin.sh'), /cp -R "\$root\/admin" "\$out\/admin"/);
});

/* ---------- colour ---------- */
const css = read('crm/ds.css');
// Phase 1: the canonical tokens are now the 22 role names (--navy, --text, --accent ...) plus --info; --mx-* are aliases. Tints (*-bg) are translucent, so they are blended over white for the contrast check.
const tokRaw = (n) => { const m = css.match(new RegExp('--' + n + ':(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))[;}]')); assert.ok(m, '--' + n + ' missing'); return m[1]; };
const tok = (n) => { const v = tokRaw(n); if (v[0] === '#') return v; const [r, g, b, a] = v.match(/[\d.]+/g).map(Number); const mix = (c) => Math.round(c * a + 255 * (1 - a)).toString(16).padStart(2, '0'); return ('#' + mix(r) + mix(g) + mix(b)).toUpperCase(); };
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('brand tokens have the agreed values', () => {
  const want = { navy: '#14295A', text: '#0B1220', accent: '#F2801F', 'on-accent': '#1A0E03', bg: '#FAFAF8', surface: '#FFFFFF', border: '#E3E6EC', text3: '#556075', good: '#157A3E', bad: '#B3261E', 'accent-text': '#9A4B00', info: '#1D4ED8', wa: '#25D366', 'on-wa': '#063B1C' };
  for (const [k, v] of Object.entries(want)) assert.equal(tok(k).toUpperCase(), v, '--' + k);
});

test('the 22 colour roles, the six type sizes, the spacing and radius scales exist', () => {
  for (const r of ['bg', 'surface', 'surface2', 'surface3', 'border', 'border2', 'text', 'text2', 'text3', 'accent', 'accent-bg', 'accent-text', 'good', 'good-bg', 'good-text', 'warn', 'warn-bg', 'warn-text', 'bad', 'bad-bg', 'bad-text']) tokRaw(r);
  for (const [k, v] of Object.entries({ 'fs-1': '10px', 'fs-2': '12px', 'fs-3': '14px', 'fs-4': '16px', 'fs-5': '20px', 'fs-6': '24px', s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px', radius: '10px', 'radius-field': '8px', 'radius-pill': '999px', 'radius-sheet': '24px', tap: '44px' })) assert.match(css, new RegExp('--' + k + ':' + v + '[;}]'), '--' + k);
});

test('every text and background pair meets 4.5:1', () => {
  const pairs = [['text', 'bg'], ['text', 'surface'], ['text2', 'surface'], ['text3', 'bg'], ['text3', 'surface'], ['text3', 'surface2'], ['on-accent', 'accent'], ['on-navy', 'navy'], ['good-text', 'good-bg'], ['bad-text', 'bad-bg'], ['accent-text', 'accent-bg'], ['warn-text', 'warn-bg'], ['info-text', 'info-bg'], ['on-wa', 'wa'], ['bad-text', 'surface'], ['good-text', 'surface'], ['info-text', 'surface'], ['accent-text', 'surface'], ['on-good', 'good'], ['on-bad', 'bad']];
  for (const [fg, bg] of pairs) { const r = ratio(tok(fg), tok(bg)); assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`); }
  assert.ok(ratio(tok('on-accent'), tok('accent')) >= 7, 'text on the accent should be about 7:1');
});

test('the old variable names still resolve to the new tokens (alias layer)', () => {
  for (const [legacy, token] of [['card', 'surface'], ['ink', 'text'], ['line', 'border'], ['muted', 'text3'], ['ember', 'accent'], ['ember-ink', 'on-accent'], ['mx-navy', 'navy'], ['mx-ember', 'accent'], ['mx-paper', 'bg'], ['mx-card', 'surface'], ['mx-line', 'border'], ['mx-ink', 'text'], ['m-ink', 'text']]) {
    assert.match(css, new RegExp('--' + legacy + ':var\\(--' + token + '\\)'), '--' + legacy);
  }
});

test('ds.css defines the component classes', () => {
  for (const c of ['mx-btn', 'mx-chip', 'mx-card', 'mx-empty', 'mx-skeleton', 'mx-error']) assert.match(css, new RegExp('\\.' + c + '[\\s{,.:-]'), c);
  assert.match(css, /prefers-reduced-motion/);
});

/* ---------- shared-file hygiene ---------- */
test('shared files have no inline handlers, script tags or javascript: URLs', () => {
  for (const f of shared) {
    const t = read('crm/' + f);
    assert.doesNotMatch(t, /\son(click|change|input|submit|load|error|keydown|keyup|focus|blur)\s*=/i, f + ' has an inline handler');
    assert.doesNotMatch(t, /<script/i, f + ' has a script tag');
    assert.doesNotMatch(t, /javascript:/i, f + ' has a javascript: URL');
  }
});

test('shared JS files touch no DOM globals when they are loaded', async () => {
  for (const f of shared.filter((n) => n.endsWith('.js'))) {
    const keep = ['document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'location'], had = keep.map((k) => [k, k in globalThis]);
    await import(new URL('../crm/' + f, import.meta.url));   // would throw a ReferenceError if it used a DOM global at load time
    assert.deepEqual(had, keep.map((k) => [k, k in globalThis]), f + ' created a global');
  }
});

test('ds.css has no dark-mode block yet (light only for now)', () => assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/));

/* ---------- ds.js (Step 3) ---------- */
const ds = await import(new URL('../crm/ds.js', import.meta.url));

test('ds.js: one vocabulary for the stored statuses, values unchanged', () => {
  const want = { new: 'New', contacted: 'Contacted', quoted: 'Quote sent', payment_sent: 'Advance link sent', paid: 'Booked', scheduled: 'Booked', completed: 'Done', lost: 'Lost', junk: 'Junk' };
  assert.deepEqual(Object.keys(ds.STATUS).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.equal(ds.statusLabel(k), v, k);
  assert.equal(ds.statusLabel('something_new'), 'something_new');
  assert.equal(ds.statusTone('lost'), 'bad'); assert.equal(ds.statusTone('completed'), 'good');
  assert.match(ds.statusChip('payment_sent'), /mx-chip mx-chip--warn">Advance link sent</);
});

test('ds.js: crm-rules STATUS_LABEL (the Crew lead views) agrees with the vocabulary', async () => {
  const { STATUS_LABEL } = await import(new URL('../crm/crm-rules.js', import.meta.url));
  for (const k of Object.keys(STATUS_LABEL)) assert.equal(STATUS_LABEL[k], ds.statusLabel(k), k);
});

test('ds.js: builders escape their text and keep the hooks the pages bind to', () => {
  assert.match(ds.chip('<b>x</b>', 'good'), /&lt;b&gt;x&lt;\/b&gt;/);
  const e = ds.errorState({ title: 'Could not load', detail: 'Network down' });
  assert.match(e, /role="alert"/); assert.match(e, /data-retry/); assert.match(e, /Try again/); assert.match(e, /mx-error/);
  assert.doesNotMatch(ds.errorState({ retry: null }), /<button/);
  assert.match(ds.errorState({ retry: { label: 'Retry', attr: 'data-flow="reloadFlow"' } }), /data-flow="reloadFlow"/);
  const s = ds.skeleton(2); assert.match(s, /aria-busy="true"/); assert.equal((s.match(/mx-skeleton--card/g) || []).length, 2);
  assert.match(ds.emptyState({ title: 'Nothing', text: 'Come back later' }), /mx-empty[\s\S]*Nothing[\s\S]*Come back later/);
  assert.match(ds.emptyState({ title: 'x', action: { label: 'Add', attr: 'data-add' } }), /<button[^>]*data-add/);
});

test('ds.js: showToast looks the document up when called and works with a stand-in', () => {
  assert.equal(ds.showToast('hi', false, null), null);
  const made = []; const doc = { createElement: () => { const el = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {} }; made.push(el); return el; }, body: { appendChild() {} } };
  const t = ds.showToast('Saved', true, doc, 1); assert.equal(t.textContent, 'Saved'); assert.match(t.className, /toast fade bad/); assert.equal(t.attrs.role, 'status');
});

test('flow-core, Crew and Admin use ds.js; the status words come from it', () => {
  assert.match(read('crm/flow-core.js'), /from '\.\/ds\.js'/);
  assert.doesNotMatch(read('crm/flow-core.js'), /flow-chip|flow-empty/);
  assert.match(read('crm/ui.js'), /STAGE = Object\.fromEntries\(Object\.entries\(STATUS\)/);
  assert.match(read('crm/crm.js'), /from '\.\/ds\.js'/); assert.match(read('admin/admin.js'), /from '\.\/ds\.js'/);
  assert.match(read('admin/admin.js'), /scheduled: 'Booked \(visit scheduled\)'/);   // dropdown keeps both stored values settable; everywhere else both read Booked
  assert.match(read('admin/admin.js'), /STATUSES\.filter\(\(s\) => s !== 'scheduled'\)/);   // pipeline: one Booked row
});
