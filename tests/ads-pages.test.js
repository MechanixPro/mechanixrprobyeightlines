// Ad landing pages, roadside page, and the tracking tags (off until IDs are set).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const offers = JSON.parse(read('src/offers.json'));
const site = JSON.parse(read('src/site.json'));

test('four ad campaigns exist with a slug, headline and a real service', () => {
  assert.deepEqual(offers.map((o) => o.slug).sort(), ['bike-service', 'ev-check', 'monsoon-check', 'pre-trip-check']);
  for (const o of offers) { assert.match(o.slug, /^[a-z0-9-]+$/); assert.ok(o.headline && o.lead && o.service in site.services); assert.ok(o.checks.length >= 4); }
});
for (const o of offers) {
  test(`/offers/${o.slug}/ has one headline, the real price, the campaign tag, and stays out of search`, () => {
    const h = read(`offers/${o.slug}/index.html`);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.match(h, /name="robots" content="noindex,nofollow"/);
    assert.ok(h.includes('₹' + site.services[o.service].price.toLocaleString('en-IN')), 'price');
    assert.ok(h.includes('/book/?service=' + o.service + '&amp;campaign=' + o.slug) || h.includes('/book/?service=' + o.service + '&campaign=' + o.slug));
    assert.match(h, /data-wa-text="[^"]*"/);
    assert.doesNotMatch(h, /\{\{/);
    assert.doesNotMatch(read('sitemap.xml'), new RegExp('/offers/' + o.slug + '/'));
    // no made-up urgency or discounts
    assert.doesNotMatch(h, /countdown|hurry|limited (time|slots|offer)|only \d+ (slots|left)|\d+% off|flat \d+|last chance|expires/i);
  });
}
test('the roadside page is indexable, in the sitemap, and has call and WhatsApp buttons', () => {
  const h = read('roadside/index.html');
  assert.doesNotMatch(h, /noindex/); assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.match(h, /<title>[^<]*Breakdown[^<]*Bengaluru/i); assert.match(h, /data-call/); assert.match(h, /data-wa-text=/);
  assert.match(h, /₹699/); assert.match(read('sitemap.xml'), /\/roadside\//);
  assert.doesNotMatch(h, /\d+ ?min(ute)?s? (arrival|response)|arrive in/i); // no promised arrival time
});
test('the site menu and footer link to the roadside page', () => {
  assert.match(read('index.html'), /href="\/roadside\/"/);
  assert.match(read('scripts/build_site.sh'), /\boffers\b/); assert.match(read('scripts/build_site.sh'), /\broadside\b/);
});

// ---- tags.js ----
function run(cfg) {
  const calls = { scripts: [], gtag: [], fbq: [], store: {} };
  const doc = { head: { appendChild: (s) => calls.scripts.push(s.src) }, createElement: () => ({}), addEventListener: (t, f) => { calls.click = f; }, getElementsByTagName: () => [{ parentNode: { insertBefore: (s) => calls.scripts.push(s.src) } }] };
  const win = { MXP: cfg, document: doc, location: { search: '?utm_source=google&gclid=abc&utm_campaign=monsoon-check' }, sessionStorage: { getItem: (k) => calls.store[k] || null, setItem: (k, v) => { calls.store[k] = v; } } };
  win.window = win; win.URLSearchParams = URLSearchParams; vm.createContext(win); vm.runInContext(read('assets/js/tags.js'), win);
  return { win, calls };
}
test('tags: with no IDs set nothing is loaded and tracking calls are harmless', () => {
  const { win, calls } = run({});
  assert.equal(calls.scripts.length, 0); assert.equal(typeof win.mxpTrack, 'function'); win.mxpTrack('generate_lead', { value: 100 });
});
test('tags: ad click details are kept for the booking page', () => {
  const { calls } = run({});
  assert.deepEqual(JSON.parse(calls.store.mxp_utm), { utm_source: 'google', gclid: 'abc', utm_campaign: 'monsoon-check' });
});
test('tags: Google loads once with the analytics ID, and a lead counts as an Ads conversion', () => {
  const { win, calls } = run({ gaId: 'G-TEST123', googleAdsSendTo: 'AW-111/abc' });
  assert.equal(calls.scripts.filter((s) => /googletagmanager\.com\/gtag\/js\?id=G-TEST123/.test(s)).length, 1);
  win.window.gtag = (...a) => calls.gtag.push(a); // after load, calls go here
  win.mxpTrack('generate_lead', { value: 1299 });
  assert.ok(calls.gtag.some((a) => a[0] === 'event' && a[1] === 'conversion' && a[2].send_to === 'AW-111/abc' && a[2].value === 1 && a[2].currency === 'INR'));
});
test('tags: the Meta Pixel loads only with a pixel ID and a lead sends the Lead event', () => {
  const { win, calls } = run({ metaPixelId: '123456789' });
  assert.ok(calls.scripts.some((s) => /connect\.facebook\.net/.test(s)));
  assert.equal(typeof win.fbq, 'function');
  const got = []; win.fbq = (...a) => got.push(a); win.mxpTrack('generate_lead', { value: 500 });
  assert.deepEqual(got.find((a) => a[1] === 'Lead').slice(0, 2), ['track', 'Lead']);
});
test('tags: never sends a name, phone or email to an ad network', () => {
  const src = read('assets/js/tags.js');
  assert.doesNotMatch(src, /user_data|\.phone|\.email|em:|ph:/);
});
test('the booking form uses the shared tags and no longer loads its own analytics', () => {
  const a = read('assets/js/app.js');
  assert.match(a, /mxpTrack/); assert.doesNotMatch(a, /googletagmanager\.com\/gtag/);
  assert.match(read('scripts/build_pages.py'), /assets\/js\/tags\.js/);
  assert.match(read('index.html'), /assets\/js\/tags\.js/);
});
test('the security policy allows the ad tags and the privacy policy says they are used', () => {
  const h = read('_headers');
  assert.match(h, /script-src[^;]*https:\/\/connect\.facebook\.net/); assert.match(h, /connect-src[^;]*https:\/\/www\.facebook\.com/); assert.match(h, /connect-src[^;]*doubleclick\.net/);
  assert.match(read('privacy/index.html'), /advertising/i);
});
test('the ads playbook exists and promises no results', () => {
  const d = read('docs/ADS-PLAYBOOK.md');
  assert.match(d, /60%/); assert.match(d, /Negative keywords/i); assert.match(d, /cost per request/i);
  assert.doesNotMatch(d, /guarantee|will get you \d+|\d+x return/i);
});

test('tags: the Google Ads tag ID alone loads the tag, and no conversion is sent until the conversion label is set', () => {
  const a = run({ googleAdsId: 'AW-18504366564' });
  assert.equal(a.calls.scripts.filter((s) => /gtag\/js\?id=AW-18504366564/.test(s)).length, 1);
  a.win.window.gtag = (...x) => a.calls.gtag.push(x); a.win.mxpTrack('generate_lead', { value: 1 });
  assert.ok(a.calls.gtag.some((x) => x[0] === 'event' && x[1] === 'generate_lead'));
  assert.ok(!a.calls.gtag.some((x) => x[1] === 'conversion'));
  assert.match(read('assets/js/config.js'), /googleAdsId: 'AW-\d+'/);
});

test('the security policy lets the Google Ads tag do its calls', () => {
  const h = read('_headers');
  assert.match(h, /script-src[^;]*https:\/\/googleads\.g\.doubleclick\.net/); assert.match(h, /script-src[^;]*https:\/\/www\.googleadservices\.com/);
  assert.match(h, /connect-src[^;]*https:\/\/www\.google\.com/); assert.match(h, /connect-src[^;]*doubleclick\.net/);
});

test('the real conversion label is set in config.js', () => {
  assert.match(read('assets/js/config.js'), /googleAdsSendTo: 'AW-18504366564\/[A-Za-z0-9_-]{10,}'/);
});

test('the Google Ads campaign pack respects the length limits and uses real pages', () => {
  const d = read('docs/GOOGLE-ADS-CAMPAIGN.md');
  const block = (title) => d.split(title)[1].split('```')[1].trim().split('\n');
  const heads = block('**Headlines**'), descs = block('**Descriptions**');
  assert.equal(heads.length, 12); for (const h of heads) assert.ok(h.length <= 30, h);
  assert.equal(descs.length, 4); for (const x of descs) assert.ok(x.length <= 90, x);
  assert.match(d, /offers\/bike-service\//); assert.match(d, /₹165/); assert.match(d, /Negative keywords/);
  assert.doesNotMatch(d, /cheapest|best price|guarantee|free service|% off/i);
});

test('the Performance Max pack respects asset length limits and avoids licensed photos', () => {
  const d = read('docs/GOOGLE-ADS-PMAX.md');
  const block = (title) => d.split(title)[1].split('```')[1].trim().split('\n');
  const heads = block('**Headlines**'), longs = block('**Long headlines**'), descs = block('**Descriptions**');
  assert.equal(heads.length, 15); for (const h of heads) assert.ok(h.length <= 30, h);
  assert.equal(longs.length, 5); for (const x of longs) assert.ok(x.length <= 90, x);
  assert.equal(descs.length, 5); for (const x of descs) assert.ok(x.length <= 90, x); assert.ok(descs[4].length <= 60);
  assert.match(d, /Final URL expansion: OFF/); assert.match(d, /Wikimedia/); assert.doesNotMatch(d, /cheapest|best price|guarantee|% off/i);
});

test('the security policy allows the Indian Google domain that Ads conversions use for visitors in India', () => {
  assert.match(read('_headers'), /connect-src[^;]*https:\/\/www\.google\.co\.in/);
});
