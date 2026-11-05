import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
const css = read('assets/css/simple.css');
const SAMPLE = ['index.html', 'bike-service-hsr-layout/index.html', 'bike-service/honda-activa-6g/index.html', 'car-service-bangalore/index.html', 'services/index.html', 'roadside/index.html'];

test('the home page has six sections, in the order a visitor decides', () => {
  const ids = [...main.matchAll(/<section[^>]*id="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['hero', 'actions', 'brief', 'prices', 'trust', 'areas']);
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
  assert.match(css, /#veh-car:checked ~ section \.bike-only\{display:none\}/);
  assert.ok(main.indexOf('id="veh-bike"') < main.indexOf('class="veh"'), 'the toggle sits above the buttons');
  assert.ok(main.indexOf('class="veh"') < main.indexOf('class="bike-only btns"'));
});
test('three buttons in order: WhatsApp quote (main, green), Call now, Book online; the car set swaps wording and links', () => {
  const bike = main.match(/<div class="bike-only btns">([\s\S]*?)<\/div>/)[1];
  const wa = bike.indexOf('btn btn-wa btn-xl'), call = bike.indexOf('data-call'), book = bike.indexOf('href="/book/"');
  assert.ok(wa > -1 && wa < call && call < book, 'WhatsApp, then Call now, then Book online');
  assert.match(bike, /data-wa="general" data-wa-text="Hi Mechanix Pro, I need a service for my bike in Bengaluru\./);
  assert.match(bike, />Book online</); assert.match(bike, />Call now</);
  const car = main.match(/<div class="car-only btns">([\s\S]*?)<\/div>/)[1];
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
  assert.match(css, /#veh-car:checked ~ \.bike-only/, 'hidden in the car view');
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
    assert.equal(links.length, 2, f); assert.match(links[0], /data-wa=/); assert.match(links[1], /data-call/); assert.doesNotMatch(m[1], /\/book\//);
    assert.doesNotMatch(h, /class="mbar"|wa-fab/, f + ' old floating buttons are gone');
  }
  assert.match(read('car-service-bangalore/index.html'), /class="dock"[^>]*><a [^>]*data-wa-text="Hi Mechanix Pro, I need a car service/);
  for (const f of ['book', 'pay', 'track', 'rate', 'warranty', 'unsubscribe']) assert.doesNotMatch(read(f + '/index.html'), /class="dock"/, f + ' stays free of the bar (one-task page)');
  assert.match(css, /\.dock\{position:fixed;[^}]*bottom:0/); assert.match(css, /@media\(min-width:900px\)\{\.dock\{display:none\}\}/);
});
test('every built page shares the same header and the simple layer', () => {
  const nav = (h) => h.slice(h.indexOf('<header class="nav">'), h.indexOf('</header>'));
  const ref = nav(home);
  for (const f of SAMPLE) { const h = read(f); assert.equal(nav(h), ref, f); assert.match(h, /assets\/css\/simple\.css/, f); }
  assert.match(ref, />Book online</);
});
test('no inline scripts or inline event handlers on any sampled page', () => {
  for (const f of [...SAMPLE, 'book/index.html', 'help/index.html']) {
    const h = read(f);
    for (const m of h.matchAll(/<script\b([^>]*)>/g)) assert.ok(/\bsrc=|type="application\/ld\+json"/.test(m[1]), f + ': ' + m[0]);
    assert.doesNotMatch(h, /\son(click|load|change|submit|error)=/i, f);
  }
});
test('one font, one green, one accent; tap targets and focus states are kept', () => {
  assert.match(css, /--display:var\(--font\)/);
  assert.equal([...new Set((css.match(/font-family:[^;}]+/g) || []).map((x) => x.replace(/\s+/g, '')))].length, 1, 'only var(--font) is used for families');
  assert.match(css, /--green:#25D366/); assert.match(css, /--accent:#F2801F/);
  assert.match(css, /\.btn\{min-height:52px/); assert.match(css, /:focus-visible\{outline:3px solid/);
  assert.match(css, /\.veh label\{[^}]*min-height:48px/); assert.match(css, /summary\{[^}]*min-height:60px/);
});
test('the home page stays light: no hero image, no chat script, no slideshow; the page is smaller than before', () => {
  assert.doesNotMatch(home, /hero-rain|chatstart\.js|hero\.js|showcase\.js|class="ticker"/);
  assert.ok(Buffer.byteLength(home) < 30000, 'home HTML is ' + Buffer.byteLength(home) + ' bytes');
  assert.ok(readdirSync(new URL('../assets/css/', import.meta.url)).includes('simple.css'));
  assert.ok(Buffer.byteLength(css) < 12000, 'simple.css is ' + Buffer.byteLength(css) + ' bytes');
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
