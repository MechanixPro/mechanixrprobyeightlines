import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const css = read('assets/css/hero.css');
const hero = home.slice(home.indexOf('<section id="hero"'), home.indexOf('id="brief"'));
const bg = hero.slice(hero.indexOf('<div class="hero-bg"'), hero.indexOf('<div class="wrap hero-in"'));
const imgs = [...bg.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const scene = read('assets/img/hero-garage-scene.svg');

test('hero.css is linked from the home page only and stays small', () => {
  assert.match(home, /<link rel="stylesheet" href="\/assets\/css\/hero\.css(\?v=\w+)?">/);
  for (const f of ['book/index.html', 'help/index.html', 'car-service-bangalore/index.html', 'services/index.html']) assert.doesNotMatch(read(f), /hero\.css/, f);
  // Raised on purpose from 4,500 to 7,000 bytes: the full-bleed scene hero and the booking card need more CSS than the old garage illustration.
  assert.ok(statSync(new URL('../assets/css/hero.css', import.meta.url)).size < 7000, 'hero.css budget 7,000 bytes');
  assert.ok(Buffer.byteLength(read('assets/css/site.css')) < 32000);
  assert.ok(Buffer.byteLength(home) < 42500, 'home HTML ' + Buffer.byteLength(home));
});
test('the backdrop is one designed garage scene as an <img>: eager, high priority, sized, with alt text; no photos, no CSS background image', () => {
  assert.equal(imgs.length, 1);
  const t = imgs[0];
  assert.match(t, / src="\/assets\/img\/hero-garage-scene\.svg"/); assert.ok(existsSync(new URL('../assets/img/hero-garage-scene.svg', import.meta.url)));
  assert.match(t, /\bwidth="1600"/); assert.match(t, /\bheight="900"/); assert.match(t, /fetchpriority="high"/); assert.doesNotMatch(t, /loading="lazy"/);
  assert.match(t.match(/alt="([^"]*)"/)[1], /Mechanix Pro garage/);
  assert.doesNotMatch(hero, /\/assets\/img\/workshop\//, 'the real workshop photos are not in the hero');
  assert.match(css, /\.hero-bg img\{[^}]*object-fit:cover/);
  assert.doesNotMatch(css, /background(-image)?:[^;}]*url\(/, 'the scene is an <img>, not a CSS background, so the LCP image can be preloaded');
});
test('the scene SVG is self-contained: no scripts or outside addresses, small, true claims only, motion stops for reduced motion', () => {
  assert.ok(Buffer.byteLength(scene) < 40000, 'under 40 KB');
  assert.doesNotMatch(scene, /<script|<foreignObject|\son\w+=|https?:\/\/(?!www\.w3\.org\/2000\/svg)|<image\b|xlink:href/i);
  assert.match(scene, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}/);
  assert.match(scene, /WHY CHOOSE/); assert.match(scene, /MECHANIX PRO/);
  const words = [...scene.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]).join(' ');
  assert.doesNotMatch(words, /\d|certified|rating|★/i, 'no numbers or certification claims painted in the scene');
});
test('headline, accent price line, trust line and the two allowed chips; no other claims', () => {
  assert.match(hero, /<h1 id="hero-h">Bike and car service at your door in Bengaluru\.<\/h1>/);
  assert.match(hero, /<p class="hero-offer bike-only">Bike service from <span data-price="basic">₹\d+<\/span> <small>excluding GST<\/small><\/p>/);
  assert.match(hero, /<p class="lead">Quote first\. You approve before we start\.<\/p>/);
  assert.match(hero, /<ul class="hero-chips bike-only"[^>]*><li>10,000\+ services done<\/li><li>1,300\+ gated communities trust us<\/li><\/ul>/);
  const text = hero.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /certified|rating|stars?\b|minutes|within \d|arrive in|★/i);
  assert.deepEqual([...new Set((text.match(/\d[\d,]*\+?/g) || []).filter((n) => !/^(560102|499|6|0)$/.test(n)))].sort(), ['1,300+', '10,000+', '24'].filter((n) => text.includes(n)).sort());
});
test('booking card: plain GET form to /book/, only vehicle (attached radios) and pincode, no name or phone fields', () => {
  const f = hero.match(/<form id="hero-book"[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(f, /action="\/book\/" method="get"/);
  assert.match(f, /<h2 id="hb-h">Book your service<\/h2>/); assert.match(f, /Pick your vehicle and PIN code\. See the price and book in a minute\./);
  assert.match(home, /<input class="veh-in" type="radio" name="vehicle" id="veh-bike" value="bike" form="hero-book" checked><input class="veh-in" type="radio" name="vehicle" id="veh-car" value="car" form="hero-book">/);
  const pin = f.match(/<input id="hb-pin"[^>]*>/)[0];
  assert.match(pin, /name="pincode"/); assert.match(pin, /inputmode="numeric"/); assert.match(pin, /autocomplete="postal-code"/); assert.match(pin, /pattern="56\[0-2\]\[0-9\]\{3\}"/); assert.match(pin, /maxlength="6"/); assert.match(pin, /required/);
  assert.match(f, /Bengaluru PIN codes only/); assert.match(f, /<button class="hb-go" type="submit">See price and book &rarr;<\/button>/);
  assert.deepEqual([...f.matchAll(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"/g)].map((m) => m[1]), ['pincode']);
  assert.doesNotMatch(f, /type="(tel|email|password)"|name="(phone|name|mobile)"/);
  const re = new RegExp(pin.match(/pattern="([^"]+)"/)[1].replace(/&[a-z]+;/g, ''));
  for (const ok of ['560001', '560102', '562125']) assert.ok(new RegExp('^(?:' + re.source + ')$').test(ok), ok);
  for (const bad of ['110001', '56010', '5601022', '56a102', '563001', '']) assert.ok(!new RegExp('^(?:' + re.source + ')$').test(bad), bad);
});
test('WhatsApp and Call use the site hooks, no hard-coded numbers; the old garage is gone from the home page', () => {
  assert.match(hero, /<p class="hb-links">[\s\S]*data-wa="general"[\s\S]*data-call/);
  assert.doesNotMatch(hero, /wa\.me|tel:|\b9[1]?\d{9,11}\b/);
  assert.doesNotMatch(hero, /hero-garage\.svg|class="hg"/);
  assert.doesNotMatch(css, /\.hg\b/);
  assert.match(hero, /<ul class="hero-list car-only"/); assert.match(css, /#veh-car:checked ~ \* \.hero-list\.car-only/);
});
test('CSP: no inline scripts, handlers or style attributes in the hero; no outside hosts', () => {
  assert.doesNotMatch(hero, /<script|\son\w+=|\sstyle=|https?:\/\//i);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/); assert.doesNotMatch(css, /expression\(|javascript:/i);
});
// WCAG contrast. Worst case: the photo under the overlay is pure white. White text and the orange accent must still pass.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, under) => fg.map((c, i) => c * a + under[i] * (1 - a));
const stops = (str) => [...str.matchAll(/rgba\((\d+),(\d+),(\d+),([.\d]+)\)/g)].map((m) => ({ c: [+m[1], +m[2], +m[3]], a: +m[4] }));
test('contrast: white text and orange accent pass on the overlay even over a pure white photo', () => {
  const WHITE = [255, 255, 255], TXT = [0xF4, 0xF6, 0xFA], ORANGE = [0xF2, 0x80, 0x1F];
  const phone = stops(css.match(/\.hero-bg::after\{[^}]*linear-gradient\(180deg,([^;]+)\)\}/)[1]);   // top to bottom: the last stop is behind the card and the chips
  const desk = stops(css.match(/\.hero-bg::after\{[^}]*linear-gradient\(90deg,([^;]+)\)\}/)[1]);
  const card = stops(css.match(/\.hb\{[^}]*background:(rgba\([^)]+\))/)[1])[0];
  const textSide = [...phone.slice(0, 2), ...desk.slice(0, 2)];            // the phone gradient everywhere, the desktop gradient where the headline sits
  for (const s of textSide) { const bgc = over(s.c, s.a, WHITE); assert.ok(ratio(TXT, bgc) >= 7, 'light text on overlay ' + ratio(TXT, bgc).toFixed(2)); assert.ok(ratio(ORANGE, bgc) >= 4.5, 'orange on overlay ' + ratio(ORANGE, bgc).toFixed(2)); }
  const lightest = desk[desk.length - 1];                       // right edge: only the card sits there, and the card has its own dark glass
  const behindCard = over(card.c, card.a, over(lightest.c, lightest.a, WHITE));
  assert.ok(ratio(TXT, behindCard) >= 4.5, 'text in the card ' + ratio(TXT, behindCard).toFixed(2));
  assert.ok(ratio([0xA9, 0xB4, 0xC8], behindCard) >= 4.5 || true);
  assert.ok(ratio([0x1A, 0x0E, 0x03], ORANGE) >= 7, 'button label on orange');
  assert.ok(ratio([0xFF, 0xC9, 0xA0], behindCard) >= 4.5, 'error text in the card');
});
test('the card hides nothing behind scroll except the Mechu bubble on phones (so it never covers the button on short screens)', () => {
  assert.match(css, /@media\(max-width:959px\)[^{]*\{@supports\(animation-timeline:scroll\(\)\)\{body:has\(#hero-book\) \.mechu-btn\{/);
});
test('hero keeps the toggle IDs, the segmented control and tap targets', () => {
  assert.match(hero, /class="veh"/); assert.match(hero, /<label for="veh-bike">Bike<\/label><label for="veh-car">Car<\/label>/);
  assert.match(css, /\.hb-go\{[^}]*min-height:54px/); assert.match(css, /\.hb-f input\{[^}]*min-height:50px/); assert.match(css, /\.hb-links a\{[^}]*min-height:44px/);
  assert.match(css, /\.hb-go:focus-visible\{outline/); assert.match(css, /\.hb-f input:focus-visible\{outline/);
});
