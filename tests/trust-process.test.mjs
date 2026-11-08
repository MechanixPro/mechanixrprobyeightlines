// /our-process/ is built by scripts/build_pages.py from src/our-process.html. These tests read the built page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../our-process/index.html', import.meta.url), 'utf8');
const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
const text = main.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

test('nine step titles, in order', () => {
  const titles = [...main.matchAll(/<h3><small>STEP (\d)<\/small>([^<]+)<\/h3>/g)];
  assert.equal(titles.length, 9);
  titles.forEach((m, i) => assert.equal(Number(m[1]), i + 1));
  const starts = ['You book and pay', 'You get your booking ID', 'We confirm your slot', 'They tell you when', 'At the door you share', 'They inspect and send', 'Photos at pickup', 'You pay the final amount', 'Your repair work is covered'];
  starts.forEach((s, i) => assert.ok(titles[i][2].startsWith(s), `step ${i + 1}: ${titles[i][2]}`));
});
test('fee and warranty come from the site data, not typed in', () => {
  assert.match(text, /₹49 to ₹99/);
  assert.match(text, /covered for 30 days/);
  assert.ok(!main.includes('{{'), 'unfilled placeholder');
});
test('no forbidden words', () => {
  for (const w of ['guaranteed', '100%', 'police', 'zero risk', 'insured', 'assurance']) assert.ok(!text.toLowerCase().includes(w), w);
});
test('no hard-coded phone number in the page body', () => {
  assert.ok(!/(\+91|\b91)[\s-]?\d{5}[\s-]?\d{5}\b|\b\d{10}\b/.test(main));
  assert.ok(main.includes('data-call') && main.includes('data-wa="general"'));
});
test('canonical, OG, title, sitemap, llms.txt, no FAQ schema', () => {
  assert.match(page, /<title>How we keep your bike safe \| Mechanix Pro<\/title>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/mechanixpro\.in\/our-process\/">/);
  assert.match(page, /property="og:url" content="https:\/\/mechanixpro\.in\/our-process\/"/);
  assert.ok(!page.includes('FAQPage'));
  assert.ok(readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8').includes('https://mechanixpro.in/our-process/'));
  assert.ok(readFileSync(new URL('../llms.txt', import.meta.url), 'utf8').includes('https://mechanixpro.in/our-process/'));
});
test('links to /book/, /terms/, /refund-policy/, /track/, /privacy/', () => {
  for (const h of ['/book/', '/terms/', '/refund-policy/', '/track/', '/privacy/']) assert.ok(main.includes(`href="${h}"`), h);
});
test('touchpoints: footer, book pay card list, home', () => {
  for (const f of ['../index.html', '../help/index.html', '../book/index.html']) assert.ok(readFileSync(new URL(f, import.meta.url), 'utf8').includes('href="/our-process/"'), f);
  const book = readFileSync(new URL('../book/index.html', import.meta.url), 'utf8');
  assert.match(book, /<ul class="bk-trust"[\s\S]*?href="\/our-process\/"[\s\S]*?<\/ul>/);
});
