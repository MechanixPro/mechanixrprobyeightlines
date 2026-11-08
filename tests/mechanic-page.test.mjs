import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../assets/js/mechanic.js'), QR = require('../assets/js/qr.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TOK = 'cd34'.repeat(12);

test('the page is private: noindex, no referrer, no site chrome or analytics, not in the sitemap, llms.txt or robots', () => {
  const h = read('mechanic/index.html');
  assert.match(h, /name="robots" content="noindex,nofollow,noarchive"/); assert.match(h, /name="referrer" content="no-referrer"/);
  assert.match(h, /<link rel="manifest" href="\/mechanic\.webmanifest">/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(h), 'no inline script');
  assert.ok(!/tags\.js|adref|mechu|gtag|fbq|analytics|class="dock"|class="top"|hero/i.test(h), 'no analytics, Mechu, dock, header or hero');
  assert.ok(!/style=/.test(h.replace(/<noscript>[\s\S]*<\/noscript>/, '')), 'no inline style');
  for (const f of ['sitemap.xml', 'llms.txt']) assert.ok(!read(f).includes('/mechanic'), 'not in ' + f);
  const scripts = [...h.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]); assert.deepEqual(scripts, ['/assets/js/config.js', '/assets/js/install.js', '/assets/js/qr.js', '/assets/js/partner-flow.js', '/assets/js/mechanic.js']);
  for (const s of scripts) assert.ok(existsSync(new URL('..' + s, import.meta.url)), s + ' exists');
});
test('headers: noindex, no-store and a strict CSP (no inline, no third-party host) for /mechanic/', () => {
  const hd = read('_headers'), blk = hd.slice(hd.indexOf('/mechanic/*'), hd.indexOf('/mechanic.webmanifest'));
  assert.match(blk, /X-Robots-Tag: noindex/); assert.match(blk, /Cache-Control: no-store/); assert.match(blk, /Referrer-Policy: no-referrer/);
  assert.match(blk, /default-src 'none'/); assert.match(blk, /script-src 'self';/); assert.match(blk, /style-src 'self';/); assert.ok(!/unsafe-inline|unsafe-eval/.test(blk));
  assert.match(blk, /frame-ancestors 'none'/); assert.match(blk, /form-action 'none'/);
  const hosts = [...blk.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]); assert.deepEqual(hosts.filter((x) => !/supabase\.co$/.test(x) && x !== 'https:'), []);
  assert.match(hd, /\/mechanic\n  X-Robots-Tag: noindex/);
});
test('manifest: own scope and start URL, existing icons, site colours', () => {
  const m = JSON.parse(read('mechanic.webmanifest'));
  assert.equal(m.start_url, '/mechanic/'); assert.equal(m.scope, '/mechanic/'); assert.equal(m.id, '/mechanic/'); assert.equal(m.name, 'Mechanix Pro Mechanic'); assert.equal(m.display, 'standalone'); assert.equal(m.theme_color, '#0B1220');
  for (const i of m.icons) assert.ok(existsSync(new URL('..' + i.src, import.meta.url)));
});
test('built into the site; no service worker caches or registers for the app', () => {
  const b = read('scripts/build_site.sh'); assert.match(b, /mechanic\.webmanifest/); assert.match(b, /for d in job garage mechanic /);
  assert.match(read('sw.js'), /startsWith\('\/mechanic\/'\)\) return/);
  assert.ok(!/serviceWorker\.register/.test(read('assets/js/mechanic.js')));
  const pk = read('package.json'); assert.match(pk, /node --check assets\/js\/mechanic\.js/); assert.match(pk, /node --check assets\/js\/qr\.js/);
});
test('the app code: no inline style, no innerHTML or eval, no phone number, no third-party host, nothing private stored', () => {
  for (const f of ['assets/js/mechanic.js', 'assets/js/qr.js']) {
    const j = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/setAttribute\('style'|\.style\.cssText|innerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/.test(j), f);
    assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg|wa\.me\/)/.test(j), f + ' calls no outside host (the only URLs are the SVG namespace and wa.me)');
    assert.ok(!/\+?91\s?\d{5}\s?\d{5}|\b[6-9]\d{9}\b/.test(j.replace(/\[6-9\]/g, '')), f + ' holds no phone number');
  }
  const j = read('assets/js/mechanic.js');
  assert.ok(!/localStorage\.setItem\([^)]*(phone|pay|url|amount)/i.test(j), 'only the link and the session are stored');
  assert.deepEqual([...j.matchAll(/localStorage\.(?:set|get|remove)Item\(([A-Z_]+)/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['LINK_KEY', 'SEEN_KEY', 'SESSION_KEY']);   // Why: M1a adds SEEN_KEY, only job ids already shown as an offer on this phone (so one job never rings twice); no phone, amount or url
  assert.ok(!/style=/.test(read('assets/css/garage.css')) && !/url\(http/.test(read('assets/css/garage.css')));
  assert.match(j, /mechanic-app/); assert.ok(!/garage-app/.test(j));
});
test('helpers: money, India dates, tel links, link and session storage', () => {
  assert.equal(M.money(880), '₹880'); assert.equal(M.money(504.24), '₹504.24'); assert.equal(M.money(1384.2), '₹1,384.20'); assert.equal(M.money(0), '₹0');
  assert.equal(M.todayIST(Date.parse('2026-11-07T20:00:00Z')), '2026-11-08'); assert.equal(M.dayLabel('2026-11-07'), 'Sat, 7 Nov'); assert.equal(M.dayLabel('junk'), '');
  assert.equal(M.telHref('98765 43210'), 'tel:+919876543210'); assert.equal(M.telHref('12345'), null); assert.equal(M.phoneShow('9876543210'), '+91 98765 43210');
  const mem = {}, win = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } } };
  assert.equal(M.saveLink(win, 'nope'), false); assert.equal(M.saveLink(win, TOK), true); assert.equal(M.savedLink(win), TOK);
  assert.equal(M.linkFromUrl('?m=' + TOK.toUpperCase()), TOK); assert.equal(M.linkFromUrl('?g=' + TOK), null, 'a garage link is not a mechanic link'); assert.equal(M.linkFromUrl('?m=short'), null);
  M.saveSession(win, { session: 'tkn', expires_at: new Date(Date.now() + 3600e3).toISOString(), mechanic: { name: 'Test Mechanic' } }); assert.equal(M.savedSession(win).t, 'tkn');
  M.saveSession(win, { session: 'old', expires_at: new Date(Date.now() - 1000).toISOString() }); assert.equal(M.savedSession(win), null); assert.ok(!(M.SESSION_KEY in mem));
  assert.equal(M.dueText({ total_due: 5, company_owes: 0 }), 'Pay this to Mechanix Pro'); assert.equal(M.dueText({ total_due: 0, company_owes: 20 }), 'Mechanix Pro owes you ₹20'); assert.equal(M.dueText({ total_due: 0, company_owes: 0 }), 'Nothing due. All settled.');
  assert.match(M.teamLinks({ whatsapp: '910000000001' }).whatsapp, /^https:\/\/wa\.me\/910000000001\?text=/);
});

