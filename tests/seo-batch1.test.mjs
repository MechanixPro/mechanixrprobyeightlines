// SEO batch 1: stale wording, FAQ parity, llms.txt, structured data, technical quick wins. Run on the generated pages (npm run pages first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, publicFiles, htmlFiles, jsonld, flat, strip } from './helpers/pages.mjs';

test('1. no public page or llms.txt carries the retired "pay after" wording (text, meta, og, alt, JSON-LD)', () => {
  const files = publicFiles(); assert.ok(files.length > 200 && files.includes('llms.txt'));
  const bad = /pay after you say yes|pay only after|nothing is charged until|checkup and quote fee/i;
  for (const f of files) assert.doesNotMatch(read(f), bad, f);
  assert.doesNotMatch(read('src/landing.json'), bad);
  assert.doesNotMatch(read('scripts/make_presence.py'), bad);
});
test('1. the og:image:alt describes the confirmation-fee flow on every page', () => {
  for (const f of htmlFiles()) {
    const m = read(f).match(/<meta property="og:image:alt" content="([^"]*)"/);
    if (m) assert.equal(m[1], 'Mechanix Pro: doorstep bike service in Bengaluru. Small confirmation fee, itemised quote before work. Open 24/7.', f);
  }
  assert.match(read('rate-card/index.html'), /Confirm with a small fee adjusted in your bill; approve the quote before work/);
  assert.match(read('two-wheeler-service-at-home-bangalore/index.html'), /Quote first, work only after your OK/);
});

