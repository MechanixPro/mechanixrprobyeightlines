import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ok = (p) => existsSync(new URL('../' + p.replace(/^\//, ''), import.meta.url));
const GARAGE = ['verified-bike-garages-bangalore', 'join', 'garage-partners'];
const TITLE = (h) => h.match(/<title>(.*?)<\/title>/)[1];
const imgs = (h) => [...h.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const main = (h) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
const stage = (h) => { const m = main(h); return m.slice(0, m.indexOf('class="sheet"') === -1 ? m.length : m.indexOf('class="sheet"')); };

test('garage pages exist with unique titles and canonicals', () => {
  const titles = new Set();
  for (const s of GARAGE) {
    const h = read(s + '/index.html');
    assert.match(h, new RegExp(`<link rel="canonical" href="https://mechanixpro\\.in/${s}/">`), s);
    const t = TITLE(h); assert.ok(!titles.has(t), 'duplicate title ' + t); titles.add(t);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, s + ' one H1');
  }
  assert.match(read('garage-partners/index.html'), /<h1>Partner your garage with Mechanix Pro\.<\/h1>/);
  // existing titles are unchanged
  assert.equal(TITLE(read('join/index.html')), 'Join Mechanix Pro: Garages and Mechanics in Bengaluru');
  assert.equal(TITLE(read('verified-bike-garages-bangalore/index.html')), 'Verified Bike Garages in Bangalore | Mechanix Pro Certified');
});
test('every image on the garage pages and on the header-picture pages exists and has alt, width and height; only one eager image per page', () => {
  const pages = [...GARAGE, 'bike-service/honda-activa-6g', 'bike-service-hsr-layout', 'car-service-bangalore', 'roadside', 'offers/bike-service', 'offers/diwali-ready', 'services', 'areas'];
  for (const s of pages) {
    const h = read(s + '/index.html');
    let eager = 0;
    for (const t of imgs(main(h))) {
      assert.match(t, /\balt="/, s + ' alt: ' + t.slice(0, 80)); assert.match(t, /\bwidth="\d+"/, s); assert.match(t, /\bheight="\d+"/, s);
      for (const m of t.matchAll(/(\/assets\/img\/[\w\/.-]+\.(?:webp|png|jpg|svg))/g)) assert.ok(ok(m[1]), m[1]);
      if (/loading="eager"/.test(t)) eager++;
    }
    assert.ok(eager <= 1, s + ' eager images: ' + eager);
  }
});
test('no inline scripts or handlers on the garage pages', () => {
  for (const s of GARAGE) {
    const h = read(s + '/index.html');
    assert.doesNotMatch(h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''), /<script(?![^>]*\bsrc=)[^>]*>/, s + ' inline script');
    assert.doesNotMatch(h, /\son(click|load|error|submit|change)=/i, s);
  }
});
test('trust-number claims stay off car, roadside, Axlio and garage pages (they are for bike pages only)', () => {
  for (const f of ['car-service-bangalore', 'roadside', 'partners/axlio', ...GARAGE]) assert.doesNotMatch(read(f + '/index.html'), /10,000\+|1,300\+/, f);
  for (const f of GARAGE) assert.doesNotMatch(main(read(f + '/index.html')), /ratings?\b.{0,30}\d|₹\s?\d{2,3},?\d* (per|a) (job|month|week)|payout|earn/i, f + ' no invented ratings, payouts or earnings');
});
test('pages.css stays within its own size budget and is linked only where a picture or garage block is used', () => {
  assert.ok(statSync(new URL('../assets/css/pages.css', import.meta.url)).size < 6000, 'pages.css budget 6,000 bytes');
  assert.ok(statSync(new URL('../assets/css/site.css', import.meta.url)).size < 32000, 'site.css budget 32,000 bytes');
  for (const f of ['book/index.html', 'track/index.html', 'terms/index.html', 'privacy/index.html', 'index.html']) assert.doesNotMatch(read(f), /pages\.css/, f);
  for (const f of GARAGE) assert.match(read(f + '/index.html'), /<link rel="stylesheet" href="\/assets\/css\/pages\.css(\?v=\w+)?">/, f);
});
test('header picture: right asset per family, in the stage, with srcset; absent on single-task and legal pages', () => {
  const want = { 'bike-service/honda-activa-6g': 'hero-bike', 'bike-service-hsr-layout': 'hero-bike', 'two-wheeler-service-at-home-bangalore': 'hero-bike', 'offers/bike-service': 'hero-bike', 'car-service-bangalore': 'hero-car', 'roadside': 'roadside-night', 'verified-bike-garages-bangalore': 'garage-front', 'join': 'garage-front', 'garage-partners': 'garage-front' };
  for (const [s, stem] of Object.entries(want)) {
    const h = read(s + '/index.html'), st = main(h).slice(0, main(h).indexOf('</section>') + 10);
    assert.match(st, /<section[^>]*class="[^"]*\bstage has-pic/, s + ' stage has-pic');
    const fig = st.match(/<figure class="stage-pic[^"]*">(<img[^>]*>)<\/figure>/); assert.ok(fig, s + ' picture in the stage');
    assert.match(fig[1], new RegExp(`srcset="/assets/img/hero/${stem}-700\\.webp 700w, /assets/img/hero/${stem}-1200\\.webp 1200w"`), s);
    assert.match(fig[1], /fetchpriority="high"/); assert.match(fig[1], /\balt="[^"]{20,}"/); assert.doesNotMatch(fig[1], /Illustration/);
    assert.equal(imgs(main(h)).filter((t) => /stage-pic|\/hero\/(hero|roadside|garage-front)/.test(t) && /loading="eager"/.test(t)).length, 1, s);
    assert.ok(statSync(new URL(`../assets/img/hero/${stem}-1200.webp`, import.meta.url)).size < 56000);
    assert.doesNotMatch(h, /hero-minimal|\/assets\/img\/workshop\//, s);
  }
  for (const s of ['book', 'pay', 'track', 'rate', 'warranty', 'job', 'unsubscribe', 'help-desk', 'terms', 'privacy', 'refund-policy', 'contact', 'quote']) {
    if (!ok(s + '/index.html')) continue;
    assert.doesNotMatch(read(s + '/index.html'), /stage-pic|has-pic/, s + ' stays without a picture');
  }
});
test('garage pages: icon cards, call to action hooks, the existing application form is untouched, links to the partner page', () => {
  const v = read('verified-bike-garages-bangalore/index.html'), j = read('join/index.html'), g = read('garage-partners/index.html');
  for (const h of [v, j, g]) { assert.match(h, /class="gcards"/); assert.match(h, /why-(door|quote|approve|code)\.webp/); assert.match(h, /data-wa="general"/); assert.match(h, /data-call/); }
  assert.match(v, /What a Mechanix Pro garage is\./); assert.match(j, /What a Mechanix Pro garage is\./);
  assert.match(j, /<form class="wl card" id="partnerForm" novalidate>/); assert.match(j, /partner\.js/);
  assert.equal((g.match(/<form\b/g) || []).length, 0, 'the partner page has no second form');
  for (const h of [v, j]) assert.match(h, /href="\/garage-partners\/"/);
  assert.match(g, /href="\/join\/#apply"/);
  assert.match(g, /"@type": "WebPage"/); assert.match(g, /BreadcrumbList/); assert.doesNotMatch(g, /AggregateRating|"Offer"|"Review"/);
});
test('sitemap, llms.txt, nav and the build copy list include /garage-partners/', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/mechanixpro\.in\/garage-partners\/<\/loc>/);
  assert.match(read('llms.txt'), /\[Partner your garage\]\(https:\/\/mechanixpro\.in\/garage-partners\/\)/);
  assert.match(read('index.html'), /<a href="\/join\/">Join as a garage or mechanic<\/a><a href="\/garage-partners\/">Partner your garage<\/a>/);
  assert.match(read('scripts/build_site.sh'), /\bgarage-partners\b/);
});

// ---- Round 2: videos, new header pictures, body pictures ----
const NEW_MEDIA = ['code-handover', 'societies', 'fleet', 'garage'];
const NEW_STILLS = ['code-handover', 'car-closeup', 'ev-care', 'monsoon-check', 'parts-counter', 'thumbs-up'];
test('new videos: files exist, under 1.3 MB, no audio track, no AI-tool tags; posters are small', () => {
  for (const n of NEW_MEDIA) {
    const f = `assets/video/${n}.mp4`, b = readFileSync(new URL('../' + f, import.meta.url));
    assert.ok(b.length < 1_300_000, f + ' is ' + b.length);
    assert.ok(!b.includes(Buffer.from('mp4a')), f + ' has no AAC audio track');
    for (const bad of ['gemini', 'Gemini', 'Google', 'Veo']) assert.ok(!b.includes(Buffer.from(bad)), f + ' no ' + bad);
    const p = `assets/img/hero/${n}-poster.webp`; assert.ok(ok(p), p); assert.ok(statSync(new URL('../' + p, import.meta.url)).size < 40_000, p + ' small');
  }
  for (const n of NEW_STILLS) for (const w of [700, 1200]) {
    const f = `assets/img/hero/${n}-${w}.webp`, b = readFileSync(new URL('../' + f, import.meta.url));
    assert.ok(b.length < 80_000, f + ' is ' + b.length);
    for (const bad of ['gemini', 'Gemini', 'Google', 'Veo']) assert.ok(!b.includes(Buffer.from(bad)), f + ' no ' + bad);
  }
});
test('videos sit on the right pages with poster, muted loop, sizes, aria-label, caption; hero-video.js is loaded only where a hm-v video is', () => {
  const where = { 'garage-partners': 'garage', 'join': 'garage', 'verified-bike-garages-bangalore': 'garage', 'help': 'code-handover', 'societies': 'societies' };   // fleet video withheld: seam in the footage
  for (const [s, n] of Object.entries(where)) {
    const h = read(s + '/index.html'), v = h.match(/<video\b[^>]*class="hm-v"[^>]*>/)[0];
    for (const a of ['autoplay', 'muted', 'loop', 'playsinline']) assert.match(v, new RegExp('\\b' + a + '\\b'), s + ' ' + a);
    assert.match(v, new RegExp(`poster="/assets/img/hero/${n}-poster\\.webp"`), s); assert.match(v, /preload="metadata"/); assert.match(v, /width="1280"/); assert.match(v, /height="572"/); assert.match(v, /aria-label="[^"]{20,}"/);
    assert.match(h, new RegExp(`<source src="/assets/video/${n}\\.mp4" type="video/mp4">`), s);
    assert.match(h, /<figcaption>[^<]{8,}<\/figcaption>/, s);
    assert.match(h, /<script src="\/assets\/js\/hero-video\.js(\?v=\w+)?" defer><\/script>/, s);
    assert.equal((h.match(/<video\b/g) || []).length, 1, s + ' one video');
  }
  assert.match(read('garage-partners/index.html'), /<figcaption>A partner workshop<\/figcaption>/);
  assert.match(read('help/index.html'), /<figcaption>Show the code on your phone to the mechanic when they arrive\.<\/figcaption>/);
  for (const s of ['book', 'car-service-bangalore', 'roadside', 'services', 'terms', 'partners/axlio']) assert.doesNotMatch(read(s + '/index.html'), /hero-video\.js|<video/, s);
  // the code video sits inside the 'Share your code when they arrive' step
  const hp = read('help/index.html'); const li = hp.slice(hp.indexOf('Share your code when they arrive'), hp.indexOf('Itemised quote, you approve'));
  assert.match(li, /<video\b/);
});
test('hero-video.js handles every hm-v video, plays only on screen and while the tab is visible, stays still for reduced motion and data saver', () => {
  const j = read('assets/js/hero-video.js');
  assert.match(j, /querySelectorAll\('video\.hm-v'\)/); assert.match(j, /IntersectionObserver/); assert.match(j, /visibilitychange/); assert.match(j, /document\.hidden/);
  assert.match(j, /prefers-reduced-motion: reduce/); assert.match(j, /saveData/); assert.doesNotMatch(j, /fetch\(|XMLHttpRequest|https?:\/\//);
});
test('new header pictures: ev, monsoon and Axlio; the car page has a body picture, Axlio stays free of bike claims', () => {
  const want = { 'offers/ev-check': 'ev-care', 'ev-and-petrol-bike-care-bangalore': 'ev-care', 'offers/monsoon-check': 'monsoon-check', 'partners/axlio': 'parts-counter' };
  for (const [s, stem] of Object.entries(want)) {
    const h = read(s + '/index.html');
    assert.match(h, new RegExp(`srcset="/assets/img/hero/${stem}-700\\.webp 700w, /assets/img/hero/${stem}-1200\\.webp 1200w"`), s);
    assert.match(h, /<section[^>]*class="[^"]*\bstage has-pic/, s);
  }
  const car = read('car-service-bangalore/index.html');
  assert.match(car, /<img src="\/assets\/img\/hero\/car-closeup-700\.webp"[^>]*loading="lazy"[^>]*alt="[^"]{20,}"/); assert.match(car, /hero-car-1200\.webp/);
  assert.doesNotMatch(read('partners/axlio/index.html'), /10,000\+|1,300\+/);
  for (const s of ['help', 'societies', 'fleet', 'car-service-bangalore', 'partners/axlio', 'offers/ev-check', 'offers/monsoon-check']) {
    const h = read(s + '/index.html'); let eager = 0;
    for (const t of imgs(main(h))) { assert.match(t, /\balt="/, s); assert.match(t, /\bwidth="\d+"/, s); assert.match(t, /\bheight="\d+"/, s); if (/loading="eager"/.test(t)) eager++; }
    assert.ok(eager <= 1, s + ' eager ' + eager);
  }
  assert.doesNotMatch(read('assets/css/pages.css'), /thumbs-up/); for (const f of [...GARAGE, 'help']) assert.doesNotMatch(read(f + '/index.html'), /thumbs-up/, 'thumbs-up is not used yet');
  for (const s of [...GARAGE, 'help', 'car-service-bangalore', 'partners/axlio']) assert.doesNotMatch(main(read(s + '/index.html')), /10,000\+|1,300\+/, s);
});