/* ---------- QR encoder: structure checks here; the preview script and a one-off CoreImage decode proved real scanners read it ---------- */
test('QR: version grows with the text, finder patterns and timing are in place, same text gives the same code, too long is refused', () => {
  const a = QR.encode('https://rzp.io/i/AbC123xyz'), b = QR.encode('https://rzp.io/i/AbC123xyz'), c = QR.encode('x'.repeat(120)), e = QR.encode('x'.repeat(200));
  assert.equal(a.version, 2); assert.equal(a.size, 25); assert.ok(c.version > a.version && e.version >= c.version); assert.equal(e.size, e.version * 4 + 17);
  const grid = (q) => Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => (q.get(x, y) ? 1 : 0)).join('')).join('\n'); assert.equal(grid(a), grid(b));
  for (const [x0, y0] of [[0, 0], [a.size - 7, 0], [0, a.size - 7]]) { for (let i = 0; i < 7; i++) { assert.ok(a.get(x0 + i, y0) && a.get(x0 + i, y0 + 6) && a.get(x0, y0 + i) && a.get(x0 + 6, y0 + i), 'finder ring'); } assert.ok(a.get(x0 + 3, y0 + 3), 'finder centre'); assert.ok(!a.get(x0 + 1, y0 + 1), 'finder gap'); }
  for (let i = 8; i < a.size - 8; i++) { assert.equal(a.get(i, 6), i % 2 === 0); assert.equal(a.get(6, i), i % 2 === 0); }
  assert.ok(a.get(8, a.size - 8), 'the always-dark module'); assert.throws(() => QR.encode('x'.repeat(300)), /Too long/);
  assert.ok(QR.encode('Mechanix ₹ Pro').size >= 21, 'non-ASCII text is encoded as UTF-8');
});
test('QR: the SVG is built from attributes only (no style attribute), with a quiet zone and one path', () => {
  const made = [], doc = { createElementNS: (ns, tag) => { const n = { ns, tag, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); } }; made.push(n); return n; } };
  const s = QR.svg(doc, 'https://rzp.io/i/AbC123xyz', 200);
  assert.equal(s.tag, 'svg'); assert.equal(s.ns, 'http://www.w3.org/2000/svg'); assert.equal(s.attrs.viewBox, '0 0 33 33'); assert.equal(s.attrs.width, '200');
  assert.ok(made.every((n) => !('style' in n.attrs))); const path = s.kids.find((k) => k.tag === 'path'); assert.match(path.attrs.d, /^M\d+ \d+h1v1h-1z/); assert.ok(!/M[0-3] /.test(path.attrs.d.replace(/M\d+ [0-3]h/g, 'M9 9h')), 'nothing is drawn in the quiet zone');
});