const visibleFaq = (html) => [...html.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)].map((m) => [strip(m[1]).trim(), strip(m[2]).trim()]);
const ldFaq = (html) => { const q = flat(jsonld(html)).find((x) => x['@type'] === 'FAQPage'); return q ? q.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]) : null; };
test('2. FAQPage JSON-LD equals the visible FAQ on /help/ and on home (questions and answers)', () => {
  for (const f of ['help/index.html', 'index.html']) {
    const h = read(f); const vis = visibleFaq(h); const ld = ldFaq(h);
    assert.ok(vis.length >= 5, f); assert.deepEqual(ld, vis, f);
    assert.equal(jsonld(h).filter((x) => x['@type'] === 'FAQPage').length, 1, f + ' has exactly one FAQPage');
  }
});
test('2. /help/: no unresolved placeholders, the real flow in the meta description, warranty wording matches the other pages', () => {
  const h = read('help/index.html');
  assert.doesNotMatch(h, /\{\{[a-z]/i);
  assert.match(h, /name="description" content="[^"]*confirmation fee[^"]*one-time code[^"]*quote/);
  const w = "Parts carry a limited warranty on the terms of the part's manufacturer or supplier, shown on your invoice.";
  assert.ok(strip(h).includes(w));
  assert.doesNotMatch(h, /Parts also carry the manufacturer/);
  const faq = ldFaq(h).find((x) => x[0] === 'Is there a warranty?');
  assert.ok(faq[1].includes(w) && /30 days/.test(faq[1]));
  assert.ok(ldFaq(h).some((x) => /₹49 to ₹99/.test(x[1])), 'fee range is in the FAQ JSON-LD');
});
test('3. home FAQ: How does it work mentions fee, one-time code, itemised quote and approval; pickup answer mentions the final bill', () => {
  const faq = Object.fromEntries(visibleFaq(read('index.html')));
  const how = faq['How does it work?'];
  for (const re of [/confirmation fee \(₹49 to ₹99/, /one-time code/, /itemised quote/, /approve/]) assert.match(how, re);
  const pick = faq['Is pickup and drop free?'];
  assert.doesNotMatch(pick, /along with the doorstep visit/);
  assert.match(pick, /confirmation fee is adjusted in your final bill/); assert.match(pick, /check or repair is quoted first/);
});

const SITE = 'https://mechanixpro.in';
const siteJson = () => JSON.parse(read('src/site.json'));
const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN');
test('4. llms.txt: structure, fee flow, prices from site.json, true PIN count, agent link format, business facts', () => {
  const t = read('llms.txt'), sv = siteJson().services;
  for (const h of ['## How booking works', '## Prices (before 18% GST)', '## Services', '## Trust and safety', '## Area', '## For AI agents', '## Business', '## Pages']) assert.ok(t.includes(h), h);
  assert.match(t, /confirmation fee \(₹49 to ₹99/);
  for (let i = 1; i <= 6; i++) assert.match(t, new RegExp('^' + i + '\\. ', 'm'), 'step ' + i);
  assert.match(t, /\[refund policy\]\(https:\/\/mechanixpro\.in\/refund-policy\/\)/);
  for (const [k, row] of [['basic', 'Basic service'], ['general', 'Standard service'], ['full', 'Full service']]) {
    assert.ok(t.includes(`| ${row} | ${rupee(sv[k].price)} | ${rupee(sv[k + '250'].price)} | ${rupee(sv[k + '500'].price)} |`), row);
  }
  for (const k of ['repair', 'puncture', 'sos']) assert.ok(t.includes(rupee(sv[k].price)), k);
  const pins = Object.keys(JSON.parse(read('src/pincodes.json')).pins);
  assert.equal(pins.length, 106);
  assert.ok(t.includes(`${pins.length} PIN codes between ${pins[0]} and ${pins[pins.length - 1]}`));
  assert.ok(t.includes('/book/?vehicle=bike|car&brand=&model=&service=basic|general|full|repair&area=&pincode='));
  assert.match(t, /Do not quote prices other than/); assert.match(t, /payment themselves/);
  assert.match(t, /NOVA VENTURES/); assert.match(t, /GSTIN 29\w+/); assert.match(t, /hello@mechanixpro\.in/); assert.match(t, /instagram\.com\/themechanixpro/);
  assert.match(t, /10,000\+ services/); assert.match(t, /1,300\+ gated communities/);
  assert.match(t, /Our partner Axlio lists jump start, flat tyre help, towing and fuel delivery for cars in Bengaluru, with the help, price and time confirmed before work starts/);
  assert.doesNotMatch(t, /OTP before the bike leaves/);
  assert.doesNotMatch(t, /pay after you say yes|pay only after|nothing is charged until|checkup and quote fee|349/i);
});
test('4. the llms.txt agent link parameters are the ones the booking page accepts', () => {
  const bp = read('assets/js/book-pay.js');
  for (const p of ['vehicle', 'brand', 'model', 'service', 'area', 'pincode']) assert.ok(bp.includes(`q.get('${p}')`), p);
  assert.match(bp, /\['basic', 'general', 'full', 'repair'\]\.indexOf\(q\.get\('service'\)\)/);
});
test('4. every link in llms.txt points to a page that exists', () => {
  const t = read('llms.txt'); const links = [...new Set([...t.matchAll(/\]\((https:\/\/mechanixpro\.in[^)]*)\)/g)].map((m) => m[1]))];
  assert.ok(links.length >= 15);
  for (const u of links) { const path = u.replace(SITE, ''); assert.ok(publicFiles().includes(path.replace(/^\//, '') + 'index.html'), u); }
  for (const u of ['/garage-partners/', '/workshop/']) assert.ok(t.includes(SITE + u), u);
});

const FEE = /a small confirmation fee, ₹49 to ₹99 depending on your vehicle's engine size/;
test('5. the confirmation fee is stated on /services/, every landing page, and the roadside and car FAQs (JSON-LD equals visible text)', () => {
  assert.match(strip(read('services/index.html')), FEE);
  for (const f of ['two-wheeler-service-at-home-bangalore', 'scooty-repair-at-home-bangalore', 'ev-and-petrol-bike-care-bangalore', 'verified-bike-garages-bangalore', 'digital-service-records', 'doorstep-bike-and-car-repair-near-me', 'major-bike-repair-pickup-and-drop-bangalore']) {
    const h = read(f + '/index.html');
    assert.ok(h.includes('Prices, up front.'), f); assert.match(strip(h), new RegExp('To confirm your slot you pay ' + FEE.source), f);
  }
  for (const f of ['roadside/index.html', 'car-service-bangalore/index.html']) {
    const h = read(f); const ld = ldFaq(h); const vis = visibleFaq(h);
    assert.deepEqual(ld, vis, f); assert.ok(ld.some(([, a]) => FEE.test(a)), f + ' FAQ states the fee');
  }
  assert.doesNotMatch(strip(read('car-service-bangalore/index.html')), /Do I pay before the work\? No\./);
});
test('5. question-style H2s on key pages, H1s unchanged', () => {
  const h2 = (f) => [...read(f).matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map((m) => strip(m[1]).trim());
  const h1 = (f) => (read(f).match(/<h1[^>]*>(.*?)<\/h1>/s) || [])[1];
  assert.ok(h2('index.html').includes('How does doorstep service work?'));
  assert.ok(h2('services/index.html').includes('What does a bike service cost?'));
  assert.ok(h2('roadside/index.html').includes('What does the roadside visit cover?'));
  assert.ok(h2('major-bike-repair-pickup-and-drop-bangalore/index.html').includes('Is pickup and drop free?'));
  assert.equal(strip(h1('services/index.html')), 'Services and prices.');
  assert.equal(strip(h1('roadside/index.html')), 'Bike broken down in Bengaluru? We send the nearest mechanic.');
  assert.ok(read('index.html').includes('id="brief-h"') && read('services/index.html').includes('id="prices"'));
});

// ---- 6. structured data ----
const SITEWIDE = new Set([SITE + '/#business', SITE + '/#website', SITE + '/services/#catalog']);
const nodesOf = (h) => flat(jsonld(h));
const walk = (o, fn) => { if (Array.isArray(o)) o.forEach((x) => walk(x, fn)); else if (o && typeof o === 'object') { fn(o); Object.values(o).forEach((x) => walk(x, fn)); } };
test('6. JSON-LD parses on every page and every @id reference resolves to a node on the page or a known site-wide id', () => {
  let blocks = 0;
  for (const f of htmlFiles()) {
    const h = read(f); const docs = jsonld(h); blocks += docs.length;
    const defined = new Set(); const refs = [];
    walk(docs, (o) => { if (o['@id']) { if (Object.keys(o).length > 1) defined.add(o['@id']); else refs.push(o['@id']); } });
    for (const r of refs) assert.ok(defined.has(r) || SITEWIDE.has(r), `${f}: unresolved @id ${r}`);
  }
  assert.ok(blocks > 500);
});
test('6. #business is defined in full once (home), #website on home, #catalog on /services/, and nothing else re-declares them', () => {
  const full = (f, id) => { let n = 0; walk(jsonld(read(f)), (o) => { if (o['@id'] === id && Object.keys(o).length > 1) n++; }); return n; };
  assert.equal(full('index.html', SITE + '/#business'), 1); assert.equal(full('index.html', SITE + '/#website'), 1);
  assert.equal(full('services/index.html', SITE + '/services/#catalog'), 1);
  for (const f of htmlFiles()) if (f !== 'index.html') {
    const t = read(f); if (!t.includes('"@id": "' + SITE + '/#business"') && !t.includes('/#business')) continue;
    // pages other than home carry the business only as an @id, except the Article publisher/author (a small Organization with the same @id)
    walk(jsonld(t), (o) => { if (o['@id'] === SITE + '/#business' && Object.keys(o).length > 1) assert.ok(o['@type'] === 'Organization' && !o.address && !o.priceRange, f); });
  }
});
test('6. no AggregateRating, Review, or invented ratings anywhere in the generated pages', () => {
  for (const f of htmlFiles()) { const t = read(f); for (const d of jsonld(t)) assert.doesNotMatch(JSON.stringify(d), /AggregateRating|"Review"|ratingValue|reviewCount|aggregateRating/, f); }
});
test('6. priceRange (home) equals the visible Basic-to-Full range', () => {
  const sv = siteJson().services, want = `${rupee(sv.basic.price)}–${rupee(sv.full.price)}`;
  let seen = 0;
  for (const f of htmlFiles()) walk(jsonld(read(f)), (o) => { if (o.priceRange) { seen++; assert.equal(o.priceRange, want, f); assert.ok(strip(read(f)).includes(rupee(sv.basic.price)) && strip(read(f)).includes(rupee(sv.full.price)), f); } });
  assert.ok(seen >= 1);
});
test('6a. model pages: FAQPage, 2-level BreadcrumbList, Service (provider #business, four Offers before GST) and WebPage; a visible breadcrumb matches', () => {
  const slugs = publicFiles().filter((f) => /^bike-service\/[^/]+\/index\.html$/.test(f)); assert.ok(slugs.length >= 170);
  for (const f of slugs) {
    const h = read(f), n = nodesOf(h), types = n.map((x) => x['@type']).sort();
    assert.deepEqual(types, ['BreadcrumbList', 'FAQPage', 'Service', 'WebPage'], f);
    const svc = n.find((x) => x['@type'] === 'Service'), wp = n.find((x) => x['@type'] === 'WebPage'), bc = n.find((x) => x['@type'] === 'BreadcrumbList');
    assert.equal(svc.provider['@id'], SITE + '/#business'); assert.equal(svc.offers.length, 4);
    for (const o of svc.offers) assert.equal(o.priceSpecification.valueAddedTaxIncluded, false);
    assert.equal(wp.about['@id'], svc['@id']); assert.equal(wp.isPartOf['@id'], SITE + '/#website');
    assert.equal(bc.itemListElement.length, 2); assert.equal(bc.itemListElement[0].item, SITE + '/'); assert.ok(!/\/book\/\?/.test(JSON.stringify(bc)), f);
    assert.equal(bc.itemListElement[1].item, SITE + '/' + f.replace('index.html', ''));
    const nav = h.match(/<nav class="breadcrumb" aria-label="Breadcrumb">(.*?)<\/nav>/s); assert.ok(nav, f + ' has a visible breadcrumb nav');
    assert.equal(strip(nav[1]).replace(/\s*›\s*/g, '|').trim(), 'Home|' + bc.itemListElement[1].name, f);
    assert.doesNotMatch(h, /<p class="breadcrumb">/);
  }
});
test('6b. home: one @graph with the full AutoRepair, WebSite and WebPage; no openingHoursSpecification; FAQPage kept', () => {
  const h = read('index.html'), docs = jsonld(h);
  const g = docs.find((d) => d['@graph'])['@graph']; assert.deepEqual(g.map((x) => x['@type']), ['AutoRepair', 'WebSite', 'WebPage']);
  const biz = g[0]; assert.equal(biz['@id'], SITE + '/#business');
  assert.equal(biz.openingHoursSpecification, undefined); assert.equal(biz.contactPoint.telephone, biz.telephone); assert.equal(biz.contactPoint.email, 'hello@mechanixpro.in');
  assert.deepEqual(biz.hasOfferCatalog, { '@id': SITE + '/services/#catalog' });
  assert.equal(g[1]['@id'], SITE + '/#website'); assert.deepEqual(g[1].publisher, { '@id': SITE + '/#business' });
  assert.ok(docs.some((d) => d['@type'] === 'FAQPage')); assert.equal(docs.filter((d) => d['@type'] === 'WebSite').length, 0);
});
test('6c. /services/: BreadcrumbList and an OfferCatalog with a tiered Offer per package, prices before GST from site.json', () => {
  const n = nodesOf(read('services/index.html')); const cat = n.find((x) => x['@type'] === 'OfferCatalog');
  assert.ok(n.some((x) => x['@type'] === 'BreadcrumbList')); assert.equal(cat['@id'], SITE + '/services/#catalog');
  const sv = siteJson().services; assert.equal(cat.itemListElement.length, Object.keys(sv).length);
  for (const o of cat.itemListElement) assert.equal(o.priceSpecification.valueAddedTaxIncluded, false);
  for (const k of Object.keys(sv)) assert.ok(cat.itemListElement.some((o) => o.price === String(sv[k].price) && o.name.startsWith(sv[k].name)), k);
  assert.ok(cat.itemListElement.some((o) => o.name === 'Full service (251-500cc)' && o.price === '2199'));
});
test('6d. /societies/ and /fleet/: BreadcrumbList and a Service for #business, no prices', () => {
  for (const f of ['societies', 'fleet']) {
    const n = nodesOf(read(f + '/index.html')); const svc = n.find((x) => x['@type'] === 'Service');
    assert.ok(n.some((x) => x['@type'] === 'BreadcrumbList'), f); assert.equal(svc.provider['@id'], SITE + '/#business'); assert.equal(svc.offers, undefined, f);
  }
});
test('6e. /workshop/: WebPage about #business (no partial AutoRepair); VideoObjects with the date the video was first published on the site', () => {
  const n = nodesOf(read('workshop/index.html'));
  assert.ok(!n.some((x) => x['@type'] === 'AutoRepair')); const wp = n.find((x) => x['@type'] === 'WebPage');
  assert.deepEqual(wp.about, { '@id': SITE + '/#business' }); assert.deepEqual(wp.mainEntity, { '@id': SITE + '/#business' });
  const vids = n.filter((x) => x['@type'] === 'VideoObject'); assert.equal(vids.length, 2);
  for (const v of vids) { assert.match(v.uploadDate, /^\d{4}-\d{2}-\d{2}$/); assert.ok(v.thumbnailUrl.startsWith(SITE) && v.contentUrl.endsWith('.mp4') && v.name && v.description); }
});
test('6f. area pages and guides do not use the build date as dateModified; guides carry a real first-published date', () => {
  for (const f of htmlFiles().filter((x) => /^bike-service-[^/]+\/index\.html$/.test(x) || x.startsWith('guides/'))) {
    walk(jsonld(read(f)), (o) => assert.equal(o.dateModified, undefined, f));
  }
  for (const g of ['how-often-to-service-your-bike', 'doorstep-bike-service-vs-garage']) {
    const a = nodesOf(read(`guides/${g}/index.html`)).find((x) => x['@type'] === 'Article'); assert.match(a.datePublished, /^2026-10-16$/);
  }
});
test('6g. blog and guide Articles: PNG publisher logo, image, publisher and author by @id', () => {
  const pages = htmlFiles().filter((f) => /^blog\/[^/]+\/index\.html$/.test(f) || /^guides\/[^/]+\/index\.html$/.test(f)); assert.ok(pages.length >= 8);
  for (const f of pages) {
    const a = nodesOf(read(f)).find((x) => x['@type'] === 'Article' || x['@type'] === 'BlogPosting'); assert.ok(a, f);
    assert.equal(a.publisher['@id'], SITE + '/#business'); assert.equal(a.publisher.logo.url, SITE + '/assets/img/icon-512.png'); assert.equal(a.image, SITE + '/assets/img/og.png'); assert.equal(a.author['@id'], SITE + '/#business');
  }
});
test('6h. join and garage-partners: about is an object', () => {
  for (const f of ['join', 'garage-partners']) { const w = nodesOf(read(f + '/index.html')).find((x) => x['@type'] === 'WebPage'); assert.equal(typeof w.about, 'object'); assert.equal(w.about['@id'], SITE + '/#business'); }
});
