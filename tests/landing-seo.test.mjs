import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LAND = JSON.parse(read('src/landing.json'));
const sitemap = read('sitemap.xml');

test('there is a page for each search the owner named', () => {
  const slugs = LAND.map((x) => x.slug);
  for (const s of ['two-wheeler-service-at-home-bangalore', 'scooty-repair-at-home-bangalore', 'ev-and-petrol-bike-care-bangalore', 'verified-bike-garages-bangalore', 'digital-service-records', 'doorstep-bike-and-car-repair-near-me']) assert.ok(slugs.includes(s), s);
});
test('each landing page has one h1, its own title and description, a canonical, structured data and a sitemap entry', () => {
  const titles = new Set();
  for (const x of LAND) {
    const h = read(`${x.slug}/index.html`);
    assert.equal((h.match(/<h1/g) || []).length, 1, x.slug);
    const t = h.match(/<title>(.*?)<\/title>/)[1]; assert.ok(t.length <= 65 && t.length >= 25, x.slug + ' title ' + t.length); assert.ok(!titles.has(t), 'duplicate title'); titles.add(t);
    const d = h.match(/<meta name="description" content="(.*?)"/)[1]; assert.ok(d.length >= 90 && d.length <= 165, x.slug + ' desc ' + d.length);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://mechanixpro.in/${x.slug}/">`));
    for (const type of ['FAQPage', 'Service', 'BreadcrumbList']) assert.match(h, new RegExp(`"@type": "${type}"`), x.slug + ' ' + type);
    for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) JSON.parse(m[1]);
    assert.ok(sitemap.includes(`https://mechanixpro.in/${x.slug}/`), 'sitemap ' + x.slug);
    assert.doesNotMatch(h, /\{\{|undefined/, x.slug);
  }
});
test('the pages use the owner\'s own words and make no claim the site has not been given', () => {
  const all = LAND.map((x) => JSON.stringify(x)).join(' ');
  for (const w of ['as fast as 2 hours', 'Bangalore', 'Mechanix Pro Certified', 'digital service record', 'scooty repair at home']) assert.match(all, new RegExp(w, 'i'), w);
  assert.doesNotMatch(all, /\d+\s?(%|stars?|reviews?)|best in|number one|#1|cheapest|guarantee/i);
  assert.match(JSON.stringify(LAND.find((x) => x.slug === 'doorstep-bike-and-car-repair-near-me')), /Mechanix Pro services bikes and scooters/);
});
test('the home page links to every landing page and says Bangalore as well as Bengaluru', () => {
  const home = read('index.html');
  for (const x of LAND) assert.ok(home.includes(`href="/${x.slug}/"`), x.slug);
  assert.match(home, /Bangalore/); assert.match(home, /Bengaluru|Bangalore/);
  const sd = home.match(/<title>(.*?)<\/title>/)[1]; assert.match(sd, /Bangalore/);
});
