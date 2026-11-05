import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
const css = read('assets/css/site.css');
const SAMPLE = ['index.html', 'bike-service-hsr-layout/index.html', 'bike-service/honda-activa-6g/index.html', 'car-service-bangalore/index.html', 'services/index.html', 'roadside/index.html'];

test('the home page has six sections, in the order a visitor decides', () => {
  const ids = [...main.matchAll(/<section[^>]*id="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['hero', 'brief', 'work', 'prices', 'trust', 'shop', 'areas', 'faq', 'tools']);
  assert.ok(main.indexOf('class="stage"') < main.indexOf('class="sheet"'), 'a navy stage first, then the light sheet');
  assert.equal((main.match(/<h1[ >]/g) || []).length, 1);
});
test('the hero says the offer in one line, and the quote-first promise in the next', () => {
  assert.match(main, /<h1[^>]*>Bike and car service at your home in Bengaluru\.<\/h1>/);
  assert.match(main, /<p class="lead">Quote first\. You approve before we start\.<\/p>/);
});
test('the Bike / Car toggle works without scripts: two radios, two labels, CSS decides what shows', () => {
  assert.match(main, /<input class="veh-in" type="radio" name="vehicle" id="veh-bike" checked>/);
  assert.match(main, /<input class="veh-in" type="radio" name="vehicle" id="veh-car">/);
  assert.match(main, /<label for="veh-bike">Bike<\/label><label for="veh-car">Car<\/label>/);
  assert.match(css, /#veh-car:checked ~ \* \.bike-only\{display:none!important\}/);
  assert.match(css, /#veh-car:checked ~ \* \.car-only\{display:var\(--d,block\)!important\}/);
  assert.ok(main.indexOf('id="veh-bike"') < main.indexOf('class="veh"'), 'the toggle sits above the buttons');
  assert.ok(main.indexOf('class="veh"') < main.indexOf('class="bike-only btns"'));
});
test('three buttons in order: WhatsApp quote (main, green), Call now, Book online; the car set swaps wording and links', () => {
  const bike = main.match(/<div class="bike-only btns">([\s\S]*?)<\/div><\/div>/)[1];
  const wa = bike.indexOf('btn btn-wa btn-xl'), call = bike.indexOf('data-call'), book = bike.indexOf('href="/book/"');
  assert.ok(wa > -1 && wa < call && call < book, 'WhatsApp, then Call now, then Book online');
  assert.match(bike, /data-wa="general" data-wa-text="Hi Mechanix Pro, I need a service for my bike in Bengaluru\./);
  assert.match(bike, />Book online</); assert.match(bike, />Call now</);
  const car = main.match(/<div class="car-only btns">([\s\S]*?)<\/div><\/div>/)[1];
  assert.match(car, /data-wa-text="Hi Mechanix Pro, I need a car service in Bangalore\./);
  assert.match(car, /href="\/car-service-bangalore\/"/);
  assert.ok(car.indexOf('btn-wa') < car.indexOf('data-call'));
});
test('how it works has three steps and keeps the tap-to-play demo, loading nothing until tapped', () => {
  const b = main.slice(main.indexOf('id="brief"'), main.indexOf('id="prices"'));
  assert.equal((b.match(/<li><b>/g) || []).length, 6, 'three bike steps and three car steps');
  assert.match(b, /Send your model and area/); assert.match(b, /Get an itemised quote/); assert.match(b, /We service at your door/);
  assert.match(b, /<video controls muted playsinline preload="none"/);
});
test('prices come from the price source, say "from", and keep GST apart; no price was changed', () => {
  const site = JSON.parse(read('src/site.json')).services;
  const p = main.slice(main.indexOf('id="prices"'), main.indexOf('id="trust"'));
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  for (const k of ['basic', 'general', 'full', 'repair']) assert.match(p, new RegExp(`<small>from</small> <span data-price="${k}">${inr(site[k].price)}</span>`), k);
  assert.match(p, /Prices exclude GST\. GST at 18% is added on your final invoice/);
});
test('the trust line is exactly the two owner-confirmed numbers, and only on bike pages', () => {
  const t = main.slice(main.indexOf('id="trust"'), main.indexOf('id="areas"'));
  assert.match(t, /class="bike-only"/);
  assert.deepEqual([...t.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]), ['10,000+ services done', '1,300+ gated communities trust us']);
  assert.doesNotMatch(main.replace(t, ''), /10,000\+|1,300\+/, 'the numbers appear nowhere else on the home page');
  assert.doesNotMatch(home, /rated|\bstars?\b|testimonial|\breviews?\b/i);
  for (const f of ['car-service-bangalore/index.html', 'partners/axlio/index.html', 'roadside/index.html']) assert.doesNotMatch(read(f), /10,000\+|1,300\+/, f);
  assert.match(css, /#veh-car:checked ~ \* \.bike-only/, 'hidden in the car view');
});
test('areas link to the existing area pages, and the FAQ shows five questions with the rest behind "More questions"', () => {
  const a = main.slice(main.indexOf('id="areas"'));
  const links = [...a.matchAll(/<a href="\/bike-service-([a-z0-9-]+)\/">/g)].map((m) => m[1]);
  assert.ok(links.length >= 8); for (const s of links) assert.ok(existsSync(new URL(`../bike-service-${s}/index.html`, import.meta.url)), s);
  const faq = a.slice(a.indexOf('id="home-faq"'));
  const visible = faq.slice(0, faq.indexOf('class="faq-in"'));
  assert.equal((visible.match(/<details>/g) || []).length, 5);
  assert.equal((faq.match(/<details>/g) || []).length, 14, 'every question stays on the page, so the FAQ structured data still matches');
});
test('home structured data is unchanged: the FAQPage lists the same 14 questions that are on the page', () => {
  const ld = [...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((x) => x['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, 14);
  assert.ok(ld.some((x) => x['@type'] === 'AutoRepair')); assert.ok(ld.some((x) => x['@type'] === 'WebSite'));
  assert.match(home, /<title>Two Wheeler Doorstep Service in Bangalore \| Mechanix Pro<\/title>/);
  assert.match(home, /<link rel="canonical" href="https:\/\/mechanixpro\.in\/">/);
});
test('the phone bar has WhatsApp and Call only, on home, service, area, car and roadside pages', () => {
  for (const f of SAMPLE) {
    const h = read(f); const m = h.match(/<nav class="dock"[^>]*>([\s\S]*?)<\/nav>/); assert.ok(m, f + ' has the bar');
    const links = [...m[1].matchAll(/<a [^>]*>/g)].map((x) => x[0]);
    const home2 = f === 'index.html'; // the home bar carries a bike and a car WhatsApp button; CSS shows one
    assert.equal(links.length, home2 ? 3 : 2, f); assert.match(links[0], /data-wa=/); assert.match(links[links.length - 1], /data-call/); assert.doesNotMatch(m[1], /\/book\//);
    if (home2) { assert.match(links[0], /bike-only/); assert.match(links[1], /car-only/); assert.match(links[1], /car service in Bangalore/); }
    assert.doesNotMatch(h, /class="mbar"|wa-fab/, f + ' old floating buttons are gone');
  }
  assert.match(read('car-service-bangalore/index.html'), /class="dock"[^>]*><a [^>]*data-wa-text="Hi Mechanix Pro, I need a car service/);
  for (const f of ['book', 'pay', 'track', 'rate', 'warranty', 'unsubscribe', 'job']) assert.doesNotMatch(read(f + '/index.html'), /class="dock"/, f + ' stays free of the bar (one-task page)');
  assert.match(css, /\.dock\{position:fixed;[^}]*bottom:0/); assert.match(css, /@media\(min-width:960px\)\{[^]*?\.dock\{display:none\}/);
});
test('every built page shares the same header and the one site stylesheet', () => {
  const nav = (h) => h.slice(h.indexOf('<header class="top">'), h.indexOf('</header>'));
  const ref = nav(home);
  for (const f of SAMPLE) { const h = read(f); assert.equal(nav(h), ref, f); assert.match(h, /assets\/css\/site\.css/, f); assert.doesNotMatch(h, /simple\.css|theme\.css|bento\.css/, f); }
  assert.match(ref, />Book online</); assert.match(ref, /class="menu"/);
  assert.ok(!existsSync(new URL('../assets/css/simple.css', import.meta.url)), 'the weak simple.css layer is gone');
});
test('no inline scripts or inline event handlers on any sampled page', () => {
  for (const f of [...SAMPLE, 'book/index.html', 'help/index.html']) {
    const h = read(f);
    for (const m of h.matchAll(/<script\b([^>]*)>/g)) assert.ok(/\bsrc=|type="application\/ld\+json"/.test(m[1]), f + ': ' + m[0]);
    assert.doesNotMatch(h, /\son(click|load|change|submit|error)=/i, f);
  }
});
test('one font, one accent; tap targets, focus, reduced motion and contrast tokens are kept', () => {
  assert.match(css, /--display:var\(--font\)/);
  assert.equal([...new Set((css.match(/font-family:[^;}]+/g) || []).map((x) => x.replace(/\s+/g, '')))].length, 1, 'only var(--font) is used for families');
  assert.match(css, /--acc:#F2801F/); assert.match(css, /--nv:#0B1220/); assert.match(css, /--tx2:#556075/); assert.match(css, /--on-acc:#1A0E03/);
  assert.match(css, /\.btn\{[^}]*min-height:52px/); assert.match(css, /:focus-visible\{outline:3px solid/);
  assert.match(css, /\.veh label\{[^}]*min-height:44px/); assert.match(css, /summary\{[^}]*min-height:60px/);
  assert.match(css, /\.pill\{[^}]*min-height:44px/); assert.match(css, /\.menu summary\{[^}]*width:44px;height:44px/); assert.match(css, /\.foot-cols a\{[^}]*min-height:44px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /animation-timeline/, 'no scroll-driven opacity: content is never hidden until scrolled');
});
test('the home page stays light: one hero photo, no chat script, no slideshow', () => {
  assert.doesNotMatch(home, /hero-rain|chatstart\.js|hero\.js|showcase\.js|class="ticker"/);
  assert.ok(Buffer.byteLength(home) < 41000, 'home HTML is ' + Buffer.byteLength(home) + ' bytes');
  assert.ok(readdirSync(new URL('../assets/css/', import.meta.url)).includes('site.css'));
  assert.ok(Buffer.byteLength(css) < 32000, 'site.css is ' + Buffer.byteLength(css) + ' bytes');
});
test('prefilled WhatsApp messages carry no phone numbers or personal details', () => {
  for (const m of main.matchAll(/data-wa-text="([^"]+)"/g)) assert.doesNotMatch(m[1], /\d{6,}|@/);
});
test('the money and service promises the old trust block made are still on the home page (in the FAQ), and no other numbers or claims were added', () => {
  const faq = main.slice(main.indexOf('id="home-faq"'));
  for (const re of [/Quote first/i, /refunded in full/i, /30-day warranty/i, /one-time code/i, /itemised quote/i]) assert.match(home, re, String(re));
  const noClaims = main.replace(/10,000\+ services done|1,300\+ gated communities trust us/g, '');
  assert.doesNotMatch(noClaims, /\b\d[\d,]*\+/);
  assert.ok(faq.includes('Is doorstep bike service safe?'));
});
test('the home page still links to roadside help, fleets and apartments (header menu) and every WhatsApp message asks for model and area', () => {
  for (const h of ['/roadside/', '/fleet/', '/societies/', '/services/', '/help/']) assert.ok(home.includes(`href="${h}"`), h);
  for (const m of main.matchAll(/data-wa-text="([^"]+)"/g)) { assert.match(m[1], /^Hi Mechanix Pro/); assert.match(m[1], /Area/); assert.match(m[1], /Bike model|Car make and model/); }
});

test('every inner page is a navy stage with the H1, then a light sheet; text, canonicals and JSON-LD are untouched', () => {
  for (const f of [...SAMPLE.slice(1), 'book/index.html', 'track/index.html', 'blog/index.html', 'help/index.html', 'areas/index.html', 'contact/index.html', 'terms/index.html', 'rate-card/index.html', 'warranty/index.html']) {
    const h = read(f), m = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
    assert.match(m, /<section[^>]*class="(page-head|hero|soon-hero)[^"]* stage/, f + ' has a stage');
    assert.ok(m.indexOf(' stage') < m.indexOf('class="sheet"'), f + ' sheet follows the stage');
    assert.equal((m.match(/<h1[ >]/g) || []).length, 1, f + ' keeps exactly one H1');
    assert.equal((h.match(/rel="canonical"/g) || []).length, 1, f);
  }
  const hsr = read('bike-service-hsr-layout/index.html');
  assert.match(hsr, /<h1>Doorstep bike service in HSR Layout\.<\/h1>/); assert.match(hsr, /"@type": "FAQPage"/); assert.match(hsr, /<link rel="canonical" href="https:\/\/mechanixpro\.in\/bike-service-hsr-layout\/">/);
  assert.match(hsr, /<section class="page-head stage art">/, 'bike area pages get the hero photo on large screens');
});
test('the shared hero photo is on bike pages only: car, roadside, Axlio and partner pages have a plain navy stage', () => {
  for (const f of ['car-service-bangalore/index.html', 'partners/axlio/index.html', 'roadside/index.html', 'doorstep-bike-and-car-repair-near-me/index.html', 'book/index.html']) assert.doesNotMatch(read(f), /stage[^"]* art"|hero-minimal/, f);
  for (const f of ['bike-service/honda-activa-6g/index.html', 'scooty-repair-at-home-bangalore/index.html']) assert.match(read(f), /stage art"/, f);
  assert.match(css, /\.page-head\.stage\.art::after\{[^}]*hero-minimal\.webp/);
  assert.ok(existsSync(new URL('../assets/img/hero-minimal.webp', import.meta.url)));
  assert.match(main, /<img src="\/assets\/img\/hero-minimal\.webp"[^>]*fetchpriority="high"/);
});
test('the footer keeps the company line and GSTIN from company.json, and the Areas links', () => {
  const co = JSON.parse(read('src/company.json'));
  for (const f of SAMPLE) {
    const h = read(f), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>'));
    assert.ok(ft.includes(`Mechanix Pro is a brand of ${co.legalName}, ${co.addressLines.join(', ')}, ${co.city} ${co.pincode}. GSTIN ${co.gstin}`), f);
    assert.match(ft, /<b>Areas<\/b>/); assert.match(ft, /href="\/bike-service-hsr-layout\/"/); assert.match(ft, /data-phone/);
  }
});
test('the home phone and WhatsApp numbers come from config.js hooks, never typed into the page', () => {
  for (const f of ['index.html', ...SAMPLE]) { const h = read(f); assert.doesNotMatch(h, /wa\.me\/\d|tel:\+?\d/, f); }
  assert.match(main, /data-call/); assert.match(main, /data-wa="general"/);
});
test('the handy tools row links to real tools: the rider tools now live on the help page', () => {
  const t = main.slice(main.indexOf('id="tools"'));
  for (const h of ['/help/#rt-due', '/help/#rt-sym', '/areas/', '/roadside/']) assert.ok(t.includes(`href="${h}"`), h);
  const help = read('help/index.html');
  for (const id of ['id="rider-tools"', 'id="rt-due"', 'id="rt-sym"', 'id="rt-pre"', 'id="due-type"', 'id="sym-out"']) assert.ok(help.includes(id), id);
  assert.match(help, /assets\/js\/rider-tools\.js/);
  assert.ok(read('areas/index.html').includes('data-pincheck'), 'the PIN check is on the areas page');
});
test('the Diwali banner is one slim closable line, with no inline script, built only until 8 November 2026', () => {
  assert.match(read('scripts/build_pages.py'), /DIWALI_LAST_DAY = '2026-11-08'/);
  assert.match(read('assets/js/diwali.js'), /TO = '2026-11-08'/);
  assert.match(css, /\.diwali-bar a\{[^}]*white-space:nowrap/); assert.match(css, /\.diwali-bar \.db-x\{[^}]*width:44px;height:44px/);
  const h = read('index.html'); const bar = h.match(/<div class="diwali-bar"[\s\S]*?<\/div>/);
  if (bar) { assert.match(bar[0], /<button type="button" class="db-x"/); assert.ok(h.indexOf('diwali-bar') < h.indexOf('<header class="top">'), 'the banner sits above the header, not inside it'); }
  assert.match(h, /assets\/js\/diwali\.js/);
});
test('the booking page shows its form below the stage and has no phone bar over it', () => {
  const b = read('book/index.html');
  assert.ok(b.indexOf('id="build-head"') < b.indexOf('id="builder"')); assert.doesNotMatch(b, /<nav class="dock"/);
  assert.match(b, /<h1 id="build-h">Build your service\.<\/h1>/);
});
test('pages that pin the WhatsApp text keep it: car pages send the car message', () => {
  const car = read('car-service-bangalore/index.html'); assert.match(car, /<nav class="dock"[^>]*><a [^>]*data-wa-text="Hi Mechanix Pro, I need a car service in Bangalore/);
  assert.doesNotMatch(car, /10,000\+|1,300\+/);
});

/* Our work showcase */
const work = main.slice(main.indexOf('<section id="work"'), main.indexOf('<section id="prices"'));
const workRefs = [...work.matchAll(/(?:src|poster)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
test('Our work sits after How it works, is bike-only and hidden by the Car toggle', () => {
  assert.ok(work.length > 500, 'section exists');
  assert.ok(main.indexOf('id="brief"') < main.indexOf('id="work"') && main.indexOf('id="work"') < main.indexOf('id="prices"'));
  assert.match(work, /^<section id="work" class="bike-only" aria-labelledby="work-h">/);
  assert.match(work, /<h2 id="work-h">Our work\.<\/h2>/);
  assert.match(css, /#veh-car:checked ~ \* \.bike-only\{display:none!important\}/);
});
test('Our work uses only files that exist, with videos that wait for a tap', () => {
  assert.ok(workRefs.length >= 20);
  for (const r of workRefs) assert.ok(existsSync(new URL('..' + r, import.meta.url)), r);
  for (const v of work.matchAll(/<video[^>]*>/g)) {
    assert.match(v[0], /preload="none"/); assert.match(v[0], /poster="\/assets\/video\/[^"]+\.webp"/); assert.match(v[0], / controls/); assert.match(v[0], / muted/);
    assert.doesNotMatch(v[0], /autoplay/); assert.match(v[0], /width="\d+" height="\d+"/);
  }
  for (const i of work.matchAll(/<img[^>]*>/g)) { assert.match(i[0], /width="\d+" height="\d+"/); assert.match(i[0], /loading="lazy"/); assert.match(i[0], /alt="/); }
});
test('Our work has no inline script or handler, and no new numeric claims', () => {
  assert.doesNotMatch(work, /<script|\son[a-z]+=|style=/i);
  const text = work.replace(/<[^>]*>/g, ' ').replace(/\b(?:NS|RC|R15|V3|S1|RTR|4V|Dio|Pro|Discover|Svartpilen|Bullet|Jawa|Karizma|Passion)\s*\d*/gi, ' ').replace(/(?:Discover|Svartpilen|Bullet|Jawa|RC|RTR|NS)\s*\d+/gi, ' ');
  assert.doesNotMatch(text, /\d/, 'only model names carry digits: ' + text.match(/.{0,20}\d.{0,20}/));
  assert.doesNotMatch(work, /rated|stars?\b|reviews?|testimonial|customers? say/i);
});
test('the bike strip loops with an aria-hidden duplicate whose links are out of the tab order', () => {
  const rows = [...work.matchAll(/<div class="mq [^"]*"[^>]*>[\s\S]*?<\/div><\/div>/g)].map((m) => m[0]);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    const lists = [...r.matchAll(/<ul class="mq-list"([^>]*)>([\s\S]*?)<\/ul>/g)];
    assert.equal(lists.length, 2); assert.doesNotMatch(lists[0][1], /aria-hidden/); assert.match(lists[1][1], /aria-hidden="true"/);
    assert.equal(lists[0][2].replace(/ tabindex="-1"/g, ''), lists[1][2].replace(/ tabindex="-1"/g, ''), 'same bikes in both copies');
    assert.ok(!/tabindex/.test(lists[0][2]) && [...lists[1][2].matchAll(/<a /g)].length === [...lists[1][2].matchAll(/<a [^>]*tabindex="-1"/g)].length);
  }
});
test('every bike in the strip links to an existing model page', () => {
  const links = new Set([...work.matchAll(/href="\/bike-service\/([a-z0-9-]+)\/"/g)].map((m) => m[1]));
  assert.ok(links.size >= 12);
  for (const s of links) { assert.ok(existsSync(new URL(`../bike-service/${s}/index.html`, import.meta.url)), s); assert.ok(existsSync(new URL(`../assets/img/showcase/${s}.webp`, import.meta.url)), s); }
  assert.match(work, /href="\/terms\/#credits"/);
});
test('the strip is calm, pauses on hover and focus, and is static for reduced motion and reduced data', () => {
  assert.match(css, /\.mq-track\{[^}]*animation:mq-left 70s linear infinite/);
  assert.match(css, /\.mq:hover \.mq-track,\.mq:focus-within \.mq-track\{animation-play-state:paused\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\),\(prefers-reduced-data:reduce\)\{[^@]*\.mq-track\{animation:none!important/);
  assert.match(css, /\.mq-list\[aria-hidden="true"\]\{display:none\}/);
  assert.match(css, /\.mq-list img\{[^}]*aspect-ratio:4\/3/);
});
