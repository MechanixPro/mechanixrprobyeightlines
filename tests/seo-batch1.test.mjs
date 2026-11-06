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
