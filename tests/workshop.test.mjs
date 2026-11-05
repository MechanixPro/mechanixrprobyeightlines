import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const M = JSON.parse(read('src/workshop.json'));
const company = JSON.parse(read('src/company.json'));
const page = read('workshop/index.html');
const home = read('index.html');
const gallery = page.match(/<div class="ws-layout[\s\S]*?<\/p>\s*<\/div><\/section>/)[0];

test('manifest entries are complete and every file exists', () => {
  assert.ok(M.items.length >= 4);
  const ids = new Set();
  for (const it of M.items) {
    assert.ok(!ids.has(it.id), 'duplicate id ' + it.id); ids.add(it.id);
    assert.match(it.kind, /^(photo|video)$/);
    assert.ok(it.alt && it.alt.trim().length > 10, 'alt for ' + it.id);
    assert.ok(it.caption && it.caption.trim(), 'caption for ' + it.id);
    assert.match(it.file, /^[a-z0-9-]+$/);
    if (it.kind === 'photo') for (const w of [600, 1200]) assert.ok(existsSync(new URL(`../assets/img/workshop/${it.file}-${w}.webp`, import.meta.url)), `${it.file}-${w}.webp`);
    else {
      assert.ok(existsSync(new URL(`../assets/video/workshop/${it.file}.mp4`, import.meta.url)));
      if (it.poster) assert.ok(existsSync(new URL(`../assets/img/workshop/${it.poster}-1200.webp`, import.meta.url)));
    }
  }
});
test('every gallery image has alt text and a 600w and 1200w srcset', () => {
  const imgs = gallery.match(/<img [^>]*>/g);
  assert.equal(imgs.length, M.items.filter((i) => i.kind === 'photo').length);
  for (const t of imgs) {
    assert.match(t, /alt="[^"]{10,}"/); assert.match(t, /srcset="[^"]*-600\.webp 600w, [^"]*-1200\.webp 1200w"/);
    assert.match(t, /width="\d+" height="\d+"/);
  }
});
test('no inline scripts or event handlers on the page or the home teaser', () => {
  for (const h of [page, home]) {
    assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/);
    assert.doesNotMatch(h, /\son(click|load|error|keydown|mouseover)=/i);
  }
  assert.match(page, /<script src="\/assets\/js\/workshop\.js" defer>/);
});
test('the page is in the sitemap, the menu, the footer and llms.txt, with a unique title and description', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/mechanixpro\.in\/workshop\/<\/loc>/);
  assert.match(home, /<div class="menu-panel">[\s\S]*href="\/workshop\/"/);
  assert.match(home, /<footer[\s\S]*href="\/workshop\/"/);
  assert.match(read('llms.txt'), /\/workshop\//);
  const t = page.match(/<title>(.*?)<\/title>/)[1], d = page.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(t.length <= 65 && d.length <= 160 && !/\d{5}/.test(d + t));
  assert.notEqual(t, home.match(/<title>(.*?)<\/title>/)[1]);
  assert.equal((page.match(/<h1[ >]/g) || []).length, 1);
});
test('captions and alt text carry no phone numbers or other business names', () => {
  const text = M.items.map((i) => i.alt + ' ' + i.caption).join(' ');
  assert.doesNotMatch(text, /\d{5}|\+91|@|www\.|\.com|\.in\b/i);
  assert.doesNotMatch(text, /honda|yamaha|hero|suzuki|bajaj|aprilia|royal enfield|bike ?bazar|garage/i);
  for (const it of M.items) assert.ok(it.caption.length <= 45, 'captions stay short and descriptive');
});
test('the edit disclosure is under the gallery and says videos are edited for privacy too', () => {
  assert.ok(page.includes('Photos are edited for privacy: faces are blurred and number plates are covered with our label. Signboard artwork shows our branding.'));
  assert.ok(page.includes('Videos are edited for privacy too: faces are blurred, number plates are covered and the sound is removed.'));
  assert.ok(page.indexOf('Photos are edited for privacy') > page.indexOf('ws-grid'));
  assert.ok(page.indexOf('Videos are edited for privacy too') > page.indexOf('ws-grid'));
});
test('only the reviewed videos are published: the custom paint video leads, then the engine rebuild; V1, V3 and V5 are absent', () => {
  const vids = M.items.filter((i) => i.kind === 'video');
  assert.deepEqual(vids.map((v) => v.file), ['custom-paint-finishes', 'engine-frame-rebuild']);
  assert.equal(M.items[0].file, 'custom-paint-finishes'); // first in the manifest
  assert.ok(page.indexOf('custom-paint-finishes.mp4') < page.indexOf('class="ws-a"'), 'the lead video is before every photo');
  assert.ok(page.indexOf('custom-paint-finishes.mp4') < page.indexOf('engine-frame-rebuild.mp4'));
  const dir = readdirSync(new URL('../assets/video/workshop/', import.meta.url));
  assert.deepEqual(dir.filter((f) => /\.mp4$/.test(f)).sort(), ['custom-paint-finishes.mp4', 'engine-frame-rebuild.mp4']);
  assert.ok(!dir.concat(readdirSync(new URL('../assets/img/workshop/', import.meta.url))).some((f) => /workshop-video-[135]/.test(f)));
  assert.doesNotMatch(page, /workshop-video-/);
});
test('videos have controls, muted, playsinline, preload none, a poster, real dimensions, a label and a visible caption, and never autoplay', () => {
  const tags = page.match(/<video [^>]*>/g); assert.equal(tags.length, 2);
  const dims = { 'custom-paint-finishes': [480, 854], 'engine-frame-rebuild': [720, 1280] };
  for (const [name, [w, h]] of Object.entries(dims)) {
    const i = page.indexOf(name + '.mp4'), tag = page.slice(page.lastIndexOf('<video ', i), page.indexOf('>', page.lastIndexOf('<video ', i)) + 1);
    for (const a of ['controls', 'muted', 'playsinline', 'preload="none"']) assert.ok(tag.includes(a), name + ' ' + a);
    assert.ok(tag.includes(`width="${w}" height="${h}"`), name + ' size'); assert.ok(tag.includes(`poster="/assets/img/workshop/${name}-1200.webp"`));
    assert.match(tag, /aria-label="[^"]{20,}"/); assert.doesNotMatch(tag, /autoplay|loop/);
    assert.match(page.slice(i, i + 400), /<figcaption>[^<]{8,}<\/figcaption>/);
  }
});
test('video, poster and page weights stay sensible: each mp4 under 8 MB, posters under 150 KB, the page HTML under 60 KB, the workshop stylesheet under 6 KB', () => {
  const sz = (p) => statSync(new URL('../' + p, import.meta.url)).size;
  for (const f of ['custom-paint-finishes', 'engine-frame-rebuild']) {
    assert.ok(sz(`assets/video/workshop/${f}.mp4`) < 8 * 1024 * 1024, f);
    for (const w of [600, 1200]) assert.ok(sz(`assets/img/workshop/${f}-${w}.webp`) < 150 * 1024, f + w);
  }
  assert.ok(Buffer.byteLength(page) < 60000); assert.ok(sz('assets/css/workshop.css') < 6000);
  assert.doesNotMatch(page, /<video[^>]*preload="(auto|metadata)"/); // nothing downloads until a viewer taps play
  assert.match(page, /<link rel="stylesheet" href="\/assets\/css\/workshop\.css">/);
});
test('trust block uses company.json and only confirmed claims', () => {
  assert.ok(page.includes(company.legalName) && page.includes(company.gstin));
  assert.ok(page.includes(company.addressLines[0]) && page.includes(company.pincode));
  assert.match(page, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Haralur/);
  assert.ok(page.includes('Quote first. Nothing starts without your OK, and your bike leaves only after you share your one-time code.'));
  assert.ok(page.includes('The confirmation fee is adjusted in your final bill.'));
  { const tb = page.match(/<section class="band">[\s\S]*?<\/section>/)[0]; assert.doesNotMatch(tb, /rating|review|certified|stars|award|opening hours|open 24|₹/i); }
});
test('the 10,000+ and 1,300+ claims sit only in the bike-only block', () => {
  const m = page.match(/<li class="bike-only ws-nums">[\s\S]*?<\/li>/)[0];
  assert.match(m, /10,000\+ services done/); assert.match(m, /1,300\+ gated communities trust us/);
  assert.equal(page.replace(m, '').match(/10,000|1,300/g), null);
});
test('structured data parses and holds only facts from company.json', () => {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((x) => JSON.parse(x[1]));
  const biz = blocks.find((b) => b['@type'] === 'AutoRepair');
  assert.equal(biz.address.postalCode, company.pincode); assert.equal(biz.legalName, company.legalName);
  assert.equal(biz.address.streetAddress, company.addressLines.join(', '));
  for (const k of ['geo', 'openingHours', 'openingHoursSpecification', 'aggregateRating', 'review', 'telephone']) assert.equal(biz[k], undefined, k);
});
test('the home teaser shows three photos and links to /workshop/ in the bike view only', () => {
  const t = home.match(/<section id="shop"[\s\S]*?<\/section>/)[0];
  assert.match(t, /class="bike-only"/); assert.match(t, /See our workshop/);
  assert.equal(t.match(/<img /g).length, 3); assert.ok(/<a class="ws-tz" href="\/workshop\/">/.test(t));
  for (const x of t.match(/<img [^>]*>/g)) assert.match(x, /alt="[^"]+"/);
});
test('the add-media guide exists and covers privacy', () => {
  const g = read('docs/ADD-WORKSHOP-MEDIA.md');
  assert.match(g, /workshop\.json/); assert.match(g, /faces/i); assert.match(g, /number plates/i);
});

test('the site build copies the workshop page into the deploy folder', () => {
  assert.match(readFileSync(new URL('../scripts/build_site.sh', import.meta.url), 'utf8'), /for d in workshop /);
});
