import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../assets/js/garage.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TOK = 'ab12'.repeat(12);

test('the page is private: noindex, no referrer, no site chrome, not in the sitemap or llms.txt', () => {
  const h = read('garage/index.html');
  assert.match(h, /name="robots" content="noindex,nofollow,noarchive"/); assert.match(h, /name="referrer" content="no-referrer"/);
  assert.match(h, /<link rel="manifest" href="\/garage\.webmanifest">/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(h), 'no inline script');
  assert.ok(!/tags\.js|adref|mechu|class="dock"|class="top"|hero/i.test(h), 'no analytics, Mechu, dock, header or hero');
  assert.ok(!read('sitemap.xml').includes('mechanixpro.in/garage/'), 'not in the sitemap');
  assert.ok(!/\/garage\/(?!-)/.test(read('llms.txt')), 'not in llms.txt');
});
test('headers: noindex, no-store and a strict CSP for /garage/', () => {
  const hd = read('_headers'), blk = hd.slice(hd.indexOf('/garage/*'), hd.indexOf('/admin/*'));
  assert.match(blk, /X-Robots-Tag: noindex/); assert.match(blk, /Cache-Control: no-store/); assert.match(blk, /script-src 'self';/); assert.ok(!/unsafe-inline|unsafe-eval/.test(blk));
  assert.match(blk, /default-src 'none'/); assert.match(blk, /frame-ancestors 'none'/);
});
test('manifest: own scope and start URL, existing icons, site colours', () => {
  const m = JSON.parse(read('garage.webmanifest'));
  assert.equal(m.start_url, '/garage/'); assert.equal(m.scope, '/garage/'); assert.equal(m.name, 'Mechanix Pro Garage'); assert.equal(m.display, 'standalone'); assert.equal(m.theme_color, '#0B1220');
  for (const i of m.icons) assert.ok(existsSync(new URL('..' + i.src, import.meta.url)));
});
test('built into the site, and no service worker caches the app', () => {
  const b = read('scripts/build_site.sh'); assert.match(b, /garage\.webmanifest/); assert.match(b, /for d in job garage /);
  assert.match(read('sw.js'), /startsWith\('\/garage\/'\) \|\| url\.pathname\.startsWith\('\/mechanic\/'\)\) return/);
  assert.ok(!/serviceWorker\.register/.test(read('assets/js/garage.js')), 'the garage app registers no worker');
  assert.match(read('package.json'), /node --check assets\/js\/garage\.js/);
});
test('the app has no inline style, no inline handler, no hard-coded team number, no eval', () => {
  const j = read('assets/js/garage.js');
  assert.ok(!/setAttribute\('style'|\.style\.cssText|innerHTML|insertAdjacentHTML|eval\(|new Function/.test(j)); assert.ok(!/\+?91\s?\d{5}\s?\d{5}|\b[6-9]\d{9}\b/.test(j.replace(/\[6-9\]/g, '')), 'no phone number in the code');
  assert.ok(!/localStorage\.setItem\([^)]*phone/i.test(j), 'the customer number is never stored');
  assert.ok(!/garage-app/.test(read('assets/css/garage.css')));
  assert.ok(!/style=/.test(read('garage/index.html').replace(/<noscript>[\s\S]*<\/noscript>/, '')) );
});
test('helpers: money, totals with GST apart, times in India, tel links', () => {
  assert.equal(G.money(1475), '₹1,475'); assert.equal(G.money(12.5), '₹12.50');
  assert.deepEqual(G.totals([{ amount: '850' }, { amount: 400 }, { amount: 'x' }, { amount: -5 }]), { subtotal: 1250, gst: 225, total: 1475 });
  assert.equal(G.whenText('2026-11-09T04:30:00Z'), 'Mon, 9 Nov, 10:00 am'); assert.equal(G.whenText(null), null);
  assert.equal(G.telHref('98765 43210'), 'tel:+919876543210'); assert.equal(G.telHref('12345'), null); assert.equal(G.phoneShow('9876543210'), '+91 98765 43210');
});
test('team contact comes from the site config; Call is hidden when the site sends calls to WhatsApp', () => {
  const t = G.teamLinks({ whatsapp: '910000000001', callNumber: '910000000002', callViaWhatsApp: false });
  assert.match(t.whatsapp, /^https:\/\/wa\.me\/910000000001\?text=/); assert.equal(t.call, 'tel:+910000000002');
  assert.equal(G.teamLinks({ whatsapp: '910000000001', callNumber: '910000000002', callViaWhatsApp: true }).call, null);
  assert.equal(G.teamLinks({}).whatsapp, null);
  assert.match(G.teamLinks({ whatsapp: '910000000001' }, { whatsapp: '910000000009' }).whatsapp, /910000000009/);
});
test('link and session storage: only a 48-hex link is kept; an expired session is dropped', () => {
  const mem = {}, win = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } } };
  assert.equal(G.saveLink(win, 'nope'), false); assert.equal(G.savedLink(win), null);
  assert.equal(G.saveLink(win, TOK), true); assert.equal(G.savedLink(win), TOK);
  assert.equal(G.linkFromUrl('?g=' + TOK.toUpperCase()), TOK); assert.equal(G.linkFromUrl('?g=short'), null); assert.equal(G.linkFromUrl('?x=1&g=' + TOK), TOK);
  G.saveSession(win, { session: 'tkn', expires_at: new Date(Date.now() + 3600e3).toISOString(), garage: { name: 'Test Garage' } });
  assert.equal(G.savedSession(win).t, 'tkn');
  G.saveSession(win, { session: 'old', expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(G.savedSession(win), null); assert.ok(!(G.SESSION_KEY in mem));
});
