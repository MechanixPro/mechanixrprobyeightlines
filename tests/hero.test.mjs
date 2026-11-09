import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('index.html');
const css = read('assets/css/hero.css');
const hero = home.slice(home.indexOf('<section id="hero"'), home.indexOf('id="how-hub"'));   // changed on purpose 2026-11-09: the animated booking journey now follows the hero
const art = hero.slice(hero.indexOf('<figure class="hero-media"'), hero.indexOf('</figure>') + 9);
const imgs = [...art.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const scene = read('assets/img/hero-garage-scene.svg');

test('hero.css is linked from the home page only and stays small', () => {
  assert.match(home, /<link rel="stylesheet" href="\/assets\/css\/hero\.css(\?v=\w+)?">/);
  for (const f of ['book/index.html', 'help/index.html', 'car-service-bangalore/index.html', 'services/index.html']) assert.doesNotMatch(read(f), /hero\.css/, f);
  // Raised on purpose to 9,500 bytes: the video hero, the booking bar and the Why choose row need more CSS than the earlier hero.
  // Raised again on purpose to 12,500 bytes for the hero picture carousel.
  // Raised once more to 14,000 bytes for the garages gallery on the home page (2026-11-08).
  assert.ok(statSync(new URL('../assets/css/hero.css', import.meta.url)).size < 14000, 'hero.css budget 14,000 bytes');
  assert.ok(Buffer.byteLength(read('assets/css/site.css')) < 32000);
  assert.ok(Buffer.byteLength(home) < 66000, 'home HTML ' + Buffer.byteLength(home));   // raised on purpose to 66,000 (2026-11-09): journey, Pro Check, comparison, partner, helpline and app sections
});
// Changed on purpose (owner's own garage render and video): the hero shows the owner's illustrated Mechanix Pro garage as a short muted loop (bike view) and a still (car view), beside the headline.
test('the hero media: a muted looping garage video with a poster (bike view) and a car still (car view); sized, alt text, no audio, files exist', () => {
  assert.match(art, /^<figure class="hero-media"/);
  const v = art.match(/<video\b[^>]*>/)[0];
  for (const a of ['autoplay', 'muted', 'loop', 'playsinline']) assert.match(v, new RegExp('\\b' + a + '\\b'), a);
  assert.match(v, /poster="\/assets\/img\/hero\/hero-garage-poster\.webp"/); assert.match(v, /width="1280"/); assert.match(v, /height="572"/); assert.match(v, /aria-label="[^"]+"/);
  const src = art.match(/<source src="([^"]+)" type="video\/mp4">/)[1];
  assert.ok(existsSync(new URL('..' + src, import.meta.url)), src); assert.ok(statSync(new URL('..' + src, import.meta.url)).size < 2_200_000, 'video under 2.2 MB');
  assert.ok(existsSync(new URL('../assets/img/hero/hero-garage-poster.webp', import.meta.url)));
  // Changed on purpose (hero carousel): the pictures are now carousel slides (data-src, car set is the second carousel). See tests/hero-slider.test.mjs.
  assert.equal(imgs.length, 6); const t = imgs.find((i) => /hero-car-1200/.test(i));
  assert.match(art, /<div class="hs car-only"/); assert.match(t, /\balt="[^"]{20,}"/); assert.match(t, /\balt="[^"]{20,}"/); assert.match(t, /width="800"/); assert.match(t, /height="619"/);   // changed on purpose: the car picture is cropped to the photo (no dark pad)
  for (const m of t.matchAll(/\/assets\/img\/hero\/[\w-]+\.webp/g)) assert.ok(existsSync(new URL('..' + m[0], import.meta.url)), m[0]);
  assert.doesNotMatch(art, /Illustration|hm-ill/, 'owner: do not show the word Illustration on the hero');
  assert.doesNotMatch(hero, /\/assets\/img\/workshop\//, 'the real workshop photos are not in the hero');
  assert.doesNotMatch(css, /background(-image)?:[^;}]*url\(/);
});
test('the video file has no audio track and no metadata beyond the container basics', () => {
  const b = readFileSync(new URL('../assets/video/hero-garage.mp4', import.meta.url));
  assert.ok(!b.includes(Buffer.from('mp4a')), 'no AAC audio track');
  for (const bad of ['gemini', 'Gemini', 'Google', 'Veo']) assert.ok(!b.includes(Buffer.from(bad)), 'no ' + bad + ' tag');
});
test('the small video script respects reduced motion and data saving, and makes no outside request', () => {
  const j = read('assets/js/hero-video.js');
  assert.match(j, /prefers-reduced-motion: reduce/); assert.match(j, /saveData/); assert.match(j, /\.pause\(\)/);
  assert.doesNotMatch(j, /fetch\(|XMLHttpRequest|https?:\/\//);
  assert.match(home, /<script src="\/assets\/js\/hero-video\.js(\?v=\w+)?" defer><\/script>/);
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
// Changed on purpose (owner: "remove the pincode"): the hero card no longer asks for a PIN code. It sends only the vehicle (Bike or Car) to /book/, where the address step asks for the PIN code.
test('booking card: plain GET form to /book/ that sends only the vehicle; no PIN, name or phone field', () => {
  const f = hero.match(/<form id="hero-book"[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(f, /action="\/book\/" method="get"/);
  assert.match(f, /<h2 id="hb-h">Book your service<\/h2>/); assert.match(f, /Pick your vehicle\. See the price and book in a minute\./);
  assert.match(home, /<input class="veh-in" type="radio" name="vehicle" id="veh-bike" value="bike" form="hero-book" checked><input class="veh-in" type="radio" name="vehicle" id="veh-car" value="car" form="hero-book">/);
  assert.deepEqual([...f.matchAll(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"/g)].map((m) => m[1]), [], 'the card has no fields of its own; the vehicle radios are attached by the form attribute');
  assert.doesNotMatch(f, /pincode|PIN code|postal-code|type="(tel|email|password)"|name="(phone|name|mobile)"/i);
  assert.match(f, /<button class="hb-go" type="submit">See price and book &rarr;<\/button>/);
});
test('WhatsApp and Call use the site hooks, no hard-coded numbers; the old garage is gone from the home page', () => {
  assert.match(hero, /<p class="hb-links">[\s\S]*data-wa="general"[\s\S]*data-call/);
  assert.doesNotMatch(hero, /wa\.me|tel:|\b9[1]?\d{9,11}\b/);
  assert.doesNotMatch(hero, /hero-garage\.svg|hero-garage-scene|class="hg"/);
  assert.doesNotMatch(css, /\.hg\b/);
  assert.match(hero, /<ul class="hero-list car-only"/); assert.match(css, /#veh-car:checked ~ \* \.hero-list\.car-only/);
});
test('CSP: no inline scripts, handlers or style attributes in the hero; no outside hosts', () => {
  assert.doesNotMatch(hero.replace(/<script src="\/assets\/js\/hero-(video|slider)\.js(\?v=\w+)?" defer><\/script>/g, ''), /<script|\son\w+=|\sstyle=|https?:\/\//i);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/); assert.doesNotMatch(css, /expression\(|javascript:/i);
});
// WCAG contrast. The text sits on the dark navy stage gradient (and its faint orange glow), never on the picture.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, under) => fg.map((c, i) => c * a + under[i] * (1 - a));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
test('contrast: light text and the orange accent pass on every colour of the solid navy stage gradient, and the card text passes on its glass', () => {
  // Changed on purpose: the hero now sits on the brand wave image (assets/img/bg), not a gradient. These are the wave's own navy tones where the text sits (left and middle of the image, sampled), plus the header navy.
  const bgs = [hex('#031947'), hex('#041a47'), hex('#0a1a44')];
  assert.match(read('assets/css/site.css'), /#hero\.stage\{background:linear-gradient\(180deg,#031947 0,rgba\(3,25,71,0\) 120px\),url\(\/assets\/img\/bg\/brand-wave-800\.webp\)/);
  const TXT = [0xF4, 0xF6, 0xFA], ORANGE = [0xF2, 0x80, 0x1F];
  // The headline, price line and chips sit on this plain navy (the video lives in its own panel to the right and fades into it).
  for (const b of bgs) { assert.ok(ratio(TXT, b) >= 7, 'light text ' + ratio(TXT, b).toFixed(2)); assert.ok(ratio(ORANGE, b) >= 4.5, 'orange ' + ratio(ORANGE, b).toFixed(2)); }
  const card = css.match(/\.hero-book \.hb\{[^}]*background:rgba\((\d+),(\d+),(\d+),([.\d]+)\)/);
  const behindCard = over([+card[1], +card[2], +card[3]], +card[4], bgs[2]);
  assert.ok(ratio(TXT, behindCard) >= 7, 'text in the card ' + ratio(TXT, behindCard).toFixed(2));
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
